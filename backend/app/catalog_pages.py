"""Institute, branch, course, and subject details that any tutor can fill in."""

from __future__ import annotations

from datetime import datetime

from bson import ObjectId
from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict
from pymongo.errors import DuplicateKeyError

from app.errors import AppError
from app.http import current_user, db
from app.importing.parse import session_key_for_label
from app.security import name_key

router = APIRouter(prefix="/api/v1")

_PLACE_LIMITS = {
    "street": 200,
    "place": 80,
    "district": 80,
    "state": 80,
    "phone": 30,
    "email": 120,
    "notes": 500,
}
_PLACE_FIELDS = ("street", "place", "district", "state", "pin", "phone", "email", "notes")
_ITEM_KINDS = {"paper", "chapter", "module"}


class PlaceBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = None
    street: str | None = None
    place: str | None = None
    district: str | None = None
    state: str | None = None
    pin: str | None = None
    phone: str | None = None
    email: str | None = None
    notes: str | None = None


class CourseBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = ""
    notes: str = ""


class BranchCourseBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    course_id: str


class BranchBatchBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    course_id: str
    name: str = ""
    started_on: str = ""
    ended_on: str = ""
    timings: str = ""


class SubjectBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = ""


class SubjectItemBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = ""
    kind: str = "paper"


class SubjectItemName(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = ""


def _now() -> datetime:
    return datetime.now().astimezone()


def _editor(user: dict) -> None:
    allowed = any(
        "catalog.correct" in grant["actions"] or "catalog.manage" in grant["actions"]
        for grant in user["grants"]
    )
    if not allowed:
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")


def _reader(user: dict) -> None:
    known = {"student.lookup", "catalog.correct", "catalog.manage"}
    if not any(known.intersection(grant.get("actions") or []) for grant in user["grants"]):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")


def place_text(value: str | None, limit: int, field: str) -> str:
    raw = str(value or "")
    text = raw.strip() if field in {"street", "notes"} else " ".join(raw.split())
    if len(text) > limit:
        raise AppError(422, "catalog.profile", f"Use {limit} characters or fewer.", field=field)
    if field == "email" and text and ("@" not in text[1:-1] or "." not in text.split("@", 1)[1]):
        raise AppError(422, "catalog.profile", "Use an email address.", field="email")
    return text


def place_pin(value: str | None) -> str:
    text = "".join(str(value or "").split())
    if text and (len(text) != 6 or not text.isdigit()):
        raise AppError(422, "catalog.profile", "Use a 6-digit PIN.", field="pin")
    return text


def calendar_date(value: str, field: str) -> str:
    text = value.strip()
    if not text:
        return ""
    if len(text) != 10 or text[4] != "-" or text[7] != "-":
        raise AppError(422, "catalog.date", "Use a date as YYYY-MM-DD.", field=field)
    try:
        datetime.strptime(text, "%Y-%m-%d")
    except ValueError as exc:
        raise AppError(422, "catalog.date", "Use a date as YYYY-MM-DD.", field=field) from exc
    return text


def place_changes(body, record: dict) -> tuple[dict, dict]:
    sent = body.model_fields_set
    sets: dict = {}
    unsets: dict = {}

    def keep(field: str, text: str) -> None:
        if text == str(record.get(field) or ""):
            return
        if text:
            sets[field] = text
        else:
            unsets[field] = ""

    for field, limit in _PLACE_LIMITS.items():
        if field in sent:
            keep(field, place_text(getattr(body, field), limit, field))
    if "pin" in sent:
        keep("pin", place_pin(body.pin))
    return sets, unsets


def place_view(record: dict) -> dict:
    return {field: record.get(field) or None for field in _PLACE_FIELDS}


async def _audit(request: Request, user: dict, updates: dict, record_id: str, kind: str) -> None:
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


@router.get("/institute")
async def institute_profile(request: Request) -> dict:
    user = await current_user(request)
    _reader(user)
    institute = await db(request).institutes.find_one({"_id": user["institute_id"]})
    return {
        "id": institute["_id"],
        "name": institute.get("name") or "",
        "code": institute.get("code") or "",
        **place_view(institute),
    }


@router.patch("/institute")
async def save_institute(request: Request, body: PlaceBody) -> dict:
    user = await current_user(request)
    _editor(user)
    institute = await db(request).institutes.find_one({"_id": user["institute_id"]})
    sets, unsets = place_changes(body, institute)
    if "name" in body.model_fields_set:
        text = " ".join(str(body.name or "").split())
        if not text:
            raise AppError(422, "catalog.profile", "Enter a name.", field="name")
        if text != (institute.get("name") or ""):
            sets["name"] = text
            sets["previous_name"] = institute.get("name") or ""
    if not sets and not unsets:
        return {"id": institute["_id"], "name": institute.get("name") or ""}
    change: dict = {}
    if sets:
        change["$set"] = sets
    if unsets:
        change["$unset"] = unsets
    await db(request).institutes.update_one({"_id": institute["_id"]}, change)
    await _audit(request, user, {**sets, **{key: "" for key in unsets}}, institute["_id"], "institute")
    return {"id": institute["_id"], "name": sets.get("name") or institute.get("name") or ""}


@router.post("/branches")
async def create_branch(request: Request, body: PlaceBody) -> dict:
    user = await current_user(request)
    _editor(user)
    text = " ".join(str(body.name or "").split())
    if not text:
        raise AppError(422, "catalog.profile", "Enter a name.", field="name")
    sets, _unsets = place_changes(body, {})
    document = {
        "_id": str(ObjectId()),
        "institute_id": user["institute_id"],
        "name": text,
        "name_key": name_key(text),
        **{key: value for key, value in sets.items() if key != "name"},
    }
    try:
        await db(request).branches.insert_one(document)
    except DuplicateKeyError:
        raise AppError(409, "branch.exists", "A branch with that name already exists.") from None
    await _audit(request, user, {"name": text}, document["_id"], "branch")
    return {"id": document["_id"]}


@router.post("/courses")
async def create_course(request: Request, body: CourseBody) -> dict:
    user = await current_user(request)
    _editor(user)
    text = " ".join(body.name.split())
    if not text:
        raise AppError(422, "catalog.profile", "Enter a name.", field="name")
    notes = place_text(body.notes, 500, "notes")
    document = {
        "_id": str(ObjectId()),
        "institute_id": user["institute_id"],
        "name": text,
        "name_key": name_key(text),
    }
    if notes:
        document["notes"] = notes
    try:
        await db(request).courses.insert_one(document)
    except DuplicateKeyError:
        raise AppError(409, "course.exists", "A course with that name already exists.") from None
    await _audit(request, user, {"name": text}, document["_id"], "course")
    return {"id": document["_id"]}


@router.post("/courses/{course_id}/subjects")
async def create_subject(request: Request, course_id: str, body: SubjectBody) -> dict:
    user = await current_user(request)
    _editor(user)
    text = " ".join(body.name.split())
    if not text:
        raise AppError(422, "catalog.profile", "Enter a name.", field="name")
    database = db(request)
    course = await database.courses.find_one({"_id": course_id, "institute_id": user["institute_id"]})
    if course is None:
        raise AppError(404, "not_found", "That record was not found.")
    document = {
        "_id": str(ObjectId()),
        "institute_id": user["institute_id"],
        "course_id": course["_id"],
        "name": text,
        "name_key": name_key(text),
    }
    try:
        await database.subjects.insert_one(document)
    except DuplicateKeyError:
        raise AppError(409, "subject.exists", "This course already has a subject with that name.") from None
    await _audit(request, user, {"name": text}, document["_id"], "subject")
    return {"id": document["_id"]}


@router.get("/branches/{branch_id}")
async def branch_profile(request: Request, branch_id: str) -> dict:
    user = await current_user(request)
    _reader(user)
    database = db(request)
    branch = await database.branches.find_one({"_id": branch_id, "institute_id": user["institute_id"]})
    if branch is None:
        raise AppError(404, "not_found", "That record was not found.")
    scope = {"institute_id": user["institute_id"], "branch_id": branch_id}
    offerings = await database.offerings.find(scope).to_list(length=200)
    course_ids = [item.get("course_id") for item in offerings if item.get("course_id")]
    courses = await database.courses.find({"_id": {"$in": course_ids}}).to_list(length=200) if course_ids else []
    batches = await database.batches.find(scope).to_list(length=200)
    students = await database.enrollments.distinct("student_id", scope)
    by_course: dict[str, list] = {}
    for batch in batches:
        by_course.setdefault(batch.get("course_id") or "", []).append({
            "id": batch["_id"],
            "name": batch.get("name") or "",
            "started_on": batch.get("started_on") or None,
            "ended_on": batch.get("ended_on") or None,
            "timings": batch.get("timings") or None,
            "archived": bool(batch.get("archived")),
        })
    course_rows = []
    for course in sorted(courses, key=lambda item: (item.get("name") or "").casefold()):
        course_rows.append({
            "id": course["_id"],
            "name": course.get("name") or "",
            "batches": sorted(by_course.get(course["_id"], []), key=lambda item: item["name"].casefold()),
        })
    return {
        "id": branch["_id"],
        "name": branch.get("name") or "",
        "archived": bool(branch.get("archived")),
        **place_view(branch),
        "courses": course_rows,
        "student_count": len(students),
    }


@router.post("/branches/{branch_id}/courses")
async def offer_course(request: Request, branch_id: str, body: BranchCourseBody) -> dict:
    user = await current_user(request)
    _editor(user)
    database = db(request)
    branch = await database.branches.find_one({"_id": branch_id, "institute_id": user["institute_id"]})
    course = await database.courses.find_one({"_id": body.course_id, "institute_id": user["institute_id"]})
    if branch is None or course is None:
        raise AppError(404, "not_found", "That record was not found.")
    document = {
        "_id": str(ObjectId()),
        "institute_id": user["institute_id"],
        "branch_id": branch_id,
        "course_id": course["_id"],
    }
    try:
        await database.offerings.insert_one(document)
    except DuplicateKeyError:
        raise AppError(409, "offering.exists", "This branch already offers that course.") from None
    await _audit(request, user, {"course_id": course["_id"]}, document["_id"], "offering")
    return {"id": document["_id"]}


@router.post("/branches/{branch_id}/batches")
async def create_batch(request: Request, branch_id: str, body: BranchBatchBody) -> dict:
    user = await current_user(request)
    _editor(user)
    database = db(request)
    branch = await database.branches.find_one({"_id": branch_id, "institute_id": user["institute_id"]})
    offering = await database.offerings.find_one({
        "institute_id": user["institute_id"], "branch_id": branch_id, "course_id": body.course_id,
    })
    if branch is None or offering is None:
        raise AppError(404, "not_found", "Offer the course at this branch before adding a batch.")
    text = " ".join(body.name.split())
    if not text:
        raise AppError(422, "catalog.profile", "Enter a name.", field="name")
    started = calendar_date(body.started_on, "started_on")
    ended = calendar_date(body.ended_on, "ended_on")
    if started and ended and ended < started:
        raise AppError(422, "catalog.date", "The until date is before the from date.", field="ended_on")
    timings = place_text(body.timings, 120, "timings")
    document = {
        "_id": str(ObjectId()),
        "institute_id": user["institute_id"],
        "offering_id": offering["_id"],
        "branch_id": branch_id,
        "course_id": body.course_id,
        "name": text,
        "name_key": name_key(text),
        "session_key": session_key_for_label(text) or name_key(text),
    }
    if started:
        document["started_on"] = started
    if ended:
        document["ended_on"] = ended
    if timings:
        document["timings"] = timings
    try:
        await database.batches.insert_one(document)
    except DuplicateKeyError:
        raise AppError(409, "batch.exists", "This course at this branch already has that batch.") from None
    await _audit(request, user, {"name": text}, document["_id"], "batch")
    return {"id": document["_id"]}


@router.post("/subjects/{subject_id}/items")
async def add_subject_item(request: Request, subject_id: str, body: SubjectItemBody) -> dict:
    user = await current_user(request)
    _editor(user)
    if body.kind not in _ITEM_KINDS:
        raise AppError(422, "catalog.profile", "Choose paper, chapter, or module.", field="kind")
    text = " ".join(body.name.split())
    if not text:
        raise AppError(422, "catalog.profile", "Enter a name.", field="name")
    database = db(request)
    subject = await database.subjects.find_one({"_id": subject_id, "institute_id": user["institute_id"]})
    if subject is None:
        raise AppError(404, "not_found", "That record was not found.")
    if body.kind == "paper":
        existing = await database.papers.find({"subject_id": subject_id}).to_list(length=200)
        numbers = [int(item["number"]) for item in existing if isinstance(item.get("number"), int)]
        document = {
            "_id": str(ObjectId()),
            "institute_id": user["institute_id"],
            "subject_id": subject_id,
            "number": max(numbers, default=0) + 1,
            "name": text,
            "name_key": name_key(text),
            "kind": "paper",
        }
        await database.papers.insert_one(document)
        await _audit(request, user, {"name": text, "kind": "paper"}, document["_id"], "paper")
        return {"id": document["_id"], "kind": "paper"}
    units = list(subject.get("units") or [])
    if any(item.get("kind") == body.kind and item.get("name_key") == name_key(text) for item in units):
        raise AppError(409, "catalog.exists", "That name is already used for this subject.")
    item_id = str(ObjectId())
    units.append({"id": item_id, "name": text, "name_key": name_key(text), "kind": body.kind})
    await database.subjects.update_one({"_id": subject_id}, {"$set": {"units": units}})
    await _audit(request, user, {"name": text, "kind": body.kind}, item_id, body.kind)
    return {"id": item_id, "kind": body.kind}


@router.patch("/subjects/{subject_id}/items/{item_id}")
async def rename_subject_item(request: Request, subject_id: str, item_id: str, body: SubjectItemName) -> dict:
    user = await current_user(request)
    _editor(user)
    text = " ".join(body.name.split())
    if not text:
        raise AppError(422, "catalog.profile", "Enter a name.", field="name")
    database = db(request)
    subject = await database.subjects.find_one({"_id": subject_id, "institute_id": user["institute_id"]})
    if subject is None:
        raise AppError(404, "not_found", "That record was not found.")
    units = list(subject.get("units") or [])
    found = next((item for item in units if item.get("id") == item_id), None)
    if found is None:
        raise AppError(404, "not_found", "That record was not found.")
    duplicate = any(
        item.get("id") != item_id and item.get("kind") == found.get("kind") and item.get("name_key") == name_key(text)
        for item in units
    )
    if duplicate:
        raise AppError(409, "catalog.exists", "That name is already used for this subject.")
    found["previous_name"] = found.get("name") or ""
    found["name"] = text
    found["name_key"] = name_key(text)
    await database.subjects.update_one({"_id": subject_id}, {"$set": {"units": units}})
    await _audit(request, user, {"name": text}, item_id, found.get("kind") or "chapter")
    return {"id": item_id}
