from __future__ import annotations

from datetime import datetime, timezone

from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from app.db import allocate_enrollment_code, allocate_student_code
from app.enrollment import enrollment_fields, name_document, require_open_batch
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
    if job.get("bundle"):
        return await commit_bundle_import(db, client, job, actor, confirm_updates=confirm_updates)
    if job.get("exam_id"):
        return await commit_exam_import(db, client, job, actor, confirm_updates=confirm_updates)
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
    attributed: set[str] = set(job.get("batch_ids") or [])
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
                    published_changes, sheet_batches = await _commit_sheet(db, session, job, actor, sheet, ledger)
        except DuplicateKeyError as exc:
            raise AppError(409, "import.conflict", "Another import saved this record first. Open the preview again.") from exc
        except AppError:
            raise
        except Exception:
            attributed.update(await _existing_batch_ids(db, actor["institute_id"], sheet))
            await _mark_sheet_failed(db, job, actor, sheet, outcomes, committed, attributed)
            raise
        attributed.update(sheet_batches)
        await _apply_published_corrections(db, client, actor, published_changes, ledger)
        for kind, buckets in ledger.items():
            for bucket, keys in buckets.items():
                job_ledger[kind][bucket].update(keys)
        by_sheet.append({"id": sheet["id"], "name": sheet["name"], "status": "committed", "counts": _from_ledger(ledger)})
        committed.add(sheet["id"])
        outcomes.append({"sheet_id": sheet["id"], "name": sheet["name"], "status": "committed"})
        await db.import_jobs.update_one(
            {"_id": job["_id"]},
            {"$set": {
                "committed_sheets": list(committed),
                "outcomes": outcomes,
                "state": "committing",
                "batch_ids": sorted(attributed),
            }},
        )
    summary = _from_ledger(job_ledger)
    for item in by_sheet:
        if item["status"] == "skipped" and item.get("counts"):
            _merge_counts(summary, item["counts"])
    stored_summary = {"counts": summary, "by_sheet": by_sheet}
    await db.import_jobs.update_one(
        {"_id": job["_id"]},
        {"$set": {
            "state": "committed",
            "committed_sheets": list(committed),
            "outcomes": outcomes,
            "summary": stored_summary,
            "committed_at": _now(),
            "batch_ids": sorted(attributed),
        }},
    )
    await _record_import(db, actor, job, attributed, "Imported a marklist", "/ecr")
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
    await _refresh_committed_marksheets(db, actor["institute_id"], job)
    return {"state": "committed", "outcomes": outcomes, "summary": stored_summary}


async def _existing_batch_ids(db, institute_id: str, sheet: dict) -> list[str]:
    branch = await db.branches.find_one({
        "institute_id": institute_id,
        "name_key": name_key(sheet.get("branch_name") or ""),
    })
    course = await db.courses.find_one({
        "institute_id": institute_id,
        "name_key": name_key(sheet.get("course_name") or ""),
    })
    if branch is None or course is None:
        return []
    offering = await db.offerings.find_one({"branch_id": branch["_id"], "course_id": course["_id"]})
    if offering is None:
        return []
    found = []
    for batch in sheet.get("batches") or []:
        row = await db.batches.find_one({
            "offering_id": offering["_id"],
            "session_key": batch.get("session_key"),
        })
        if row:
            found.append(row["_id"])
    return found


async def _mark_sheet_failed(db, job: dict, actor: dict, sheet: dict, outcomes: list, committed: set, batch_ids: set[str]) -> None:
    failed = {
        "sheet_id": sheet["id"],
        "name": sheet["name"],
        "status": "failed",
        "error": "This sheet could not be saved.",
    }
    state = "failed" if not committed else "committing"
    stored = {
        "state": state,
        "outcomes": [*outcomes, failed],
        "batch_ids": sorted(batch_ids),
        "committed_sheets": list(committed),
    }
    if state == "failed":
        stored["error"] = "This import could not be saved."
        stored["failed_at"] = _now()
    await db.import_jobs.update_one({"_id": job["_id"]}, {"$set": stored})
    if state == "failed":
        await _record_import(db, actor, job, batch_ids, "An import failed", "/ecr")


async def _refresh_committed_marksheets(db, institute_id: str, job: dict) -> None:
    from app.assessments.marks import refresh_sheet_marks

    query: dict = {"institute_id": institute_id}
    if job.get("file_id"):
        query["file_id"] = job["file_id"]
    elif job.get("filename"):
        query["source_file"] = job["filename"]
    else:
        return
    for sheet in await db.marksheets.find(query).to_list(length=100):
        await refresh_sheet_marks(db, sheet)


async def _refresh_committed_marksheets(db, institute_id: str, job: dict) -> None:
    from app.assessments.marks import refresh_sheet_marks

    query: dict = {"institute_id": institute_id}
    if job.get("file_id"):
        query["file_id"] = job["file_id"]
    elif job.get("filename"):
        query["source_file"] = job["filename"]
    else:
        return
    sheets = await db.marksheets.find(query).to_list(length=200)
    for sheet in sheets:
        await refresh_sheet_marks(db, sheet)


async def _record_import(db, actor: dict, job: dict, batch_ids: set[str], action: str, href: str) -> None:
    from app.business import write_business

    sample = None
    if batch_ids:
        sample = await db.batches.find_one({"_id": sorted(batch_ids)[0], "institute_id": actor["institute_id"]})
    await write_business(
        db,
        actor,
        action=action,
        record=job.get("filename") or "Import",
        href=href,
        permission="marksheet.view",
        collection="import_jobs",
        record_id=job["_id"],
        course_id=(sample or {}).get("course_id") or "",
        branch_id=(sample or {}).get("branch_id") or "",
        batch_id=(sample or {}).get("_id") or "",
    )


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
        updates = [row for row in rows if not row.get("insert")]
        inserts = [row for row in rows if row.get("insert")]
        reason = "; ".join(dict.fromkeys(row["reason"] for row in rows if row.get("reason")))
        corrected = await correct_marksheet(
            db,
            client,
            actor,
            sheet,
            reason,
            [{"result_id": row["result_id"], "score": row["score"], "status": row["status"]} for row in updates],
            sheet.get("edit_version", 0),
        )
        for row in inserts:
            document = dict(row["document"])
            document["_id"] = str(ObjectId())
            document["revision"] = corrected["revision"]
            document["active"] = True
            await db.results.insert_one(document)
            _note(ledger, "results", "insert", document["_id"])
        for row in updates:
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
                "name_key": name_key(batch["label"]),
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
    return queued, batch_ids


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
            enrollment_fields(
                institute_id=institute_id,
                student_id=person["_id"],
                branch_id=branch["_id"],
                course_id=course["_id"],
                batch_id=batch_id,
            ),
        )
        if enrollment_new or not enrollment.get("enrollment_code"):
            code = await allocate_enrollment_code(db, session)
            await db.enrollments.update_one(
                {"_id": enrollment["_id"], "enrollment_code": {"$exists": False}},
                {"$set": {"enrollment_code": code}},
                session=session,
            )
            enrollment["enrollment_code"] = enrollment.get("enrollment_code") or code
        _note(ledger, "enrollments", "insert" if enrollment_new else "unchanged", enrollment["_id"])
        stored_name = name_document(
            institute_id=institute_id,
            batch_id=batch_id,
            student_id=person["_id"],
            name_key=student["name_key"],
        )
        stored_name.pop("_id")
        await _ensure(
            db, "enrollment_names", session,
            {"batch_id": batch_id, "name_key": student["name_key"]},
            stored_name,
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
    matches = await db.enrollment_names.find(
        {"batch_id": batch_id, "name_key": student["name_key"]}, session=session
    ).to_list(length=5)
    if len(matches) > 1:
        raise AppError(
            409,
            "import.ambiguous_name",
            f"More than one student in this batch is named {student['display_name']}. Choose which student this row is.",
        )
    if matches:
        found = await db.students.find_one({"_id": matches[0]["student_id"]}, session=session)
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


async def commit_exam_import(db, client, job: dict, actor: dict, confirm_updates: bool = False) -> dict:
    from app.importing.exam_plan import annotate_exam_plan

    exam = await db.exams.find_one({"_id": job["exam_id"], "institute_id": actor["institute_id"]})
    if exam is None:
        raise AppError(404, "not_found", "That record was not found.")
    marksheet = await db.marksheets.find_one({"_id": exam["marksheet_id"], "institute_id": actor["institute_id"]})
    if marksheet is None:
        raise AppError(404, "not_found", "That record was not found.")
    known = await known_sessions(db, actor["institute_id"])
    plan = apply_decisions(job["parsed"], job.get("decisions") or {}, known)
    await annotate_exam_plan(db, plan, exam)
    if plan["blockers"]:
        raise AppError(422, "import.blocked", "Resolve the listed rows before committing.", blockers=plan["blockers"])
    if plan["totals"].get("updates") and not confirm_updates:
        raise AppError(
            422,
            "import.confirm_updates",
            "Confirm the preview before changing existing draft results.",
            updates=plan["totals"]["updates"],
        )
    sheet = next(item for item in plan["sheets"] if item["included"])
    group = next(item for item in sheet["groups"] if item["interpretation"] != "skip_duplicate")
    ledger = _ledger()
    try:
        async with await client.start_session() as session:
            async with session.start_transaction():
                published_changes = await _commit_exam_group(
                    db, session, job, actor, exam, marksheet, sheet, group, ledger
                )
    except DuplicateKeyError as exc:
        raise AppError(409, "import.conflict", "Another import saved this record first. Open the preview again.") from exc
    await _apply_published_corrections(db, client, actor, published_changes, ledger)
    summary = _from_ledger(ledger)
    by_sheet = [{"id": sheet["id"], "name": sheet["name"], "status": "committed", "counts": summary}]
    outcomes = [*list(job.get("outcomes") or []), {"sheet_id": sheet["id"], "name": sheet["name"], "status": "committed"}]
    for skipped in plan["sheets"]:
        if skipped["included"]:
            continue
        outcomes.append({"sheet_id": skipped["id"], "name": skipped["name"], "status": "skipped", "reason": "Another sheet was saved for this exam."})
    stored_summary = {"counts": summary, "by_sheet": by_sheet}
    batch_ids = list(exam.get("batch_ids") or [])
    await db.import_jobs.update_one(
        {"_id": job["_id"]},
        {"$set": {
            "state": "committed",
            "committed_sheets": [sheet["id"]],
            "outcomes": outcomes,
            "summary": stored_summary,
            "committed_at": _now(),
            "batch_ids": batch_ids,
            "marksheet_id": marksheet["_id"],
        }},
    )
    href = "/ecr/import"
    await _record_import(db, actor, job, set(batch_ids), "Imported a marklist", href)
    await db.audit_events.insert_one(
        {
            "_id": str(ObjectId()),
            "institute_id": actor["institute_id"],
            "action": "import.commit",
            "actor_id": actor["_id"],
            "at": _now(),
            "context": {"import_id": job["_id"], "file": job.get("filename"), "exam_id": exam["_id"]},
        }
    )
    from app.assessments.marks import refresh_sheet_marks

    fresh = await db.marksheets.find_one({"_id": marksheet["_id"], "institute_id": actor["institute_id"]})
    if fresh:
        await refresh_sheet_marks(db, fresh)
    return {"state": "committed", "outcomes": outcomes, "summary": stored_summary}


async def _commit_exam_group(db, session, job, actor, exam, marksheet, sheet, group, ledger) -> list:
    queued: list = []
    institute_id = actor["institute_id"]
    batch_ids = list(exam.get("batch_ids") or [])
    batches = {
        item["_id"]: item
        for item in await db.batches.find({"_id": {"$in": batch_ids}}, session=session).to_list(length=50)
    }
    await db.marksheets.update_one(
        {"_id": marksheet["_id"]},
        {"$set": {
            "source_job_id": job["_id"],
            "source_file": job.get("filename"),
            "source_sheet": sheet["name"],
            "file_id": job.get("file_id"),
            "uploader_id": actor["_id"],
        }},
        session=session,
    )
    _note(ledger, "academic", "unchanged", marksheet["_id"])
    stored = await db.results.find({"marksheet_id": marksheet["_id"]}, session=session).to_list(length=5000)
    revision = marksheet.get("active_revision") or marksheet.get("revision") or 1
    by_student = {row["student_id"]: row for row in stored if row.get("revision") == revision}
    published = marksheet.get("status") == "published"
    for student in group["students"]:
        if not str(student.get("display_name") or "").strip():
            continue
        if published:
            matches = await db.enrollment_names.find(
                {"batch_id": {"$in": batch_ids}, "name_key": student["name_key"]},
                session=session,
            ).to_list(length=10)
            matched_ids = {row["student_id"] for row in matches}
            existing = by_student.get(next(iter(matched_ids))) if len(matched_ids) == 1 else None
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
        matches = await db.enrollment_names.find(
            {"batch_id": {"$in": batch_ids}, "name_key": student["name_key"]},
            session=session,
        ).to_list(length=10)
        matched: dict[str, dict] = {}
        for row in matches:
            matched.setdefault(row["student_id"], row)
        if len(matched) != 1:
            _note(ledger, "results", "reject" if len(matched) > 1 else "skip", f"{marksheet['_id']}:{student['name_key']}:{student['row']}")
            continue
        name_row = next(iter(matched.values()))
        person = await db.students.find_one({"_id": name_row["student_id"]}, session=session)
        batch_id = name_row["batch_id"]
        enrollment = None
        if person:
            enrollment = await db.enrollments.find_one(
                {"student_id": person["_id"], "batch_id": batch_id},
                session=session,
            )
        if person is None or enrollment is None:
            _note(ledger, "results", "skip", f"{marksheet['_id']}:{student['name_key']}:{student['row']}")
            continue
        batch = batches.get(batch_id) or {}
        _note(ledger, "students", "unchanged", person["_id"])
        _note(ledger, "enrollments", "unchanged", enrollment["_id"])
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
                "revision": revision,
                "active": False,
                "status": student["status"],
                "score": student["score"],
                "maximum": exam["maximum"],
                "percentage": student["percentage"],
                "rank": student["rank"],
                "band": student["band"],
                "exam_date": exam.get("exam_date"),
                "title": exam.get("title"),
                "assessment_id": exam["assessment_id"],
                "attempt_kind": "original",
                "exam_type": exam.get("exam_type"),
                "counts_in_aggregate": True,
                "source_rank": student["source_rank"],
                "branch_id": batch.get("branch_id") or "",
                "course_id": exam["course_id"],
                "batch_id": batch_id,
                "subject_id": exam["subject_id"],
                "paper_id": exam.get("paper_id") or "",
                "source": {"file": job.get("filename"), "sheet": sheet["name"], "row": student["row"], "column": student["column"]},
            },
            session=session,
        )
        _note(ledger, "results", "insert", result_id)
    return queued


async def commit_bundle_import(db, client, job: dict, actor: dict, confirm_updates: bool = False) -> dict:
    from app.importing.bundle_plan import annotate_bundle_plan

    known = await known_sessions(db, actor["institute_id"])
    plan = apply_decisions(job["parsed"], job.get("decisions") or {}, known)
    await annotate_bundle_plan(db, plan, job)
    if plan["blockers"]:
        raise AppError(422, "import.blocked", "Resolve the listed rows before committing.", blockers=plan["blockers"])
    if plan["totals"].get("updates") and not confirm_updates:
        raise AppError(
            422,
            "import.confirm_updates",
            "Confirm the preview before changing existing draft results.",
            updates=plan["totals"]["updates"],
        )
    await _require_bundle_batches(db, actor, plan)
    ledger = _ledger()
    outcomes = []
    by_sheet = []
    queued: list = []
    try:
        async with await client.start_session() as session:
            async with session.start_transaction():
                for sheet in plan["sheets"]:
                    if not sheet.get("included"):
                        outcomes.append({
                            "sheet_id": sheet["id"],
                            "name": sheet["name"],
                            "status": "skipped",
                            "reason": "Left out.",
                        })
                        by_sheet.append({
                            "id": sheet["id"],
                            "name": sheet["name"],
                            "status": "skipped",
                            "counts": sheet.get("planned"),
                        })
                        continue
                    group = next(item for item in sheet["groups"] if item["interpretation"] != "skip_duplicate")
                    exam, marksheet, created = await _bundle_exam(db, session, job, actor, sheet, ledger)
                    queued.extend(await _commit_bundle_scores(
                        db, session, job, actor, exam, marksheet, sheet, group, ledger,
                    ))
                    outcomes.append({
                        "sheet_id": sheet["id"],
                        "name": sheet["name"],
                        "status": "committed",
                        "exam_id": exam["_id"],
                        "created": created,
                    })
                    by_sheet.append({
                        "id": sheet["id"],
                        "name": sheet["name"],
                        "status": "committed",
                        "counts": sheet.get("planned"),
                    })
    except DuplicateKeyError as exc:
        raise AppError(409, "import.conflict", "Another import saved this record first. Open the preview again.") from exc
    await _apply_published_corrections(db, client, actor, queued, ledger)
    summary = {"counts": _from_ledger(ledger), "by_sheet": by_sheet}
    saved_batches = _bundle_batch_ids(plan)
    await db.import_jobs.update_one(
        {"_id": job["_id"]},
        {"$set": {
            "state": "committed",
            "committed_sheets": [item["sheet_id"] for item in outcomes if item["status"] == "committed"],
            "outcomes": outcomes,
            "summary": summary,
            "committed_at": _now(),
            "batch_ids": saved_batches,
        }},
    )
    await _record_import(db, actor, job, set(saved_batches), "Imported exam marklists", "/ecr")
    await db.audit_events.insert_one({
        "_id": str(ObjectId()),
        "institute_id": actor["institute_id"],
        "action": "import.commit",
        "actor_id": actor["_id"],
        "at": _now(),
        "context": {"import_id": job["_id"], "file": job.get("filename"), "bundle": True},
    })
    from app.assessments.marks import refresh_sheet_marks

    for item in outcomes:
        exam_id = item.get("exam_id")
        if item.get("status") != "committed" or not exam_id:
            continue
        sheet = await db.marksheets.find_one({"exam_id": exam_id, "institute_id": actor["institute_id"]})
        if sheet:
            await refresh_sheet_marks(db, sheet)
    return {"state": "committed", "outcomes": outcomes, "summary": summary}


def _bundle_batch_ids(plan: dict) -> list[str]:
    found: list[str] = []
    for sheet in plan["sheets"]:
        if not sheet.get("included"):
            continue
        for batch_id in sheet.get("selected_batch_ids") or []:
            if batch_id not in found:
                found.append(batch_id)
    return found


async def _require_bundle_batches(db, actor: dict, plan: dict) -> None:
    from app.acl import allows

    batch_ids = _bundle_batch_ids(plan)
    stored = {
        item["_id"]: item
        for item in await db.batches.find(
            {"_id": {"$in": batch_ids}, "institute_id": actor["institute_id"]}
        ).to_list(length=len(batch_ids) or 1)
    }
    for sheet in plan["sheets"]:
        if not sheet.get("included"):
            continue
        for batch_id in sheet.get("selected_batch_ids") or []:
            batch = stored.get(batch_id)
            if batch is None:
                raise AppError(422, "exam.batch", f"Choose a batch for {sheet['name']}.")
            resource = {
                "institute_id": actor["institute_id"],
                "branch_id": batch.get("branch_id"),
                "course_id": batch.get("course_id"),
                "batch_id": batch["_id"],
                "subject_id": None,
                "paper_id": None,
            }
            if not allows(actor.get("grants") or [], "marksheet.upload", resource, False):
                raise AppError(403, "auth.forbidden", "You do not have permission for that action.")


async def _bundle_exam(db, session, job: dict, actor: dict, sheet: dict, ledger: dict) -> tuple[dict, dict, bool]:
    fields = sheet["exam"]
    matched = sheet.get("matched_exam") or {}
    batch_ids = list(sheet.get("selected_batch_ids") or [])
    if not batch_ids:
        raise AppError(422, "exam.batch", f"Choose a batch for {sheet['name']}.")
    if matched.get("id"):
        exam = await db.exams.find_one({"_id": matched["id"], "institute_id": actor["institute_id"]}, session=session)
        marksheet = await db.marksheets.find_one({"_id": exam["marksheet_id"]}, session=session)
        if sorted(exam.get("batch_ids") or []) != sorted(batch_ids):
            await db.exams.update_one({"_id": exam["_id"]}, {"$set": {"batch_ids": batch_ids}}, session=session)
            await db.marksheets.update_one(
                {"_id": marksheet["_id"]},
                {"$set": {"batch_ids": batch_ids, "cohort_key": "|".join(batch_ids)}},
                session=session,
            )
            if exam.get("assessment_id"):
                await db.assessments.update_one(
                    {"_id": exam["assessment_id"]},
                    {"$set": {"batch_ids": batch_ids}},
                    session=session,
                )
            exam["batch_ids"] = batch_ids
            marksheet["batch_ids"] = batch_ids
        chosen_kind = fields.get("exam_kind") or ""
        if chosen_kind and chosen_kind != (exam.get("exam_kind") or ""):
            await db.exams.update_one({"_id": exam["_id"]}, {"$set": {"exam_kind": chosen_kind}}, session=session)
            await db.marksheets.update_one({"_id": marksheet["_id"]}, {"$set": {"exam_kind": chosen_kind}}, session=session)
            if exam.get("assessment_id"):
                await db.assessments.update_one(
                    {"_id": exam["assessment_id"]},
                    {"$set": {"exam_kind": chosen_kind}},
                    session=session,
                )
            exam["exam_kind"] = chosen_kind
            marksheet["exam_kind"] = chosen_kind
        _note(ledger, "academic", "unchanged", marksheet["_id"])
        return exam, marksheet, False
    exam_id = str(ObjectId())
    assessment_id = str(ObjectId())
    attempt_id = str(ObjectId())
    sheet_id = str(ObjectId())
    branch = await db.batches.find_one({"_id": batch_ids[0]}, session=session) if batch_ids else {}
    scope = fields.get("scope") or {"kind": "subject", "item_ids": []}
    maximum = float(fields["maximum"])
    exam = {
        "_id": exam_id,
        "institute_id": actor["institute_id"],
        "course_id": job.get("course_id") or "",
        "subject_id": fields.get("subject_id") or "",
        "title": fields.get("title") or sheet["name"],
        "title_key": name_key(fields.get("title") or sheet["name"]),
        "exam_date": fields.get("exam_date") or "",
        "maximum": maximum,
        "scope": scope,
        "batch_ids": batch_ids,
        "paper_id": fields.get("paper_id") or "",
        "exam_type": scope.get("kind") or "subject",
        "exam_kind": fields.get("exam_kind") or "",
        "assessment_id": assessment_id,
        "attempt_id": attempt_id,
        "marksheet_id": sheet_id,
        "created_at": _now(),
    }
    await db.assessments.insert_one({
        "_id": assessment_id,
        "institute_id": actor["institute_id"],
        "identity_key": f"exam|{exam_id}",
        "title": exam["title"],
        "title_key": exam["title_key"],
        "exam_type": exam["exam_type"],
        "exam_kind": exam.get("exam_kind") or "",
        "format": "manual",
        "subject_id": exam["subject_id"],
        "paper_id": exam["paper_id"],
        "branch_id": (branch or {}).get("branch_id") or job.get("branch_id") or "",
        "course_id": exam["course_id"],
        "batch_ids": batch_ids,
        "exam_date": exam["exam_date"],
        "maximum": maximum,
        "exam_id": exam_id,
    }, session=session)
    await db.attempts.insert_one({
        "_id": attempt_id,
        "institute_id": actor["institute_id"],
        "assessment_id": assessment_id,
        "kind": "original",
        "maximum": maximum,
    }, session=session)
    marksheet = {
        "_id": sheet_id,
        "institute_id": actor["institute_id"],
        "assessment_id": assessment_id,
        "attempt_id": attempt_id,
        "cohort_key": "|".join(batch_ids),
        "branch_id": (branch or {}).get("branch_id") or job.get("branch_id") or "",
        "course_id": exam["course_id"],
        "subject_id": exam["subject_id"],
        "paper_id": exam["paper_id"],
        "batch_ids": batch_ids,
        "title": exam["title"],
        "maximum": maximum,
        "exam_type": exam["exam_type"],
        "exam_kind": exam.get("exam_kind") or "",
        "exam_date": exam["exam_date"],
        "status": "draft",
        "revision": 1,
        "active_revision": None,
        "source_sheet": sheet["name"],
        "source_job_id": job["_id"],
        "source_file": job.get("filename"),
        "file_id": job.get("file_id"),
        "uploader_id": actor["_id"],
        "edit_version": 0,
        "attempt_kind": "original",
        "exam_id": exam_id,
    }
    await db.marksheets.insert_one(marksheet, session=session)
    await db.exams.insert_one(exam, session=session)
    _note(ledger, "academic", "insert", sheet_id)
    await db.audit_events.insert_one({
        "_id": str(ObjectId()),
        "institute_id": actor["institute_id"],
        "action": "exam.create",
        "actor_id": actor["_id"],
        "at": _now(),
        "context": {"exam_id": exam_id, "title": exam["title"], "import_id": job["_id"]},
    }, session=session)
    return exam, marksheet, True


async def _commit_bundle_scores(db, session, job, actor, exam, marksheet, sheet, group, ledger) -> list:
    queued: list = []
    stored = await db.results.find({"marksheet_id": marksheet["_id"]}, session=session).to_list(length=5000)
    revision = marksheet.get("active_revision") or marksheet.get("revision") or 1
    by_student = {row["student_id"]: row for row in stored if row.get("revision") == revision}
    published = marksheet.get("status") == "published"
    for student in group["students"]:
        change = student.get("change")
        if student.get("match") == "enroll" and student.get("batch_id") and change != "reject":
            person, student_new, enrollment, enrollment_new = await _enroll_import_row(db, session, actor, student)
            _note(ledger, "students", "insert" if student_new else "unchanged", person["_id"])
            _note(ledger, "enrollments", "insert" if enrollment_new else "unchanged", enrollment["_id"])
        elif change in {None, "skip", "reject"} or not student.get("student_id"):
            if change:
                _note(ledger, "results", change if change in {"skip", "reject"} else "skip", f"{sheet['id']}:{student.get('row')}")
            continue
        else:
            person = await db.students.find_one({"_id": student["student_id"]}, session=session)
            enrollment = await db.enrollments.find_one(
                {"student_id": student["student_id"], "batch_id": student.get("batch_id")},
                session=session,
            )
            if person is None or enrollment is None:
                _note(ledger, "results", "skip", f"{sheet['id']}:{student.get('row')}")
                continue
            _note(ledger, "students", "unchanged", person["_id"])
            _note(ledger, "enrollments", "unchanged", enrollment["_id"])
        if change in {None, "skip", "reject"}:
            _note(ledger, "results", change if change in {"skip", "reject"} else "skip", f"{sheet['id']}:{student.get('row')}")
            continue
        existing = by_student.get(person["_id"])
        if change == "unchanged" and existing:
            _note(ledger, "results", "unchanged", existing["_id"])
            continue
        if published and change == "update" and existing:
            queued.append({
                "marksheet_id": marksheet["_id"],
                "result_id": existing["_id"],
                "score": student.get("score"),
                "status": student.get("status"),
                "reason": student.get("correction_reason") or "Imported correction",
            })
            continue
        if published and change == "insert" and student.get("published_insert"):
            batch = await db.batches.find_one({"_id": student.get("batch_id")}, session=session)
            queued.append({
                "marksheet_id": marksheet["_id"],
                "insert": True,
                "reason": student.get("correction_reason") or "Marked absent",
                "document": _bundle_result_document(actor, job, exam, marksheet, sheet, student, person, enrollment, batch, revision),
            })
            continue
        if existing and change == "update":
            await db.results.update_one(
                {"_id": existing["_id"]},
                {"$set": {
                    "status": student["status"],
                    "score": student["score"],
                    "percentage": student["percentage"],
                    "rank": student.get("rank"),
                    "band": student.get("band"),
                }},
                session=session,
            )
            _note(ledger, "results", "update", existing["_id"])
            continue
        if change != "insert":
            _note(ledger, "results", "skip", f"{sheet['id']}:{student.get('row')}")
            continue
        batch = await db.batches.find_one({"_id": student.get("batch_id")}, session=session)
        result_id = str(ObjectId())
        await db.results.insert_one(
            _bundle_result_document(actor, job, exam, marksheet, sheet, student, person, enrollment, batch, revision, result_id),
            session=session,
        )
        _note(ledger, "results", "insert", result_id)
    return queued


def _bundle_result_document(actor, job, exam, marksheet, sheet, student, person, enrollment, batch, revision, result_id=None) -> dict:
    document = {
        "institute_id": actor["institute_id"],
        "marksheet_id": marksheet["_id"],
        "enrollment_id": enrollment["_id"],
        "student_id": person["_id"],
        "revision": revision,
        "active": False,
        "status": student["status"],
        "score": student["score"],
        "maximum": exam["maximum"],
        "percentage": student.get("percentage"),
        "rank": student.get("rank"),
        "band": student.get("band"),
        "exam_date": exam.get("exam_date"),
        "title": exam.get("title"),
        "assessment_id": exam["assessment_id"],
        "attempt_kind": "original",
        "exam_type": exam.get("exam_type"),
        "counts_in_aggregate": True,
        "source_rank": student.get("source_rank"),
        "branch_id": (batch or {}).get("branch_id") or "",
        "course_id": exam["course_id"],
        "batch_id": student.get("batch_id") or "",
        "subject_id": exam["subject_id"],
        "paper_id": exam.get("paper_id") or "",
        "source": {
            "file": job.get("filename"),
            "sheet": sheet["name"],
            "row": student.get("row"),
            "column": student.get("column"),
        },
    }
    if result_id:
        document["_id"] = result_id
    return document


async def _enroll_import_row(db, session, actor: dict, student: dict) -> tuple[dict, bool, dict, bool]:
    batch = await db.batches.find_one(
        {"_id": student.get("batch_id"), "institute_id": actor["institute_id"]}, session=session
    )
    if batch is None:
        raise AppError(422, "exam.batch", f"Choose a batch for {student.get('display_name')}.")
    require_open_batch(batch)
    person, student_new = await _import_student(db, session, actor["institute_id"], student)
    enrollment, enrollment_new = await _ensure(
        db, "enrollments", session,
        {"student_id": person["_id"], "batch_id": batch["_id"]},
        enrollment_fields(
            institute_id=actor["institute_id"],
            student_id=person["_id"],
            branch_id=batch.get("branch_id") or "",
            course_id=batch.get("course_id") or "",
            batch_id=batch["_id"],
        ),
    )
    if enrollment_new or not enrollment.get("enrollment_code"):
        code = await allocate_enrollment_code(db, session)
        await db.enrollments.update_one(
            {"_id": enrollment["_id"], "enrollment_code": {"$exists": False}},
            {"$set": {"enrollment_code": code}},
            session=session,
        )
        enrollment["enrollment_code"] = enrollment.get("enrollment_code") or code
    taken = await db.enrollment_names.find_one(
        {"batch_id": batch["_id"], "name_key": student["name_key"]}, session=session
    )
    if taken and taken.get("student_id") != person["_id"]:
        raise AppError(
            409, "import.ambiguous_name",
            f"Another student in that batch is already named {student.get('display_name')}.",
        )
    if taken is None:
        await db.enrollment_names.insert_one(
            name_document(
                institute_id=actor["institute_id"],
                batch_id=batch["_id"],
                student_id=person["_id"],
                name_key=student["name_key"],
            ),
            session=session,
        )
    return person, student_new, enrollment, enrollment_new


async def _import_student(db, session, institute_id: str, student: dict) -> tuple[dict, bool]:
    if student.get("student_id"):
        found = await db.students.find_one(
            {"_id": student["student_id"], "institute_id": institute_id}, session=session
        )
        if found:
            return found, False
    matches = await db.students.find(
        {"institute_id": institute_id, "name_key": student["name_key"]}, session=session
    ).to_list(length=5)
    if len(matches) > 1:
        raise AppError(409, "import.ambiguous_name", f"More than one student is named {student.get('display_name')}.")
    if matches:
        return matches[0], False
    document = {
        "_id": str(ObjectId()),
        "institute_id": institute_id,
        "student_code": await allocate_student_code(db, session, "IAM"),
        "display_name": student.get("display_name") or "",
        "name_key": student["name_key"],
    }
    await db.students.insert_one(document, session=session)
    return document, True


