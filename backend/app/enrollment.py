"""Enrollment checks shared by admission, manual enrollment, and import."""

from __future__ import annotations

from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from app.db import allocate_enrollment_code
from app.errors import AppError


def require_batch_match(batch: dict | None, branch_id: str, course_id: str) -> None:
    if batch is None or batch.get("branch_id") != branch_id or batch.get("course_id") != course_id:
        raise AppError(422, "enrollment.context", "Choose a branch, course, and batch that belong together.")


def batch_is_closed(batch: dict) -> bool:
    return bool(batch.get("closed"))


def require_open_batch(batch: dict) -> None:
    if batch.get("archived"):
        raise AppError(422, "batch.archived", "This batch is archived. New enrollments stay out.")
    if batch_is_closed(batch):
        raise AppError(422, "batch.closed", "This batch is closed. New enrollments stay out.")


def enrollment_fields(
    *,
    institute_id: str,
    student_id: str,
    branch_id: str,
    course_id: str,
    batch_id: str,
    started_on: str | None = None,
    status: str | None = None,
    enrollment_code: str | None = None,
) -> dict:
    document = {
        "institute_id": institute_id,
        "student_id": student_id,
        "branch_id": branch_id,
        "course_id": course_id,
        "batch_id": batch_id,
    }
    if enrollment_code:
        document["enrollment_code"] = enrollment_code
    if started_on:
        document["started_on"] = started_on
    if status:
        document["status"] = status
    return document


def enrollment_document(*, enrollment_id: str, **fields) -> dict:
    return {"_id": enrollment_id, **enrollment_fields(**fields)}


async def assign_enrollment_code(database, enrollment: dict, session=None) -> str:
    """The enrollment number is the stable key for that student's place in a batch."""
    current = enrollment.get("enrollment_code")
    if current:
        return current
    for _ in range(3):
        code = await allocate_enrollment_code(database, session)
        try:
            await database.enrollments.update_one(
                {"_id": enrollment["_id"], "enrollment_code": {"$exists": False}},
                {"$set": {"enrollment_code": code}},
                session=session,
            )
        except DuplicateKeyError:
            continue
        fresh = await database.enrollments.find_one({"_id": enrollment["_id"]}, session=session)
        found = (fresh or {}).get("enrollment_code")
        if found:
            enrollment["enrollment_code"] = found
            return found
    raise AppError(409, "enrollment.code", "Could not assign an enrollment number. Try again.")


def name_document(*, institute_id: str, batch_id: str, student_id: str, name_key: str) -> dict:
    return {
        "_id": str(ObjectId()),
        "institute_id": institute_id,
        "batch_id": batch_id,
        "student_id": student_id,
        "name_key": name_key,
    }


async def name_conflicts(database, batch_id: str, keys, student_id: str, session=None) -> bool:
    wanted = [key for key in keys if key]
    if not wanted:
        return False
    taken = await database.enrollment_names.find(
        {"batch_id": batch_id, "name_key": {"$in": wanted}, "student_id": {"$ne": student_id}},
        session=session,
    ).to_list(length=5)
    return bool(taken)
