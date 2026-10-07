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


async def commit_import(db, client, job: dict, actor: dict) -> dict:
    known = await known_sessions(db, actor["institute_id"])
    plan = apply_decisions(job["parsed"], job.get("decisions") or {}, known)
    if plan["blockers"]:
        raise AppError(422, "import.blocked", "Resolve the listed rows before committing.", blockers=plan["blockers"])
    committed = set(job.get("committed_sheets") or [])
    outcomes = list(job.get("outcomes") or [])
    for sheet in plan["sheets"]:
        if not sheet["included"]:
            if not any(item.get("sheet_id") == sheet["id"] and item.get("status") == "skipped" for item in outcomes):
                outcomes.append({"sheet_id": sheet["id"], "name": sheet["name"], "status": "skipped", "reason": sheet.get("skip_reason") or "Skipped."})
            continue
        if sheet["id"] in committed:
            continue
        try:
            async with await client.start_session() as session:
                async with session.start_transaction():
                    await _commit_sheet(db, session, job, actor, sheet)
        except DuplicateKeyError as exc:
            raise AppError(409, "import.conflict", "Another import saved this record first. Open the preview again.") from exc
        committed.add(sheet["id"])
        outcomes.append({"sheet_id": sheet["id"], "name": sheet["name"], "status": "committed"})
        await db.import_jobs.update_one(
            {"_id": job["_id"]},
            {"$set": {"committed_sheets": list(committed), "outcomes": outcomes, "state": "committing"}},
        )
    await db.import_jobs.update_one(
        {"_id": job["_id"]},
        {"$set": {"state": "committed", "committed_sheets": list(committed), "outcomes": outcomes, "committed_at": _now()}},
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
    return {"state": "committed", "outcomes": outcomes}


async def _commit_sheet(db, session, job: dict, actor: dict, sheet: dict) -> None:
    institute_id = actor["institute_id"]
    branch, _ = await _ensure(
        db, "branches", session,
        {"institute_id": institute_id, "name_key": name_key(sheet["branch_name"])},
        {"institute_id": institute_id, "name": sheet["branch_name"], "name_key": name_key(sheet["branch_name"])},
    )
    course, _ = await _ensure(
        db, "courses", session,
        {"institute_id": institute_id, "name_key": name_key(sheet["course_name"])},
        {"institute_id": institute_id, "name": sheet["course_name"], "name_key": name_key(sheet["course_name"])},
    )
    offering, _ = await _ensure(
        db, "offerings", session,
        {"branch_id": branch["_id"], "course_id": course["_id"]},
        {"institute_id": institute_id, "branch_id": branch["_id"], "course_id": course["_id"]},
    )
    subject, _ = await _ensure(
        db, "subjects", session,
        {"course_id": course["_id"], "name_key": name_key(sheet["subject_name"])},
        {"institute_id": institute_id, "course_id": course["_id"], "name": sheet["subject_name"], "name_key": name_key(sheet["subject_name"])},
    )
    paper, _ = await _ensure(
        db, "papers", session,
        {"subject_id": subject["_id"], "number": sheet["paper_number"]},
        {"institute_id": institute_id, "subject_id": subject["_id"], "number": sheet["paper_number"], "name": f"Paper {sheet['paper_number']}"},
    )
    batch_ids = []
    for batch in sheet["batches"]:
        saved, _ = await _ensure(
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
    session_to_batch = {batch["session_key"]: batch_ids[index] for index, batch in enumerate(sheet["batches"])}
    for group in sheet["groups"]:
        if group["interpretation"] == "skip_duplicate":
            continue
        await _commit_group(db, session, job, actor, sheet, group, branch, course, subject, paper, batch_ids, session_to_batch)


async def _commit_group(db, session, job, actor, sheet, group, branch, course, subject, paper, batch_ids, session_to_batch) -> None:
    institute_id = actor["institute_id"]
    title = sheet["title"]
    title_key = sheet["title_key"]
    if group["interpretation"] in {"separate_assessment", "component"}:
        label = "component" if group["interpretation"] == "component" else "marks"
        title = f"{sheet['title']} ({group['maximum']} {label})"
        title_key = f"{sheet['title_key']} {group['maximum']} {group['interpretation']}"
    sessions = tuple(batch["session_key"] for batch in sheet["batches"])
    identity = "|".join((name_key(sheet["subject_name"]), title_key, sheet["format"], ",".join(sessions)))
    assessment, _ = await _ensure(
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
    attempt_kind = "retest" if sheet["attempt"] == "retest" or group["interpretation"] == "retest" else "original"
    attempt, _ = await _ensure(
        db, "attempts", session,
        {"assessment_id": assessment["_id"], "kind": attempt_kind},
        {"institute_id": institute_id, "assessment_id": assessment["_id"], "kind": attempt_kind, "maximum": group["maximum"]},
    )
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
    if not created:
        return
    for student in group["students"]:
        batch_id = session_to_batch[student["batch_session"]]
        person = await _student_for_batch(db, session, institute_id, batch_id, student)
        enrollment, _ = await _ensure(
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
        await _ensure(
            db, "enrollment_names", session,
            {"batch_id": batch_id, "name_key": student["name_key"]},
            {"institute_id": institute_id, "batch_id": batch_id, "student_id": person["_id"], "name_key": student["name_key"]},
        )
        await db.results.insert_one(
            {
                "_id": str(ObjectId()),
                "institute_id": institute_id,
                "marksheet_id": marksheet["_id"],
                "enrollment_id": enrollment["_id"],
                "student_id": person["_id"],
                "revision": 1,
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


async def _student_for_batch(db, session, institute_id: str, batch_id: str, student: dict) -> dict:
    existing = await db.enrollment_names.find_one(
        {"batch_id": batch_id, "name_key": student["name_key"]}, session=session
    )
    if existing:
        found = await db.students.find_one({"_id": existing["student_id"]}, session=session)
        if found:
            return found
    code = await allocate_student_code(db, session, "IAM")
    document = {
        "_id": str(ObjectId()),
        "institute_id": institute_id,
        "student_code": code,
        "display_name": student["display_name"],
        "name_key": student["name_key"],
    }
    await db.students.insert_one(document, session=session)
    return document


async def _ensure(db, collection: str, session, query: dict, document: dict) -> tuple[dict, bool]:
    found = await db[collection].find_one(query, session=session)
    if found:
        return found, False
    document = {**document, "_id": str(ObjectId())}
    await db[collection].insert_one(document, session=session)
    return document, True
