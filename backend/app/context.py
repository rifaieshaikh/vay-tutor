"""Academic context shared by lists, the dashboard, and marksheets."""

from __future__ import annotations

from urllib.parse import urlencode

from fastapi import Request

from app.acl import allows
from app.deps import db


def _option_resource(dimension: str, row: dict, institute_id: str, subject_course: dict) -> dict:
    resource = {"institute_id": institute_id}
    if dimension == "branch":
        resource["branch_id"] = row["_id"]
    elif dimension == "course":
        resource["course_id"] = row["_id"]
    elif dimension == "batch":
        resource["branch_id"] = row.get("branch_id")
        resource["course_id"] = row.get("course_id")
        resource["batch_id"] = row["_id"]
    elif dimension == "subject":
        resource["course_id"] = row.get("course_id")
        resource["subject_id"] = row["_id"]
    elif dimension == "paper":
        resource["subject_id"] = row.get("subject_id")
        resource["course_id"] = subject_course.get(row.get("subject_id"))
        resource["paper_id"] = row["_id"]
    return resource


def _restrict_batches(query: dict, field: str, batch_id: str, period_ids: list[str] | None) -> None:
    if period_ids is None:
        if batch_id:
            query[field] = batch_id
        return
    allowed = period_ids
    if batch_id:
        allowed = [batch_id] if batch_id in set(period_ids) else []
    query[field] = {"$in": allowed}


async def resolve_academic(
    request: Request, user: dict, action: str, branch_id: str, course_id: str, batch_id: str, period: str
) -> tuple[dict, list[str], list[str] | None]:
    """Keep context values the caller may use. `period` is a batch session_key, not a new field."""
    applied: dict[str, str] = {}
    dropped: list[str] = []
    institute_id = user["institute_id"]
    grants = user["grants"]
    if branch_id:
        if allows(grants, action, {"institute_id": institute_id, "branch_id": branch_id}, True):
            applied["branch_id"] = branch_id
        else:
            dropped.append("branch_id")
    if course_id:
        if allows(grants, action, {"institute_id": institute_id, "course_id": course_id}, True):
            applied["course_id"] = course_id
        else:
            dropped.append("course_id")
    batch = None
    if batch_id:
        batch = await db(request).batches.find_one({"_id": batch_id, "institute_id": institute_id})
        resource = {
            "institute_id": institute_id,
            "branch_id": (batch or {}).get("branch_id"),
            "course_id": (batch or {}).get("course_id"),
            "batch_id": batch_id,
        }
        fits = bool(batch) and allows(grants, action, resource, True)
        if fits and applied.get("branch_id") and batch.get("branch_id") != applied["branch_id"]:
            fits = False
        if fits and applied.get("course_id") and batch.get("course_id") != applied["course_id"]:
            fits = False
        if fits and period and batch.get("session_key") != period:
            fits = False
        if fits:
            applied["batch_id"] = batch_id
        else:
            dropped.append("batch_id")
    if period:
        applied["period"] = period
    period_ids = None
    if period:
        query: dict = {"institute_id": institute_id, "session_key": period}
        if applied.get("branch_id"):
            query["branch_id"] = applied["branch_id"]
        if applied.get("course_id"):
            query["course_id"] = applied["course_id"]
        period_ids = [
            row["_id"]
            for row in await db(request).batches.find(query, {"_id": 1}).to_list(length=500)
        ]
    return applied, dropped, period_ids


def _href(path: str, **values: str) -> str:
    kept = {key: value for key, value in values.items() if value}
    if not kept:
        return path
    return f"{path}?{urlencode(kept)}"
