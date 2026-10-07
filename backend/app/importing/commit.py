from __future__ import annotations

from datetime import datetime, timezone

from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from app.db import allocate_student_code
from app.errors import AppError
from app.importing.plan import apply_decisions
from app.security import name_key


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def known_sessions(db, institute_id: str) -> dict[str, list[str]]:
    known: dict[str, list[str]] = {}
    batches = {
        item["_id"]: item["session_key"]
        async for item in db.batches.find({"institute_id": institute_id})
    }
    cursor = db.enrollment_names.find({"institute_id": institute_id})
    async for row in cursor:
        session_key = batches.get(row["batch_id"])
        if session_key:
            known.setdefault(row["name_key"], []).append(session_key)
    return known


async def commit_import(db, client, job: dict, actor: dict, confirm_updates: bool = False) -> dict:
    known = await known_sessions(db, actor["institute_id"])
    plan = apply_decisions(job["parsed"], job.get("decisions") or {}, known)
    from app.importing.counts import annotate_plan

    await annotate_plan(db, actor["institute_id"], plan)
    if plan["blockers"]:
        raise AppError(422, "import.blocked", "Resolve the listed rows before committing.", blockers=plan["blockers"])
    if plan["totals"].get("updates") and not confirm_updates:
        raise AppError(
            422,
            "import.confirm_updates",
            "Confirm the preview before changing existing draft results.",
            updates=plan["totals"]["updates"],
        )
    committed = set(job.get("committed_sheets") or [])
    outcomes = list(job.get("outcomes") or [])
    job_ledger = _ledger()
    by_sheet = []
    for sheet in plan["sheets"]:
        if not sheet["included"]:
            if not any(item.get("sheet_id") == sheet["id"] and item.get("status") == "skipped" for item in outcomes):
                outcomes.append({"sheet_id": sheet["id"], "name": sheet["name"], "status": "skipped", "reason": sheet.get("skip_reason") or "Skipped."})
            by_sheet.append({"id": sheet["id"], "name": sheet["name"], "status": "skipped", "counts": sheet.get("planned")})
            continue
        if sheet["id"] in committed:
            by_sheet.append({"id": sheet["id"], "name": sheet["name"], "status": "already_committed", "counts": sheet.get("planned")})
            continue
        ledger = _ledger()
        try:
            async with await client.start_session() as session:
                async with session.start_transaction():
                    published_changes = await _commit_sheet(db, session, job, actor, sheet, ledger)
        except DuplicateKeyError as exc:
            raise AppError(409, "import.conflict", "Another import saved this record first. Open the preview again.") from exc
        await _apply_published_corrections(db, client, actor, published_changes, ledger)
        for kind, buckets in ledger.items():
            for bucket, keys in buckets.items():
                job_ledger[kind][bucket].update(keys)
        by_sheet.append({"id": sheet["id"], "name": sheet["name"], "status": "committed", "counts": _from_ledger(ledger)})
        committed.add(sheet["id"])
        outcomes.append({"sheet_id": sheet["id"], "name": sheet["name"], "status": "committed"})
        await db.import_jobs.update_one(
            {"_id": job["_id"]},
            {"$set": {"committed_sheets": list(committed), "outcomes": outcomes, "state": "committing"}},
        )
    summary = _from_ledger(job_ledger)
    for item in by_sheet:
        if item["status"] == "skipped" and item.get("counts"):
            _merge_counts(summary, item["counts"])
    stored_summary = {"counts": summary, "by_sheet": by_sheet}
    await db.import_jobs.update_one(
        {"_id": job["_id"]},
        {"$set": {"state": "committed", "committed_sheets": list(committed), "outcomes": outcomes, "summary": stored_summary, "committed_at": _now()}},
    )
    await db.audit_events.insert_one(
        {
            "_id": str(ObjectId()),
            "institute_id": actor["institute_id"],
            "action": "import.commit",
            "actor_id": actor["_id"],
            "at": _now(),
            "context": {"import_id": job["_id"], "file": job.get("filename")},
        }
    )
    return {"state": "committed", "outcomes": outcomes, "summary": stored_summary}


def _ledger() -> dict:
    return {kind: {bucket: set() for bucket in ("insert", "update", "unchanged", "skip", "reject")} for kind in ("academic", "students", "enrollments", "results")}


def _note(ledger: dict, kind: str, bucket: str, key: str) -> None:
    ledger[kind][bucket].add(str(key))


def _from_ledger(ledger: dict) -> dict:
    return {kind: {bucket: len(keys) for bucket, keys in buckets.items()} for kind, buckets in ledger.items()}


def _merge_counts(target: dict, source: dict) -> None:
    for kind, buckets in source.items():
        for bucket, count in buckets.items():
            target[kind][bucket] += count


async def _apply_published_corrections(db, client, actor: dict, changes: list, ledger: dict) -> None:
    from app.acl import allows
    from app.importing.publish import correct_marksheet

    grouped: dict[str, list] = {}
    for change in changes:
        grouped.setdefault(change["marksheet_id"], []).append(change)
    for marksheet_id, rows in grouped.items():
        sheet = await db.marksheets.find_one({"_id": marksheet_id})
        resource = {
            "institute_id": sheet["institute_id"],
            "branch_id": sheet.get("branch_id"),
            "course_id": sheet.get("course_id"),
            "batch_id": (sheet.get("batch_ids") or [None])[0],
            "subject_id": sheet.get("subject_id"),
            "paper_id": sheet.get("paper_id"),
        }
        if not allows(actor.get("grants") or [], "marksheet.correct", resource):
            raise AppError(403, "auth.forbidden", "You do not have permission to correct a published marksheet.")
        reason = "; ".join(dict.fromkeys(row["reason"] for row in rows))
        await correct_marksheet(
            db,
            client,
            actor,
            sheet,
            reason,
            [{"result_id": row["result_id"], "score": row["score"], "status": row["status"]} for row in rows],
            sheet.get("edit_version", 0),
        )
        for row in rows:
            _note(ledger, "results", "update", row["result_id"])


def _same_mark(existing: dict, student: dict) -> bool:
    if existing.get("status") != student.get("status"):
        return False
    left, right = existing.get("score"), student.get("score")
    if left is None or right is None:
        return left is None and right is None
    return float(left) == float(right)


async def _commit_sheet(db, session, job: dict, actor: dict, sheet: dict, ledger: dict) -> list:
    institute_id = actor["institute_id"]
    branch, branch_new = await _ensure(
        db, "branches", session,
        {"institute_id": institute_id, "name_key": name_key(sheet["branch_name"])},
        {"institute_id": institute_id, "name": sheet["branch_name"], "name_key": name_key(sheet["branch_name"])},
    )
    _note(ledger, "academic", "insert" if branch_new else "unchanged", branch["_id"])
    course, course_new = await _ensure(
        db, "courses", session,
        {"institute_id": institute_id, "name_key": name_key(sheet["course_name"])},
        {"institute_id": institute_id, "name": sheet["course_name"], "name_key": name_key(sheet["course_name"])},
    )
    _note(ledger, "academic", "insert" if course_new else "unchanged", course["_id"])
    offering, offering_new = await _ensure(
        db, "offerings", session,
        {"branch_id": branch["_id"], "course_id": course["_id"]},
        {"institute_id": institute_id, "branch_id": branch["_id"], "course_id": course["_id"]},
    )
    _note(ledger, "academic", "insert" if offering_new else "unchanged", offering["_id"])
    subject, subject_new = await _ensure(
        db, "subjects", session,
        {"course_id": course["_id"], "name_key": name_key(sheet["subject_name"])},
        {"institute_id": institute_id, "course_id": course["_id"], "name": sheet["subject_name"], "name_key": name_key(sheet["subject_name"])},
    )
    _note(ledger, "academic", "insert" if subject_new else "unchanged", subject["_id"])
    paper, paper_new = await _ensure(
        db, "papers", session,
        {"subject_id": subject["_id"], "number": sheet["paper_number"]},
        {"institute_id": institute_id, "subject_id": subject["_id"], "number": sheet["paper_number"], "name": f"Paper {sheet['paper_number']}"},
    )
    _note(ledger, "academic", "insert" if paper_new else "unchanged", paper["_id"])
    batch_ids = []
    for batch in sheet["batches"]:
        saved, batch_new = await _ensure(
            db, "batches", session,
            {"offering_id": offering["_id"], "session_key": batch["session_key"]},
            {
                "institute_id": institute_id,
                "offering_id": offering["_id"],
                "branch_id": branch["_id"],
                "course_id": course["_id"],
                "session_key": batch["session_key"],
                "name": batch["label"],
            },
        )
        batch_ids.append(saved["_id"])
        _note(ledger, "academic", "insert" if batch_new else "unchanged", saved["_id"])
    session_to_batch = {batch["session_key"]: batch_ids[index] for index, batch in enumerate(sheet["batches"])}
    queued = []
    for group in sheet["groups"]:
        if group["interpretation"] == "skip_duplicate":
            for student in group["students"]:
                _note(ledger, "results", "skip", f"{sheet['id']}:{group['id']}:{student['row']}")
            continue
        queued.extend(await _commit_group(db, session, job, actor, sheet, group, branch, course, subject, paper, batch_ids, session_to_batch, ledger))
    return queued


async def _commit_group(db, session, job, actor, sheet, group, branch, course, subject, paper, batch_ids, session_to_batch, ledger: dict) -> list:
    queued: list = []
    institute_id = actor["institute_id"]
    title = sheet["title"]
    title_key = sheet["title_key"]
    if group["interpretation"] in {"separate_assessment", "component"}:
        label = "component" if group["interpretation"] == "component" else "marks"
        title = f"{sheet['title']} ({group['maximum']} {label})"
        title_key = f"{sheet['title_key']} {group['maximum']} {group['interpretation']}"
    sessions = tuple(batch["session_key"] for batch in sheet["batches"])
    identity = "|".join((name_key(sheet["subject_name"]), title_key, sheet["format"], ",".join(sessions)))
    assessment, assessment_new = await _ensure(
        db, "assessments", session,
        {"institute_id": institute_id, "identity_key": identity},
        {
            "institute_id": institute_id,
            "identity_key": identity,
            "title": title,
            "title_key": title_key,
            "exam_type": sheet["exam_type"],
            "format": sheet["format"],
            "subject_id": subject["_id"],
            "paper_id": paper["_id"],
            "branch_id": branch["_id"],
            "course_id": course["_id"],
            "batch_ids": batch_ids,
            "series": sheet["series"],
            "exam_date": sheet["exam_date"],
            "maximum": group["maximum"],
        },
    )
    _note(ledger, "academic", "insert" if assessment_new else "unchanged", assessment["_id"])
    attempt_kind = "retest" if sheet["attempt"] == "retest" or group["interpretation"] == "retest" else "original"
    attempt, attempt_new = await _ensure(
        db, "attempts", session,
        {"assessment_id": assessment["_id"], "kind": attempt_kind},
        {"institute_id": institute_id, "assessment_id": assessment["_id"], "kind": attempt_kind, "maximum": group["maximum"]},
    )
    _note(ledger, "academic", "insert" if attempt_new else "unchanged", attempt["_id"])
    cohort_key = "|".join(batch_ids)
    marksheet, created = await _ensure(
        db, "marksheets", session,
        {"assessment_id": assessment["_id"], "attempt_id": attempt["_id"], "cohort_key": cohort_key},
        {
            "institute_id": institute_id,
            "assessment_id": assessment["_id"],
            "attempt_id": attempt["_id"],
            "cohort_key": cohort_key,
            "branch_id": branch["_id"],
            "course_id": course["_id"],
            "subject_id": subject["_id"],
            "paper_id": paper["_id"],
            "batch_ids": batch_ids,
            "title": title,
            "maximum": group["maximum"],
            "exam_type": sheet["exam_type"],
            "exam_date": sheet["exam_date"],
            "status": "draft",
            "revision": 1,
            "active_revision": None,
            "source_job_id": job["_id"],
            "source_file": job.get("filename"),
            "source_sheet": sheet["name"],
            "uploader_id": actor["_id"],
            "file_id": job.get("file_id"),
            "edit_version": 0,
            "heading_conflict": sheet["heading_conflict"],
            "heading_acknowledged": sheet["heading_acknowledged"],
        },
    )
    _note(ledger, "academic", "insert" if created else "unchanged", marksheet["_id"])
    stored = []
    if not created:
        stored = await db.results.find({"marksheet_id": marksheet["_id"]}, session=session).to_list(length=5000)
    revision = marksheet.get("active_revision") or marksheet.get("revision") or 1
    by_student = {row["student_id"]: row for row in stored if row.get("revision") == revision}
    published = marksheet.get("status") == "published"
    for student in group["students"]:
        if not str(student.get("display_name") or "").strip():
            continue
        batch_id = session_to_batch[student["batch_session"]]
        if published:
            existing_name = await db.enrollment_names.find_one(
                {"batch_id": batch_id, "name_key": student["name_key"]}, session=session
            )
            existing = by_student.get(existing_name["student_id"]) if existing_name else None
            if existing and (_same_mark(existing, student) or student.get("correction") == "keep"):
                _note(ledger, "results", "unchanged", existing["_id"])
            elif existing and student.get("correction") == "replace" and str(student.get("correction_reason") or "").strip():
                queued.append({
                    "marksheet_id": marksheet["_id"],
                    "result_id": existing["_id"],
                    "score": student.get("score"),
                    "status": student.get("status"),
                    "reason": student["correction_reason"],
                })
            else:
                _note(ledger, "results", "reject", f"{marksheet['_id']}:{student['name_key']}:{student['row']}")
            continue
        person, student_new = await _student_for_batch(db, session, institute_id, batch_id, student)
        _note(ledger, "students", "insert" if student_new else "unchanged", person["_id"])
        enrollment, enrollment_new = await _ensure(
            db, "enrollments", session,
            {"student_id": person["_id"], "batch_id": batch_id},
            {
                "institute_id": institute_id,
                "student_id": person["_id"],
                "branch_id": branch["_id"],
                "course_id": course["_id"],
                "batch_id": batch_id,
            },
        )
        _note(ledger, "enrollments", "insert" if enrollment_new else "unchanged", enrollment["_id"])
        await _ensure(
            db, "enrollment_names", session,
            {"batch_id": batch_id, "name_key": student["name_key"]},
            {"institute_id": institute_id, "batch_id": batch_id, "student_id": person["_id"], "name_key": student["name_key"]},
        )
        existing = by_student.get(person["_id"])
        if existing and _same_mark(existing, student):
            _note(ledger, "results", "unchanged", existing["_id"])
            continue
        if existing:
            await db.results.update_one(
                {"_id": existing["_id"]},
                {"$set": {
                    "status": student["status"],
                    "score": student["score"],
                    "percentage": student["percentage"],
                    "rank": student["rank"],
                    "band": student["band"],
                }},
                session=session,
            )
            _note(ledger, "results", "update", existing["_id"])
            continue
        result_id = str(ObjectId())
        await db.results.insert_one(
            {
                "_id": result_id,
                "institute_id": institute_id,
                "marksheet_id": marksheet["_id"],
                "enrollment_id": enrollment["_id"],
                "student_id": person["_id"],
                "revision": revision if not created else 1,
                "active": False,
                "status": student["status"],
                "score": student["score"],
                "maximum": group["maximum"],
                "percentage": student["percentage"],
                "rank": student["rank"],
                "band": student["band"],
                "exam_date": sheet["exam_date"],
                "title": title,
                "assessment_id": assessment["_id"],
                "attempt_kind": attempt_kind,
                "exam_type": sheet["exam_type"],
                "counts_in_aggregate": group["interpretation"] != "component",
                "source_rank": student["source_rank"],
                "branch_id": branch["_id"],
                "course_id": course["_id"],
                "batch_id": batch_id,
                "subject_id": subject["_id"],
                "paper_id": paper["_id"],
                "source": {"file": job.get("filename"), "sheet": sheet["name"], "row": student["row"], "column": student["column"]},
            },
            session=session,
        )
        _note(ledger, "results", "insert", result_id)
    return queued


async def _student_for_batch(db, session, institute_id: str, batch_id: str, student: dict) -> tuple[dict, bool]:
    existing = await db.enrollment_names.find_one(
        {"batch_id": batch_id, "name_key": student["name_key"]}, session=session
    )
    if existing:
        found = await db.students.find_one({"_id": existing["student_id"]}, session=session)
        if found:
            return found, False
    code = await allocate_student_code(db, session, "IAM")
    document = {
        "_id": str(ObjectId()),
        "institute_id": institute_id,
        "student_code": code,
        "display_name": student["display_name"],
        "name_key": student["name_key"],
    }
    await db.students.insert_one(document, session=session)
    return document, True


async def _ensure(db, collection: str, session, query: dict, document: dict) -> tuple[dict, bool]:
    found = await db[collection].find_one(query, session=session)
    if found:
        return found, False
    document = {**document, "_id": str(ObjectId())}
    await db[collection].insert_one(document, session=session)
    return document, True
