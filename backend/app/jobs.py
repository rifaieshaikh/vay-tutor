from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.acl import allows

log = logging.getLogger("vay.jobs")


def _in_scope(row: dict, scope: dict) -> bool:
    for field in ("branch_id", "course_id", "batch_id", "subject_id", "paper_id"):
        if scope.get(field) and row.get(field) != scope[field]:
            return False
    return True


def _card_permitted(grants: list[dict], action: str, scope: dict, enrollments: list[dict]) -> bool:
    for enrollment in enrollments:
        if scope.get("branch_id") and scope["branch_id"] != enrollment.get("branch_id"):
            continue
        if scope.get("course_id") and scope["course_id"] != enrollment.get("course_id"):
            continue
        if scope.get("batch_id") and scope["batch_id"] != enrollment.get("batch_id"):
            continue
        resource = {
            "institute_id": enrollment.get("institute_id"),
            "branch_id": enrollment.get("branch_id"),
            "course_id": enrollment.get("course_id"),
            "batch_id": enrollment.get("batch_id"),
            "subject_id": scope.get("subject_id"),
            "paper_id": scope.get("paper_id"),
        }
        named = bool(scope.get("subject_id") or scope.get("paper_id"))
        if allows(grants, "progress_card.view", resource, not named) and allows(grants, action, resource, not named):
            return True
    return False


async def _export_allowed(db: AsyncIOMotorDatabase, job: dict, user: dict | None, grants: list[dict], action: str, resource: dict) -> bool:
    if user is None or not user.get("active") or user.get("session_version") != job["session_version"]:
        return False
    card = job["payload"].get("card") or {}
    if card.get("student_id"):
        enrollments = await db.enrollments.find(
            {"student_id": card["student_id"], "institute_id": job["institute_id"]}
        ).to_list(length=50)
        return _card_permitted(grants, action, resource, enrollments)
    return allows(grants, action, resource) and allows(grants, "progress_card.view", resource)


def _matches_card(row: dict, card: dict) -> bool:
    student_id = card.get("student_id")
    if student_id and row.get("student_id") != student_id:
        return False
    exam_date = str(row.get("exam_date") or "")
    start = str(card.get("exam_date_from") or "")
    end = str(card.get("exam_date_to") or "")
    if start and exam_date < start:
        return False
    if end and (not exam_date or exam_date > end):
        return False
    if card.get("exam_type") and row.get("exam_type") != card["exam_type"]:
        return False
    attempt = card.get("attempt")
    if attempt in {"original", "retest"} and (row.get("attempt_kind") or "original") != attempt:
        return False
    return True


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def enqueue(
    db: AsyncIOMotorDatabase,
    *,
    kind: str,
    actor: dict,
    payload: dict,
    idempotency_key: str | None,
) -> dict:
    if idempotency_key:
        existing = await db.jobs.find_one({"idempotency_key": idempotency_key})
        if existing:
            return existing
    document = {
        "_id": str(ObjectId()),
        "kind": kind,
        "state": "queued",
        "attempts": 0,
        "lease_until": None,
        "actor_id": actor["_id"],
        "session_version": actor["session_version"],
        "institute_id": actor["institute_id"],
        "payload": payload,
        "file_id": None,
        "last_error": None,
        "created_at": _now(),
    }
    if idempotency_key:
        document["idempotency_key"] = idempotency_key
    await db.jobs.insert_one(document)
    return document


async def process_due_jobs(db: AsyncIOMotorDatabase, data_dir: Path) -> int:
    now = _now()
    await db.jobs.update_many(
        {"state": "leased", "lease_until": {"$lt": now}},
        {"$set": {"state": "queued", "lease_until": None}},
    )
    processed = 0
    while True:
        job = await db.jobs.find_one_and_update(
            {"state": "queued"},
            {
                "$set": {"state": "leased", "lease_until": now + timedelta(minutes=2)},
                "$inc": {"attempts": 1},
            },
        )
        if job is None:
            return processed
        job["attempts"] = job.get("attempts", 0) + 1
        job["state"] = "leased"
        await _run(db, data_dir, job)
        processed += 1


async def _run(db: AsyncIOMotorDatabase, data_dir: Path, job: dict) -> None:
    user = await db.users.find_one({"_id": job["actor_id"]})
    grants = await db.grants.find({"user_id": job["actor_id"]}).to_list(length=500)
    action = "export.pdf" if job["kind"] == "report_pdf" else "export.xlsx"
    resource = job["payload"].get("scope", {})
    if not await _export_allowed(db, job, user, grants, action, resource):
        await db.jobs.update_one(
            {"_id": job["_id"]},
            {
                "$set": {
                    "state": "failed",
                    "lease_until": None,
                    "last_error": "Access was revoked before the export finished.",
                }
            },
        )
        return
    target = data_dir / "files"
    target.mkdir(parents=True, exist_ok=True)
    from app.reporting import authorized, export_bytes, file_digest, hydrate, policy_for

    policy = await policy_for(db, job["institute_id"])
    stored = await db.results.find({"institute_id": job["institute_id"], "active": {"$ne": False}}).to_list(length=5000)
    card = job["payload"].get("card") or {}
    rows = [
        row for row in authorized(await hydrate(db, stored), grants, "progress_card.view")
        if _in_scope(row, resource) and _matches_card(row, card)
    ]
    lines = [
        f"Policy version {policy.get('version', 1)}",
        policy.get("aggregate") or "maximum-marks-weighted",
        "Authorized subjects only. Drafts are excluded.",
        "One active revision is included.",
        "The total uses the latest published attempt, weighted by each maximum.",
    ]
    scope = resource or {}
    for field, value in scope.items():
        if value and field != "institute_id":
            lines.append(f"{field}: {value}")
    if card.get("student_id"):
        lines.append(f"student_id: {card['student_id']}")
    if card.get("exam_date_from"):
        lines.append(f"exam_date_from: {card['exam_date_from']}")
    if card.get("exam_date_to"):
        lines.append(f"exam_date_to: {card['exam_date_to']}")
    if card.get("exam_type"):
        lines.append(f"exam_type: {card['exam_type']}")
    if card.get("attempt"):
        lines.append(f"attempt: {card['attempt']}")
    if not any(field != "institute_id" and value for field, value in scope.items()):
        lines.append("Scope: this institute")
    student_ids = list({row.get("student_id") for row in rows if row.get("student_id")})
    people = {}
    if student_ids:
        for student in await db.students.find({"_id": {"$in": student_ids}}).to_list(length=len(student_ids)):
            people[student["_id"]] = f"{student.get('display_name')} ({student.get('student_code')})"
    for row in rows:
        if not row.get("published"):
            continue
        previous = row.get("previous_score")
        earlier = f" previous {previous}" if previous is not None else ""
        who = people.get(row.get("student_id"), "Student")
        if row.get("status") == "scored":
            mark = f"scored {row.get('score')}/{row.get('maximum')}"
        else:
            mark = row.get("status") or "unscored"
        lines.append(
            f"{who} - {row.get('title') or 'Result'} revision {row.get('revision') or 1} "
            f"{mark}{earlier} {row.get('exam_date') or 'undated'}"
        )
    payload, filename = export_bytes(job["kind"], lines)
    partial = target / f"{job['_id']}.partial"
    final = target / f"{job['_id']}.bin"
    partial.write_bytes(payload)
    user = await db.users.find_one({"_id": job["actor_id"]})
    grants = await db.grants.find({"user_id": job["actor_id"]}).to_list(length=500)
    if not await _export_allowed(db, job, user, grants, action, resource):
        partial.unlink(missing_ok=True)
        await db.jobs.update_one(
            {"_id": job["_id"]},
            {
                "$set": {
                    "state": "failed",
                    "lease_until": None,
                    "last_error": "Access was revoked before the export finished.",
                }
            },
        )
        return
    partial.replace(final)
    file_doc = {
        "_id": str(ObjectId()),
        "institute_id": job["institute_id"],
        "kind": job["kind"],
        "job_id": job["_id"],
        "actor_id": job["actor_id"],
        "session_version": job["session_version"],
        "scope": resource,
        "path": str(final),
        "filename": filename,
        "sha256": file_digest(final.read_bytes()),
        "created_at": _now(),
    }
    await db.files.insert_one(file_doc)
    await db.jobs.update_one(
        {"_id": job["_id"]},
        {"$set": {"state": "succeeded", "lease_until": None, "file_id": file_doc["_id"]}},
    )
    log.info("job %s finished", job["_id"])


async def run_actor_job(db: AsyncIOMotorDatabase, data_dir: Path, job_id: str, actor_id: str) -> dict | None:
    now = _now()
    job = await db.jobs.find_one_and_update(
        {"_id": job_id, "actor_id": actor_id, "state": "queued"},
        {"$set": {"state": "leased", "lease_until": now + timedelta(minutes=2)}, "$inc": {"attempts": 1}},
    )
    if job is None:
        return await db.jobs.find_one({"_id": job_id, "actor_id": actor_id})
    job["attempts"] = job.get("attempts", 0) + 1
    job["state"] = "leased"
    try:
        await _run(db, data_dir, job)
    except Exception:
        log.exception("job %s failed", job_id)
        await db.jobs.update_one(
            {"_id": job_id},
            {"$set": {"state": "failed", "lease_until": None, "last_error": "The export could not be finished."}},
        )
    return await db.jobs.find_one({"_id": job_id, "actor_id": actor_id})
