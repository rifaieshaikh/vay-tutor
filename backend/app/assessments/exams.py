"""Exam conduct register. An exam is recorded before its marklist is uploaded."""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, File, Form, Request, UploadFile
from pydantic import BaseModel, ConfigDict, Field

from app.academics.curriculum import active_exam_type, active_kind, public_exam_types, public_kinds
from app.acl import allows
from app.deps import current_user, db, write_audit
from app.errors import AppError
from app.importing.parse import parse_workbook
from app.security import name_key

router = APIRouter(prefix="/api/v1")
_MAX_BYTES = 25 * 1024 * 1024


class ExamScope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: str
    item_ids: list[str] = Field(default_factory=list)


class ExamCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = ""
    exam_date: str = ""
    maximum: float = Field(gt=0)
    subject_id: str
    scope: ExamScope
    batch_ids: list[str] = Field(min_length=1)
    exam_kind: str = ""


class ExamPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    maximum: float | None = Field(default=None, gt=0)
    exam_date: str | None = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _date(value: str) -> str:
    text = value.strip()
    try:
        datetime.strptime(text, "%Y-%m-%d")
    except ValueError:
        raise AppError(422, "exam.date", "Enter the exam date.", field="exam_date") from None
    return text


def _batch_resource(user: dict, batch: dict, subject_id: str = "", paper_id: str = "") -> dict:
    return {
        "institute_id": user["institute_id"],
        "branch_id": batch.get("branch_id"),
        "course_id": batch.get("course_id"),
        "batch_id": batch["_id"],
        "subject_id": subject_id or None,
        "paper_id": paper_id or None,
    }


def _can(
    user: dict,
    action: str,
    batch: dict,
    subject_id: str = "",
    paper_id: str = "",
    fields_only: bool = True,
) -> bool:
    resource = _batch_resource(user, batch, subject_id, paper_id)
    return allows(user["grants"], action, resource, fields_only)


async def _visible_batches(request: Request, user: dict) -> list[dict]:
    rows = await db(request).batches.find({"institute_id": user["institute_id"]}).to_list(length=500)
    return [row for row in rows if _can(user, "marksheet.view", row)]


def _scope_label(exam: dict, kind_labels: dict[str, str], names: dict[str, str]) -> str:
    scope = exam.get("scope") or {}
    if scope.get("kind") == "subject":
        return "Whole subject"
    label = kind_labels.get(scope.get("kind") or "", scope.get("kind") or "Items")
    chosen = [names.get(item, "") for item in scope.get("item_ids") or []]
    chosen = [item for item in chosen if item]
    if not chosen:
        return label
    return f"{label}: {', '.join(chosen)}"


@router.get("/exams/batches")
async def list_exam_batches(request: Request, q: str = "") -> dict:
    user = await current_user(request)
    if not any("marksheet.view" in grant["actions"] for grant in user["grants"]):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    database = db(request)
    batches = await _visible_batches(request, user)
    branches = {
        item["_id"]: item.get("name") or ""
        for item in await database.branches.find({"institute_id": user["institute_id"]}).to_list(length=200)
    }
    courses = {
        item["_id"]: item.get("name") or ""
        for item in await database.courses.find({"institute_id": user["institute_id"]}).to_list(length=200)
    }
    needle = q.casefold().strip()
    items = []
    for batch in batches:
        name = batch.get("name") or ""
        branch_name = branches.get(batch.get("branch_id"), "")
        course_name = courses.get(batch.get("course_id"), "")
        if needle and needle not in f"{name} {branch_name} {course_name}".casefold():
            continue
        items.append({
            "id": batch["_id"],
            "name": name,
            "branch_id": batch.get("branch_id") or "",
            "branch_name": branch_name,
            "course_id": batch.get("course_id") or "",
            "course_name": course_name,
            "archived": bool(batch.get("archived")),
            "closed": bool(batch.get("closed")),
        })
    items.sort(key=lambda item: (
        item["branch_name"].casefold(),
        item["course_name"].casefold(),
        item["name"].casefold(),
    ))
    counts = {}
    if items:
        ids = [item["id"] for item in items]
        async for exam in database.exams.find({"institute_id": user["institute_id"], "batch_ids": {"$in": ids}}):
            for batch_id in exam.get("batch_ids") or []:
                if batch_id in ids:
                    counts[batch_id] = counts.get(batch_id, 0) + 1
    for item in items:
        item["exam_count"] = counts.get(item["id"], 0)
    return {"items": items, "total": len(items)}


@router.get("/exams")
async def list_exams(request: Request, batch_id: str = "") -> dict:
    user = await current_user(request)
    if not batch_id:
        raise AppError(422, "exam.batch", "Choose a batch.", field="batch_id")
    database = db(request)
    batch = await database.batches.find_one({"_id": batch_id, "institute_id": user["institute_id"]})
    if batch is None or not _can(user, "marksheet.view", batch):
        raise AppError(404, "not_found", "That record was not found.")
    course_id = batch.get("course_id") or ""
    subjects = await database.subjects.find(
        {"institute_id": user["institute_id"], "course_id": course_id}
    ).to_list(length=200)
    subject_ids = [item["_id"] for item in subjects]
    papers = await database.papers.find(
        {"institute_id": user["institute_id"], "subject_id": {"$in": subject_ids}}
    ).to_list(length=400) if subject_ids else []
    names = {item["_id"]: item.get("name") or "" for item in subjects}
    names.update({item["_id"]: item.get("name") or "" for item in papers})
    for subject in subjects:
        for unit in subject.get("units") or []:
            if unit.get("id"):
                names[unit["id"]] = unit.get("name") or ""
    institute = await database.institutes.find_one({"_id": user["institute_id"]})
    kind_labels = {item["key"]: item["label"] for item in public_kinds((institute or {}).get("curriculum_kinds"))}
    sheet_rows = await database.marksheets.find(
        {"institute_id": user["institute_id"], "batch_ids": batch_id}
    ).to_list(length=500)
    sheets = {item["_id"]: item for item in sheet_rows}
    same_course = await database.batches.find(
        {"institute_id": user["institute_id"], "course_id": course_id}
    ).to_list(length=200)
    course_batches = [
        row for row in same_course
        if _can(user, "marksheet.upload", row) or row["_id"] == batch_id
    ]
    branch_names = {
        item["_id"]: item.get("name") or ""
        for item in await database.branches.find({"institute_id": user["institute_id"]}).to_list(length=200)
    }
    exams = await database.exams.find({"institute_id": user["institute_id"], "batch_ids": batch_id}).to_list(length=500)
    items = []
    for exam in exams:
        sheet = sheets.get(exam.get("marksheet_id")) or {}
        others = []
        for other_id in exam.get("batch_ids") or []:
            if other_id == batch_id:
                continue
            other = next((row for row in course_batches if row["_id"] == other_id), None)
            if other is None:
                other = await database.batches.find_one({"_id": other_id, "institute_id": user["institute_id"]})
            if other:
                others.append({
                    "id": other["_id"],
                    "name": other.get("name") or "",
                    "branch_name": branch_names.get(other.get("branch_id"), ""),
                })
        items.append({
            "id": exam["_id"],
            "title": exam.get("title") or "",
            "exam_date": exam.get("exam_date") or "",
            "maximum": exam.get("maximum"),
            "subject_id": exam.get("subject_id") or "",
            "subject_name": names.get(exam.get("subject_id"), ""),
            "scope_kind": (exam.get("scope") or {}).get("kind") or exam.get("exam_type") or "subject",
            "scope_label": _scope_label(exam, kind_labels, names),
            "exam_kind": exam.get("exam_kind") or "",
            "marksheet_id": exam.get("marksheet_id") or "",
            "marksheet_status": sheet.get("status") or "draft",
            "other_batches": others,
        })
    items.sort(key=lambda item: item["title"].casefold())
    items.sort(key=lambda item: item["exam_date"] or "", reverse=True)
    subject_rows = []
    for subject in sorted(subjects, key=lambda item: (item.get("name") or "").casefold()):
        subject_rows.append({
            "id": subject["_id"],
            "name": subject.get("name") or "",
            "papers": [
                {"id": paper["_id"], "name": paper.get("name") or ""}
                for paper in papers if paper.get("subject_id") == subject["_id"]
            ],
            "units": [
                {"id": unit.get("id"), "name": unit.get("name") or "", "kind": unit.get("kind") or ""}
                for unit in subject.get("units") or [] if unit.get("id")
            ],
        })
    course = await database.courses.find_one({"_id": course_id, "institute_id": user["institute_id"]})
    branch = await database.branches.find_one({"_id": batch.get("branch_id"), "institute_id": user["institute_id"]})
    return {
        "batch": {
            "id": batch["_id"],
            "name": batch.get("name") or "",
            "course_id": course_id,
            "course_name": (course or {}).get("name") or "",
            "branch_id": batch.get("branch_id") or "",
            "branch_name": (branch or {}).get("name") or "",
        },
        "subjects": subject_rows,
        "course_batches": [
            {
                "id": row["_id"],
                "name": row.get("name") or "",
                "branch_name": branch_names.get(row.get("branch_id"), ""),
            }
            for row in sorted(course_batches, key=lambda item: (item.get("name") or "").casefold())
        ],
        "items": items,
        "total": len(items),
    }


@router.post("/exams")
async def create_exam(request: Request, body: ExamCreate) -> dict:
    user = await current_user(request)
    title = " ".join(body.title.split())
    if not title:
        raise AppError(422, "exam.title", "Enter a title.", field="title")
    exam_date = _date(body.exam_date)
    database = db(request)
    institute = await database.institutes.find_one({"_id": user["institute_id"]})
    kinds = public_kinds((institute or {}).get("curriculum_kinds"))
    exam_kind = body.exam_kind.strip()
    if exam_kind and active_exam_type(public_exam_types((institute or {}).get("exam_types")), exam_kind) is None:
        raise AppError(422, "exam.type", "Choose an exam type.", field="exam_kind")
    scope_kind = body.scope.kind.strip()
    item_ids = list(dict.fromkeys(body.scope.item_ids))
    if scope_kind == "subject":
        if item_ids:
            raise AppError(422, "exam.scope", "A subject exam does not list separate items.", field="scope")
    else:
        kind = active_kind(kinds, scope_kind)
        if kind is None:
            raise AppError(422, "exam.scope", "Choose a subject partition.", field="scope")
        if not item_ids:
            raise AppError(422, "exam.scope", "Choose at least one item.", field="scope")
    batch_ids = list(dict.fromkeys(body.batch_ids))
    batches = await database.batches.find(
        {"_id": {"$in": batch_ids}, "institute_id": user["institute_id"]}
    ).to_list(length=len(batch_ids))
    if len(batches) != len(batch_ids):
        raise AppError(404, "not_found", "That record was not found.")
    by_id = {item["_id"]: item for item in batches}
    batches = [by_id[item] for item in batch_ids]
    course_ids = {item.get("course_id") for item in batches}
    if len(course_ids) != 1:
        raise AppError(422, "exam.batch", "Every batch must be the same course.", field="batch_ids")
    course_id = batches[0].get("course_id")
    subject = await database.subjects.find_one({
        "_id": body.subject_id,
        "institute_id": user["institute_id"],
        "course_id": course_id,
    })
    if subject is None:
        raise AppError(422, "exam.subject", "Choose a subject on this course.", field="subject_id")
    paper_id = ""
    if scope_kind == "paper" or (scope_kind != "subject" and active_kind(kinds, scope_kind)["storage"] == "paper"):
        found = await database.papers.find({
            "_id": {"$in": item_ids},
            "institute_id": user["institute_id"],
            "subject_id": subject["_id"],
        }).to_list(length=len(item_ids))
        if len(found) != len(item_ids):
            raise AppError(422, "exam.scope", "Choose items of one type from this subject.", field="scope")
        if len(item_ids) == 1:
            paper_id = item_ids[0]
    elif scope_kind != "subject":
        units = {unit.get("id"): unit.get("kind") for unit in subject.get("units") or []}
        if any(units.get(item) != scope_kind for item in item_ids):
            raise AppError(422, "exam.scope", "Choose items of one type from this subject.", field="scope")
    for batch in batches:
        if batch.get("archived"):
            raise AppError(422, "batch.archived", "This batch is archived.")
        if not _can(user, "marksheet.upload", batch, subject["_id"], paper_id, fields_only=False):
            raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    exam_id = str(ObjectId())
    assessment_id = str(ObjectId())
    attempt_id = str(ObjectId())
    sheet_id = str(ObjectId())
    branch = batches[0]
    exam = {
        "_id": exam_id,
        "institute_id": user["institute_id"],
        "course_id": course_id,
        "subject_id": subject["_id"],
        "title": title,
        "title_key": name_key(title),
        "exam_date": exam_date,
        "maximum": body.maximum,
        "scope": {"kind": scope_kind, "item_ids": item_ids},
        "batch_ids": batch_ids,
        "paper_id": paper_id,
        "exam_type": scope_kind,
        "exam_kind": exam_kind,
        "assessment_id": assessment_id,
        "attempt_id": attempt_id,
        "marksheet_id": sheet_id,
        "created_at": _now(),
    }
    client = request.app.state.client
    async with await client.start_session() as session:
        async with session.start_transaction():
            await database.assessments.insert_one(
                {
                    "_id": assessment_id,
                    "institute_id": user["institute_id"],
                    "identity_key": f"exam|{exam_id}",
                    "title": title,
                    "title_key": name_key(title),
                    "exam_type": scope_kind,
                    "exam_kind": exam_kind,
                    "format": "manual",
                    "subject_id": subject["_id"],
                    "paper_id": paper_id,
                    "branch_id": branch.get("branch_id"),
                    "course_id": course_id,
                    "batch_ids": batch_ids,
                    "exam_date": exam_date,
                    "maximum": body.maximum,
                    "exam_id": exam_id,
                },
                session=session,
            )
            await database.attempts.insert_one(
                {
                    "_id": attempt_id,
                    "institute_id": user["institute_id"],
                    "assessment_id": assessment_id,
                    "kind": "original",
                    "maximum": body.maximum,
                },
                session=session,
            )
            await database.marksheets.insert_one(
                {
                    "_id": sheet_id,
                    "institute_id": user["institute_id"],
                    "assessment_id": assessment_id,
                    "attempt_id": attempt_id,
                    "cohort_key": "|".join(batch_ids),
                    "branch_id": branch.get("branch_id"),
                    "course_id": course_id,
                    "subject_id": subject["_id"],
                    "paper_id": paper_id,
                    "batch_ids": batch_ids,
                    "title": title,
                    "maximum": body.maximum,
                    "exam_type": scope_kind,
                    "exam_kind": exam_kind,
                    "exam_date": exam_date,
                    "status": "draft",
                    "revision": 1,
                    "active_revision": None,
                    "source_sheet": "Exam conduct register",
                    "uploader_id": user["_id"],
                    "edit_version": 0,
                    "attempt_kind": "original",
                    "exam_id": exam_id,
                },
                session=session,
            )
            await database.exams.insert_one(exam, session=session)
    await write_audit(
        request, user, "exam.create", None,
        {"title": title, "batch_ids": batch_ids, "scope": exam["scope"]},
        _batch_resource(user, branch, subject["_id"], paper_id),
    )
    return {"id": exam_id, "marksheet_id": sheet_id, "status": "draft"}


async def _load_exam(request: Request, user: dict, exam_id: str) -> tuple[dict, list[dict]]:
    database = db(request)
    exam = await database.exams.find_one({"_id": exam_id, "institute_id": user["institute_id"]})
    if exam is None:
        raise AppError(404, "not_found", "That record was not found.")
    batches = await database.batches.find(
        {"_id": {"$in": exam.get("batch_ids") or []}, "institute_id": user["institute_id"]}
    ).to_list(length=50)
    subject_id = exam.get("subject_id") or ""
    paper_id = exam.get("paper_id") or ""
    if not any(_can(user, "marksheet.view", batch, subject_id, paper_id) for batch in batches):
        raise AppError(404, "not_found", "That record was not found.")
    return exam, batches


@router.post("/exams/import")
async def upload_exam_bundle(
    request: Request,
    branch_id: str = Form(""),
    course_id: str = Form(""),
    batch_ids: str = Form(""),
    file: UploadFile = File(...),
) -> dict:
    user = await current_user(request)
    chosen = [item for item in batch_ids.split(",") if item]
    if not branch_id or not course_id or not chosen:
        raise AppError(422, "exam.batch", "Choose a branch, a course, and at least one batch.")
    database = db(request)
    batches = await database.batches.find(
        {"_id": {"$in": chosen}, "institute_id": user["institute_id"]}
    ).to_list(length=len(chosen))
    by_id = {item["_id"]: item for item in batches}
    if any(item not in by_id for item in chosen):
        raise AppError(404, "not_found", "That record was not found.")
    ordered = [by_id[item] for item in chosen]
    for batch in ordered:
        if batch.get("branch_id") != branch_id or batch.get("course_id") != course_id:
            raise AppError(422, "exam.batch", "Every batch must be on the chosen branch and course.")
        if batch.get("archived") or batch.get("closed"):
            raise AppError(422, "exam.batch", "Choose current batches.")
        if not _can(user, "marksheet.upload", batch, fields_only=False):
            raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    filename = file.filename or "marklist.xlsx"
    if not filename.lower().endswith(".xlsx"):
        raise AppError(422, "import.file_type", "Upload an .xlsx workbook.")
    data = await file.read()
    if len(data) > _MAX_BYTES:
        raise AppError(422, "import.too_large", "The workbook is larger than 25 MB.")
    try:
        parsed = parse_workbook(data, filename)
    except ValueError as exc:
        raise AppError(422, "import.unreadable", str(exc)) from exc
    digest = hashlib.sha256(data).hexdigest()
    file_id = str(ObjectId())
    path = request.app.state.settings.data_dir / "files" / f"{file_id}.xlsx"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    job_id = str(ObjectId())
    await database.files.insert_one({
        "_id": file_id,
        "institute_id": user["institute_id"],
        "kind": "source_xlsx",
        "sha256": digest,
        "path": str(path),
        "filename": filename,
        "created_at": _now(),
    })
    await database.import_jobs.insert_one({
        "_id": job_id,
        "institute_id": user["institute_id"],
        "actor_id": user["_id"],
        "filename": filename,
        "sha256": digest,
        "file_id": file_id,
        "state": "needs_resolution",
        "parsed": parsed,
        "decisions": {"sheets": {}},
        "committed_sheets": [],
        "outcomes": [],
        "created_at": _now(),
        "bundle": True,
        "branch_id": branch_id,
        "course_id": course_id,
        "batch_ids": chosen,
    })
    return {"id": job_id, "state": "needs_resolution", "duplicate": False, "sheets": len(parsed["sheets"])}


@router.get("/exams/{exam_id}")
async def get_exam(request: Request, exam_id: str) -> dict:
    user = await current_user(request)
    exam, batches = await _load_exam(request, user, exam_id)
    database = db(request)
    subject = await database.subjects.find_one({"_id": exam.get("subject_id"), "institute_id": user["institute_id"]})
    sheet = await database.marksheets.find_one({"_id": exam.get("marksheet_id"), "institute_id": user["institute_id"]})
    institute = await database.institutes.find_one({"_id": user["institute_id"]})
    kind_labels = {item["key"]: item["label"] for item in public_kinds((institute or {}).get("curriculum_kinds"))}
    names = {}
    if subject:
        names[subject["_id"]] = subject.get("name") or ""
        for unit in subject.get("units") or []:
            if unit.get("id"):
                names[unit["id"]] = unit.get("name") or ""
    papers = await database.papers.find({"subject_id": exam.get("subject_id")}).to_list(length=50)
    names.update({item["_id"]: item.get("name") or "" for item in papers})
    branch_names = {
        item["_id"]: item.get("name") or ""
        for item in await database.branches.find({"institute_id": user["institute_id"]}).to_list(length=200)
    }
    return {
        "id": exam["_id"],
        "title": exam.get("title") or "",
        "exam_date": exam.get("exam_date") or "",
        "maximum": exam.get("maximum"),
        "subject_id": exam.get("subject_id") or "",
        "subject_name": (subject or {}).get("name") or "",
        "course_id": exam.get("course_id") or "",
        "scope": exam.get("scope") or {"kind": "subject", "item_ids": []},
        "scope_label": _scope_label(exam, kind_labels, names),
        "paper_id": exam.get("paper_id") or "",
        "batch_ids": exam.get("batch_ids") or [],
        "batches": [
            {
                "id": batch["_id"],
                "name": batch.get("name") or "",
                "branch_name": branch_names.get(batch.get("branch_id"), ""),
            }
            for batch in batches
        ],
        "marksheet_id": exam.get("marksheet_id") or "",
        "marksheet_status": (sheet or {}).get("status") or "draft",
    }


@router.patch("/exams/{exam_id}")
async def patch_exam(request: Request, exam_id: str, body: ExamPatch) -> dict:
    user = await current_user(request)
    exam, batches = await _load_exam(request, user, exam_id)
    subject_id = exam.get("subject_id") or ""
    paper_id = exam.get("paper_id") or ""
    allowed = any(
        _can(user, "marksheet.upload", batch, subject_id, paper_id, fields_only=False)
        for batch in batches
    )
    if not allowed:
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    database = db(request)
    changes = {}
    if body.exam_date is not None:
        changes["exam_date"] = _date(body.exam_date)
    if body.maximum is not None:
        result_count = await database.results.count_documents({"marksheet_id": exam.get("marksheet_id")})
        if result_count:
            raise AppError(422, "exam.maximum", "The maximum stays once a marklist has scores.")
        changes["maximum"] = body.maximum
    if not changes:
        return {"id": exam_id}
    await database.exams.update_one({"_id": exam_id}, {"$set": changes})
    await database.marksheets.update_one({"_id": exam.get("marksheet_id")}, {"$set": changes})
    await database.assessments.update_one({"_id": exam.get("assessment_id")}, {"$set": changes})
    if "maximum" in changes:
        await database.attempts.update_one({"_id": exam.get("attempt_id")}, {"$set": {"maximum": changes["maximum"]}})
    return {"id": exam_id, **changes}


@router.post("/exams/{exam_id}/marklist")
async def upload_exam_marklist(request: Request, exam_id: str, file: UploadFile = File(...)) -> dict:
    user = await current_user(request)
    exam, batches = await _load_exam(request, user, exam_id)
    subject_id = exam.get("subject_id") or ""
    paper_id = exam.get("paper_id") or ""
    allowed = all(
        _can(user, "marksheet.upload", batch, subject_id, paper_id, fields_only=False)
        for batch in batches
    )
    if not allowed:
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    filename = file.filename or "marklist.xlsx"
    if not filename.lower().endswith(".xlsx"):
        raise AppError(422, "import.file_type", "Upload an .xlsx workbook.")
    data = await file.read()
    if len(data) > _MAX_BYTES:
        raise AppError(422, "import.too_large", "The workbook is larger than 25 MB.")
    digest = hashlib.sha256(data).hexdigest()
    database = db(request)
    existing = await database.import_jobs.find_one({
        "institute_id": user["institute_id"],
        "sha256": digest,
        "exam_id": exam_id,
        "state": {"$nin": ["committed", "cancelled"]},
    })
    if existing:
        return {"id": existing["_id"], "state": existing["state"], "duplicate": True, "exam_id": exam_id}
    try:
        parsed = parse_workbook(data, filename)
    except ValueError as exc:
        raise AppError(422, "import.unreadable", str(exc)) from exc
    file_id = str(ObjectId())
    path = request.app.state.settings.data_dir / "files" / f"{file_id}.xlsx"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    job_id = str(ObjectId())
    await database.files.insert_one({
        "_id": file_id,
        "institute_id": user["institute_id"],
        "kind": "source_xlsx",
        "sha256": digest,
        "path": str(path),
        "filename": filename,
        "created_at": _now(),
    })
    from app.assessments.routes import _needs_resolution

    state = "needs_resolution" if _needs_resolution(parsed) else "ready"
    await database.import_jobs.insert_one({
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
        "exam_id": exam_id,
        "batch_ids": list(exam.get("batch_ids") or []),
    })
    return {"id": job_id, "state": state, "duplicate": False, "sheets": len(parsed["sheets"]), "exam_id": exam_id}
