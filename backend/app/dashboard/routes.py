"""Operational dashboard and the shared academic context options."""

from __future__ import annotations

from fastapi import APIRouter, Request

from app.acl import allows, mongo_clause
from app.context import _href, _option_resource, _restrict_batches, resolve_academic
from app.deps import _now, current_user, db
from app.errors import AppError
from app.security import name_key

router = APIRouter(prefix="/api/v1")

_CONTEXT_ACTIONS = (
    "dashboard.view",
    "marksheet.view",
    "marksheet.upload",
    "student.lookup",
    "progress_card.view",
    "catalog.correct",
    "catalog.manage",
)
_CONTEXT_FIELDS = {
    "branch": {"institute_id": "institute_id", "branch_id": "_id"},
    "course": {"institute_id": "institute_id", "course_id": "_id"},
    "subject": {"institute_id": "institute_id", "course_id": "course_id", "subject_id": "_id"},
    "batch": {
        "institute_id": "institute_id",
        "branch_id": "branch_id",
        "course_id": "course_id",
        "batch_id": "_id",
    },
    "paper": {"institute_id": "institute_id", "subject_id": "subject_id", "paper_id": "_id"},
}

@router.get("/context/options")
async def context_options(request: Request, dimension: str, q: str = "") -> dict:
    user = await current_user(request)
    collection_name = {
        "branch": "branches",
        "course": "courses",
        "subject": "subjects",
        "batch": "batches",
        "paper": "papers",
    }.get(dimension)
    if dimension == "exam_type":
        return {"items": [
            {"id": "unit", "label": "Unit", "parents": {}},
            {"id": "part", "label": "Part", "parents": {}},
            {"id": "chapter", "label": "Chapter", "parents": {}},
        ]}
    if collection_name is None:
        raise AppError(422, "context.unknown", "Choose a known context level.")
    field_map = _CONTEXT_FIELDS[dimension]
    query = {
        "institute_id": user["institute_id"],
        "$or": [mongo_clause(user["grants"], action, field_map) for action in _CONTEXT_ACTIONS],
    }
    if q:
        query["name_key"] = {"$regex": name_key(q)}
    rows = await db(request)[collection_name].find(query).limit(200).to_list(length=200)
    offerings = await db(request).offerings.find({"institute_id": user["institute_id"]}).to_list(length=200)
    branches_for_course: dict[str, list[str]] = {}
    for offering in offerings:
        branches_for_course.setdefault(offering["course_id"], []).append(offering["branch_id"])
    subject_course = {
        item["_id"]: item.get("course_id")
        for item in await db(request).subjects.find({"institute_id": user["institute_id"]}).to_list(length=200)
    }
    items = []
    for row in rows:
        resource = _option_resource(dimension, row, user["institute_id"], subject_course)
        if not any(allows(user["grants"], action, resource, True) for action in _CONTEXT_ACTIONS):
            continue
        label = row.get("name") or (f"Paper {row['number']}" if row.get("number") is not None else row["_id"])
        parents = {key: row[key] for key in ("branch_id", "course_id", "subject_id", "session_key") if row.get(key)}
        if dimension == "course":
            parents["branch_ids"] = branches_for_course.get(row["_id"], [])
        if dimension == "paper" and row.get("subject_id"):
            parents["course_id"] = subject_course.get(row["subject_id"])
        items.append({"id": row["_id"], "label": label, "parents": parents})
    return {"items": items}


@router.get("/dashboard")
async def dashboard(
    request: Request, branch_id: str = "", course_id: str = "", batch_id: str = "", period: str = ""
) -> dict:
    user = await current_user(request)
    from app.importing.routes import marksheet_visible
    from app.intake import applied_intake_course, enquiry_awaiting_follow_up, intake_course_visible

    academic, dropped, period_ids = await resolve_academic(
        request, user, "marksheet.view", branch_id, course_id, batch_id, period
    )
    intake_course, intake_dropped = applied_intake_course(user["grants"], course_id)
    if intake_dropped:
        dropped.append("course_id")
    items = []
    if any("student.lookup" in (grant.get("actions") or []) for grant in user["grants"]):
        today = _now().date().isoformat()
        enquiries = await db(request).enquiries.find({"institute_id": user["institute_id"]}).to_list(length=500)
        enquiry_count = 0
        for row in enquiries:
            if not intake_course_visible(user["grants"], row.get("course_id") or ""):
                continue
            if intake_course and (row.get("course_id") or "") != intake_course:
                continue
            if enquiry_awaiting_follow_up(row, today):
                enquiry_count += 1
        admissions = await db(request).admissions.find({"institute_id": user["institute_id"]}).to_list(length=500)
        admission_count = 0
        for row in admissions:
            if not intake_course_visible(user["grants"], row.get("course_id") or ""):
                continue
            if intake_course and (row.get("course_id") or "") != intake_course:
                continue
            if (row.get("status") or "open") == "open":
                admission_count += 1
        items.append({
            "key": "enquiries",
            "count": enquiry_count,
            "label": "Enquiries awaiting follow-up",
            "detail": "Not yet an admission, and the latest follow-up is missing or due.",
            "href": _href("/students/enquiries", follow_up="due", course_id=intake_course),
        })
        items.append({
            "key": "admissions",
            "count": admission_count,
            "label": "Admissions awaiting conversion",
            "detail": "Open admissions. Conversion into a batch is the next action.",
            "href": _href("/students/admissions", status="open", course_id=intake_course),
        })
    if any("marksheet.view" in (grant.get("actions") or []) for grant in user["grants"]):
        query: dict = {"institute_id": user["institute_id"], "status": "submitted"}
        for field in ("branch_id", "course_id"):
            if academic.get(field):
                query[field] = academic[field]
        _restrict_batches(query, "batch_ids", academic.get("batch_id", ""), period_ids)
        sheets = await db(request).marksheets.find(query).to_list(length=500)
        review_count = sum(1 for sheet in sheets if marksheet_visible(user, sheet))
        items.append({
            "key": "marksheets",
            "count": review_count,
            "label": "Marksheets awaiting review",
            "detail": "Submitted marksheets. Drafts are not in review yet.",
            "href": _href(
                "/marksheets",
                status="submitted",
                branch_id=academic.get("branch_id", ""),
                course_id=academic.get("course_id", ""),
                batch_id=academic.get("batch_id", ""),
                period=academic.get("period", ""),
            ),
        })
    if any(
        action in (grant.get("actions") or [])
        for grant in user["grants"]
        for action in ("marksheet.upload", "marksheet.view")
    ):
        failed = await db(request).import_jobs.count_documents(
            {"institute_id": user["institute_id"], "state": "failed"}
        )
        items.append({
            "key": "imports",
            "count": failed,
            "label": "Failed imports",
            "detail": "Import jobs whose state is failed. They are not narrowed by branch.",
            "href": "/import?state=failed",
        })
    return {"context": academic, "dropped": sorted(set(dropped)), "items": items}

