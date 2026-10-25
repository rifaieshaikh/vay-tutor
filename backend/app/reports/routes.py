"""Academic views, progress cards, and card export."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.acl import allows, clean_scope, mongo_clause
from app.context import _restrict_batches, resolve_academic
from app.deps import current_user, db, write_audit
from app.errors import AppError
from app.jobs import enqueue
from app.queries import _card_context, _export_covers_student, _period, _report_filters
from app.students import enrollment_resource

router = APIRouter(prefix="/api/v1")


def _and(clause: dict) -> dict:
    if "$or" in clause or clause == {"_id": {"$exists": False}}:
        return clause
    return clause

class ReportBody(BaseModel):
    format: str
    scope: dict[str, Any] = Field(default_factory=dict)


@router.get("/views/{level}")
async def view(
    request: Request,
    level: str,
    branch_id: str = "",
    course_id: str = "",
    batch_id: str = "",
    subject_id: str = "",
    paper_id: str = "",
    exam_type: str = "",
    exam_date: str = "",
    exam_date_from: str = "",
    exam_date_to: str = "",
    attempt: str = "",
    period: str = "",
    page: int = 1,
    attention_page: int = 1,
) -> dict:
    user = await current_user(request)
    if level not in {"institute", "branch", "course", "batch", "subject", "paper"}:
        raise AppError(404, "not_found", "That record was not found.")
    if not any("dashboard.view" in grant["actions"] for grant in user["grants"]):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    academic, _dropped, period_ids = await resolve_academic(
        request, user, "dashboard.view", branch_id, course_id, batch_id, period
    )
    branch_id = academic.get("branch_id", "")
    course_id = academic.get("course_id", "")
    batch_id = academic.get("batch_id", "")
    start, end = _period(exam_date_from, exam_date_to)
    filters = {
        "branch_id": branch_id,
        "course_id": course_id,
        "batch_id": batch_id,
        "subject_id": subject_id,
        "paper_id": paper_id,
        "exam_type": exam_type,
        "exam_date": exam_date,
        "exam_date_from": start,
        "exam_date_to": end,
        "attempt": attempt if attempt in {"original", "retest"} else "",
    }
    branch_clause = mongo_clause(
        user["grants"], "dashboard.view", {"institute_id": "institute_id", "branch_id": "_id"}
    )
    branch_query = {"institute_id": user["institute_id"], **_and(branch_clause)}
    if branch_id:
        branch_query["_id"] = branch_id
    branches = await db(request).branches.count_documents(branch_query)
    enrollment_clause = mongo_clause(
        user["grants"],
        "dashboard.view",
        {
            "institute_id": "institute_id",
            "branch_id": "branch_id",
            "course_id": "course_id",
            "batch_id": "batch_id",
        },
    )
    enrollment_query = {"institute_id": user["institute_id"], **_and(enrollment_clause)}
    for field in ("branch_id", "course_id"):
        if filters[field]:
            enrollment_query[field] = filters[field]
    _restrict_batches(enrollment_query, "batch_id", filters.get("batch_id", ""), period_ids)
    enrollment_rows = await _every(db(request).enrollments.find(enrollment_query))
    student_ids = {item["student_id"] for item in enrollment_rows}
    from app.calculating import aggregate, public_bands
    from app.reporting import (
        attention,
        authorized,
        hydrate,
        matches,
        names_for,
        participation_summary,
        policy_for,
        rank_page,
        student_boards,
        view_sections,
    )

    policy = await policy_for(db(request), user["institute_id"])
    result_clause = mongo_clause(
        user["grants"],
        "dashboard.view",
        {
            "institute_id": "institute_id",
            "branch_id": "branch_id",
            "course_id": "course_id",
            "batch_id": "batch_id",
            "subject_id": "subject_id",
            "paper_id": "paper_id",
        },
    )
    result_query = {"institute_id": user["institute_id"], "active": {"$ne": False}, **_and(result_clause)}
    for field in ("branch_id", "course_id", "subject_id", "paper_id"):
        if filters.get(field):
            result_query[field] = filters[field]
    _restrict_batches(result_query, "batch_id", filters.get("batch_id", ""), period_ids)
    stored = await _every(db(request).results.find(result_query))
    rows = [row for row in await hydrate(db(request), stored) if row.get("published") and matches(row, filters)]
    rows = authorized(rows, user["grants"], "dashboard.view")
    academic_fields = ("subject_id", "paper_id", "exam_type", "exam_date", "exam_date_from", "exam_date_to", "attempt")
    academic = any(filters.get(field) for field in academic_fields)
    if academic:
        matched_students = {row.get("student_id") for row in rows if row.get("student_id")}
        enrollment_rows = [item for item in enrollment_rows if item.get("student_id") in matched_students]
        student_count = len(matched_students)
    else:
        student_count = len(student_ids)
    summary = aggregate(rows, policy)
    summary["participation"] = None
    confirmed, eligible = await _eligible_rosters(request, user["institute_id"], rows)
    if confirmed:
        summary.update(participation_summary(rows, eligible))
    current_policy = policy.get("version")
    published_versions = (row.get("policy_version") for row in rows)
    pending = any(item is not None and item != current_policy for item in published_versions)
    names = await names_for(db(request), rows)
    boards = student_boards(level, rows, policy, names, attention_page=attention_page)
    danger = attention(rows, policy)
    attention_students = {item.get("student_id") for item in danger if item.get("student_id")}
    attention_size = 20
    attention_pages = max(1, (len(danger) + attention_size - 1) // attention_size) if danger else 1
    current_attention = min(max(attention_page, 1), attention_pages)
    shown_attention = danger[(current_attention - 1) * attention_size : current_attention * attention_size]
    named_rows = list(shown_attention) + list(boards["top_students"])
    for group in boards["boards"]:
        named_rows.extend(group["top_students"])
        named_rows.extend(group["attention"])
    attention_ids = list({item.get("student_id") for item in named_rows if item.get("student_id")})
    student_names = {}
    student_codes = {}
    if attention_ids:
        query = {"_id": {"$in": attention_ids}}
        projection = {"display_name": 1, "student_code": 1}
        found = await db(request).students.find(query, projection).to_list(length=len(attention_ids))
        for person in found:
            student_names[person["_id"]] = person.get("display_name") or ""
            student_codes[person["_id"]] = person.get("student_code") or ""
    for item in named_rows:
        item["student_name"] = student_names.get(item.get("student_id"), "")
        item["student_code"] = student_codes.get(item.get("student_id"), "")
    return {
        "level": level,
        "branches": branches,
        "students": student_count,
        "enrollments": len(enrollment_rows),
        "roster_confirmed": confirmed,
        "membership_label": "students listed in imported marklists",
        "policy_version": policy.get("version", 1),
        "policy_label": policy.get("aggregate") or "maximum-marks-weighted",
        "bands": public_bands(policy.get("bands")),
        "pending_recalculation": pending,
        "sample_size": summary["scored"],
        "performance": summary,
        "sections": view_sections(level, rows, enrollment_rows, names, policy),
        "top_students": boards["top_students"],
        "top_student_count": boards["top_student_count"],
        "boards": boards["boards"],
        "attention": shown_attention,
        "attention_count": len(danger),
        "attention_result_count": len(danger),
        "attention_student_count": len(attention_students),
        "attention_sample_count": len(shown_attention),
        "attention_page": current_attention,
        "attention_pages": attention_pages,
        "ranks": rank_page(rows, page),
        "empty": not rows,
        "filters": {key: value for key, value in filters.items() if value},
    }


async def _every(cursor) -> list:
    return [item async for item in cursor]


async def _eligible_rosters(request: Request, institute_id: str, rows: list[dict]) -> tuple[bool, dict]:
    batch_ids = {row.get("batch_id") for row in rows if row.get("batch_id")}
    if not batch_ids:
        return False, {}
    stored = await _every(
        db(request).rosters.find({"institute_id": institute_id, "batch_id": {"$in": list(batch_ids)}})
    )
    eligible = {item["batch_id"]: set(item.get("student_ids") or []) for item in stored}
    return batch_ids <= set(eligible), eligible


@router.post("/rosters/confirm")
async def confirm_roster(request: Request) -> dict:
    user = await current_user(request)
    body = await request.json()
    batch_id = str(body.get("batch_id") or "")
    batch = await db(request).batches.find_one({"_id": batch_id, "institute_id": user["institute_id"]})
    if batch is None:
        raise AppError(404, "not_found", "That record was not found.")
    resource = {
        "institute_id": user["institute_id"],
        "branch_id": batch.get("branch_id"),
        "course_id": batch.get("course_id"),
        "batch_id": batch_id,
    }
    if not allows(user["grants"], "catalog.manage", resource):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    listed = await _every(db(request).enrollments.find({"batch_id": batch_id}))
    await db(request).rosters.update_one(
        {"institute_id": user["institute_id"], "batch_id": batch_id},
        {"$set": {"student_ids": [item["student_id"] for item in listed], "confirmed_by": user["_id"]}},
        upsert=True,
    )
    return {"batch_id": batch_id, "listed": len(listed), "roster_confirmed": True}


@router.get("/students/{student_id}/card")
async def student_card(
    request: Request,
    student_id: str,
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
) -> dict:
    user = await current_user(request)
    academic, _dropped, period_ids = await resolve_academic(
        request, user, "progress_card.view", branch_id, course_id, batch_id, period,
    )
    branch_id = academic.get("branch_id", "")
    course_id = academic.get("course_id", "")
    batch_id = academic.get("batch_id", "")
    student = await db(request).students.find_one(
        {"_id": student_id, "institute_id": user["institute_id"]}
    )
    if student is None:
        raise AppError(404, "not_found", "That record was not found.")
    enrollments = await db(request).enrollments.find({"student_id": student_id}).to_list(length=50)
    visible = False
    for enrollment in enrollments:
        resource = {
            "institute_id": enrollment["institute_id"],
            "branch_id": enrollment["branch_id"],
            "course_id": enrollment["course_id"],
            "batch_id": enrollment["batch_id"],
        }
        if allows(user["grants"], "progress_card.view", resource, resource_fields_only=True):
            visible = True
    if not visible:
        raise AppError(404, "not_found", "That record was not found.")
    enrollments = [
        item for item in enrollments
        if allows(user["grants"], "progress_card.view", enrollment_resource(item), resource_fields_only=True)
    ]
    results = await db(request).results.find({"student_id": student_id, "active": {"$ne": False}}).to_list(length=500)
    from app.calculating import aggregate, public_bands
    from app.reporting import comparisons, hydrate, matches, policy_for, present, ranks_for, tops_for

    policy = await policy_for(db(request), user["institute_id"])
    hydrated = await hydrate(db(request), results)
    shown_rows = []
    hidden = False
    for result in hydrated:
        resource = {
            "institute_id": result["institute_id"],
            "branch_id": result["branch_id"],
            "course_id": result["course_id"],
            "batch_id": result.get("batch_id"),
            "subject_id": result.get("subject_id"),
            "paper_id": result.get("paper_id"),
        }
        if allows(user["grants"], "progress_card.view", resource):
            if result.get("published"):
                shown_rows.append(result)
        else:
            hidden = True
    siblings = {}
    if not hidden:
        sheet_ids = list({row.get("marksheet_id") for row in shown_rows if row.get("marksheet_id")})
        if sheet_ids:
            found = await db(request).results.find(
                {"marksheet_id": {"$in": sheet_ids}, "active": {"$ne": False}}
            ).to_list(length=5000)
            cohort = [row for row in await hydrate(db(request), found) if row.get("published")]
            for row in cohort:
                siblings.setdefault(row.get("marksheet_id"), []).append(row)
    start_filters = _report_filters(
        branch_id, course_id, batch_id, subject_id, paper_id, exam_type, exam_date_from, exam_date_to, attempt,
    )
    card_filters = start_filters
    start = card_filters.get("exam_date_from") or ""
    end = card_filters.get("exam_date_to") or ""
    allowed_batches = set(period_ids) if period_ids is not None else None
    enrolled = [
        item for item in enrollments
        if (allowed_batches is None or item.get("batch_id") in allowed_batches)
        and all(
            not card_filters.get(field) or item.get(field) == card_filters[field]
            for field in ("branch_id", "course_id", "batch_id")
        )
    ]
    context_selected = bool(period) or any(card_filters.get(field) for field in ("branch_id", "course_id", "batch_id"))
    if context_selected and not enrolled:
        selected = []
        empty_reason = "enrollment"
    else:
        selected = [row for row in shown_rows if matches(row, card_filters)]
        if allowed_batches is not None:
            selected = [row for row in selected if row.get("batch_id") in allowed_batches]
        if not shown_rows and hidden:
            empty_reason = "restricted"
        elif not shown_rows:
            empty_reason = "unpublished"
        elif not selected:
            empty_reason = "filters"
        else:
            empty_reason = None
    presented = []
    for row in selected:
        rank = batch_rank = top_score = batch_top_score = None
        if not hidden:
            group = siblings.get(row.get("marksheet_id"), [row])
            rank, batch_rank = ranks_for(row, group)
            top_score, batch_top_score = tops_for(group, row.get("batch_id"))
        presented.append(present(row, policy, rank, batch_rank, top_score, batch_top_score))
    summary = aggregate(selected, policy)
    grouped: dict[tuple, list] = {}
    for row in selected:
        grouped.setdefault((row.get("subject_id") or "", row.get("paper_id") or ""), []).append(row)
    subjects = [
        {"subject_id": key[0] or None, "paper_id": key[1] or None, **aggregate(rows, policy)}
        for key, rows in grouped.items()
    ]
    outside = []
    if empty_reason != "enrollment" and (start or end):
        undated = {key: value for key, value in card_filters.items() if key not in {"exam_date_from", "exam_date_to"}}
        outside = [row for row in shown_rows if matches(row, undated) and not matches(row, card_filters)]
    facet_batches = {item.get("batch_id") for item in enrollments if item.get("batch_id")}
    facet_batches.update(row.get("batch_id") for row in shown_rows if row.get("batch_id"))
    return {
        "student_code": student["student_code"],
        "display_name": student["display_name"],
        "photo_id": student.get("photo_file_id") or None,
        "partial": hidden,
        "coverage_note": "Authorized subjects only." if hidden else None,
        "empty_reason": empty_reason,
        "membership_label": "students listed in imported marklists",
        "policy_version": policy.get("version", 1),
        "bands": public_bands(policy.get("bands")),
        "performance": summary,
        "subjects": subjects,
        "retests": comparisons(selected, outside),
        "filters": card_filters,
        "result_count": len(presented),
        "facets": {
            "batch_ids": sorted(facet_batches),
            "subject_ids": sorted({row.get("subject_id") for row in shown_rows if row.get("subject_id")}),
            "paper_ids": sorted({row.get("paper_id") for row in shown_rows if row.get("paper_id")}),
        },
        "enrollments": [
            {
                "id": item["_id"],
                "batch_id": item["batch_id"],
                "branch_id": item.get("branch_id"),
                "course_id": item.get("course_id"),
            }
            for item in enrollments
        ],
        "results": presented,
    }


@router.post("/reports/cards")
async def queue_cards(request: Request, body: ReportBody) -> dict:
    user = await current_user(request)
    if body.format not in {"pdf", "xlsx"}:
        raise AppError(422, "report.format", "Choose a PDF or spreadsheet export.")
    action = "export.pdf" if body.format == "pdf" else "export.xlsx"
    scope = clean_scope(body.scope, user["institute_id"])
    card = _card_context(body.scope)
    period = str(body.scope.get("period") or "").strip()
    if period:
        _applied, _dropped, period_ids = await resolve_academic(
            request,
            user,
            "progress_card.view",
            str(body.scope.get("branch_id") or ""),
            str(body.scope.get("course_id") or ""),
            str(body.scope.get("batch_id") or ""),
            period,
        )
        card["period_batch_ids"] = period_ids or []
    if card.get("student_id"):
        student = await db(request).students.find_one(
            {"_id": card["student_id"], "institute_id": user["institute_id"]}
        )
        if student is None:
            raise AppError(404, "not_found", "That record was not found.")
        enrollments = await db(request).enrollments.find({"student_id": student["_id"]}).to_list(length=50)
        if not _export_covers_student(user, enrollments, scope, action):
            raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    elif not allows(user["grants"], "progress_card.view", scope) or not allows(user["grants"], action, scope):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    key = request.headers.get("Idempotency-Key")
    job = await enqueue(
        db(request),
        kind="report_pdf" if body.format == "pdf" else "report_xlsx",
        actor=user,
        payload={"scope": scope, "card": card},
        idempotency_key=key,
    )
    await write_audit(request, user, "export.queue", None, {"job_id": job["_id"]}, scope)
    return {"id": job["_id"], "state": job["state"]}
