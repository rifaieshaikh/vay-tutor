"""Student profile, enrollment, and transfer."""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from pathlib import Path

from bson import ObjectId
from fastapi import APIRouter, File, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict
from pymongo.errors import DuplicateKeyError

from app.acl import allows
from app.admissions.routes import apply_course_profiles, apply_record_update, remember_answers, student_extras
from app.deps import current_user, db, write_audit
from app.enrollment import enrollment_document, name_conflicts, name_document, require_batch_match, require_open_batch
from app.errors import AppError
from app.security import name_key, phone_key
from app.students.directory import (
    card_visible,
    directory_facts,
    enrollment_context,
    enrollment_resource,
    enrollment_visible,
    history_item,
    history_permitted,
    history_visible,
    identity_editable,
)

router = APIRouter(prefix="/api/v1")


def _now() -> datetime:
    return datetime.now(timezone.utc)

class MergeBody(BaseModel):
    source_id: str
    target_id: str
    acknowledge: bool = False


class StudentName(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: str = ""
    edit_version: int | None = None
    student_code: str | None = None
    date_of_birth: str | None = None
    blood_group: str | None = None
    phone: str | None = None
    guardian_name: str | None = None
    guardian_phone: str | None = None
    notes: str | None = None
    street: str | None = None
    place: str | None = None
    district: str | None = None
    state: str | None = None
    pin: str | None = None
    qualification: str | None = None
    institution: str | None = None
    board: str | None = None
    passing_year: str | None = None
    gender: str | None = None
    email: str | None = None
    address_line_2: str | None = None
    academic_records: list[dict] | None = None
    course_profiles: list[dict] | None = None
    business_answers: list[dict] | None = None


_PROFILE_LIMITS = {
    "phone": 30,
    "guardian_name": 120,
    "guardian_phone": 30,
    "notes": 500,
    "street": 200,
    "address_line_2": 200,
    "place": 80,
    "district": 80,
    "state": 80,
    "qualification": 120,
    "institution": 200,
    "board": 160,
    "email": 120,
}
_GENDERS = {"Female", "Male", "Other"}
_BLOOD_GROUPS = {"A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"}
_CONTACT_FIELDS = (
    "phone",
    "email",
    "guardian_name",
    "guardian_phone",
    "notes",
    "street",
    "address_line_2",
    "place",
    "district",
    "state",
    "pin",
)
_PROFILE_FIELDS = (
    "date_of_birth",
    "blood_group",
    "gender",
    "phone",
    "email",
    "guardian_name",
    "guardian_phone",
    "notes",
    "street",
    "address_line_2",
    "place",
    "district",
    "state",
    "pin",
    "qualification",
    "institution",
    "board",
    "passing_year",
)


class StudentAlias(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: str = ""


class EnrollmentDates(BaseModel):
    model_config = ConfigDict(extra="forbid")
    started_on: str = ""
    ended_on: str = ""


class EnrollmentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    branch_id: str
    course_id: str
    batch_id: str
    started_on: str = ""


class TransferBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    from_enrollment_id: str
    branch_id: str
    course_id: str
    batch_id: str
    on: str = ""


_MAX_PHOTO = 2 * 1024 * 1024


@router.post("/students/merge-preview")
async def merge_preview(request: Request, body: MergeBody) -> dict:
    user = await current_user(request)
    if not any("catalog.manage" in grant["actions"] for grant in user["grants"]):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    source, target = await _merge_pair(request, user["institute_id"], body)
    source_rows = await db(request).enrollments.find({"student_id": source["_id"]}).to_list(length=100)
    target_rows = await db(request).enrollments.find({"student_id": target["_id"]}).to_list(length=100)
    target_batches = {item["batch_id"] for item in target_rows}
    moving = [item for item in source_rows if item["batch_id"] not in target_batches]
    kept = [item for item in source_rows if item["batch_id"] in target_batches]
    facts = await directory_facts(db(request), user["institute_id"])
    return {
        "source": source.get("display_name"),
        "target": target.get("display_name"),
        "source_code": source.get("student_code"),
        "target_code": target.get("student_code"),
        "move": [item["_id"] for item in moving],
        "kept_separate": [item["_id"] for item in kept],
        "moves": enrollment_context(moving, facts),
        "kept": enrollment_context(kept, facts),
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
    await db(request).students.update_one(
        {"_id": source["_id"]}, {"$set": {"archived": True, "merged_into": target["_id"]}}
    )
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
    student, visible, owned, facts = await _student_directory(request, user, student_id)
    aliases = await db(request).aliases.find({"student_id": student_id}).to_list(length=20)
    contexts = enrollment_context(visible, facts)
    visible_by_id = {row["_id"]: row for row in visible}
    contact = False
    for item in contexts:
        source = visible_by_id.get(item["id"]) or {}
        item["manage"] = bool(source) and allows(user["grants"], "student.manage", enrollment_resource(source))
        contact = contact or item["manage"]
    profile = _profile_view(student)
    extras = await student_extras(db(request), student)
    admissions = []
    if contact:
        for row in await db(request).admissions.find(
            {"institute_id": user["institute_id"], "student_id": student_id}
        ).to_list(length=20):
            admissions.append(
                {
                    "id": row["_id"],
                    "enquiry_id": row.get("enquiry_id") or None,
                    "course_id": row.get("course_id") or "",
                    "course_name": facts["course_name"].get(row.get("course_id"), ""),
                    "status": row.get("status") or "open",
                }
            )
    else:
        for field in _CONTACT_FIELDS:
            profile[field] = None
        extras["business_answers"] = []
    from app.reporting import hydrate

    stored = await db(request).results.find({"student_id": student_id, "active": {"$ne": False}}).to_list(length=50)
    assessments = []
    for row in await hydrate(db(request), stored):
        if not row.get("published"):
            continue
        resource = {
            "institute_id": row.get("institute_id"),
            "branch_id": row.get("branch_id"),
            "course_id": row.get("course_id"),
            "batch_id": row.get("batch_id"),
            "subject_id": row.get("subject_id"),
            "paper_id": row.get("paper_id"),
        }
        if not allows(user["grants"], "marksheet.view", resource):
            continue
        assessments.append(
            {
                "id": row.get("marksheet_id"),
                "title": row.get("title") or "Marksheet",
                "status": "published",
                "batch_id": row.get("batch_id") or "",
                "score": row.get("score"),
                "maximum": row.get("maximum"),
            }
        )
    return {
        "id": student["_id"],
        "student_code": student.get("student_code"),
        "display_name": student.get("display_name"),
        "archived": bool(student.get("archived")),
        "edit_version": student.get("edit_version", 0),
        "photo_id": student.get("photo_file_id") or None,
        **profile,
        **extras,
        "enrollments": contexts,
        "admissions": admissions,
        "assessments": assessments,
        "aliases": [
            {"id": item["_id"], "display_name": item.get("display_name")}
            for item in aliases
            if item.get("display_name")
        ],
        "actions": {
            "edit": identity_editable(user["grants"], owned),
            "card": card_visible(user["grants"], visible),
            "enroll": any("student.manage" in (grant.get("actions") or []) for grant in user["grants"]),
            "contact": contact,
        },
    }


@router.patch("/students/{student_id}")
async def rename_student(request: Request, student_id: str, body: StudentName) -> dict:
    user = await current_user(request)
    if body.student_code is not None:
        raise AppError(422, "student.identity", "The student id stays as it is.")
    student, _visible, owned, _facts = await _student_directory(request, user, student_id)
    if not identity_editable(user["grants"], owned):
        raise AppError(403, "auth.forbidden", "This name is shared across enrollments you do not manage.")
    current = student.get("edit_version", 0)
    if body.edit_version is None or body.edit_version != current:
        raise AppError(
            409,
            "student.conflict",
            "Someone else saved this student. Compare the details and try again.",
            **_conflict_details(student, current),
        )
    display_name = " ".join(body.display_name.split())
    if not display_name:
        raise AppError(422, "student.name", "Enter the student's name.")
    if len(display_name) > 120:
        raise AppError(422, "student.name", "Use a name of 120 characters or fewer.")
    key = name_key(display_name)
    await _reject_shared_name(request, user["institute_id"], student_id, key, owned)
    profile_set, profile_unset, profile_before, profile_after = _profile_changes(body, student)
    if "phone" in profile_set:
        profile_set["phone_key"] = phone_key(profile_set["phone"])
    elif "phone" in profile_unset:
        profile_unset["phone_key"] = ""
    if "academic_records" in body.model_fields_set:
        record_set, record_unset, record_before, record_after = apply_record_update(
            student, body.academic_records or []
        )
        profile_set.update(record_set)
        profile_unset.update(record_unset)
        profile_before.update(record_before)
        profile_after.update(record_after)
    if "course_profiles" in body.model_fields_set:
        profile_set["course_profiles"] = await apply_course_profiles(
            request, user["institute_id"], body.course_profiles or []
        )
    if "business_answers" in body.model_fields_set:
        profile_set["business_answers"] = await remember_answers(
            request,
            user["institute_id"],
            "admission",
            student.get("business_answers") or [],
            body.business_answers or [],
            require=False,
        )
    for field in profile_set:
        profile_unset.pop(field, None)
    version_query: dict = {"_id": student_id, "institute_id": user["institute_id"]}
    if current == 0:
        version_query["$or"] = [{"edit_version": 0}, {"edit_version": {"$exists": False}}]
    else:
        version_query["edit_version"] = current
    changes: dict = {
        "$set": {
            "display_name": display_name,
            "name_key": key,
            "previous_name": student.get("display_name"),
            "edit_version": current + 1,
            **profile_set,
        }
    }
    if profile_unset:
        changes["$unset"] = profile_unset
    updated = await db(request).students.update_one(version_query, changes)
    if updated.matched_count == 0:
        fresh = await db(request).students.find_one({"_id": student_id, "institute_id": user["institute_id"]})
        current_student = fresh or student
        raise AppError(
            409,
            "student.conflict",
            "Someone else saved this student. Compare the details and try again.",
            **_conflict_details(current_student, current_student.get("edit_version", 0)),
        )
    if display_name != student.get("display_name") and student.get("display_name"):
        await db(request).aliases.insert_one(
            {
                "_id": str(ObjectId()),
                "institute_id": user["institute_id"],
                "student_id": student_id,
                "name_key": student.get("name_key"),
                "display_name": student.get("display_name"),
            }
        )
    await write_audit(
        request,
        user,
        "student.update",
        {"display_name": student.get("display_name"), "student_code": student.get("student_code"), **profile_before},
        {"display_name": display_name, "student_code": student.get("student_code"), **profile_after},
        {"student_id": student_id},
    )
    return {
        "id": student_id,
        "display_name": display_name,
        "student_code": student.get("student_code"),
        "edit_version": current + 1,
    }


def _profile_view(student: dict) -> dict:
    return {field: student.get(field) or None for field in _PROFILE_FIELDS}


def _conflict_details(student: dict, version: int) -> dict:
    details = {
        "current_display_name": student.get("display_name") or "",
        "edit_version": version,
    }
    for field in _PROFILE_FIELDS:
        details[f"current_{field}"] = student.get(field) or ""
    return details


def _profile_text(value: str | None, limit: int, field: str) -> str:
    text = " ".join(str(value or "").split())
    if field in {"street", "notes", "address_line_2"}:
        text = str(value or "").strip()
    if len(text) > limit:
        raise AppError(422, "student.profile", f"Use {limit} characters or fewer.", field=field)
    return text


def _birth_date(value: str | None) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError as exc:
        raise AppError(422, "student.profile", "Use a date of birth as YYYY-MM-DD.", field="date_of_birth") from exc
    if parsed > _now().date():
        raise AppError(422, "student.profile", "The date of birth is in the future.", field="date_of_birth")
    return text


def _profile_changes(body: StudentName, student: dict) -> tuple[dict, dict, dict, dict]:
    sent = body.model_fields_set
    sets: dict = {}
    unsets: dict = {}
    before: dict = {}
    after: dict = {}

    def keep(field: str, text: str) -> None:
        previous = str(student.get(field) or "")
        if text == previous:
            return
        before[field] = previous or "Not recorded"
        after[field] = text or "Not recorded"
        if text:
            sets[field] = text
        else:
            unsets[field] = ""

    for field, limit in _PROFILE_LIMITS.items():
        if field not in sent:
            continue
        text = _profile_text(getattr(body, field), limit, field)
        if field == "email" and text and ("@" not in text[1:-1] or "." not in text.split("@", 1)[1]):
            raise AppError(422, "student.profile", "Use an email address.", field="email")
        keep(field, text)
    if "gender" in sent:
        gender = str(body.gender or "").strip()
        if gender and gender not in _GENDERS:
            raise AppError(422, "student.profile", "Choose a gender.", field="gender")
        keep("gender", gender)
    if "date_of_birth" in sent:
        born = _birth_date(body.date_of_birth)
        keep("date_of_birth", born or "")
    if "blood_group" in sent:
        group = str(body.blood_group or "").strip()
        if group and group not in _BLOOD_GROUPS:
            raise AppError(422, "student.profile", "Choose a blood group.", field="blood_group")
        keep("blood_group", group)
    if "pin" in sent:
        keep("pin", _pin(body.pin))
    if "passing_year" in sent:
        keep("passing_year", _passing_year(body.passing_year))
    return sets, unsets, before, after


def _pin(value: str | None) -> str:
    text = "".join(str(value or "").split())
    if text and (len(text) != 6 or not text.isdigit()):
        raise AppError(422, "student.profile", "Use a 6-digit PIN.", field="pin")
    return text


def _passing_year(value: str | None) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    year = int(text) if len(text) == 4 and text.isdigit() else 0
    if year < 1950 or year > _now().year:
        raise AppError(422, "student.profile", "Use a year of passing as YYYY.", field="passing_year")
    return text


def _photo_type(data: bytes) -> tuple[str, str] | None:
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", "jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", "png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp", "webp"
    return None


def _calendar_date(value: str, field: str) -> str | None:
    text = value.strip()
    if not text:
        return None
    if len(text) != 10 or text[4] != "-" or text[7] != "-":
        raise AppError(422, "enrollment.date", "Use a date as YYYY-MM-DD.", field=field)
    try:
        datetime.strptime(text, "%Y-%m-%d")
    except ValueError as exc:
        raise AppError(422, "enrollment.date", "Use a date as YYYY-MM-DD.", field=field) from exc
    return text


def _require_identity_edit(user: dict, owned: list[dict]) -> None:
    if not identity_editable(user["grants"], owned):
        raise AppError(403, "auth.forbidden", "This record is shared across enrollments you do not manage.")


async def _managed_enrollment(request: Request, user: dict, student_id: str, enrollment_id: str) -> tuple[dict, dict]:
    _student, visible, _owned, facts = await _student_directory(request, user, student_id)
    row = next((item for item in visible if item["_id"] == enrollment_id), None)
    if row is None:
        raise AppError(404, "not_found", "That record was not found.")
    if not allows(user["grants"], "student.manage", enrollment_resource(row)):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    return row, facts


@router.get("/students/{student_id}/photo")
async def student_photo(request: Request, student_id: str):
    user = await current_user(request)
    student, _visible, _owned, _facts = await _student_directory(request, user, student_id)
    file_id = student.get("photo_file_id")
    if not file_id:
        raise AppError(404, "not_found", "That record was not found.")
    file_doc = await db(request).files.find_one(
        {"_id": file_id, "institute_id": user["institute_id"], "kind": "student_photo"}
    )
    path = Path(file_doc["path"]) if file_doc else None
    if file_doc is None or path is None or not path.is_file():
        raise AppError(404, "not_found", "That record was not found.")
    return FileResponse(path, media_type=file_doc.get("media_type") or "image/jpeg")


@router.post("/students/{student_id}/photo")
async def upload_student_photo(request: Request, student_id: str, photo: UploadFile = File(...)) -> dict:
    user = await current_user(request)
    student, _visible, owned, _facts = await _student_directory(request, user, student_id)
    _require_identity_edit(user, owned)
    data = await photo.read()
    if not data or len(data) > _MAX_PHOTO:
        raise AppError(422, "student.photo", "Use a JPEG, PNG, or WebP photo of 2 MB or less.")
    kind = _photo_type(data)
    if kind is None:
        raise AppError(422, "student.photo", "Use a JPEG, PNG, or WebP photo.")
    media_type, extension = kind
    file_id = str(ObjectId())
    path = request.app.state.settings.data_dir / "files" / f"{file_id}.{extension}"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    await db(request).files.insert_one(
        {
            "_id": file_id,
            "institute_id": user["institute_id"],
            "kind": "student_photo",
            "media_type": media_type,
            "sha256": hashlib.sha256(data).hexdigest(),
            "path": str(path),
            "filename": f"photo.{extension}",
            "created_at": _now(),
        }
    )
    previous = student.get("photo_file_id")
    updated = await db(request).students.update_one(
        {"_id": student_id, "institute_id": user["institute_id"]},
        {"$set": {"photo_file_id": file_id}},
    )
    if updated.matched_count == 0:
        path.unlink(missing_ok=True)
        await db(request).files.delete_one({"_id": file_id})
        raise AppError(404, "not_found", "That record was not found.")
    await write_audit(
        request,
        user,
        "student.photo",
        {"photo": "Recorded"} if previous else None,
        {"photo": "Recorded"},
        {"student_id": student_id},
    )
    return {"id": student_id, "photo_id": file_id}


@router.delete("/students/{student_id}/photo")
async def remove_student_photo(request: Request, student_id: str) -> dict:
    user = await current_user(request)
    student, _visible, owned, _facts = await _student_directory(request, user, student_id)
    _require_identity_edit(user, owned)
    previous = student.get("photo_file_id")
    if previous:
        await db(request).students.update_one(
            {"_id": student_id, "institute_id": user["institute_id"]},
            {"$unset": {"photo_file_id": ""}},
        )
        await write_audit(
            request,
            user,
            "student.photo",
            {"photo": "Recorded"},
            None,
            {"student_id": student_id},
        )
    return {"id": student_id, "photo_id": None}


@router.post("/students/{student_id}/aliases")
async def add_student_alias(request: Request, student_id: str, body: StudentAlias) -> dict:
    user = await current_user(request)
    student, _visible, owned, _facts = await _student_directory(request, user, student_id)
    _require_identity_edit(user, owned)
    display_name = " ".join(body.display_name.split())
    if not display_name or len(display_name) > 120:
        raise AppError(422, "student.name", "Enter a previous name of 120 characters or fewer.")
    key = name_key(display_name)
    if key == student.get("name_key"):
        raise AppError(422, "student.alias", "That is the student's current name.")
    existing = await db(request).aliases.find_one({"student_id": student_id, "name_key": key})
    if existing:
        raise AppError(409, "student.alias", "That previous name is already recorded.")
    alias_id = str(ObjectId())
    await db(request).aliases.insert_one(
        {
            "_id": alias_id,
            "institute_id": user["institute_id"],
            "student_id": student_id,
            "name_key": key,
            "display_name": display_name,
        }
    )
    await write_audit(
        request,
        user,
        "student.alias",
        None,
        {"alias": display_name},
        {"student_id": student_id},
    )
    return {"id": alias_id, "display_name": display_name}


@router.delete("/students/{student_id}/aliases/{alias_id}")
async def remove_student_alias(request: Request, student_id: str, alias_id: str) -> dict:
    user = await current_user(request)
    _student, _visible, owned, _facts = await _student_directory(request, user, student_id)
    _require_identity_edit(user, owned)
    alias = await db(request).aliases.find_one(
        {"_id": alias_id, "student_id": student_id, "institute_id": user["institute_id"]}
    )
    if alias is None:
        raise AppError(404, "not_found", "That record was not found.")
    await db(request).aliases.delete_one({"_id": alias_id})
    await write_audit(
        request,
        user,
        "student.alias",
        {"alias": alias.get("display_name")},
        None,
        {"student_id": student_id},
    )
    return {"id": alias_id}


@router.patch("/students/{student_id}/enrollments/{enrollment_id}")
async def update_enrollment_dates(request: Request, student_id: str, enrollment_id: str, body: EnrollmentDates) -> dict:
    user = await current_user(request)
    row, facts = await _managed_enrollment(request, user, student_id, enrollment_id)
    started = _calendar_date(body.started_on, "started_on")
    ended = _calendar_date(body.ended_on, "ended_on")
    if started and ended and ended < started:
        raise AppError(422, "enrollment.date", "The until date is before the from date.")
    update: dict = {"$set": {}, "$unset": {}}
    if started:
        update["$set"]["started_on"] = started
    else:
        update["$unset"]["started_on"] = ""
    if ended:
        update["$set"]["ended_on"] = ended
        update["$set"]["status"] = "historical"
    else:
        update["$unset"]["ended_on"] = ""
        update["$unset"]["status"] = ""
    if not update["$set"]:
        del update["$set"]
    await db(request).enrollments.update_one({"_id": enrollment_id, "student_id": student_id}, update)
    batch_name = facts["batch_name"].get(row.get("batch_id"), "")
    await write_audit(
        request,
        user,
        "enrollment.update",
        {
            "batch_name": batch_name,
            "started_on": row.get("started_on") or "Not recorded",
            "ended_on": row.get("ended_on") or "Not recorded",
        },
        {
            "batch_name": batch_name,
            "started_on": started or "Not recorded",
            "ended_on": ended or "Not recorded",
        },
        {
            "student_id": student_id,
            "branch_id": row.get("branch_id"),
            "course_id": row.get("course_id"),
            "batch_id": row.get("batch_id"),
        },
    )
    return {"id": enrollment_id, "started_on": started, "ended_on": ended}


@router.post("/students/{student_id}/enrollments")
async def add_student_enrollment(request: Request, student_id: str, body: EnrollmentCreate) -> dict:
    user = await current_user(request)
    student, _visible, _owned, _facts = await _student_directory(request, user, student_id)
    started = _calendar_date(body.started_on, "started_on")
    batch = await db(request).batches.find_one({"_id": body.batch_id, "institute_id": user["institute_id"]})
    require_batch_match(batch, body.branch_id, body.course_id)
    require_open_batch(batch)
    resource = {
        "institute_id": user["institute_id"],
        "branch_id": body.branch_id,
        "course_id": body.course_id,
        "batch_id": body.batch_id,
    }
    if not allows(user["grants"], "student.manage", resource):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    already = await db(request).enrollments.find_one({"student_id": student_id, "batch_id": body.batch_id})
    if already:
        raise AppError(409, "enrollment.exists", "This student is already in that batch.")
    aliases = await db(request).aliases.find({"student_id": student_id}).to_list(length=20)
    keys = {student.get("name_key")}
    keys.update(item.get("name_key") for item in aliases if item.get("name_key"))
    keys.discard(None)
    if await name_conflicts(db(request), body.batch_id, keys, student_id):
        raise AppError(
            409,
            "student.identity",
            "Another student in that batch already uses this name. Merge them only from the merge action.",
        )
    enrollment_id = str(ObjectId())
    enrollment = enrollment_document(
        enrollment_id=enrollment_id,
        institute_id=user["institute_id"],
        student_id=student_id,
        branch_id=body.branch_id,
        course_id=body.course_id,
        batch_id=body.batch_id,
        started_on=started,
    )
    names = [
        name_document(
            institute_id=user["institute_id"],
            batch_id=body.batch_id,
            student_id=student_id,
            name_key=key,
        )
        for key in keys
    ]
    try:
        async with await request.app.state.client.start_session() as session:
            async with session.start_transaction():
                await db(request).enrollments.insert_one(enrollment, session=session)
                if names:
                    await db(request).enrollment_names.insert_many(names, session=session)
    except DuplicateKeyError as exc:
        raise AppError(
            409,
            "student.identity",
            "Another student in that batch already uses this name. Merge them only from the merge action.",
        ) from exc
    await write_audit(
        request,
        user,
        "enrollment.create",
        None,
        {"batch_name": batch.get("name") or "", "started_on": started or "Not recorded"},
        resource | {"student_id": student_id},
    )
    return {"id": enrollment_id, "batch_id": body.batch_id, "started_on": started}


@router.post("/students/{student_id}/transfers")
async def transfer_student(request: Request, student_id: str, body: TransferBody) -> dict:
    user = await current_user(request)
    _student, visible, _owned, facts = await _student_directory(request, user, student_id)
    source = next((row for row in visible if row["_id"] == body.from_enrollment_id), None)
    if source is None:
        raise AppError(404, "not_found", "That record was not found.")
    if not allows(user["grants"], "student.manage", enrollment_resource(source)):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    if source.get("ended_on"):
        raise AppError(409, "enrollment.ended", "This enrollment has already ended.")
    if source.get("batch_id") == body.batch_id:
        raise AppError(422, "enrollment.context", "Choose a different batch.")
    batch = await db(request).batches.find_one({"_id": body.batch_id, "institute_id": user["institute_id"]})
    require_batch_match(batch, body.branch_id, body.course_id)
    require_open_batch(batch)
    destination = {
        "institute_id": user["institute_id"],
        "branch_id": body.branch_id,
        "course_id": body.course_id,
        "batch_id": body.batch_id,
    }
    if not allows(user["grants"], "student.manage", destination):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    moved_on = _calendar_date(body.on, "on") or _now().date().isoformat()
    if source.get("started_on") and moved_on < source["started_on"]:
        raise AppError(422, "enrollment.date", "The transfer date is before the enrollment started.")
    already = await db(request).enrollments.find_one({"student_id": student_id, "batch_id": body.batch_id})
    if already:
        raise AppError(409, "enrollment.exists", "This student is already in that batch.")
    student = await db(request).students.find_one({"_id": student_id})
    aliases = await db(request).aliases.find({"student_id": student_id}).to_list(length=20)
    keys = {(student or {}).get("name_key")}
    keys.update(item.get("name_key") for item in aliases if item.get("name_key"))
    keys.discard(None)
    if await name_conflicts(db(request), body.batch_id, keys, student_id):
        raise AppError(
            409,
            "student.identity",
            "Another student in that batch already uses this name. Merge them only from the merge action.",
        )
    enrollment_id = str(ObjectId())
    enrollment = enrollment_document(
        enrollment_id=enrollment_id,
        institute_id=user["institute_id"],
        student_id=student_id,
        branch_id=body.branch_id,
        course_id=body.course_id,
        batch_id=body.batch_id,
        started_on=moved_on,
        status="current",
    )
    names = [
        name_document(
            institute_id=user["institute_id"],
            batch_id=body.batch_id,
            student_id=student_id,
            name_key=key,
        )
        for key in keys
    ]
    try:
        async with await request.app.state.client.start_session() as session:
            async with session.start_transaction():
                await db(request).enrollments.update_one(
                    {"_id": source["_id"], "student_id": student_id},
                    {"$set": {"ended_on": moved_on, "status": "historical"}},
                    session=session,
                )
                await db(request).enrollments.insert_one(enrollment, session=session)
                if names:
                    await db(request).enrollment_names.insert_many(names, session=session)
    except DuplicateKeyError as exc:
        raise AppError(
            409,
            "student.identity",
            "Another student in that batch already uses this name. Merge them only from the merge action.",
        ) from exc
    await write_audit(
        request,
        user,
        "enrollment.transfer",
        {"batch_name": facts["batch_name"].get(source.get("batch_id"), ""), "ended_on": "Not recorded"},
        {"batch_name": batch.get("name") or "", "started_on": moved_on},
        destination | {"student_id": student_id},
    )
    return {"id": enrollment_id, "from_enrollment_id": source["_id"], "started_on": moved_on}


@router.get("/students/{student_id}/history")
async def student_history(request: Request, student_id: str) -> dict:
    user = await current_user(request)
    _student, visible, _owned, _facts = await _student_directory(request, user, student_id)
    if not history_permitted(user["grants"], visible):
        return {"permitted": False, "items": []}
    events = (
        await db(request)
        .audit_events.find(
            {
                "institute_id": user["institute_id"],
                "$or": [
                    {"scope.student_id": student_id},
                    {"context.student_id": student_id},
                    {"context.source_id": student_id},
                    {"context.target_id": student_id},
                    {"context.kind": "student", "context.id": student_id},
                ],
            }
        )
        .sort("at", -1)
        .to_list(length=100)
    )
    chosen = [event for event in events if history_visible(user["grants"], event, student_id, visible)]
    actor_names: dict[str, str] = {}
    for event in chosen:
        actor_id = event.get("actor_id")
        if actor_id and actor_id not in actor_names:
            person = await db(request).users.find_one({"_id": actor_id})
            actor_names[actor_id] = person["name"] if person else ""
    return {
        "permitted": True,
        "items": [history_item(event, actor_names.get(event.get("actor_id"), "")) for event in chosen],
    }


async def _student_directory(
    request: Request, user: dict, student_id: str
) -> tuple[dict, list[dict], list[dict], dict]:
    student = await db(request).students.find_one({"_id": student_id, "institute_id": user["institute_id"]})
    if student is None:
        raise AppError(404, "not_found", "That record was not found.")
    owned = await db(request).enrollments.find({"student_id": student_id}).to_list(length=100)
    facts = await directory_facts(db(request), user["institute_id"])
    visible = [
        row
        for row in owned
        if enrollment_visible(user["grants"], row, facts["subject_by_id"], facts["paper_subject"], facts["rosters"])
    ]
    if not visible:
        raise AppError(404, "not_found", "That record was not found.")
    return student, visible, owned, facts


async def _reject_shared_name(
    request: Request, institute_id: str, student_id: str, key: str, owned: list[dict]
) -> None:
    others = (
        await db(request)
        .students.find(
            {"institute_id": institute_id, "name_key": key, "_id": {"$ne": student_id}, "archived": {"$ne": True}}
        )
        .to_list(length=20)
    )
    if not others:
        return
    batches = {row.get("batch_id") for row in owned if row.get("batch_id")}
    other_ids = [item["_id"] for item in others]
    overlap = (
        await db(request)
        .enrollments.find({"student_id": {"$in": other_ids}, "batch_id": {"$in": list(batches)}})
        .to_list(length=20)
    )
    if overlap:
        raise AppError(
            409,
            "student.identity",
            "Another student in the same batch already uses that name. Merge them only from the merge action.",
        )


async def _merge_pair(request: Request, institute_id: str, body: MergeBody) -> tuple[dict, dict]:
    source = await db(request).students.find_one({"_id": body.source_id, "institute_id": institute_id})
    target = await db(request).students.find_one({"_id": body.target_id, "institute_id": institute_id})
    if source is None or target is None or source["_id"] == target["_id"]:
        raise AppError(404, "not_found", "That record was not found.")
    return source, target

