"""Marksheet detail, publication, and the legacy import commit check."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.acl import allows, clean_scope
from app.deps import current_user, db
from app.errors import AppError

router = APIRouter(prefix="/api/v1")

class ImportCommitBody(BaseModel):
    sheets: list[dict[str, Any]]


@router.get("/marksheets/{marksheet_id}")
async def get_marksheet(request: Request, marksheet_id: str) -> dict:
    user = await current_user(request)
    sheet = await db(request).marksheets.find_one(
        {"_id": marksheet_id, "institute_id": user["institute_id"]}
    )
    if sheet is None:
        raise AppError(404, "not_found", "That record was not found.")
    from app.assessments.marks import band_policy_for_sheet
    from app.calculating import public_bands

    resource = _sheet_resource(sheet)
    if not allows(user["grants"], "marksheet.view", resource):
        batches = await db(request).batches.find(
            {"_id": {"$in": sheet.get("batch_ids") or []}, "institute_id": user["institute_id"]}
        ).to_list(length=20)
        visible = False
        for batch in batches:
            wider = {
                **resource,
                "branch_id": batch.get("branch_id"),
                "batch_id": batch["_id"],
            }
            if allows(user["grants"], "marksheet.view", wider, True):
                visible = True
                break
        if not visible:
            raise AppError(404, "not_found", "That record was not found.")
    exam = await db(request).exams.find_one({"marksheet_id": sheet["_id"], "institute_id": user["institute_id"]})
    course = None
    if sheet.get("course_id"):
        course = await db(request).courses.find_one(
            {"_id": sheet["course_id"], "institute_id": user["institute_id"]}
        )
    revision = sheet.get("active_revision") or sheet.get("revision") or 1
    results = await db(request).results.find(
        {"marksheet_id": sheet["_id"], "revision": revision}
    ).to_list(length=500)
    student_ids = list({item.get("student_id") for item in results if item.get("student_id")})
    names = {}
    codes = {}
    if student_ids:
        for person in await db(request).students.find({"_id": {"$in": student_ids}}).to_list(length=len(student_ids)):
            names[person["_id"]] = person.get("display_name") or ""
            codes[person["_id"]] = person.get("student_code") or ""
    available = []
    if sheet.get("status") in {"draft", "submitted"}:
        batch_ids = sheet.get("batch_ids") or []
        enrolled = await db(request).enrollments.find({"batch_id": {"$in": batch_ids}}).to_list(length=500)
        waiting = [item["student_id"] for item in enrolled if item["student_id"] not in set(student_ids)]
        if waiting:
            for person in await db(request).students.find({"_id": {"$in": waiting}}).to_list(length=len(waiting)):
                available.append({
                    "id": person["_id"],
                    "display_name": person.get("display_name") or "",
                    "student_code": person.get("student_code") or "",
                })
    return {
        "id": sheet["_id"],
        "status": sheet.get("status"),
        "branch_id": sheet.get("branch_id"),
        "course_id": sheet.get("course_id"),
        "subject_id": sheet.get("subject_id"),
        "paper_id": sheet.get("paper_id"),
        "batch_ids": sheet.get("batch_ids") or [],
        "attempt_kind": sheet.get("attempt_kind") or "original",
        "title": sheet.get("title"),
        "exam_date": sheet.get("exam_date"),
        "exam_type": sheet.get("exam_type"),
        "exam_kind": (exam or {}).get("exam_kind") or sheet.get("exam_kind") or "",
        "maximum": sheet.get("maximum"),
        "source_file": sheet.get("source_file"),
        "source_sheet": sheet.get("source_sheet"),
        "exam_id": (exam or {}).get("_id") or "",
        "revision": revision,
        "edit_version": sheet.get("edit_version", 0),
        "file_id": sheet.get("file_id"),
        "uploader_id": sheet.get("uploader_id"),
        "reviewer_id": sheet.get("reviewer_id"),
        "bands": public_bands(sheet["bands"]) if sheet.get("bands") else None,
        "course_bands": public_bands(course["bands"]) if course and course.get("bands") else None,
        "available_students": available,
        "results": _present_results(results, names, codes, sheet, await band_policy_for_sheet(db(request), sheet)),
    }


def _present_results(results: list, names: dict, codes: dict, sheet: dict, policy: dict | None) -> list[dict]:
    from app.calculating import band_detail, percentage

    rows = []
    for item in results:
        exact = (
            percentage(
                item.get("score"),
                item.get("maximum") if item.get("maximum") is not None else sheet.get("maximum"),
            )
            if item.get("status") == "scored"
            else None
        )
        detail = band_detail(exact, policy) if exact is not None else {
            "band": None, "band_name": None, "band_place": None, "band_color": None,
        }
        rows.append(
            {
                "id": item["_id"],
                "student_id": item.get("student_id"),
                "display_name": names.get(item.get("student_id"), ""),
                "student_code": codes.get(item.get("student_id"), ""),
                "status": item.get("status"),
                "score": item.get("score"),
                "rank": item.get("rank"),
                "percentage": item.get("percentage"),
                "band": detail["band"],
                "band_name": detail["band_name"],
                "band_place": detail["band_place"],
                "band_color": detail.get("band_color"),
                "previous_score": item.get("previous_score"),
                "source": item.get("source"),
            }
        )
    return rows


@router.post("/marksheets/{marksheet_id}/publish")
async def publish_marksheet(request: Request, marksheet_id: str) -> dict:
    user = await current_user(request)
    sheet = await db(request).marksheets.find_one(
        {"_id": marksheet_id, "institute_id": user["institute_id"]}
    )
    if sheet is None or not allows(user["grants"], "marksheet.view", _sheet_resource(sheet)):
        raise AppError(404, "not_found", "That record was not found.")
    if not allows(user["grants"], "marksheet.publish", _sheet_resource(sheet)):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    if not sheet.get("assessment_id"):
        raise AppError(422, "marksheet.not_ready", "Publication is available after a marklist is imported.")
    from app.importing.publish import publish_revision

    return await publish_revision(db(request), request.app.state.client, user, sheet)


@router.post("/imports/commit")
async def commit_import(request: Request, body: ImportCommitBody) -> dict:
    user = await current_user(request)
    for sheet in body.sheets:
        if sheet.get("skipped"):
            continue
        scope = clean_scope(sheet.get("scope"), user["institute_id"])
        if not allows(user["grants"], "marksheet.upload", scope):
            raise AppError(
                403,
                "auth.forbidden",
                "You do not have permission to import that sheet.",
                sheet=sheet.get("name"),
            )
        dimension = sheet.get("create")
        if dimension:
            from app.acl import CREATE_ACTION

            action = CREATE_ACTION[dimension]
            if not allows(user["grants"], action, scope):
                raise AppError(
                    403,
                    "auth.forbidden",
                    "You do not have permission to create that record.",
                    dimension=dimension,
                )
    raise AppError(422, "import.not_ready", "Workbook import is the next milestone.")

def _sheet_resource(sheet: dict) -> dict:
    return {
        "institute_id": sheet["institute_id"],
        "branch_id": sheet.get("branch_id"),
        "course_id": sheet.get("course_id"),
        "batch_id": sheet.get("batch_id"),
        "subject_id": sheet.get("subject_id"),
        "paper_id": sheet.get("paper_id"),
    }
