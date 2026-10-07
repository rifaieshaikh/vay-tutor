from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from io import BytesIO

from bson import ObjectId
from fastapi import APIRouter, File, Request, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from pydantic import BaseModel, Field

from app.acl import allows
from app.errors import AppError
from app.http import current_user, db
from app.importing.commit import commit_import, known_sessions
from app.importing.corrections import parse_correction_file
from app.importing.counts import annotate_plan
from app.importing.parse import parse_workbook, workbook_rows
from app.importing.plan import apply_decisions, variant_suggestions
from app.importing.publish import (
    correct_marksheet,
    reject_marksheet,
    require_current_version,
    submit_marksheet,
    withdraw_marksheet,
)
from app.security import name_key

router = APIRouter(prefix="/api/v1")
_MAX_BYTES = 25 * 1024 * 1024


class DecisionBody(BaseModel):
    sheets: dict = Field(default_factory=dict)
    defaults: dict = Field(default_factory=dict)


class ReasonBody(BaseModel):
    reason: str = ""
    changes: list[dict] = Field(default_factory=list)
    edit_version: int | None = None


class ResultPatch(BaseModel):
    score: float | None = None
    status: str | None = None
    edit_version: int | None = None


class CatalogPatch(BaseModel):
    name: str | None = None
    archived: bool | None = None


class MergeBody(BaseModel):
    source_id: str
    target_id: str
    acknowledge: bool = False


class MarksheetPatch(BaseModel):
    exam_date: str | None = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


@router.post("/imports")
async def upload_import(request: Request, file: UploadFile = File(...)) -> dict:
    user = await current_user(request)
    if not any("marksheet.upload" in grant["actions"] for grant in user["grants"]):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    filename = file.filename or "marklist.xlsx"
    if not filename.lower().endswith(".xlsx"):
        raise AppError(422, "import.file_type", "Upload an .xlsx workbook.")
    data = await file.read()
    if len(data) > _MAX_BYTES:
        raise AppError(422, "import.too_large", "The workbook is larger than 25 MB.")
    digest = hashlib.sha256(data).hexdigest()
    existing = await db(request).import_jobs.find_one(
        {"institute_id": user["institute_id"], "sha256": digest, "state": {"$nin": ["committed", "cancelled"]}}
    )
    if existing:
        return {"id": existing["_id"], "state": existing["state"], "duplicate": True}
    try:
        parsed = parse_workbook(data, filename)
    except ValueError as exc:
        raise AppError(422, "import.unreadable", str(exc)) from exc
    file_id = str(ObjectId())
    path = request.app.state.settings.data_dir / "files" / f"{file_id}.xlsx"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    job_id = str(ObjectId())
    await db(request).files.insert_one(
        {
            "_id": file_id,
            "institute_id": user["institute_id"],
            "kind": "source_xlsx",
            "sha256": digest,
            "path": str(path),
            "filename": filename,
            "created_at": _now(),
        }
    )
    state = "needs_resolution" if _needs_resolution(parsed) else "ready"
    await db(request).import_jobs.insert_one(
        {
            "_id": job_id,
            "institute_id": user["institute_id"],
            "actor_id": user["_id"],
            "filename": filename,
            "sha256": digest,
            "file_id": file_id,
            "state": state,
            "parsed": parsed,
            "decisions": {"sheets": {}},
            "committed_sheets": [],
            "outcomes": [],
            "created_at": _now(),
        }
    )
    await db(request).audit_events.insert_one(
        {
            "_id": str(ObjectId()),
            "institute_id": user["institute_id"],
            "action": "import.upload",
            "actor_id": user["_id"],
            "at": _now(),
            "context": {"import_id": job_id, "file": filename},
        }
    )
    return {"id": job_id, "state": state, "duplicate": False, "sheets": len(parsed["sheets"])}


def _needs_resolution(parsed: dict) -> bool:
    for sheet in parsed["sheets"]:
        if sheet["heading_conflict"]:
            return True
        if any(not group["confirmed"] for group in sheet["groups"]):
            return True
        if len(sheet["recommended_batches"]) > 1:
            return True
    return False


@router.get("/imports/{import_id}")
async def get_import(request: Request, import_id: str) -> dict:
    user = await current_user(request)
    job = await _job(request, user, import_id)
    known = await known_sessions(db(request), user["institute_id"])
    plan = apply_decisions(job["parsed"], job.get("decisions") or {}, known)
    plan["totals"].update(await _plan_totals(db(request), user["institute_id"], plan, known))
    await annotate_plan(db(request), user["institute_id"], plan)
    stored_rows = _stored_rows(request, job)
    return {
        "id": job["_id"],
        "state": job["state"],
        "filename": job["filename"],
        "sheets": [_public_sheet(sheet, stored_rows.get(sheet["name"], [])) for sheet in plan["sheets"]],
        "blockers": plan["blockers"],
        "totals": plan["totals"],
        "variants": variant_suggestions(job["parsed"]),
        "outcomes": job.get("outcomes") or [],
        "summary": job.get("summary"),
        "ready": plan["ready"],
    }


@router.patch("/imports/{import_id}")
async def patch_import(request: Request, import_id: str, body: DecisionBody) -> dict:
    user = await current_user(request)
    job = await _job(request, user, import_id)
    if job["state"] == "committed":
        raise AppError(422, "import.committed", "This workbook is already committed.")
    decisions = job.get("decisions") or {"sheets": {}}
    if body.defaults:
        decisions["defaults"] = {**(decisions.get("defaults") or {}), **body.defaults}
    for sheet_id, choice in body.sheets.items():
        current = decisions["sheets"].get(sheet_id, {})
        groups = {**(current.get("groups") or {}), **(choice.get("groups") or {})}
        levels = {**(current.get("levels") or {}), **(choice.get("levels") or {})}
        row_batches = {**(current.get("row_batches") or {}), **(choice.get("row_batches") or {})}
        corrections = {**(current.get("corrections") or {}), **(choice.get("corrections") or {})}
        names = {**(current.get("names") or {}), **(choice.get("names") or {})}
        added = {**(current.get("added") or {}), **(choice.get("added") or {})}
        drop_rows = list(dict.fromkeys([*(current.get("drop_rows") or []), *(choice.get("drop_rows") or [])]))
        current.update(choice)
        if groups:
            current["groups"] = groups
        if levels:
            current["levels"] = levels
        if row_batches:
            current["row_batches"] = row_batches
        if corrections:
            current["corrections"] = corrections
        if names:
            current["names"] = names
        if added:
            current["added"] = added
        if drop_rows:
            current["drop_rows"] = drop_rows
        decisions["sheets"][sheet_id] = current
    known = await known_sessions(db(request), user["institute_id"])
    plan = apply_decisions(job["parsed"], decisions, known)
    state = "ready" if plan["ready"] else "needs_resolution"
    await db(request).import_jobs.update_one({"_id": job["_id"]}, {"$set": {"decisions": decisions, "state": state}})
    return {"id": job["_id"], "state": state, "ready": plan["ready"], "blockers": plan["blockers"]}


@router.post("/imports/{import_id}/corrections")
async def upload_corrections(request: Request, import_id: str, file: UploadFile = File(...)) -> dict:
    user = await current_user(request)
    job = await _job(request, user, import_id)
    if job["state"] == "committed":
        raise AppError(422, "import.committed", "This workbook is already committed.")
    filename = file.filename or "corrections.xlsx"
    if not filename.lower().endswith(".xlsx"):
        raise AppError(422, "import.file_type", "Upload an .xlsx correction file.")
    try:
        rows = parse_correction_file(await file.read())
    except ValueError as exc:
        raise AppError(422, "import.unreadable", str(exc)) from exc
    known = await known_sessions(db(request), user["institute_id"])
    plan = apply_decisions(job["parsed"], job.get("decisions") or {}, known)
    decisions = job.get("decisions") or {"sheets": {}}
    decisions.setdefault("sheets", {})
    applied = []
    unmatched = []
    for row in rows:
        sheet = next((item for item in plan["sheets"] if item["name"].strip().casefold() == row["sheet"].casefold()), None)
        if sheet is None:
            unmatched.append({"sheet": row["sheet"], "student": row["student"], "message": "That sheet is not in this workbook."})
            continue
        wanted_row = row["row"]
        matches = []
        for group in sheet["groups"]:
            for student in group["students"]:
                if wanted_row not in (None, "") and int(wanted_row) != int(student["row"]):
                    continue
                if name_key(row["student"]) == student["name_key"]:
                    matches.append(student)
        if len(matches) != 1:
            unmatched.append({"sheet": row["sheet"], "student": row["student"], "message": "Match one student. Add the Row column when a name appears twice."})
            continue
        score = row["score"]
        status = None
        if isinstance(score, str) and score.strip().upper() in {"A", "AB"}:
            status = "absent"
            score = None
        elif score in (None, ""):
            status = "missing"
            score = None
        choice = decisions["sheets"].setdefault(sheet["id"], {})
        corrections = choice.setdefault("corrections", {})
        corrections[str(matches[0]["row"])] = {"action": "replace", "score": score, "status": status, "reason": row["reason"]}
        applied.append({"sheet": sheet["name"], "student": matches[0]["display_name"], "row": matches[0]["row"]})
    await db(request).import_jobs.update_one({"_id": job["_id"]}, {"$set": {"decisions": decisions}})
    return {"applied": applied, "unmatched": unmatched}


@router.get("/imports/{import_id}/correction-template")
async def correction_template(request: Request, import_id: str):
    payload = await get_import(request, import_id)
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Corrections"
    sheet.append(["Sheet", "Row", "Student", "File score", "Saved score", "Score", "Reason"])
    for item in payload["sheets"]:
        for group in item["groups"]:
            for student in group["students"]:
                if student.get("change") not in {"reject", "update"}:
                    continue
                sheet.append([
                    item["name"],
                    student["row"],
                    student["display_name"],
                    student.get("score"),
                    student.get("before_score"),
                    "",
                    "",
                ])
    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="corrections.xlsx"'},
    )


@router.get("/imports/{import_id}/preview")
async def preview_import(request: Request, import_id: str) -> dict:
    return await get_import(request, import_id)


@router.get("/imports/{import_id}/validation-report")
async def validation_report(request: Request, import_id: str):
    user = await current_user(request)
    if not any("export.xlsx" in grant["actions"] for grant in user["grants"]):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    payload = await get_import(request, import_id)
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Validation"
    sheet.append(["Sheet", "Row", "Name", "Status", "Score", "Before", "Change", "Maximum", "Percentage", "Rank", "Source rank", "Blocker"])
    blockers = {(item.get("sheet_id"), item.get("row")): item["message"] for item in payload["blockers"]}
    for item in payload["sheets"]:
        for group in item["groups"]:
            for student in group["students"]:
                sheet.append(
                    [
                        item["name"],
                        student["row"],
                        student["display_name"],
                        student["status"],
                        student["score"],
                        student.get("before_score"),
                        student.get("change"),
                        group["maximum"],
                        None if student["percentage"] is None else round(student["percentage"], 2),
                        student["rank"],
                        student["source_rank"],
                        blockers.get((item["id"], student["row"]), ""),
                    ]
                )
    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="validation.xlsx"'},
    )


@router.get("/imports/{import_id}/outcome-report")
async def outcome_report(request: Request, import_id: str):
    user = await current_user(request)
    if not any("export.xlsx" in grant["actions"] for grant in user["grants"]):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    job = await _job(request, user, import_id)
    summary = job.get("summary")
    if not summary:
        raise AppError(422, "import.not_committed", "Commit the workbook before downloading the outcome.")
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Outcome"
    sheet.append(["Kind", "Inserted", "Updated", "Unchanged", "Skipped", "Rejected"])
    for kind, buckets in (summary.get("counts") or {}).items():
        sheet.append([kind, buckets.get("insert", 0), buckets.get("update", 0), buckets.get("unchanged", 0), buckets.get("skip", 0), buckets.get("reject", 0)])
    detail = workbook.create_sheet("Sheets")
    detail.append(["Sheet", "Status", "Kind", "Inserted", "Updated", "Unchanged", "Skipped", "Rejected"])
    for item in summary.get("by_sheet") or []:
        for kind, buckets in (item.get("counts") or {}).items():
            detail.append([item.get("name"), item.get("status"), kind, buckets.get("insert", 0), buckets.get("update", 0), buckets.get("unchanged", 0), buckets.get("skip", 0), buckets.get("reject", 0)])
    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="import-outcome.xlsx"'},
    )


@router.post("/imports/{import_id}/commit")
async def commit_import_route(request: Request, import_id: str) -> dict:
    user = await current_user(request)
    job = await _job(request, user, import_id)
    if not any("marksheet.upload" in grant["actions"] for grant in user["grants"]):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    if job["state"] == "committed":
        return {"id": job["_id"], "state": "committed", "outcomes": job.get("outcomes") or []}
    if job["state"] == "cancelled":
        raise AppError(422, "import.cancelled", "This import was cancelled.")
    raw = await request.body()
    confirm_updates = bool(json.loads(raw).get("confirm_updates")) if raw else False
    result = await commit_import(db(request), request.app.state.client, job, user, confirm_updates=confirm_updates)
    return {"id": job["_id"], **result}


@router.post("/imports/{import_id}/cancel")
async def cancel_import(request: Request, import_id: str) -> dict:
    user = await current_user(request)
    job = await _job(request, user, import_id)
    if job["state"] == "committed":
        raise AppError(422, "import.committed", "A committed workbook cannot be cancelled.")
    await db(request).import_jobs.update_one({"_id": job["_id"]}, {"$set": {"state": "cancelled"}})
    return {"id": job["_id"], "state": "cancelled"}


@router.get("/imports")
async def list_imports(request: Request) -> dict:
    user = await current_user(request)
    if not any("marksheet.upload" in grant["actions"] or "marksheet.view" in grant["actions"] for grant in user["grants"]):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    items = []
    cursor = db(request).import_jobs.find({"institute_id": user["institute_id"]}).sort("created_at", -1)
    async for job in cursor:
        items.append(
            {
                "id": job["_id"],
                "filename": job.get("filename"),
                "state": job.get("state"),
                "created_at": job.get("created_at").isoformat() if job.get("created_at") else None,
                "outcomes": job.get("outcomes") or [],
                "summary": job.get("summary"),
            }
        )
    return {"items": items}


@router.get("/marksheets")
async def list_marksheets(
    request: Request,
    status: str = "",
    exam_type: str = "",
    branch_id: str = "",
    course_id: str = "",
    batch_id: str = "",
    subject_id: str = "",
    paper_id: str = "",
    exam_date: str = "",
    q: str = "",
) -> dict:
    user = await current_user(request)
    if not any("marksheet.view" in grant["actions"] for grant in user["grants"]):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    query: dict = {"institute_id": user["institute_id"]}
    for field, value in (
        ("status", status),
        ("exam_type", exam_type),
        ("branch_id", branch_id),
        ("course_id", course_id),
        ("subject_id", subject_id),
        ("paper_id", paper_id),
        ("exam_date", exam_date),
    ):
        if value:
            query[field] = value
    if batch_id:
        query["batch_ids"] = batch_id
    items = []
    names = {}
    cursor = db(request).marksheets.find(query)
    async for sheet in cursor:
        resource = {
            "institute_id": sheet["institute_id"],
            "branch_id": sheet.get("branch_id"),
            "course_id": sheet.get("course_id"),
            "subject_id": sheet.get("subject_id"),
        }
        if not allows(user["grants"], "marksheet.view", resource):
            continue
        summary = _marksheet_summary(sheet)
        if q and q.casefold() not in " ".join(
            str(summary.get(field) or "") for field in ("title", "source_file", "source_sheet")
        ).casefold():
            continue
        for field, key in (("uploader_id", "uploader_name"), ("reviewer_id", "reviewer_name")):
            person_id = sheet.get(field)
            if person_id and person_id not in names:
                person = await db(request).users.find_one({"_id": person_id})
                names[person_id] = person["name"] if person else ""
            summary[key] = names.get(person_id, "")
        items.append(summary)
    return {"items": items}


@router.post("/marksheets/{marksheet_id}/submit")
async def submit_route(request: Request, marksheet_id: str) -> dict:
    user, sheet = await _editable(request, marksheet_id, "marksheet.submit")
    return await submit_marksheet(db(request), user, sheet)


@router.post("/marksheets/{marksheet_id}/reject")
async def reject_route(request: Request, marksheet_id: str) -> dict:
    user, sheet = await _editable(request, marksheet_id, "marksheet.publish")
    return await reject_marksheet(db(request), user, sheet)


@router.post("/marksheets/{marksheet_id}/correct")
async def correct_route(request: Request, marksheet_id: str, body: ReasonBody) -> dict:
    user, sheet = await _editable(request, marksheet_id, "marksheet.correct")
    return await correct_marksheet(
        db(request), request.app.state.client, user, sheet, body.reason, body.changes, body.edit_version
    )


@router.post("/marksheets/{marksheet_id}/withdraw")
async def withdraw_route(request: Request, marksheet_id: str, body: ReasonBody) -> dict:
    user, sheet = await _editable(request, marksheet_id, "marksheet.withdraw")
    return await withdraw_marksheet(db(request), request.app.state.client, user, sheet, body.reason, body.edit_version)


@router.patch("/marksheets/{marksheet_id}")
async def patch_marksheet(request: Request, marksheet_id: str, body: MarksheetPatch) -> dict:
    _user, sheet = await _editable(request, marksheet_id, "marksheet.edit_draft")
    if sheet.get("status") != "draft":
        raise AppError(422, "marksheet.state", "Only a draft can be edited.")
    updates = {}
    if body.exam_date:
        updates["exam_date"] = body.exam_date
    if updates:
        updates["edit_version"] = sheet.get("edit_version", 0) + 1
        await db(request).marksheets.update_one({"_id": sheet["_id"]}, {"$set": updates})
    return {"id": sheet["_id"], **updates}


@router.patch("/marksheets/{marksheet_id}/results/{result_id}")
async def patch_result(request: Request, marksheet_id: str, result_id: str, body: ResultPatch) -> dict:
    _user, sheet = await _editable(request, marksheet_id, "marksheet.edit_draft")
    require_current_version(sheet, body.edit_version)
    if sheet.get("status") != "draft":
        raise AppError(422, "marksheet.state", "Only a draft result can be corrected here.")
    result = await db(request).results.find_one({"_id": result_id, "marksheet_id": sheet["_id"]})
    if result is None:
        raise AppError(404, "not_found", "That record was not found.")
    updates = {"previous_score": result.get("score")}
    if body.score is not None:
        if body.score < 0 or (sheet.get("maximum") is not None and body.score > sheet["maximum"]):
            raise AppError(422, "import.invalid_mark", "The score must be from 0 through the maximum.")
        updates["score"] = body.score
        updates["status"] = "scored"
    if body.status:
        updates["status"] = body.status
    version = sheet.get("edit_version", 0) + 1
    await db(request).results.update_one({"_id": result_id}, {"$set": updates})
    await db(request).marksheets.update_one({"_id": sheet["_id"]}, {"$set": {"edit_version": version}})
    return {"id": result_id, "edit_version": version, **updates}


@router.get("/catalog")
async def catalog(request: Request) -> dict:
    user = await current_user(request)
    if not any(action in grant["actions"] for grant in user["grants"] for action in ("student.lookup", "catalog.correct", "catalog.manage")):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    database = db(request)
    branches = await database.branches.find({"institute_id": user["institute_id"]}).to_list(length=200)
    courses = await database.courses.find({"institute_id": user["institute_id"]}).to_list(length=200)
    batches = await database.batches.find({"institute_id": user["institute_id"]}).to_list(length=200)
    subjects = await database.subjects.find({"institute_id": user["institute_id"]}).to_list(length=200)
    students = await database.students.find({"institute_id": user["institute_id"]}).to_list(length=500)
    return {
        "branches": [_catalog_row(item) for item in branches],
        "courses": [_catalog_row(item) for item in courses],
        "batches": [_catalog_row(item) for item in batches],
        "subjects": [_catalog_row(item) for item in subjects],
        "students": [_catalog_row(item) for item in students],
    }


@router.patch("/catalog/{kind}/{record_id}")
async def patch_catalog(request: Request, kind: str, record_id: str, body: CatalogPatch) -> dict:
    user = await current_user(request)
    if not any("catalog.correct" in grant["actions"] or "catalog.manage" in grant["actions"] for grant in user["grants"]):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    collection = {"branch": "branches", "course": "courses", "batch": "batches", "subject": "subjects", "student": "students"}.get(kind)
    if collection is None:
        raise AppError(404, "not_found", "That record was not found.")
    record = await db(request)[collection].find_one({"_id": record_id, "institute_id": user["institute_id"]})
    if record is None:
        raise AppError(404, "not_found", "That record was not found.")
    updates = {}
    if body.name:
        updates["name"] = body.name
        if kind == "student":
            updates["display_name"] = body.name
        updates["previous_name"] = record.get("name") or record.get("display_name")
    if body.archived is not None:
        updates["archived"] = body.archived
    if not updates:
        raise AppError(422, "catalog.empty", "Choose a new name or an archive state.")
    await db(request)[collection].update_one({"_id": record_id}, {"$set": updates})
    await db(request).audit_events.insert_one(
        {
            "_id": str(ObjectId()),
            "institute_id": user["institute_id"],
            "action": "catalog.correct",
            "actor_id": user["_id"],
            "at": _now(),
            "context": {"kind": kind, "id": record_id, **updates},
        }
    )
    return {"id": record_id, **updates}


@router.post("/students/merge-preview")
async def merge_preview(request: Request, body: MergeBody) -> dict:
    user = await current_user(request)
    if not any("catalog.manage" in grant["actions"] for grant in user["grants"]):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    source, target = await _merge_pair(request, user["institute_id"], body)
    source_rows = await db(request).enrollments.find({"student_id": source["_id"]}).to_list(length=100)
    target_rows = await db(request).enrollments.find({"student_id": target["_id"]}).to_list(length=100)
    target_batches = {item["batch_id"] for item in target_rows}
    return {
        "source": source.get("display_name"),
        "target": target.get("display_name"),
        "move": [item["_id"] for item in source_rows if item["batch_id"] not in target_batches],
        "kept_separate": [item["_id"] for item in source_rows if item["batch_id"] in target_batches],
        "alias": source.get("name_key"),
    }


@router.post("/students/merge")
async def merge_students(request: Request, body: MergeBody) -> dict:
    user = await current_user(request)
    if not any("catalog.manage" in grant["actions"] for grant in user["grants"]):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    if not body.acknowledge:
        raise AppError(422, "catalog.acknowledge", "Review the merge impact and confirm it.")
    preview = await merge_preview(request, body)
    source, target = await _merge_pair(request, user["institute_id"], body)
    for enrollment_id in preview["move"]:
        await db(request).enrollments.update_one({"_id": enrollment_id}, {"$set": {"student_id": target["_id"]}})
    await db(request).aliases.insert_one(
        {
            "_id": str(ObjectId()),
            "institute_id": user["institute_id"],
            "student_id": target["_id"],
            "name_key": source.get("name_key"),
            "display_name": source.get("display_name"),
        }
    )
    await db(request).students.update_one({"_id": source["_id"]}, {"$set": {"archived": True, "merged_into": target["_id"]}})
    await db(request).audit_events.insert_one(
        {
            "_id": str(ObjectId()),
            "institute_id": user["institute_id"],
            "action": "student.merge",
            "actor_id": user["_id"],
            "at": _now(),
            "context": {"source_id": source["_id"], "target_id": target["_id"], "moved": preview["move"]},
        }
    )
    return {"id": target["_id"], "moved": len(preview["move"]), "archived_id": source["_id"]}


@router.get("/students/{student_id}/enrollments")
async def enrollment_history(request: Request, student_id: str) -> dict:
    user = await current_user(request)
    student = await db(request).students.find_one({"_id": student_id, "institute_id": user["institute_id"]})
    if student is None:
        raise AppError(404, "not_found", "That record was not found.")
    rows = await db(request).enrollments.find({"student_id": student_id}).to_list(length=100)
    items = []
    for row in rows:
        batch = await db(request).batches.find_one({"_id": row["batch_id"]})
        items.append({"id": row["_id"], "batch_id": row["batch_id"], "batch_name": batch.get("name") if batch else ""})
    aliases = await db(request).aliases.find({"student_id": student_id}).to_list(length=20)
    return {
        "student_code": student.get("student_code"),
        "display_name": student.get("display_name"),
        "archived": bool(student.get("archived")),
        "enrollments": items,
        "aliases": [item.get("display_name") for item in aliases],
    }


async def _plan_totals(database, institute_id: str, plan: dict, known: dict) -> dict:
    seen = {key: list(value) for key, value in known.items()}
    create = 0
    reuse = 0
    for sheet in plan["sheets"]:
        if not sheet["included"]:
            continue
        for group in sheet["groups"]:
            if group["interpretation"] == "skip_duplicate":
                continue
            for student in group["students"]:
                if not str(student.get("display_name") or "").strip():
                    continue
                sessions = seen.get(student["name_key"], [])
                if student.get("batch_session") in sessions:
                    reuse += 1
                else:
                    create += 1
                    if student.get("batch_session"):
                        seen.setdefault(student["name_key"], []).append(student["batch_session"])
    branch = await database.branches.find_one({"institute_id": institute_id})
    return {"students_to_create": create, "students_to_reuse": reuse, "catalog_started": branch is not None}


async def _merge_pair(request: Request, institute_id: str, body: MergeBody) -> tuple[dict, dict]:
    source = await db(request).students.find_one({"_id": body.source_id, "institute_id": institute_id})
    target = await db(request).students.find_one({"_id": body.target_id, "institute_id": institute_id})
    if source is None or target is None or source["_id"] == target["_id"]:
        raise AppError(404, "not_found", "That record was not found.")
    return source, target


def _catalog_row(item: dict) -> dict:
    return {
        "id": item["_id"],
        "name": item.get("name") or item.get("display_name"),
        "archived": bool(item.get("archived")),
        "student_code": item.get("student_code"),
    }


async def _job(request: Request, user: dict, import_id: str) -> dict:
    job = await db(request).import_jobs.find_one({"_id": import_id, "institute_id": user["institute_id"]})
    if job is None:
        raise AppError(404, "not_found", "That record was not found.")
    if not any("marksheet.upload" in grant["actions"] or "marksheet.view" in grant["actions"] for grant in user["grants"]):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    return job


async def _editable(request: Request, marksheet_id: str, action: str) -> tuple[dict, dict]:
    user = await current_user(request)
    sheet = await db(request).marksheets.find_one({"_id": marksheet_id, "institute_id": user["institute_id"]})
    if sheet is None:
        raise AppError(404, "not_found", "That record was not found.")
    resource = {
        "institute_id": sheet["institute_id"],
        "branch_id": sheet.get("branch_id"),
        "course_id": sheet.get("course_id"),
        "subject_id": sheet.get("subject_id"),
    }
    if not allows(user["grants"], "marksheet.view", resource):
        raise AppError(404, "not_found", "That record was not found.")
    if not allows(user["grants"], action, resource):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    return user, sheet


def _stored_rows(request: Request, job: dict) -> dict:
    file_id = job.get("file_id")
    if not file_id:
        return {}
    path = request.app.state.settings.data_dir / "files" / f"{file_id}.xlsx"
    if not path.exists():
        return {}
    try:
        return workbook_rows(path.read_bytes())
    except ValueError:
        return {}


def _public_sheet(sheet: dict, rows: list | None = None) -> dict:
    return {
        "id": sheet["id"],
        "name": sheet["name"],
        "included": sheet["included"],
        "title": sheet["title"],
        "suggested_title": sheet["suggested_title"],
        "branch_name": sheet["branch_name"],
        "course_name": sheet["course_name"],
        "subject_name": sheet["subject_name"],
        "paper_number": sheet["paper_number"],
        "batches": sheet["batches"],
        "heading_conflict": sheet["heading_conflict"],
        "heading_acknowledged": sheet["heading_acknowledged"],
        "exam_date": sheet["exam_date"],
        "rows": rows or [],
        "attempt": sheet["attempt"],
        "exam_type": sheet["exam_type"],
        "planned": sheet.get("planned"),
        "groups": [
            {
                "id": group["id"],
                "maximum": group["maximum"],
                "interpretation": group["interpretation"],
                "confirmed": group["confirmed"],
                "duplicate_of": group["duplicate_of"],
                "students": group["students"],
            }
            for group in sheet["groups"]
        ],
        "blockers": sheet["blockers"],
    }


def _marksheet_summary(sheet: dict) -> dict:
    return {
        "id": sheet["_id"],
        "title": sheet.get("title") or sheet.get("status"),
        "status": sheet.get("status"),
        "branch_id": sheet.get("branch_id"),
        "course_id": sheet.get("course_id"),
        "subject_id": sheet.get("subject_id"),
        "paper_id": sheet.get("paper_id"),
        "batch_ids": sheet.get("batch_ids") or [],
        "exam_date": sheet.get("exam_date"),
        "exam_type": sheet.get("exam_type"),
        "maximum": sheet.get("maximum"),
        "source_file": sheet.get("source_file"),
        "source_sheet": sheet.get("source_sheet"),
        "file_id": sheet.get("file_id"),
        "revision": sheet.get("active_revision") or sheet.get("revision"),
        "edit_version": sheet.get("edit_version", 0),
    }
