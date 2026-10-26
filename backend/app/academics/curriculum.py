"""Subject partition types and exam types.

Paper stays numbered. Every other partition is a named item on the subject.
Exam types name the sitting, such as a test series or a module exam.
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict

from app.deps import current_user, db, institute_resource, require
from app.errors import AppError
from app.security import name_key

router = APIRouter(prefix="/api/v1")

DEFAULT_CURRICULUM_KINDS = (
    {"key": "paper", "label": "Paper", "storage": "paper", "locked": True, "archived": False},
    {"key": "part", "label": "Part", "storage": "unit", "locked": False, "archived": False},
    {"key": "chapter", "label": "Chapter", "storage": "unit", "locked": False, "archived": False},
    {"key": "module", "label": "Module", "storage": "unit", "locked": False, "archived": False},
)
DEFAULT_EXAM_TYPES = (
    {"key": "test-series", "label": "Test series", "archived": False, "weight": 1},
    {"key": "module-exam", "label": "Module exam", "archived": False, "weight": 2},
)


def public_kinds(stored: list | None) -> list[dict]:
    by_key = {item.get("key"): item for item in stored or [] if item.get("key")}
    merged = []
    seen = set()
    for default in DEFAULT_CURRICULUM_KINDS:
        current = by_key.get(default["key"]) or {}
        merged.append({
            "key": default["key"],
            "label": current.get("label") or default["label"],
            "storage": default["storage"],
            "locked": default["key"] == "paper",
            "archived": False if default["key"] == "paper" else bool(current.get("archived")),
        })
        seen.add(default["key"])
    for item in stored or []:
        key = item.get("key")
        if not key or key in seen or key == "subject":
            continue
        merged.append({
            "key": key,
            "label": item.get("label") or key,
            "storage": "unit",
            "locked": False,
            "archived": bool(item.get("archived")),
        })
    return merged


def active_kind(kinds: list[dict], key: str) -> dict | None:
    return next((item for item in kinds if item["key"] == key and not item["archived"]), None)


class CurriculumKindBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str = ""


class CurriculumKindPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str | None = None
    archived: bool | None = None


def _kind_key(label: str) -> str:
    return "-".join(name_key(label).split())


@router.get("/curriculum-kinds")
async def list_curriculum_kinds(request: Request) -> dict:
    user = await current_user(request)
    institute = await db(request).institutes.find_one({"_id": user["institute_id"]})
    stored = (institute or {}).get("curriculum_kinds")
    return {"items": public_kinds(stored)}


@router.post("/curriculum-kinds")
async def add_curriculum_kind(request: Request, body: CurriculumKindBody) -> dict:
    user = await current_user(request)
    require(user, "catalog.manage", institute_resource(user))
    label = " ".join(body.label.split())
    key = _kind_key(label)
    if not label or not key or key == "subject":
        raise AppError(422, "curriculum.kind", "Enter a name for this subject partition.", field="label")
    database = db(request)
    institute = await database.institutes.find_one({"_id": user["institute_id"]})
    if institute is None:
        raise AppError(404, "not_found", "That record was not found.")
    kinds = public_kinds(institute.get("curriculum_kinds"))
    if any(item["key"] == key for item in kinds):
        raise AppError(409, "curriculum.exists", "That subject partition already exists.")
    kinds.append({"key": key, "label": label, "storage": "unit", "locked": False, "archived": False})
    await database.institutes.update_one({"_id": institute["_id"]}, {"$set": {"curriculum_kinds": kinds}})
    return {"key": key, "label": label}


@router.patch("/curriculum-kinds/{kind_key}")
async def patch_curriculum_kind(request: Request, kind_key: str, body: CurriculumKindPatch) -> dict:
    user = await current_user(request)
    require(user, "catalog.manage", institute_resource(user))
    database = db(request)
    institute = await database.institutes.find_one({"_id": user["institute_id"]})
    if institute is None:
        raise AppError(404, "not_found", "That record was not found.")
    kinds = public_kinds(institute.get("curriculum_kinds"))
    found = next((item for item in kinds if item["key"] == kind_key), None)
    if found is None:
        raise AppError(404, "not_found", "That record was not found.")
    if body.label is not None:
        label = " ".join(body.label.split())
        if not label:
            raise AppError(422, "curriculum.kind", "Enter a name for this subject partition.", field="label")
        found["label"] = label
    if body.archived is not None:
        if found["locked"]:
            raise AppError(422, "curriculum.locked", "Paper stays available for new items.")
        found["archived"] = body.archived
    await database.institutes.update_one({"_id": institute["_id"]}, {"$set": {"curriculum_kinds": kinds}})
    return found


def part_heading(value, fallback: str = "Part") -> str:
    text = " ".join(str(value or "").split())
    return text or fallback


def exam_weight(value, fallback: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return fallback
    if number < 1 or number > 99:
        return fallback
    return number


def public_exam_types(stored: list | None) -> list[dict]:
    by_key = {item.get("key"): item for item in stored or [] if item.get("key")}
    merged = []
    seen = set()
    for default in DEFAULT_EXAM_TYPES:
        current = by_key.get(default["key"]) or {}
        merged.append({
            "key": default["key"],
            "label": current.get("label") or default["label"],
            "archived": bool(current.get("archived")),
            "weight": exam_weight(current.get("weight"), default["weight"]),
            "part_heading": part_heading(current.get("part_heading")),
        })
        seen.add(default["key"])
    next_weight = max((item["weight"] for item in merged), default=0) + 1
    for item in stored or []:
        key = item.get("key")
        if not key or key in seen:
            continue
        weight = exam_weight(item.get("weight"), next_weight)
        merged.append({
            "key": key,
            "label": item.get("label") or key,
            "archived": bool(item.get("archived")),
            "weight": weight,
            "part_heading": part_heading(item.get("part_heading")),
        })
        seen.add(key)
        next_weight = max(next_weight, weight) + 1
    return merged


def active_exam_type(types: list[dict], key: str) -> dict | None:
    return next((item for item in types if item["key"] == key and not item["archived"]), None)


class ExamTypeBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str = ""
    weight: int | None = None
    part_heading: str = ""


class ExamTypePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str | None = None
    archived: bool | None = None
    weight: int | None = None
    part_heading: str | None = None


def _require_weight(value: int) -> int:
    if value < 1 or value > 99:
        raise AppError(422, "exam.weight", "Enter a weight from 1 to 99.", field="weight")
    return value


@router.get("/exam-types")
async def list_exam_types(request: Request) -> dict:
    user = await current_user(request)
    institute = await db(request).institutes.find_one({"_id": user["institute_id"]})
    return {"items": public_exam_types((institute or {}).get("exam_types"))}


@router.post("/exam-types")
async def add_exam_type(request: Request, body: ExamTypeBody) -> dict:
    user = await current_user(request)
    require(user, "catalog.manage", institute_resource(user))
    label = " ".join(body.label.split())
    key = _kind_key(label)
    if not label or not key:
        raise AppError(422, "exam.type", "Enter a name for this exam type.", field="label")
    database = db(request)
    institute = await database.institutes.find_one({"_id": user["institute_id"]})
    if institute is None:
        raise AppError(404, "not_found", "That record was not found.")
    types = public_exam_types(institute.get("exam_types"))
    if any(item["key"] == key for item in types):
        raise AppError(409, "exam.exists", "That exam type already exists.")
    if body.weight is None:
        weight = max((item["weight"] for item in types), default=0) + 1
    else:
        weight = _require_weight(body.weight)
    heading = part_heading(body.part_heading)
    types.append({"key": key, "label": label, "archived": False, "weight": weight, "part_heading": heading})
    await database.institutes.update_one({"_id": institute["_id"]}, {"$set": {"exam_types": types}})
    return {"key": key, "label": label, "weight": weight, "part_heading": heading}


@router.patch("/exam-types/{type_key}")
async def patch_exam_type(request: Request, type_key: str, body: ExamTypePatch) -> dict:
    user = await current_user(request)
    require(user, "catalog.manage", institute_resource(user))
    database = db(request)
    institute = await database.institutes.find_one({"_id": user["institute_id"]})
    if institute is None:
        raise AppError(404, "not_found", "That record was not found.")
    types = public_exam_types(institute.get("exam_types"))
    found = next((item for item in types if item["key"] == type_key), None)
    if found is None:
        raise AppError(404, "not_found", "That record was not found.")
    if body.label is not None:
        label = " ".join(body.label.split())
        if not label:
            raise AppError(422, "exam.type", "Enter a name for this exam type.", field="label")
        found["label"] = label
    if body.archived is not None:
        found["archived"] = body.archived
    if body.weight is not None:
        found["weight"] = _require_weight(body.weight)
    if body.part_heading is not None:
        found["part_heading"] = part_heading(body.part_heading)
    await database.institutes.update_one({"_id": institute["_id"]}, {"$set": {"exam_types": types}})
    return found


async def seed_exam_types(database) -> None:
    async for institute in database.institutes.find({}, {"exam_types": 1}):
        stored = institute.get("exam_types")
        merged = public_exam_types(stored)
        if stored != merged:
            await database.institutes.update_one({"_id": institute["_id"]}, {"$set": {"exam_types": merged}})


async def seed_curriculum_kinds(database) -> None:
    async for institute in database.institutes.find({}, {"curriculum_kinds": 1}):
        stored = institute.get("curriculum_kinds")
        merged = public_kinds(stored)
        if stored != merged:
            await database.institutes.update_one({"_id": institute["_id"]}, {"$set": {"curriculum_kinds": merged}})
