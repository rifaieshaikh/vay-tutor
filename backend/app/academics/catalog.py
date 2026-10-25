"""Institute, branch, course, and subject details that any tutor can fill in."""

from __future__ import annotations

from datetime import datetime

from bson import ObjectId
from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict
from pymongo.errors import DuplicateKeyError

from app.academics.curriculum import active_kind, public_kinds
from app.acl import allows
from app.deps import current_user, db, institute_resource, new_id, require, write_audit
from app.errors import AppError
from app.importing.parse import session_key_for_label
from app.paging import page_of
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
    expected_revision: int | None = None


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
    kind: str | None = None


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


_NODE_ACTIONS = ("student.lookup", "catalog.correct", "catalog.manage", "marksheet.view")


def _node_visible(user: dict, resource: dict) -> bool:
    return any(allows(user["grants"], action, resource, True) for action in _NODE_ACTIONS)


def _subject_visible(user: dict, subject: dict) -> bool:
    return _node_visible(user, {
        "institute_id": user["institute_id"],
        "course_id": subject.get("course_id"),
        "subject_id": subject["_id"],
    })


def _paper_visible(user: dict, paper: dict, course_id: str | None) -> bool:
    return _node_visible(user, {
        "institute_id": user["institute_id"],
        "course_id": course_id,
        "subject_id": paper.get("subject_id"),
        "paper_id": paper["_id"],
    })


def _grant_edits(
    user: dict,
    resource: dict,
    *,
    block_subject: bool,
    block_paper: bool,
    subject_id: str = "",
    paper_id: str = "",
) -> bool:
    for grant in user["grants"]:
        actions = set(grant.get("actions") or [])
        if "catalog.correct" not in actions and "catalog.manage" not in actions:
            continue
        scope = grant.get("scope") or {}
        if block_subject and (scope.get("subject_id") or scope.get("paper_id")):
            continue
        if block_paper and scope.get("paper_id"):
            continue
        if subject_id and scope.get("subject_id") and scope.get("subject_id") != subject_id:
            continue
        if paper_id and scope.get("paper_id") and scope.get("paper_id") != paper_id:
            continue
        action = "catalog.correct" if "catalog.correct" in actions else "catalog.manage"
        if allows([grant], action, resource, True):
            return True
    return False


def _require_course_editor(user: dict, course_id: str) -> None:
    resource = {"institute_id": user["institute_id"], "course_id": course_id}
    if not _grant_edits(user, resource, block_subject=True, block_paper=True):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")


def _require_subject_editor(user: dict, subject: dict) -> None:
    resource = {
        "institute_id": user["institute_id"],
        "course_id": subject.get("course_id"),
        "subject_id": subject["_id"],
    }
    if not _grant_edits(user, resource, block_subject=False, block_paper=True, subject_id=subject["_id"]):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")


def _reject_archived(record: dict | None, message: str) -> None:
    if record is not None and record.get("archived"):
        raise AppError(422, "catalog.archived", message)


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
        "revision": int(institute.get("revision") or 0),
    }


@router.patch("/institute")
async def save_institute(request: Request, body: PlaceBody) -> dict:
    user = await current_user(request)
    _editor(user)
    institute = await db(request).institutes.find_one({"_id": user["institute_id"]})
    if (
        "expected_revision" in body.model_fields_set
        and int(body.expected_revision or 0) != int(institute.get("revision") or 0)
    ):
        raise AppError(409, "catalog.stale", "This record changed. Reload it and try again.")
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
    sets["revision"] = int(institute.get("revision") or 0) + 1
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
    _require_course_editor(user, course["_id"])
    _reject_archived(course, "This course is archived. New subjects stay out until it is restored.")
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
    offerings = await database.offerings.find(scope).to_list(length=5000)
    course_ids = [item.get("course_id") for item in offerings if item.get("course_id")]
    courses = await database.courses.find({"_id": {"$in": course_ids}}).to_list(length=5000) if course_ids else []
    batches = await database.batches.find(scope).to_list(length=5000)
    from app.students import directory_facts, enrollment_visible

    facts = await directory_facts(database, user["institute_id"])
    enrollment_rows = await database.enrollments.find(scope).to_list(length=5000)
    visible_ids: list[str] = []
    for row in enrollment_rows:
        student_id = row.get("student_id")
        if student_id and enrollment_visible(
            user["grants"], row, facts["subject_by_id"], facts["paper_subject"], facts["rosters"]
        ):
            visible_ids.append(student_id)
    unique_ids = list(dict.fromkeys(visible_ids))
    archived_ids = set()
    if unique_ids:
        for student in await database.students.find(
            {"_id": {"$in": unique_ids}, "archived": True}, {"_id": 1}
        ).to_list(length=len(unique_ids)):
            archived_ids.add(student["_id"])
    student_count = sum(1 for student_id in unique_ids if student_id not in archived_ids)
    by_course: dict[str, list] = {}
    for batch in batches:
        by_course.setdefault(batch.get("course_id") or "", []).append({
            "id": batch["_id"],
            "name": batch.get("name") or "",
            "started_on": batch.get("started_on") or None,
            "ended_on": batch.get("ended_on") or None,
            "timings": batch.get("timings") or None,
            "session_key": batch.get("session_key") or None,
            "archived": bool(batch.get("archived")),
            "closed": bool(batch.get("closed")),
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
        "student_count": student_count,
        "revision": int(branch.get("revision") or 0),
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
    _reject_archived(branch, "This branch is archived. New offerings stay out until it is restored.")
    _reject_archived(course, "This course is archived. New offerings stay out until it is restored.")
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
    course = await database.courses.find_one({"_id": body.course_id, "institute_id": user["institute_id"]})
    _reject_archived(branch, "This branch is archived. New batches stay out until it is restored.")
    _reject_archived(course, "This course is archived. New batches stay out until it is restored.")
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
    text = " ".join(body.name.split())
    if not text:
        raise AppError(422, "catalog.profile", "Enter a name.", field="name")
    database = db(request)
    institute = await database.institutes.find_one({"_id": user["institute_id"]})
    kind = active_kind(public_kinds((institute or {}).get("curriculum_kinds")), body.kind)
    if kind is None:
        raise AppError(422, "catalog.profile", "Choose a subject partition.", field="kind")
    subject = await database.subjects.find_one({"_id": subject_id, "institute_id": user["institute_id"]})
    if subject is None:
        raise AppError(404, "not_found", "That record was not found.")
    _require_subject_editor(user, subject)
    course = await database.courses.find_one({"_id": subject.get("course_id"), "institute_id": user["institute_id"]})
    _reject_archived(course, "This course is archived. New curriculum items stay out until it is restored.")
    _reject_archived(subject, "This subject is archived. New curriculum items stay out until it is restored.")
    if kind["storage"] == "paper":
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
    institute = await database.institutes.find_one({"_id": user["institute_id"]})
    kinds = public_kinds((institute or {}).get("curriculum_kinds"))
    subject = await database.subjects.find_one({"_id": subject_id, "institute_id": user["institute_id"]})
    if subject is None:
        raise AppError(404, "not_found", "That record was not found.")
    _require_subject_editor(user, subject)
    units = list(subject.get("units") or [])
    found = next((item for item in units if item.get("id") == item_id), None)
    paper = await database.papers.find_one({
        "_id": item_id,
        "subject_id": subject_id,
        "institute_id": user["institute_id"],
    })
    if found is None and paper is None:
        raise AppError(404, "not_found", "That record was not found.")
    current_kind = (paper or found).get("kind") or "paper"
    requested = body.kind or current_kind
    kind_row = next((item for item in kinds if item["key"] == requested), None)
    if kind_row is None or (requested != current_kind and kind_row["archived"]):
        raise AppError(422, "catalog.profile", "Choose a subject partition.", field="kind")
    if kind_row["storage"] != "paper" and any(
        item.get("id") != item_id and item.get("kind") == requested and item.get("name_key") == name_key(text)
        for item in units
    ):
        raise AppError(409, "catalog.exists", "That name is already used for this subject.")
    await _reject_shared_exam(database, user["institute_id"], item_id, requested)
    client = request.app.state.client
    async with await client.start_session() as session:
        async with session.start_transaction():
            await _store_item_kind(
                database, session, user, subject_id, item_id, text, requested, kind_row["storage"], found, paper, units,
            )
            await _retarget_item_exams(database, session, user["institute_id"], item_id, requested, kind_row["storage"])
    await _audit(request, user, {"name": text, "kind": requested}, item_id, requested)
    return {"id": item_id, "kind": requested}


async def _reject_shared_exam(database, institute_id: str, item_id: str, kind: str) -> None:
    exams = await database.exams.find({
        "institute_id": institute_id,
        "$or": [{"paper_id": item_id}, {"scope.item_ids": item_id}],
    }).to_list(length=200)
    for exam in exams:
        scope = exam.get("scope") or {}
        ids = list(scope.get("item_ids") or [])
        if item_id in ids and len(ids) > 1 and scope.get("kind") != kind:
            raise AppError(
                409,
                "catalog.kind",
                "This item is used with other items on an exam. Change that exam before changing the kind.",
            )


async def _store_item_kind(
    database, session, user, subject_id, item_id, text, kind, storage, found, paper, units,
) -> None:
    if storage == "paper":
        if paper is None:
            existing = await database.papers.find({"subject_id": subject_id}, session=session).to_list(length=200)
            numbers = [int(item["number"]) for item in existing if isinstance(item.get("number"), int)]
            await database.papers.insert_one({
                "_id": item_id,
                "institute_id": user["institute_id"],
                "subject_id": subject_id,
                "number": max(numbers, default=0) + 1,
                "name": text,
                "name_key": name_key(text),
                "kind": kind,
                "previous_name": (found or {}).get("name") or "",
            }, session=session)
            units = [item for item in units if item.get("id") != item_id]
            await database.subjects.update_one({"_id": subject_id}, {"$set": {"units": units}}, session=session)
            return
        await database.papers.update_one(
            {"_id": item_id},
            {"$set": {
                "name": text,
                "name_key": name_key(text),
                "kind": kind,
                "previous_name": paper.get("name") or "",
            }},
            session=session,
        )
        return
    if paper is not None:
        await database.papers.delete_one({"_id": item_id}, session=session)
        units.append({
            "id": item_id,
            "name": text,
            "name_key": name_key(text),
            "kind": kind,
            "previous_name": paper.get("name") or "",
        })
    else:
        found["previous_name"] = found.get("name") or ""
        found["name"] = text
        found["name_key"] = name_key(text)
        found["kind"] = kind
    await database.subjects.update_one({"_id": subject_id}, {"$set": {"units": units}}, session=session)


async def _retarget_item_exams(database, session, institute_id: str, item_id: str, kind: str, storage: str) -> None:
    exams = await database.exams.find({
        "institute_id": institute_id,
        "$or": [{"paper_id": item_id}, {"scope.item_ids": item_id}],
    }, session=session).to_list(length=200)
    paper_id = item_id if storage == "paper" else ""
    for exam in exams:
        scope = dict(exam.get("scope") or {})
        ids = list(scope.get("item_ids") or [])
        if item_id not in ids and exam.get("paper_id") != item_id:
            continue
        if scope.get("kind") == kind and (exam.get("paper_id") or "") == paper_id:
            continue
        if item_id not in ids:
            ids = [item_id]
        scope["kind"] = kind
        scope["item_ids"] = ids
        await database.exams.update_one(
            {"_id": exam["_id"]},
            {"$set": {"scope": scope, "exam_type": kind, "paper_id": paper_id}},
            session=session,
        )
        await database.assessments.update_many(
            {"exam_id": exam["_id"]},
            {"$set": {"exam_type": kind, "paper_id": paper_id}},
            session=session,
        )
        await database.marksheets.update_many(
            {"exam_id": exam["_id"]},
            {"$set": {"exam_type": kind, "paper_id": paper_id}},
            session=session,
        )
        sheets = await database.marksheets.find({"exam_id": exam["_id"]}, session=session).to_list(length=20)
        if sheets:
            await database.results.update_many(
                {"marksheet_id": {"$in": [item["_id"] for item in sheets]}},
                {"$set": {"exam_type": kind, "paper_id": paper_id}},
                session=session,
            )


class BatchAssignmentBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    teacher_id: str
    subject_id: str
    paper_id: str = ""
    started_on: str = ""


class EndAssignmentBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ended_on: str = ""


def _page(rows: list, page: int, page_size: int) -> tuple[list, int, int, int]:
    return page_of(rows, page, page_size)


async def _open_batch(request: Request, user: dict, batch_id: str) -> dict:
    batch = await db(request).batches.find_one({"_id": batch_id, "institute_id": user["institute_id"]})
    if batch is None:
        raise AppError(404, "not_found", "That record was not found.")
    resource = {
        "institute_id": user["institute_id"],
        "branch_id": batch.get("branch_id"),
        "course_id": batch.get("course_id"),
        "batch_id": batch["_id"],
    }
    if not allows(user["grants"], "student.lookup", resource, True):
        raise AppError(404, "not_found", "That record was not found.")
    return batch


@router.get("/batches/{batch_id}/roster")
async def batch_roster(request: Request, batch_id: str) -> dict:
    user = await current_user(request)
    await _open_batch(request, user, batch_id)
    database = db(request)
    from app.enrollment import assign_enrollment_code
    from app.students import directory_facts, enrollment_visible

    facts = await directory_facts(database, user["institute_id"])
    enrollments = await database.enrollments.find(
        {"institute_id": user["institute_id"], "batch_id": batch_id}
    ).to_list(length=5000)
    visible = [
        row for row in enrollments
        if enrollment_visible(user["grants"], row, facts["subject_by_id"], facts["paper_subject"], facts["rosters"])
        and not row.get("ended_on")
    ]
    student_ids = [row.get("student_id") for row in visible if row.get("student_id")]
    people = {}
    if student_ids:
        for student in await database.students.find({"_id": {"$in": student_ids}}).to_list(length=len(student_ids)):
            people[student["_id"]] = student
    items = []
    for row in visible:
        code = await assign_enrollment_code(database, row)
        person = people.get(row.get("student_id")) or {}
        items.append({
            "id": row.get("student_id"),
            "enrollment_id": row.get("_id"),
            "enrollment_code": code,
            "student_code": person.get("student_code") or "",
            "display_name": person.get("display_name") or "Not recorded",
        })
    items.sort(key=lambda item: (item["display_name"].casefold(), item["enrollment_code"]))
    return {"batch_id": batch_id, "items": items}


@router.get("/batches/{batch_id}")
async def batch_workspace(
    request: Request,
    batch_id: str,
    student_page: int = 1,
    assessment_page: int = 1,
    page_size: int = 8,
    student_q: str = "",
    student_state: str = "",
    assessment_q: str = "",
    assessment_status: str = "",
    assessment_subject: str = "",
) -> dict:
    user = await current_user(request)
    batch = await _open_batch(request, user, batch_id)
    database = db(request)
    from app.assessments.routes import marksheet_visible
    from app.students import directory_facts, enrollment_visible

    facts = await directory_facts(database, user["institute_id"])
    enrollments = await database.enrollments.find(
        {"institute_id": user["institute_id"], "batch_id": batch["_id"]}
    ).to_list(length=2000)
    visible = [
        row for row in enrollments
        if enrollment_visible(user["grants"], row, facts["subject_by_id"], facts["paper_subject"], facts["rosters"])
    ]
    student_ids = [row["student_id"] for row in visible if row.get("student_id")]
    people = {}
    if student_ids:
        for student in await database.students.find({"_id": {"$in": student_ids}}).to_list(length=len(student_ids)):
            people[student["_id"]] = student
    student_rows = []
    for row in visible:
        person = people.get(row.get("student_id")) or {}
        student_rows.append({
            "id": row.get("student_id"),
            "enrollment_id": row.get("_id"),
            "student_code": person.get("student_code") or "",
            "display_name": person.get("display_name") or "Not recorded",
            "enrollment_code": row.get("enrollment_code") or "",
            "started_on": row.get("started_on") or None,
            "ended_on": row.get("ended_on") or None,
        })
    if student_state not in {"", "current", "historical"}:
        raise AppError(422, "batch.students", "Enrollment state must be current, historical, or omitted.")
    student_rows.sort(key=lambda item: item["display_name"].casefold())
    needle = student_q.casefold().strip()
    if needle:
        student_rows = [
            item for item in student_rows
            if needle in f"{item['display_name']} {item['student_code']} {item.get('enrollment_code') or ''}".casefold()
        ]
    if student_state == "current":
        student_rows = [item for item in student_rows if not item.get("ended_on")]
    elif student_state == "historical":
        student_rows = [item for item in student_rows if item.get("ended_on")]
    student_items, student_total, student_number, student_pages = _page(student_rows, student_page, page_size)

    subjects = await database.subjects.find(
        {"institute_id": user["institute_id"], "course_id": batch.get("course_id")}
    ).to_list(length=200)
    subject_ids = [item["_id"] for item in subjects]
    papers = await database.papers.find(
        {"institute_id": user["institute_id"], "subject_id": {"$in": subject_ids}}
    ).to_list(length=400) if subject_ids else []
    papers = [
        paper for paper in papers
        if _paper_visible(user, paper, batch.get("course_id"))
    ]
    visible_subjects = []
    for subject in subjects:
        own_papers = [paper for paper in papers if paper.get("subject_id") == subject["_id"]]
        if _subject_visible(user, subject) or own_papers:
            visible_subjects.append(subject)
    subjects = visible_subjects
    papers_for: dict[str, list] = {}
    for paper in papers:
        papers_for.setdefault(paper.get("subject_id"), []).append({
            "id": paper["_id"],
            "name": paper.get("name") or f"Paper {paper.get('number') or ''}".strip(),
        })
    curriculum = []
    for subject in sorted(subjects, key=lambda item: (item.get("name") or "").casefold()):
        curriculum.append({
            "id": subject["_id"],
            "name": subject.get("name") or "",
            "papers": sorted(papers_for.get(subject["_id"], []), key=lambda item: item["name"].casefold()),
            "units": [
                {
                    "id": unit.get("id"),
                    "name": unit.get("name") or "",
                    "kind": unit.get("kind") or "chapter",
                }
                for unit in subject.get("units") or []
                if unit.get("id")
            ],
        })

    subject_name = {item["_id"]: item.get("name") or "" for item in subjects}
    paper_name = {item["_id"]: item.get("name") or "" for item in papers}
    teachers = await database.teachers.find(
        {"institute_id": user["institute_id"], "assignments.batch_id": batch["_id"]}
    ).to_list(length=500)
    assignments = []
    for teacher in teachers:
        for item in teacher.get("assignments") or []:
            if item.get("batch_id") != batch["_id"]:
                continue
            subject_id = item.get("subject_id") or ""
            if subject_id and subject_id not in subject_name:
                continue
            assignments.append({
                "id": item.get("id"),
                "teacher_id": teacher["_id"],
                "teacher_name": teacher.get("name") or "",
                "subject_id": item.get("subject_id") or "",
                "subject_name": subject_name.get(item.get("subject_id"), ""),
                "paper_id": item.get("paper_id") or "",
                "paper_name": paper_name.get(item.get("paper_id"), ""),
                "started_on": item.get("started_on") or None,
                "ended_on": item.get("ended_on") or None,
                "status": item.get("status") or "current",
            })
    assignments.sort(key=lambda item: (
        item["status"] != "current",
        item["teacher_name"].casefold(),
        item["subject_name"].casefold(),
    ))

    sheets = await database.marksheets.find(
        {"institute_id": user["institute_id"], "batch_ids": batch["_id"]}
    ).to_list(length=500)
    assessment_rows = []
    for sheet in sheets:
        if not marksheet_visible(user, sheet):
            continue
        subject_id = sheet.get("subject_id") or ""
        if subject_id and subject_id not in subject_name:
            continue
        assessment_rows.append({
            "id": sheet["_id"],
            "title": sheet.get("title") or sheet.get("status") or "Marksheet",
            "status": sheet.get("status") or "",
            "subject_id": sheet.get("subject_id") or "",
            "exam_date": sheet.get("exam_date") or None,
        })
    assessment_rows.sort(key=lambda item: str(item["title"]).casefold())
    assessment_needle = assessment_q.casefold().strip()
    if assessment_needle:
        assessment_rows = [item for item in assessment_rows if assessment_needle in str(item["title"]).casefold()]
    if assessment_status.strip():
        assessment_rows = [item for item in assessment_rows if item["status"] == assessment_status.strip()]
    if assessment_subject.strip():
        assessment_rows = [item for item in assessment_rows if item["subject_id"] == assessment_subject.strip()]
    assessment_items, assessment_total, assessment_number, assessment_pages = _page(
        assessment_rows, assessment_page, page_size
    )
    return {
        "id": batch["_id"],
        "name": batch.get("name") or "",
        "branch_id": batch.get("branch_id") or "",
        "branch_name": facts["branch_name"].get(batch.get("branch_id"), ""),
        "course_id": batch.get("course_id") or "",
        "course_name": facts["course_name"].get(batch.get("course_id"), ""),
        "session_key": batch.get("session_key") or "",
        "started_on": batch.get("started_on") or None,
        "ended_on": batch.get("ended_on") or None,
        "timings": batch.get("timings") or None,
        "archived": bool(batch.get("archived")),
        "closed": bool(batch.get("closed")),
        "students": {"items": student_items, "total": student_total, "page": student_number, "pages": student_pages},
        "curriculum": curriculum,
        "assignments": assignments,
        "assessments": {
            "items": assessment_items,
            "total": assessment_total,
            "page": assessment_number,
            "pages": assessment_pages,
        },
    }


@router.post("/batches/{batch_id}/assignments")
async def assign_batch_teacher(request: Request, batch_id: str, body: BatchAssignmentBody) -> dict:
    user = await current_user(request)
    require(user, "user.manage", institute_resource(user))
    batch = await _open_batch(request, user, batch_id)
    if batch.get("archived"):
        raise AppError(422, "batch.archived", "This batch is archived.")
    if batch.get("closed"):
        raise AppError(422, "batch.closed", "This batch is closed.")
    database = db(request)
    teacher = await database.teachers.find_one({"_id": body.teacher_id, "institute_id": user["institute_id"]})
    if teacher is None:
        raise AppError(404, "not_found", "That record was not found.")
    subject = await database.subjects.find_one({
        "_id": body.subject_id,
        "institute_id": user["institute_id"],
        "course_id": batch.get("course_id"),
    })
    if subject is None:
        raise AppError(422, "teaching.subject", "Choose a subject in this course.")
    paper_id = body.paper_id.strip()
    if paper_id:
        paper = await database.papers.find_one({
            "_id": paper_id,
            "institute_id": user["institute_id"],
            "subject_id": subject["_id"],
        })
        if paper is None:
            raise AppError(422, "teaching.part", "Choose a paper on that subject.")
    started = calendar_date(body.started_on, "started_on")
    for item in teacher.get("assignments") or []:
        if item.get("status") == "ended":
            continue
        same = (
            item.get("batch_id") == batch["_id"]
            and item.get("subject_id") == subject["_id"]
            and (item.get("paper_id") or "") == paper_id
        )
        if same:
            raise AppError(409, "teaching.exists", "This teacher already has that current assignment in this batch.")
    assignment = {
        "id": new_id(),
        "batch_id": batch["_id"],
        "branch_id": batch.get("branch_id") or "",
        "course_id": batch.get("course_id") or "",
        "subject_id": subject["_id"],
        "paper_id": paper_id,
        "started_on": started,
        "ended_on": "",
        "status": "current",
    }
    await database.teachers.update_one({"_id": teacher["_id"]}, {"$push": {"assignments": assignment}})
    await write_audit(
        request,
        user,
        "teacher.assign",
        None,
        {"teacher_id": teacher["_id"], "subject_id": subject["_id"], "batch_id": batch["_id"]},
        {"institute_id": user["institute_id"], "batch_id": batch["_id"], "teacher_id": teacher["_id"]},
    )
    return {"id": assignment["id"]}


@router.post("/batches/{batch_id}/assignments/{assignment_id}/end")
async def end_batch_assignment(
    request: Request, batch_id: str, assignment_id: str, body: EndAssignmentBody
) -> dict:
    user = await current_user(request)
    require(user, "user.manage", institute_resource(user))
    batch = await _open_batch(request, user, batch_id)
    database = db(request)
    teacher = await database.teachers.find_one({
        "institute_id": user["institute_id"],
        "assignments": {"$elemMatch": {"id": assignment_id, "batch_id": batch["_id"]}},
    })
    if teacher is None:
        raise AppError(404, "not_found", "That record was not found.")
    ended = calendar_date(body.ended_on, "ended_on") or _now().date().isoformat()
    kept = []
    found = None
    for item in teacher.get("assignments") or []:
        if item.get("id") == assignment_id and item.get("batch_id") == batch["_id"]:
            if item.get("status") == "ended":
                raise AppError(409, "teaching.ended", "That assignment has already ended.")
            started = item.get("started_on") or ""
            if started and ended < started:
                raise AppError(422, "catalog.date", "The until date is before the from date.", field="ended_on")
            found = {**item, "ended_on": ended, "status": "ended"}
            kept.append(found)
        else:
            kept.append(item)
    await database.teachers.update_one({"_id": teacher["_id"]}, {"$set": {"assignments": kept}})
    await write_audit(
        request,
        user,
        "teacher.assign_end",
        {"status": "current"},
        {"status": "ended", "ended_on": ended, "assignment_id": assignment_id},
        {"institute_id": user["institute_id"], "batch_id": batch["_id"], "teacher_id": teacher["_id"]},
    )
    return {"id": assignment_id, "status": "ended", "ended_on": ended}

class CatalogPatch(BaseModel):
    name: str | None = None
    archived: bool | None = None
    closed: bool | None = None
    notes: str | None = None
    street: str | None = None
    place: str | None = None
    district: str | None = None
    state: str | None = None
    pin: str | None = None
    phone: str | None = None
    email: str | None = None
    started_on: str | None = None
    ended_on: str | None = None
    timings: str | None = None
    expected_revision: int | None = None


def batch_visible(user: dict, batch: dict) -> bool:
    """Same batch visibility the overview uses for its active-batch figure."""
    resource = {
        "institute_id": user["institute_id"],
        "branch_id": batch.get("branch_id"),
        "course_id": batch.get("course_id"),
        "batch_id": batch.get("_id"),
    }
    return any(
        allows(user["grants"], action, resource, True)
        for action in ("dashboard.view", "student.lookup", "catalog.manage", "catalog.correct")
    )


@router.get("/catalog")
async def catalog(request: Request) -> dict:
    user = await current_user(request)
    if not any(
        action in grant["actions"]
        for grant in user["grants"]
        for action in ("student.lookup", "catalog.correct", "catalog.manage")
    ):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    database = db(request)
    limit = 5000

    async def take(collection: str) -> tuple[list, bool]:
        rows = await database[collection].find({"institute_id": user["institute_id"]}).to_list(length=limit + 1)
        return rows[:limit], len(rows) > limit

    branches, branches_truncated = await take("branches")
    courses, courses_truncated = await take("courses")
    batch_rows, batches_truncated = await take("batches")
    batches = [item for item in batch_rows if batch_visible(user, item)]
    subjects, subjects_truncated = await take("subjects")
    students, students_truncated = await take("students")
    papers, papers_truncated = await take("papers")
    course_of_subject = {item["_id"]: item.get("course_id") for item in subjects}
    kept_subjects = []
    for subject in subjects:
        own_papers = [paper for paper in papers if paper.get("subject_id") == subject["_id"]]
        if _subject_visible(user, subject) or any(
            _paper_visible(user, paper, subject.get("course_id")) for paper in own_papers
        ):
            kept_subjects.append(subject)
    subjects = kept_subjects
    visible_subject_ids = {item["_id"] for item in subjects}
    papers = [
        paper for paper in papers
        if paper.get("subject_id") in visible_subject_ids
        and _paper_visible(user, paper, course_of_subject.get(paper.get("subject_id")))
    ]
    offerings, offerings_truncated = await take("offerings")
    return {
        "truncated": any((
            branches_truncated,
            courses_truncated,
            batches_truncated,
            subjects_truncated,
            students_truncated,
            papers_truncated,
            offerings_truncated,
        )),
        "branches": [_catalog_row(item) for item in branches],
        "courses": [_catalog_row(item) for item in courses],
        "batches": [{**_catalog_row(item), "closed": bool(item.get("closed"))} for item in batches],
        "subjects": [_catalog_row(item) for item in subjects],
        "papers": [_catalog_row(item) for item in papers],
        "students": [_catalog_row(item) for item in students],
        "offerings": [
            {"id": item["_id"], "branch_id": item.get("branch_id"), "course_id": item.get("course_id")}
            for item in offerings
        ],
    }


@router.patch("/catalog/{kind}/{record_id}")
async def patch_catalog(request: Request, kind: str, record_id: str, body: CatalogPatch) -> dict:
    user = await current_user(request)
    if not any(
        "catalog.correct" in grant["actions"] or "catalog.manage" in grant["actions"] for grant in user["grants"]
    ):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    collection = {
        "branch": "branches",
        "course": "courses",
        "batch": "batches",
        "subject": "subjects",
        "paper": "papers",
        "student": "students",
    }.get(kind)
    if collection is None:
        raise AppError(404, "not_found", "That record was not found.")
    record = await db(request)[collection].find_one({"_id": record_id, "institute_id": user["institute_id"]})
    if record is None:
        raise AppError(404, "not_found", "That record was not found.")
    if "expected_revision" in body.model_fields_set and int(body.expected_revision or 0) != int(record.get("revision") or 0):
        raise AppError(409, "catalog.stale", "This record changed. Reload it and try again.")
    if kind == "course":
        _require_course_editor(user, record["_id"])
    elif kind == "subject":
        _require_subject_editor(user, record)
    elif kind == "paper":
        parent = await db(request).subjects.find_one({"_id": record.get("subject_id"), "institute_id": user["institute_id"]})
        resource = {
            "institute_id": user["institute_id"],
            "course_id": None if parent is None else parent.get("course_id"),
            "subject_id": record.get("subject_id"),
            "paper_id": record["_id"],
        }
        if not _grant_edits(
            user, resource, block_subject=False, block_paper=False,
            subject_id=str(record.get("subject_id") or ""), paper_id=record["_id"],
        ):
            raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    elif kind in {"branch", "batch"}:
        resource = {"institute_id": user["institute_id"], "branch_id": record["_id"] if kind == "branch" else record.get("branch_id")}
        if kind == "batch":
            resource["course_id"] = record.get("course_id")
            resource["batch_id"] = record["_id"]
        if not _grant_edits(user, resource, block_subject=True, block_paper=True):
            raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    updates = {}
    unsets = {}
    sent = body.model_fields_set
    if "name" in sent:
        text = " ".join(str(body.name or "").split())
        if not text:
            raise AppError(422, "catalog.empty", "Enter a name.")
        current_name = record.get("name") or record.get("display_name") or ""
        if text != current_name:
            updates["name"] = text
            updates["previous_name"] = current_name
            if kind == "student":
                updates["display_name"] = text
            else:
                updates["name_key"] = name_key(text)
    if body.archived is not None:
        updates["archived"] = body.archived
    if kind == "branch":
        detail_sets, detail_unsets = place_changes(body, record)
        updates.update(detail_sets)
        unsets.update(detail_unsets)
    if kind == "course" and "notes" in sent:
        notes = place_text(body.notes, 500, "notes")
        if notes != str(record.get("notes") or ""):
            if notes:
                updates["notes"] = notes
            else:
                unsets["notes"] = ""
    if kind == "batch":
        started = (
            calendar_date(body.started_on or "", "started_on")
            if "started_on" in sent
            else str(record.get("started_on") or "")
        )
        ended = (
            calendar_date(body.ended_on or "", "ended_on") if "ended_on" in sent else str(record.get("ended_on") or "")
        )
        if started and ended and ended < started:
            raise AppError(422, "catalog.date", "The until date is before the from date.", field="ended_on")
        for field, value in (
            ("started_on", started if "started_on" in sent else None),
            ("ended_on", ended if "ended_on" in sent else None),
        ):
            if value is None:
                continue
            if value != str(record.get(field) or ""):
                if value:
                    updates[field] = value
                else:
                    unsets[field] = ""
        if "timings" in sent:
            timings = place_text(body.timings, 120, "timings")
            if timings != str(record.get("timings") or ""):
                if timings:
                    updates["timings"] = timings
                else:
                    unsets["timings"] = ""
        if "closed" in sent and bool(body.closed) != bool(record.get("closed")):
            updates["closed"] = bool(body.closed)
    if not updates and not unsets:
        raise AppError(422, "catalog.empty", "Choose a new name or an archive state.")
    updates["revision"] = int(record.get("revision") or 0) + 1
    change = {}
    if updates:
        change["$set"] = updates
    if unsets:
        change["$unset"] = unsets
    try:
        await db(request)[collection].update_one({"_id": record_id}, change)
    except DuplicateKeyError:
        raise AppError(409, "catalog.exists", "That name is already used.") from None
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


def _catalog_row(item: dict) -> dict:
    row = {
        "id": item["_id"],
        "name": item.get("name") or item.get("display_name"),
        "archived": bool(item.get("archived")),
        "revision": int(item.get("revision") or 0),
        "student_code": item.get("student_code"),
    }
    for key in (
        "branch_id",
        "course_id",
        "subject_id",
        "offering_id",
        "number",
        "started_on",
        "ended_on",
        "timings",
        "notes",
        "session_key",
        "kind",
    ):
        if item.get(key) is not None:
            row[key] = item[key]
    if item.get("units"):
        row["units"] = [
            {"id": unit.get("id"), "name": unit.get("name") or "", "kind": unit.get("kind") or "chapter"}
            for unit in item["units"]
            if unit.get("id")
        ]
    return row

