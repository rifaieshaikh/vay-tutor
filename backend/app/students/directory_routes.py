"""Enrolled student directory."""

from __future__ import annotations

from fastapi import APIRouter, Request

from app.acl import allows, mongo_clause
from app.context import _restrict_batches, resolve_academic
from app.deps import current_user, db, institute_resource
from app.errors import AppError
from app.queries import _report_filters, _student_sort_key
from app.students import card_visible, directory_facts, enrollment_context, enrollment_visible, identity_editable

router = APIRouter(prefix="/api/v1")


@router.get("/students/options")
async def student_options(request: Request, manage: bool = False) -> dict:
    user = await current_user(request)
    grants = user["grants"]
    known = {"student.lookup", "student.manage"}
    if not any(known.intersection(grant.get("actions") or []) for grant in grants):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    database = db(request)
    institute_id = user["institute_id"]
    branches = await database.branches.find({"institute_id": institute_id}).to_list(length=200)
    courses = await database.courses.find({"institute_id": institute_id}).to_list(length=200)
    batches = await database.batches.find({"institute_id": institute_id}).to_list(length=200)
    offerings = await database.offerings.find({"institute_id": institute_id}).to_list(length=200)
    action = "student.manage" if manage else "student.lookup"

    def covered(resource: dict) -> bool:
        return allows(grants, action, resource, resource_fields_only=not manage)

    visible_branches = [
        {"id": row["_id"], "label": row.get("name") or ""}
        for row in branches
        if covered({"institute_id": institute_id, "branch_id": row["_id"]})
    ]
    course_branches: dict[str, list[str]] = {}
    for offering in offerings:
        resource = {
            "institute_id": institute_id,
            "branch_id": offering.get("branch_id"),
            "course_id": offering.get("course_id"),
        }
        if covered(resource) and offering.get("course_id") and offering.get("branch_id"):
            course_branches.setdefault(offering["course_id"], []).append(offering["branch_id"])
    visible_courses = [
        {"id": row["_id"], "label": row.get("name") or "", "parents": {"branch_ids": course_branches[row["_id"]]}}
        for row in courses
        if row["_id"] in course_branches
    ]
    visible_batches = []
    for row in batches:
        resource = {
            "institute_id": institute_id,
            "branch_id": row.get("branch_id"),
            "course_id": row.get("course_id"),
            "batch_id": row["_id"],
        }
        if not covered(resource):
            continue
        visible_batches.append({
            "id": row["_id"],
            "label": row.get("name") or "",
            "parents": {"branch_id": row.get("branch_id"), "course_id": row.get("course_id")},
        })
    visible_branches.sort(key=lambda item: item["label"].casefold())
    visible_courses.sort(key=lambda item: item["label"].casefold())
    visible_batches.sort(key=lambda item: item["label"].casefold())
    return {"branches": visible_branches, "courses": visible_courses, "batches": visible_batches}


@router.get("/students")
async def list_students(
    request: Request,
    q: str = "",
    branch_id: str = "",
    course_id: str = "",
    batch_id: str = "",
    subject_id: str = "",
    paper_id: str = "",
    exam_type: str = "",
    exam_date_from: str = "",
    exam_date_to: str = "",
    attempt: str = "",
    period: str = "",
    sort: str = "name",
    direction: str = "asc",
    page: int = 0,
    page_size: int = 8,
) -> dict:
    user = await current_user(request)
    academic, _dropped, period_ids = await resolve_academic(
        request, user, "student.lookup", branch_id, course_id, batch_id, period
    )
    branch_id = academic.get("branch_id", "")
    course_id = academic.get("course_id", "")
    batch_id = academic.get("batch_id", "")
    clause = mongo_clause(
        user["grants"],
        "student.lookup",
        {
            "institute_id": "institute_id",
            "branch_id": "branch_id",
            "course_id": "course_id",
            "batch_id": "batch_id",
        },
    )
    if not any("student.lookup" in grant["actions"] for grant in user["grants"]):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    enrollment_query: dict = {"institute_id": user["institute_id"], **clause}
    for field, value in (("branch_id", branch_id), ("course_id", course_id)):
        if value:
            enrollment_query[field] = value
    _restrict_batches(enrollment_query, "batch_id", batch_id, period_ids)
    enrollments = await db(request).enrollments.find(enrollment_query).to_list(length=1000)
    facts = await directory_facts(db(request), user["institute_id"])
    enrollments = [
        item for item in enrollments
        if enrollment_visible(
            user["grants"], item, facts["subject_by_id"], facts["paper_subject"], facts["rosters"],
        )
    ]
    by_student: dict[str, list] = {}
    for item in enrollments:
        by_student.setdefault(item["student_id"], []).append(item)
    student_ids = list(by_student)
    filters = _report_filters(
        branch_id, course_id, batch_id, subject_id, paper_id, exam_type, exam_date_from, exam_date_to, attempt,
    )
    academic_fields = ("subject_id", "paper_id", "exam_type", "exam_date_from", "exam_date_to", "attempt")
    academic = any(filters.get(field) for field in academic_fields)
    students = []
    if student_ids:
        students = await db(request).students.find({"_id": {"$in": student_ids}}).to_list(length=len(student_ids))
    needle = q.casefold().strip()
    if needle:
        students = [
            student for student in students
            if needle in f"{student.get('student_code', '')} {student.get('display_name', '')}".casefold()
        ]
    from app.calculating import aggregate
    from app.reporting import hydrate, matches, policy_for

    policy = await policy_for(db(request), user["institute_id"])
    grouped: dict[str, list] = {}
    if student_ids:
        found = await db(request).results.find(
            {"institute_id": user["institute_id"], "active": {"$ne": False}, "student_id": {"$in": student_ids}}
        ).to_list(length=5000)
        for row in await hydrate(db(request), found):
            resource = {
                "institute_id": row.get("institute_id"),
                "branch_id": row.get("branch_id"),
                "course_id": row.get("course_id"),
                "batch_id": row.get("batch_id"),
                "subject_id": row.get("subject_id"),
                "paper_id": row.get("paper_id"),
            }
            if not row.get("published"):
                continue
            if not allows(user["grants"], "progress_card.view", resource) or not matches(row, filters):
                continue
            grouped.setdefault(row.get("student_id"), []).append(row)
    manage = allows(user["grants"], "student.manage", institute_resource(user))
    owned: dict[str, list] = {}
    if student_ids:
        for item in await db(request).enrollments.find(
            {"institute_id": user["institute_id"], "student_id": {"$in": student_ids}}
        ).to_list(length=5000):
            owned.setdefault(item["student_id"], []).append(item)
    items = []
    included_rows: list = []
    for student in students:
        rows = grouped.get(student["_id"], [])
        if academic and not rows:
            continue
        summary = aggregate(rows, policy)
        latest = max((str(row.get("exam_date") or "") for row in rows), default="")
        item = {
            "id": student["_id"],
            "student_code": student["student_code"],
            "display_name": student["display_name"],
            "performance": {
                "percentage": summary["percentage"],
                "scored": summary["scored"],
                "expected": summary["expected"],
                "missing": summary["missing"],
                "absent": summary["absent"],
                "band": summary["band"],
            },
            "latest_exam_date": latest or None,
            "empty_reason": None if rows else "unpublished",
            "enrollments": enrollment_context(by_student.get(student["_id"], []), facts),
            "actions": {
                "edit": identity_editable(user["grants"], owned.get(student["_id"], [])),
                "card": card_visible(user["grants"], by_student.get(student["_id"], [])),
            },
        }
        if manage:
            item["name_key"] = student.get("name_key")
        items.append(item)
        included_rows.extend(rows)
    report = aggregate(included_rows, policy)
    summary = {
        "percentage": report["percentage"],
        "scored": report["scored"],
        "expected": report["expected"],
        "missing": report["missing"],
        "absent": report["absent"],
        "band": report["band"],
        "students": len(items),
        "with_results": sum(1 for item in items if item["empty_reason"] is None),
    }
    total = len(items)
    current = page or 1
    size = min(max(page_size, 1), 50)
    if page:
        items.sort(key=lambda item: _student_sort_key(item, sort), reverse=direction == "desc")
        offset = (current - 1) * size
        items = items[offset:offset + size]
    pages = max(1, (total + size - 1) // size) if total else 1
    return {"items": items, "total": total, "page": current if page else 0, "pages": pages, "summary": summary}
