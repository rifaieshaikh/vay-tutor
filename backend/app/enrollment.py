"""Enrollment checks shared by admission, manual enrollment, and import."""

from __future__ import annotations

from bson import ObjectId

from app.errors import AppError


def require_batch_match(batch: dict | None, branch_id: str, course_id: str) -> None:
    if batch is None or batch.get("branch_id") != branch_id or batch.get("course_id") != course_id:
        raise AppError(422, "enrollment.context", "Choose a branch, course, and batch that belong together.")


def require_open_batch(batch: dict) -> None:
    if batch.get("ended_on"):
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
) -> dict:
    document = {
        "institute_id": institute_id,
        "student_id": student_id,
        "branch_id": branch_id,
        "course_id": course_id,
        "batch_id": batch_id,
    }
    if started_on:
        document["started_on"] = started_on
    if status:
        document["status"] = status
    return document


def enrollment_document(*, enrollment_id: str, **fields) -> dict:
    return {"_id": enrollment_id, **enrollment_fields(**fields)}


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
