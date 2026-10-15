"""Enquiry and admission intake, separate from mark-sheet import."""

from __future__ import annotations

from datetime import datetime, timezone
from io import BytesIO

from bson import ObjectId
from fastapi import APIRouter, File, Request, UploadFile
from openpyxl import load_workbook
from pydantic import BaseModel, ConfigDict
from pymongo.errors import DuplicateKeyError

from app.acl import allows
from app.db import allocate_student_code
from app.deps import current_user, db, write_audit
from app.enrollment import enrollment_document, name_conflicts, name_document, require_open_batch
from app.errors import AppError
from app.security import name_key, phone_key

router = APIRouter(prefix="/api/v1")

INTERESTS = ("High", "Medium", "Low")
GENDERS = ("Female", "Male", "Other")
BLOOD_GROUPS = {"A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"}
ANSWER_TYPES = {"boolean", "choice", "text", "textarea"}
_MAX_BYTES = 5 * 1024 * 1024
_RECORD_LIMITS = {
    "qualification": 120,
    "stream": 120,
    "institution": 200,
    "mark": 40,
    "board": 160,
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _reader(user: dict) -> None:
    if not any("student.lookup" in (grant.get("actions") or []) for grant in user["grants"]):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")


def _writer(user: dict) -> None:
    if not any("student.manage" in (grant.get("actions") or []) for grant in user["grants"]):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")


def _catalog_editor(user: dict) -> None:
    allowed = any(
        "catalog.correct" in (grant.get("actions") or []) or "catalog.manage" in (grant.get("actions") or [])
        for grant in user["grants"]
    )
    if not allowed:
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")


def _text(value: str | None, limit: int, field: str, code: str = "intake.field") -> str:
    text = " ".join(str(value or "").split())
    if len(text) > limit:
        raise AppError(422, code, f"Use {limit} characters or fewer.", field=field)
    return text


def _long_text(value: str | None, limit: int, field: str) -> str:
    text = str(value or "").strip()
    if len(text) > limit:
        raise AppError(422, "intake.field", f"Use {limit} characters or fewer.", field=field)
    return text


def _choice(value: str | None, allowed: tuple[str, ...] | set[str], field: str, label: str) -> str:
    text = " ".join(str(value or "").split())
    if not text:
        return ""
    match = next((item for item in allowed if item.casefold() == text.casefold()), "")
    if not match:
        raise AppError(422, "intake.field", label, field=field)
    return match


def _blood(value: str | None) -> str:
    text = "".join(str(value or "").split()).upper()
    if not text:
        return ""
    match = next((item for item in BLOOD_GROUPS if item.upper() == text), "")
    if not match:
        raise AppError(422, "intake.field", "Choose a blood group.", field="blood_group")
    return match


def _email(value: str | None) -> str:
    text = _text(value, 120, "email")
    if text and ("@" not in text[1:-1] or "." not in text.split("@", 1)[1]):
        raise AppError(422, "intake.field", "Use an email address.", field="email")
    return text


def _pin(value: str | None) -> str:
    text = "".join(str(value or "").split())
    if text and (len(text) != 6 or not text.isdigit()):
        raise AppError(422, "intake.field", "Use a 6-digit PIN.", field="pin")
    return text


def _date(value: str | None, field: str, *, future_ok: bool = True) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    try:
        parsed = datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError as exc:
        raise AppError(422, "intake.field", "Use a date as YYYY-MM-DD.", field=field) from exc
    if not future_ok and parsed > _now().date():
        raise AppError(422, "intake.field", "The date of birth is in the future.", field=field)
    return text


def _year(value: str | None) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    year = int(text) if len(text) == 4 and text.isdigit() else 0
    if year < 1950 or year > _now().year + 1:
        raise AppError(422, "intake.field", "Use a year of passing as YYYY.", field="year_of_passing")
    return text


def clean_academic_records(items: list | None) -> list[dict]:
    records = []
    for item in items or []:
        if not isinstance(item, dict) and not hasattr(item, "qualification"):
            raise AppError(
                422, "intake.field", "Each academic record needs qualification, stream, institution, mark, and year."
            )
        source = item if isinstance(item, dict) else item.model_dump()
        record = {
            "qualification": _text(source.get("qualification"), _RECORD_LIMITS["qualification"], "qualification"),
            "stream": _text(source.get("stream"), _RECORD_LIMITS["stream"], "stream"),
            "institution": _text(source.get("institution"), _RECORD_LIMITS["institution"], "institution"),
            "mark": _text(source.get("mark"), _RECORD_LIMITS["mark"], "mark"),
            "year_of_passing": _year(source.get("year_of_passing")),
            "board": _text(source.get("board"), _RECORD_LIMITS["board"], "board"),
        }
        if any(record.values()):
            records.append(record)
    if len(records) > 12:
        raise AppError(422, "intake.field", "Use 12 academic records or fewer.", field="academic_records")
    return records


def displayed_records(student: dict) -> list[dict]:
    stored = student.get("academic_records")
    if isinstance(stored, list) and stored:
        return stored
    legacy = {
        "qualification": student.get("qualification") or "",
        "stream": "",
        "institution": student.get("institution") or "",
        "mark": "",
        "year_of_passing": student.get("passing_year") or "",
        "board": student.get("board") or "",
    }
    if any(legacy.values()):
        return [legacy]
    return []


def _mirror_legacy(records: list[dict]) -> dict[str, str]:
    first = records[0] if records else {}
    return {
        "qualification": first.get("qualification") or "",
        "institution": first.get("institution") or "",
        "board": first.get("board") or "",
        "passing_year": first.get("year_of_passing") or "",
    }


class QuestionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str = ""
    answer_type: str = "text"
    choices: list[str] = []
    required: bool = False
    place: str = ""


class QuestionPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str | None = None
    answer_type: str | None = None
    choices: list[str] | None = None
    required: bool | None = None
    order: int | None = None
    place: str | None = None


class AnswerBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question_id: str = ""
    value: str = ""
    label: str = ""


class FollowUpBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    at: str = ""
    note: str = ""
    interest: str = ""
    next_on: str = ""


class EnquiryBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = ""
    whatsapp: str = ""
    present_institution: str = ""
    course_id: str = ""
    interest: str = ""
    references: str = ""
    details: str = ""
    answers: list[AnswerBody] = []


class EnquiryCommit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rows: list[EnquiryBody]


class AdmissionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    course_id: str = ""
    name: str = ""
    phone: str = ""
    date_of_birth: str = ""
    gender: str = ""
    blood_group: str = ""
    email: str = ""
    street: str = ""
    address_line_2: str = ""
    place: str = ""
    district: str = ""
    state: str = ""
    pin: str = ""
    guardian_name: str = ""
    guardian_phone: str = ""
    academic_records: list[dict] = []
    course_answers: list[AnswerBody] = []
    business_answers: list[AnswerBody] = []


class AdmissionCommitRow(AdmissionBody):
    decision: str = ""
    student_id: str = ""


class AdmissionCommit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rows: list[AdmissionCommitRow]


class ConvertBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    branch_id: str
    batch_id: str
    decision: str = ""
    student_id: str = ""


def _question_view(row: dict) -> dict:
    return {
        "id": row["_id"],
        "course_id": row.get("course_id"),
        "label": row.get("label") or "",
        "answer_type": row.get("answer_type") or "text",
        "choices": row.get("choices") or [],
        "required": bool(row.get("required")),
        "order": row.get("order") or 0,
        "place": _place_of(row.get("forms") or []),
    }


def _clean_question(body: QuestionBody, existing: dict | None = None) -> dict:
    label = _text(body.label, 120, "label")
    if not label:
        raise AppError(422, "intake.field", "Enter the question.", field="label")
    answer_type = body.answer_type or (existing or {}).get("answer_type") or "text"
    if answer_type not in ANSWER_TYPES:
        raise AppError(422, "intake.field", "Choose a checkbox, dropdown, text box, or text area.", field="answer_type")
    choices = []
    for item in body.choices:
        choice = _text(item, 80, "choices")
        if choice and choice not in choices:
            choices.append(choice)
    if answer_type == "choice" and not choices:
        raise AppError(422, "intake.field", "Add at least one choice.", field="choices")
    if answer_type != "choice":
        choices = []
    return {
        "label": label,
        "label_key": name_key(label),
        "answer_type": answer_type,
        "choices": choices,
        "required": bool(body.required),
    }


def _forms_for(place: str) -> list[str]:
    chosen = place or "both"
    if chosen == "both":
        return ["enquiry", "admission"]
    if chosen not in {"enquiry", "admission"}:
        raise AppError(422, "intake.field", "Choose enquiry, admission, or both.", field="place")
    return [chosen]


def _place_of(forms: list) -> str:
    names = set(forms or [])
    if "enquiry" in names and "admission" in names:
        return "both"
    if "enquiry" in names:
        return "enquiry"
    if "admission" in names:
        return "admission"
    return ""


async def _course(request: Request, user: dict, course_id: str) -> dict:
    if not course_id:
        raise AppError(422, "intake.field", "Choose a course.", field="course_id")
    course = await db(request).courses.find_one({"_id": course_id, "institute_id": user["institute_id"]})
    if course is None:
        raise AppError(422, "intake.field", "Choose a course.", field="course_id")
    return course


async def _questions_for(request: Request, course_id: str) -> list[dict]:
    return await db(request).course_questions.find({"course_id": course_id}).sort("order", 1).to_list(length=50)


async def _form_questions(request: Request, institute_id: str, form: str) -> list[dict]:
    return (
        await db(request)
        .form_questions.find({"institute_id": institute_id, "forms": form})
        .sort("order", 1)
        .to_list(length=50)
    )


async def clean_form_answers(
    request: Request, institute_id: str, form: str, answers: list, *, require: bool
) -> list[dict]:
    questions = await _form_questions(request, institute_id, form)
    return _clean_answers(questions, answers, require=require)


async def remember_answers(
    request: Request, institute_id: str, form: str, existing: list, incoming: list, *, require: bool
) -> list[dict]:
    questions = await _form_questions(request, institute_id, form)
    cleaned = _clean_answers(questions, incoming, require=require)
    current = {item["_id"] for item in questions}
    kept = [item for item in existing or [] if item.get("question_id") not in current]
    return kept + cleaned


def _answer_value(question: dict, value: str) -> str:
    kind = question.get("answer_type") or "text"
    label = question.get("label") or "the question"
    if kind == "textarea":
        return _long_text(value, 2000, "answers")
    text = " ".join(str(value or "").split())
    if not text:
        return ""
    if kind == "boolean":
        if text.casefold() in {"yes", "true", "1", "y"}:
            return "Yes"
        if text.casefold() in {"no", "false", "0", "n"}:
            return ""
        raise AppError(422, "intake.field", f"Tick {label} or leave it clear.", field="answers")
    if kind == "text":
        return _text(text, 300, "answers")
    if kind == "number":
        try:
            float(text)
        except ValueError as exc:
            raise AppError(422, "intake.field", f"Enter a number for {label}.", field="answers") from exc
        return text
    if kind == "date":
        return _date(text, "answers")
    choices = question.get("choices") or []
    match = next((item for item in choices if item.casefold() == text.casefold()), "")
    if not match:
        raise AppError(
            422,
            "intake.field",
            f"Choose an answer for {label}.",
            field="course_answers",
        )
    return match


def _clean_answers(questions: list[dict], answers: list[AnswerBody] | list[dict], *, require: bool) -> list[dict]:
    by_id = {item["_id"]: item for item in questions}
    cleaned = []
    seen = set()
    for item in answers:
        source = item if isinstance(item, dict) else item.model_dump()
        question_id = source.get("question_id") or ""
        question = by_id.get(question_id)
        if question is None:
            raise AppError(422, "intake.field", "One of the answers does not match a question.", field="answers")
        if question_id in seen:
            continue
        seen.add(question_id)
        value = _answer_value(question, source.get("value") or "")
        cleaned.append({"question_id": question_id, "label": question.get("label") or "", "value": value})
    if require:
        missing = [
            item
            for item in questions
            if item.get("required")
            and not next((answer["value"] for answer in cleaned if answer["question_id"] == item["_id"]), "")
        ]
        if missing:
            label = missing[0].get("label") or "the question"
            message = f"Tick {label}." if missing[0].get("answer_type") == "boolean" else f"Answer {label}."
            raise AppError(422, "intake.field", message, field="answers")
    return cleaned


def _enquiry_fields(body: EnquiryBody) -> dict:
    name = _text(body.name, 120, "name")
    if not name:
        raise AppError(422, "intake.field", "Enter the name.", field="name")
    whatsapp = _text(body.whatsapp, 30, "whatsapp")
    return {
        "name": name,
        "name_key": name_key(name),
        "whatsapp": whatsapp,
        "whatsapp_key": phone_key(whatsapp),
        "present_institution": _text(body.present_institution, 200, "present_institution"),
        "course_id": body.course_id,
        "interest": _choice(body.interest, INTERESTS, "interest", "Choose High, Medium, or Low."),
        "references": _long_text(body.references, 500, "references"),
        "details": _long_text(body.details, 1000, "details"),
    }


def _admission_contact(body: AdmissionBody) -> dict:
    name = _text(body.name, 120, "name")
    phone = _text(body.phone, 30, "phone")
    if not name:
        raise AppError(422, "intake.field", "Enter the name.", field="name")
    if not phone:
        raise AppError(422, "intake.field", "Enter the contact number.", field="phone")
    return {
        "name": name,
        "name_key": name_key(name),
        "phone": phone,
        "phone_key": phone_key(phone),
        "date_of_birth": _date(body.date_of_birth, "date_of_birth", future_ok=False),
        "gender": _choice(body.gender, GENDERS, "gender", "Choose Female, Male, or Other."),
        "blood_group": _blood(body.blood_group),
        "email": _email(body.email),
        "street": _long_text(body.street, 200, "street"),
        "address_line_2": _long_text(body.address_line_2, 200, "address_line_2"),
        "place": _text(body.place, 80, "place"),
        "district": _text(body.district, 80, "district"),
        "state": _text(body.state, 80, "state"),
        "pin": _pin(body.pin),
        "guardian_name": _text(body.guardian_name, 120, "guardian_name"),
        "guardian_phone": _text(body.guardian_phone, 30, "guardian_phone"),
        "academic_records": clean_academic_records(body.academic_records),
    }


def enquiry_progress(row: dict, today: str) -> tuple[str, str]:
    if row.get("admission_id"):
        return "Admitted", "Open the admission"
    follow_ups = row.get("follow_ups") or []
    if not follow_ups:
        return "Enquiry", "Record a follow-up"
    next_on = (follow_ups[-1].get("next_on") or "")
    if not next_on or next_on <= today:
        return "Enquiry", "Follow up"
    return "Enquiry", f"Follow up on {next_on}"


def admission_progress(row: dict) -> tuple[str, str]:
    if (row.get("status") or "open") == "converted":
        return "Enrolled", "Open the student"
    return "Open", "Enroll in a batch"


def _enquiry_view(row: dict, course_name: str = "", today: str = "") -> dict:
    stage, next_action = enquiry_progress(row, today or _now().date().isoformat())
    return {
        "id": row["_id"],
        "name": row.get("name") or "",
        "whatsapp": row.get("whatsapp") or "",
        "present_institution": row.get("present_institution") or "",
        "course_id": row.get("course_id") or "",
        "course_name": course_name,
        "interest": row.get("interest") or "",
        "references": row.get("references") or "",
        "details": row.get("details") or "",
        "stage": stage,
        "next_action": next_action,
        "follow_ups": [
            {
                "id": item.get("id"),
                "at": item.get("at") or "",
                "note": item.get("note") or "",
                "interest": item.get("interest") or "",
                "next_on": item.get("next_on") or "",
            }
            for item in row.get("follow_ups") or []
        ],
        "admission_id": row.get("admission_id") or None,
        "created_at": row.get("created_at"),
    }


def _admission_view(
    row: dict, course_name: str = "", matches: list[dict] | None = None, questions: list[dict] | None = None
) -> dict:
    stage, next_action = admission_progress(row)
    return {
        "id": row["_id"],
        "course_id": row.get("course_id") or "",
        "course_name": course_name,
        "name": row.get("name") or "",
        "phone": row.get("phone") or "",
        "date_of_birth": row.get("date_of_birth") or "",
        "gender": row.get("gender") or "",
        "blood_group": row.get("blood_group") or "",
        "email": row.get("email") or "",
        "street": row.get("street") or "",
        "address_line_2": row.get("address_line_2") or "",
        "place": row.get("place") or "",
        "district": row.get("district") or "",
        "state": row.get("state") or "",
        "pin": row.get("pin") or "",
        "guardian_name": row.get("guardian_name") or "",
        "guardian_phone": row.get("guardian_phone") or "",
        "academic_records": row.get("academic_records") or [],
        "course_answers": row.get("course_answers") or [],
        "business_answers": row.get("business_answers") or [],
        "questions": [_question_view(item) for item in questions or []],
        "status": row.get("status") or "open",
        "stage": stage,
        "next_action": next_action,
        "student_id": row.get("student_id") or None,
        "enrollment_id": row.get("enrollment_id") or None,
        "branch_id": row.get("branch_id") or None,
        "batch_id": row.get("batch_id") or None,
        "enquiry_id": row.get("enquiry_id") or None,
        "match_decision": row.get("match_decision") or "",
        "match_student_id": row.get("match_student_id") or "",
        "matches": matches or [],
        "created_at": row.get("created_at"),
    }


def _match_view(student: dict) -> dict:
    return {
        "id": student["_id"],
        "display_name": student.get("display_name") or "",
        "student_code": student.get("student_code") or "",
        "phone": student.get("phone") or "",
    }


async def _course_name(request: Request, course_id: str) -> str:
    if not course_id:
        return ""
    course = await db(request).courses.find_one({"_id": course_id})
    return (course or {}).get("name") or ""


async def find_matches(request: Request, institute_id: str, name: str, phone: str) -> list[dict]:
    key = name_key(name)
    number = phone_key(phone)
    if not key or not number:
        return []
    people = (
        await db(request)
        .students.find({"institute_id": institute_id, "name_key": key, "archived": {"$ne": True}})
        .to_list(length=50)
    )
    matched = []
    for person in people:
        stored = person.get("phone_key") or phone_key(person.get("phone") or "")
        if stored == number:
            matched.append(_match_view(person))
    return matched


async def student_extras(database, student: dict) -> dict:
    profiles = []
    for item in student.get("course_profiles") or []:
        course_id = item.get("course_id") or ""
        course = await database.courses.find_one({"_id": course_id})
        questions = {
            row["_id"]: row for row in await database.course_questions.find({"course_id": course_id}).to_list(length=50)
        }
        answers = []
        for answer in item.get("answers") or []:
            question = questions.get(answer.get("question_id")) or {}
            answers.append(
                {
                    "question_id": answer.get("question_id") or "",
                    "label": answer.get("label") or question.get("label") or "",
                    "value": answer.get("value") or "",
                    "answer_type": question.get("answer_type") or "text",
                    "choices": question.get("choices") or [],
                }
            )
        profiles.append(
            {
                "course_id": course_id,
                "course_name": (course or {}).get("name") or "",
                "answers": answers,
            }
        )
    return {
        "academic_records": displayed_records(student),
        "course_profiles": profiles,
        "business_answers": student.get("business_answers") or [],
    }


def apply_record_update(student: dict, records: list[dict]) -> tuple[dict, dict, dict, dict]:
    cleaned = clean_academic_records(records)
    sets: dict = {"academic_records": cleaned}
    unsets: dict = {}
    before = {"academic_records": _record_summary(displayed_records(student))}
    after = {"academic_records": _record_summary(cleaned)}
    for field, value in _mirror_legacy(cleaned).items():
        if value:
            sets[field] = value
        else:
            unsets[field] = ""
    return sets, unsets, before, after


def _record_summary(records: list[dict]) -> str:
    if not records:
        return "Not recorded"
    parts = []
    for item in records:
        label = ", ".join(
            item.get(key) or ""
            for key in ("qualification", "stream", "institution", "mark", "year_of_passing", "board")
            if item.get(key)
        )
        if label:
            parts.append(label)
    return "; ".join(parts) or "Not recorded"


async def apply_course_profiles(request: Request, institute_id: str, profiles: list) -> list[dict]:
    cleaned = []
    for item in profiles or []:
        source = item if isinstance(item, dict) else {}
        course_id = source.get("course_id") or ""
        course = await db(request).courses.find_one({"_id": course_id, "institute_id": institute_id})
        if course is None:
            raise AppError(422, "intake.field", "Choose a course for the extra answers.", field="course_profiles")
        questions = await _questions_for(request, course_id)
        answers = _clean_answers(questions, source.get("answers") or [], require=False)
        cleaned.append({"course_id": course_id, "answers": answers})
    return cleaned


@router.get("/form-questions")
async def list_form_questions(request: Request, form: str = "") -> dict:
    user = await current_user(request)
    _reader(user)
    query: dict = {"institute_id": user["institute_id"]}
    if form:
        if form not in {"enquiry", "admission"}:
            raise AppError(422, "intake.field", "Choose enquiry or admission.", field="form")
        query["forms"] = form
    rows = await db(request).form_questions.find(query).sort("order", 1).to_list(length=50)
    return {"items": [_question_view(row) for row in rows]}


@router.post("/form-questions")
async def create_form_question(request: Request, body: QuestionBody) -> dict:
    user = await current_user(request)
    _catalog_editor(user)
    fields = _clean_question(body)
    forms = _forms_for(body.place or "both")
    taken = await db(request).form_questions.find_one(
        {"institute_id": user["institute_id"], "label_key": fields["label_key"]}
    )
    if taken:
        raise AppError(409, "question.exists", "That question already exists.")
    last = (
        await db(request)
        .form_questions.find({"institute_id": user["institute_id"]})
        .sort("order", -1)
        .to_list(length=1)
    )
    order = (last[0].get("order") or 0) + 1 if last else 1
    question_id = str(ObjectId())
    await db(request).form_questions.insert_one(
        {"_id": question_id, "institute_id": user["institute_id"], "order": order, "forms": forms, **fields}
    )
    await write_audit(
        request, user, "form_question.create", None, {"label": fields["label"], "place": _place_of(forms)}, {}
    )
    return {"id": question_id}


@router.patch("/form-questions/{question_id}")
async def update_form_question(request: Request, question_id: str, body: QuestionPatch) -> dict:
    user = await current_user(request)
    _catalog_editor(user)
    row = await db(request).form_questions.find_one({"_id": question_id, "institute_id": user["institute_id"]})
    if row is None:
        raise AppError(404, "not_found", "That record was not found.")
    merged = QuestionBody(
        label=body.label if body.label is not None else row.get("label") or "",
        answer_type=body.answer_type if body.answer_type is not None else row.get("answer_type") or "text",
        choices=body.choices if body.choices is not None else row.get("choices") or [],
        required=body.required if body.required is not None else bool(row.get("required")),
        place=body.place if body.place is not None else _place_of(row.get("forms") or []),
    )
    fields = _clean_question(merged)
    fields["forms"] = _forms_for(merged.place or "both")
    taken = await db(request).form_questions.find_one(
        {"institute_id": user["institute_id"], "label_key": fields["label_key"], "_id": {"$ne": question_id}}
    )
    if taken:
        raise AppError(409, "question.exists", "That question already exists.")
    await db(request).form_questions.update_one({"_id": question_id}, {"$set": fields})
    return {"id": question_id}


@router.delete("/form-questions/{question_id}")
async def delete_form_question(request: Request, question_id: str) -> dict:
    user = await current_user(request)
    _catalog_editor(user)
    row = await db(request).form_questions.find_one({"_id": question_id, "institute_id": user["institute_id"]})
    if row is None:
        raise AppError(404, "not_found", "That record was not found.")
    await db(request).form_questions.delete_one({"_id": question_id})
    await write_audit(request, user, "form_question.delete", {"label": row.get("label") or ""}, None, {})
    return {"id": question_id}


def intake_course_visible(grants: list, course_id: str) -> bool:
    """An enquiry or admission has a course and no branch. A grant's branch does not hide it."""
    for grant in grants:
        if "student.lookup" not in (grant.get("actions") or []):
            continue
        scoped = (grant.get("scope") or {}).get("course_id")
        if scoped and scoped != course_id:
            continue
        if scoped and not course_id:
            continue
        return True
    return False


def applied_intake_course(grants: list, course_id: str) -> tuple[str, bool]:
    if not course_id:
        return "", False
    if intake_course_visible(grants, course_id):
        return course_id, False
    return "", True


def enquiry_awaiting_follow_up(row: dict, today: str) -> bool:
    if row.get("admission_id"):
        return False
    follow_ups = list(row.get("follow_ups") or [])
    if not follow_ups:
        return True
    next_on = str(follow_ups[-1].get("next_on") or "")
    return not next_on or next_on <= today


@router.get("/enquiries")
async def list_enquiries(
    request: Request, q: str = "", page: int = 1, page_size: int = 20, follow_up: str = "", course_id: str = ""
) -> dict:
    user = await current_user(request)
    _reader(user)
    return await _list_people(
        request, user, "enquiries", q, page, page_size, follow_up=follow_up, course_id=course_id
    )


@router.post("/enquiries")
async def create_enquiry(request: Request, body: EnquiryBody) -> dict:
    user = await current_user(request)
    _writer(user)
    if body.course_id:
        await _course(request, user, body.course_id)
    fields = _enquiry_fields(body)
    fields["answers"] = await clean_form_answers(request, user["institute_id"], "enquiry", body.answers, require=False)
    enquiry_id = str(ObjectId())
    await db(request).enquiries.insert_one(
        {
            "_id": enquiry_id,
            "institute_id": user["institute_id"],
            "follow_ups": [],
            "created_at": _now(),
            "updated_at": _now(),
            **fields,
        }
    )
    await write_audit(request, user, "enquiry.create", None, {"name": fields["name"]}, {"enquiry_id": enquiry_id})
    return {"id": enquiry_id}


@router.get("/enquiries/{enquiry_id}")
async def get_enquiry(request: Request, enquiry_id: str) -> dict:
    user = await current_user(request)
    _reader(user)
    row = await _enquiry(request, user, enquiry_id)
    view = _enquiry_view(row, await _course_name(request, row.get("course_id") or ""))
    questions = await _form_questions(request, user["institute_id"], "enquiry")
    view["questions"] = [_question_view(item) for item in questions]
    view["answers"] = row.get("answers") or []
    return view


@router.patch("/enquiries/{enquiry_id}")
async def update_enquiry(request: Request, enquiry_id: str, body: EnquiryBody) -> dict:
    user = await current_user(request)
    _writer(user)
    row = await _enquiry(request, user, enquiry_id)
    if body.course_id:
        await _course(request, user, body.course_id)
    fields = _enquiry_fields(body)
    fields["answers"] = await remember_answers(
        request, user["institute_id"], "enquiry", row.get("answers") or [], body.answers, require=False
    )
    fields["updated_at"] = _now()
    await db(request).enquiries.update_one({"_id": enquiry_id}, {"$set": fields})
    await write_audit(
        request,
        user,
        "enquiry.update",
        {"name": row.get("name") or ""},
        {"name": fields["name"]},
        {"enquiry_id": enquiry_id},
    )
    return {"id": enquiry_id}


@router.post("/enquiries/{enquiry_id}/follow-ups")
async def add_follow_up(request: Request, enquiry_id: str, body: FollowUpBody) -> dict:
    user = await current_user(request)
    _writer(user)
    await _enquiry(request, user, enquiry_id)
    note = _long_text(body.note, 500, "note")
    at = _date(body.at, "at")
    if not at or not note:
        raise AppError(422, "intake.field", "Enter the follow-up date and what was discussed.", field="note")
    follow = {
        "id": str(ObjectId()),
        "at": at,
        "note": note,
        "interest": _choice(body.interest, INTERESTS, "interest", "Choose High, Medium, or Low."),
        "next_on": _date(body.next_on, "next_on"),
    }
    await db(request).enquiries.update_one(
        {"_id": enquiry_id},
        {"$push": {"follow_ups": follow}, "$set": {"updated_at": _now()}},
    )
    await write_audit(request, user, "enquiry.follow_up", None, {"at": at, "note": note}, {"enquiry_id": enquiry_id})
    return follow


@router.delete("/enquiries/{enquiry_id}/follow-ups/{follow_id}")
async def delete_follow_up(request: Request, enquiry_id: str, follow_id: str) -> dict:
    user = await current_user(request)
    _writer(user)
    await _enquiry(request, user, enquiry_id)
    await db(request).enquiries.update_one({"_id": enquiry_id}, {"$pull": {"follow_ups": {"id": follow_id}}})
    return {"id": follow_id}


@router.post("/enquiries/{enquiry_id}/convert")
async def convert_enquiry(request: Request, enquiry_id: str) -> dict:
    user = await current_user(request)
    _writer(user)
    row = await _enquiry(request, user, enquiry_id)
    if row.get("admission_id"):
        return {"id": row["admission_id"], "existing": True}
    if row.get("course_id"):
        await _course(request, user, row["course_id"])
    admission_id = str(ObjectId())
    records = []
    if row.get("present_institution"):
        records.append(
            {
                "qualification": "",
                "stream": "",
                "institution": row.get("present_institution") or "",
                "mark": "",
                "year_of_passing": "",
                "board": "",
            }
        )
    phone = row.get("whatsapp") or ""
    if not phone:
        raise AppError(422, "intake.field", "Enter a WhatsApp number before admitting this enquiry.", field="whatsapp")
    enquiry_answers = await clean_form_answers(
        request, user["institute_id"], "enquiry", row.get("answers") or [], require=True
    )
    admission_questions = await _form_questions(request, user["institute_id"], "admission")
    shared_ids = {item["_id"] for item in admission_questions}
    shared_answers = [item for item in enquiry_answers if item["question_id"] in shared_ids]
    await db(request).admissions.insert_one(
        {
            "_id": admission_id,
            "institute_id": user["institute_id"],
            "course_id": row.get("course_id") or "",
            "name": row.get("name") or "",
            "name_key": row.get("name_key") or name_key(row.get("name") or ""),
            "phone": phone,
            "phone_key": phone_key(phone),
            "date_of_birth": "",
            "gender": "",
            "blood_group": "",
            "email": "",
            "street": "",
            "address_line_2": "",
            "place": "",
            "district": "",
            "state": "",
            "pin": "",
            "guardian_name": "",
            "guardian_phone": "",
            "academic_records": records,
            "course_answers": [],
            "business_answers": shared_answers,
            "status": "open",
            "enquiry_id": enquiry_id,
            "created_at": _now(),
            "updated_at": _now(),
        }
    )
    await db(request).enquiries.update_one(
        {"_id": enquiry_id},
        {"$set": {"admission_id": admission_id, "updated_at": _now()}},
    )
    await write_audit(
        request,
        user,
        "enquiry.convert",
        None,
        {"name": row.get("name") or "", "admission_id": admission_id},
        {"enquiry_id": enquiry_id},
    )
    return {"id": admission_id, "existing": False}


@router.post("/enquiries/import")
async def preview_enquiries(request: Request, file: UploadFile = File(...)) -> dict:
    user = await current_user(request)
    _writer(user)
    rows = _sheet_rows(await _workbook_bytes(file))
    courses = await db(request).courses.find({"institute_id": user["institute_id"]}).to_list(length=200)
    by_name = {item.get("name_key"): item for item in courses}
    form_questions = await _form_questions(request, user["institute_id"], "enquiry")
    preview = []
    for offset, cells in rows:
        mapped, unknown = _map_headers(cells, _ENQUIRY_HEADERS)
        extras, leftover = _question_columns(cells, unknown, form_questions)
        item = {"row": offset, "errors": [], "values": {}, "answers": []}
        if leftover:
            item["errors"].append(f"Unknown column {leftover[0]}.")
        try:
            course_id = ""
            course_label = mapped.get("course") or ""
            if course_label:
                course = by_name.get(name_key(course_label))
                if course is None:
                    raise AppError(422, "intake.field", f"No course named {course_label}.", field="course_id")
                course_id = course["_id"]
            body = EnquiryBody(
                name=mapped.get("name") or "",
                whatsapp=mapped.get("whatsapp") or "",
                present_institution=mapped.get("present_institution") or "",
                course_id=course_id,
                interest=mapped.get("interest") or "",
                references=mapped.get("references") or "",
                details=mapped.get("details") or "",
                answers=extras,
            )
            fields = _enquiry_fields(body)
            answers = _clean_answers(form_questions, extras, require=False)
            item["answers"] = answers
            item["values"] = {
                "name": fields["name"],
                "whatsapp": fields["whatsapp"],
                "present_institution": fields["present_institution"],
                "course_id": course_id,
                "course_name": course_label,
                "interest": fields["interest"],
                "references": fields["references"],
                "details": fields["details"],
            }
        except AppError as exc:
            item["errors"].append(exc.message)
        preview.append(item)
    return {"rows": preview}


@router.post("/enquiries/import/commit")
async def commit_enquiries(request: Request, body: EnquiryCommit) -> dict:
    user = await current_user(request)
    _writer(user)
    if not body.rows:
        raise AppError(422, "intake.field", "There are no rows to save.")
    created = []
    for item in body.rows:
        if item.course_id:
            await _course(request, user, item.course_id)
        fields = _enquiry_fields(item)
        fields["answers"] = await clean_form_answers(
            request, user["institute_id"], "enquiry", item.answers, require=False
        )
        enquiry_id = str(ObjectId())
        await db(request).enquiries.insert_one(
            {
                "_id": enquiry_id,
                "institute_id": user["institute_id"],
                "follow_ups": [],
                "created_at": _now(),
                "updated_at": _now(),
                **fields,
            }
        )
        created.append(enquiry_id)
    await write_audit(
        request, user, "enquiry.import", None, {"count": len(created)}, {"institute_id": user["institute_id"]}
    )
    return {"created": len(created), "ids": created}


@router.get("/admissions")
async def list_admissions(
    request: Request, q: str = "", page: int = 1, page_size: int = 20, status: str = "", course_id: str = ""
) -> dict:
    user = await current_user(request)
    _reader(user)
    return await _list_people(
        request, user, "admissions", q, page, page_size, status=status, course_id=course_id
    )


@router.post("/admissions")
async def create_admission(request: Request, body: AdmissionBody) -> dict:
    user = await current_user(request)
    _writer(user)
    return await _save_admission(request, user, None, body)


@router.get("/admissions/{admission_id}")
async def get_admission(request: Request, admission_id: str) -> dict:
    user = await current_user(request)
    _reader(user)
    row = await _admission(request, user, admission_id)
    matches = await find_matches(request, user["institute_id"], row.get("name") or "", row.get("phone") or "")
    questions = await _questions_for(request, row.get("course_id") or "")
    return _admission_view(row, await _course_name(request, row.get("course_id") or ""), matches, questions)


@router.patch("/admissions/{admission_id}")
async def update_admission(request: Request, admission_id: str, body: AdmissionBody) -> dict:
    user = await current_user(request)
    _writer(user)
    row = await _admission(request, user, admission_id)
    if row.get("status") == "converted":
        raise AppError(409, "admission.converted", "This admission is already a student. Edit the student instead.")
    return await _save_admission(request, user, row, body)


@router.post("/admissions/{admission_id}/convert")
async def convert_admission(request: Request, admission_id: str, body: ConvertBody) -> dict:
    user = await current_user(request)
    _writer(user)
    row = await _admission(request, user, admission_id)
    if row.get("status") == "converted":
        return {"id": row.get("student_id"), "existing": True, "enrollment_id": row.get("enrollment_id")}
    if not allows(
        user["grants"],
        "student.manage",
        {
            "institute_id": user["institute_id"],
            "branch_id": body.branch_id,
            "course_id": row.get("course_id"),
            "batch_id": body.batch_id,
        },
    ):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    batch = await db(request).batches.find_one({"_id": body.batch_id, "institute_id": user["institute_id"]})
    if batch is None or batch.get("branch_id") != body.branch_id or batch.get("course_id") != row.get("course_id"):
        raise AppError(422, "enrollment.context", "Choose a branch and batch for this course.")
    require_open_batch(batch)
    questions = await _questions_for(request, row.get("course_id") or "")
    answers = _clean_answers(questions, row.get("course_answers") or [], require=True)
    business = await clean_form_answers(
        request, user["institute_id"], "admission", row.get("business_answers") or [], require=True
    )
    row["business_answers"] = business
    matches = await find_matches(request, user["institute_id"], row.get("name") or "", row.get("phone") or "")
    decision = body.decision or row.get("match_decision") or ""
    student_id = body.student_id or row.get("match_student_id") or ""
    if decision == "attach":
        if student_id not in {item["id"] for item in matches}:
            raise AppError(422, "admission.match", "Choose one of the matching students.")
    elif decision == "create":
        student_id = ""
    elif matches:
        raise AppError(409, "admission.match", "Confirm which student this admission belongs to.", matches=matches)
    result = await _commit_student(
        request, user, row, batch, answers, student_id or None, admission_id, decision or "create"
    )
    await write_audit(
        request,
        user,
        "admission.convert",
        None,
        {"name": row.get("name") or "", "student_id": result["id"], "created": result["created"]},
        {"student_id": result["id"], "branch_id": body.branch_id, "batch_id": body.batch_id},
    )
    return result


@router.post("/admissions/import")
async def preview_admissions(request: Request, file: UploadFile = File(...)) -> dict:
    user = await current_user(request)
    _writer(user)
    rows = _sheet_rows(await _workbook_bytes(file))
    courses = await db(request).courses.find({"institute_id": user["institute_id"]}).to_list(length=200)
    by_name = {item.get("name_key"): item for item in courses}
    question_rows = await db(request).course_questions.find({"institute_id": user["institute_id"]}).to_list(length=500)
    business_questions = await _form_questions(request, user["institute_id"], "admission")
    preview = []
    for offset, cells in rows:
        mapped, unknown = _map_headers(cells, _ADMISSION_HEADERS)
        item = {"row": offset, "errors": [], "matches": [], "values": {}, "answers": [], "business_answers": []}
        course = by_name.get(name_key(mapped.get("course") or ""))
        questions = [question for question in question_rows if course and question.get("course_id") == course["_id"]]
        extras, leftover = _question_columns(cells, unknown, questions)
        business_extras, leftover = _question_columns(cells, leftover, business_questions)
        if leftover:
            item["errors"].append(f"Unknown column {leftover[0]}.")
        try:
            if course is None:
                label = mapped.get("course") or ""
                message = f"No course named {label}." if label else "Choose a course."
                raise AppError(422, "intake.field", message, field="course_id")
            body = _admission_from_map(mapped, course["_id"], extras, business_extras)
            fields = _admission_contact(body)
            answers = _clean_answers(questions, body.course_answers, require=False)
            business = _clean_answers(business_questions, body.business_answers, require=False)
            matches = await find_matches(request, user["institute_id"], fields["name"], fields["phone"])
            item["matches"] = matches
            item["answers"] = answers
            item["business_answers"] = business
            item["values"] = {**fields, "course_id": course["_id"], "course_name": course.get("name") or ""}
            item["values"].pop("name_key", None)
            item["values"].pop("phone_key", None)
        except AppError as exc:
            item["errors"].append(exc.message)
        preview.append(item)
    return {"rows": preview}


@router.post("/admissions/import/commit")
async def commit_admissions(request: Request, body: AdmissionCommit) -> dict:
    user = await current_user(request)
    _writer(user)
    if not body.rows:
        raise AppError(422, "intake.field", "There are no rows to save.")
    created = []
    for item in body.rows:
        matches = await find_matches(request, user["institute_id"], item.name, item.phone)
        decision = item.decision
        if matches and decision not in {"attach", "create"}:
            raise AppError(
                409, "admission.match", f"Confirm whether {item.name} is an existing student.", matches=matches
            )
        if decision == "attach" and item.student_id not in {match["id"] for match in matches}:
            raise AppError(422, "admission.match", f"Choose a matching student for {item.name}.")
        if not matches:
            decision = "create"
        saved = await _save_admission(request, user, None, item, decision=decision, student_id=item.student_id)
        created.append(saved["id"])
    await write_audit(
        request, user, "admission.import", None, {"count": len(created)}, {"institute_id": user["institute_id"]}
    )
    return {"created": len(created), "ids": created}


async def _save_admission(
    request: Request, user: dict, existing: dict | None, body: AdmissionBody, decision: str = "", student_id: str = ""
) -> dict:
    await _course(request, user, body.course_id)
    fields = _admission_contact(body)
    questions = await _questions_for(request, body.course_id)
    fields["course_answers"] = _clean_answers(questions, body.course_answers, require=False)
    fields["business_answers"] = await remember_answers(
        request,
        user["institute_id"],
        "admission",
        (existing or {}).get("business_answers") or [],
        body.business_answers,
        require=False,
    )
    fields["course_id"] = body.course_id
    fields["updated_at"] = _now()
    if decision:
        fields["match_decision"] = decision
        fields["match_student_id"] = student_id if decision == "attach" else ""
    if existing is None:
        admission_id = str(ObjectId())
        await db(request).admissions.insert_one(
            {
                "_id": admission_id,
                "institute_id": user["institute_id"],
                "status": "open",
                "created_at": _now(),
                **fields,
            }
        )
        await write_audit(
            request, user, "admission.create", None, {"name": fields["name"]}, {"admission_id": admission_id}
        )
        return {"id": admission_id}
    await db(request).admissions.update_one({"_id": existing["_id"]}, {"$set": fields})
    await write_audit(
        request,
        user,
        "admission.update",
        {"name": existing.get("name") or ""},
        {"name": fields["name"]},
        {"admission_id": existing["_id"]},
    )
    return {"id": existing["_id"]}


async def _commit_student(
    request: Request,
    user: dict,
    admission: dict,
    batch: dict,
    answers: list[dict],
    student_id: str | None,
    admission_id: str,
    decision: str,
) -> dict:
    institute_id = user["institute_id"]
    profile = _profile_from_admission(admission)
    records = admission.get("academic_records") or []
    business = admission.get("business_answers") or []
    created = student_id is None
    try:
        async with await request.app.state.client.start_session() as session:
            async with session.start_transaction():
                if created:
                    code = await allocate_student_code(db(request), session, "IAM")
                    student_id = str(ObjectId())
                    document = {
                        "_id": student_id,
                        "institute_id": institute_id,
                        "student_code": code,
                        "display_name": admission.get("name") or "",
                        "name_key": admission.get("name_key") or name_key(admission.get("name") or ""),
                        "edit_version": 0,
                        "academic_records": records,
                        "course_profiles": [{"course_id": admission.get("course_id"), "answers": answers}]
                        if answers
                        else [],
                        "business_answers": business,
                        **{key: value for key, value in profile.items() if value},
                        **{key: value for key, value in _mirror_legacy(records).items() if value},
                    }
                    if profile.get("phone"):
                        document["phone_key"] = phone_key(profile["phone"])
                    await db(request).students.insert_one(document, session=session)
                else:
                    student = await db(request).students.find_one({"_id": student_id}, session=session)
                    if student is None:
                        raise AppError(404, "not_found", "That record was not found.")
                    sets = {}
                    for key, value in profile.items():
                        if value and not student.get(key):
                            sets[key] = value
                    if sets.get("phone") and not student.get("phone_key"):
                        sets["phone_key"] = phone_key(sets["phone"])
                    existing_records = list(student.get("academic_records") or displayed_records(student))
                    if records:
                        sets["academic_records"] = existing_records + records
                        for key, value in _mirror_legacy(records).items():
                            if value and not student.get(key):
                                sets[key] = value
                    profiles = list(student.get("course_profiles") or [])
                    merged = _merge_answers(profiles, admission.get("course_id") or "", answers)
                    if merged != profiles:
                        sets["course_profiles"] = merged
                    combined = _merge_form_answers(student.get("business_answers") or [], business)
                    if combined != (student.get("business_answers") or []):
                        sets["business_answers"] = combined
                    if sets:
                        await db(request).students.update_one({"_id": student_id}, {"$set": sets}, session=session)
                enrollment_id = await _ensure_enrollment(
                    request, session, institute_id, student_id, batch, admission.get("name_key") or ""
                )
                await db(request).admissions.update_one(
                    {"_id": admission_id},
                    {
                        "$set": {
                            "status": "converted",
                            "student_id": student_id,
                            "enrollment_id": enrollment_id,
                            "branch_id": batch.get("branch_id"),
                            "batch_id": batch["_id"],
                            "updated_at": _now(),
                            "match_decision": decision or "create",
                        }
                    },
                    session=session,
                )
    except DuplicateKeyError as exc:
        raise AppError(
            409,
            "student.identity",
            "Another student in that batch already uses this name. Add the course to that student instead.",
        ) from exc
    return {"id": student_id, "created": created, "enrollment_id": enrollment_id}


def _profile_from_admission(admission: dict) -> dict:
    return {
        "date_of_birth": admission.get("date_of_birth") or "",
        "gender": admission.get("gender") or "",
        "blood_group": admission.get("blood_group") or "",
        "phone": admission.get("phone") or "",
        "email": admission.get("email") or "",
        "street": admission.get("street") or "",
        "address_line_2": admission.get("address_line_2") or "",
        "place": admission.get("place") or "",
        "district": admission.get("district") or "",
        "state": admission.get("state") or "",
        "pin": admission.get("pin") or "",
        "guardian_name": admission.get("guardian_name") or "",
        "guardian_phone": admission.get("guardian_phone") or "",
    }


def _merge_answers(profiles: list[dict], course_id: str, answers: list[dict]) -> list[dict]:
    if not answers:
        return profiles
    found = next((item for item in profiles if item.get("course_id") == course_id), None)
    if found is None:
        return profiles + [{"course_id": course_id, "answers": answers}]
    current = list(found.get("answers") or [])
    for answer in answers:
        previous = next((item for item in current if item.get("question_id") == answer.get("question_id")), None)
        if previous is None:
            current.append(answer)
        elif not previous.get("value") and answer.get("value"):
            previous["value"] = answer["value"]
    found["answers"] = current
    return profiles


async def _ensure_enrollment(
    request: Request, session, institute_id: str, student_id: str, batch: dict, key: str
) -> str:
    batch_id = batch["_id"]
    already = await db(request).enrollments.find_one({"student_id": student_id, "batch_id": batch_id}, session=session)
    if already:
        return already["_id"]
    require_open_batch(batch)
    if key and await name_conflicts(db(request), batch_id, [key], student_id, session):
        raise AppError(
            409,
            "student.identity",
            "Another student in that batch already uses this name. Add the course to that student instead.",
        )
    enrollment_id = str(ObjectId())
    await db(request).enrollments.insert_one(
        enrollment_document(
            enrollment_id=enrollment_id,
            institute_id=institute_id,
            student_id=student_id,
            branch_id=batch.get("branch_id"),
            course_id=batch.get("course_id"),
            batch_id=batch_id,
        ),
        session=session,
    )
    if key:
        own = await db(request).enrollment_names.find_one(
            {"batch_id": batch_id, "name_key": key, "student_id": student_id}, session=session
        )
        if own is None:
            await db(request).enrollment_names.insert_one(
                name_document(
                    institute_id=institute_id, batch_id=batch_id, student_id=student_id, name_key=key
                ),
                session=session,
            )
    return enrollment_id


async def _enquiry(request: Request, user: dict, enquiry_id: str) -> dict:
    row = await db(request).enquiries.find_one({"_id": enquiry_id, "institute_id": user["institute_id"]})
    if row is None:
        raise AppError(404, "not_found", "That record was not found.")
    return row


async def _admission(request: Request, user: dict, admission_id: str) -> dict:
    row = await db(request).admissions.find_one({"_id": admission_id, "institute_id": user["institute_id"]})
    if row is None:
        raise AppError(404, "not_found", "That record was not found.")
    return row


async def _list_people(
    request: Request,
    user: dict,
    collection: str,
    q: str,
    page: int,
    page_size: int,
    follow_up: str = "",
    status: str = "",
    course_id: str = "",
) -> dict:
    size = min(max(page_size, 1), 100)
    number = max(page, 1)
    query: dict = {"institute_id": user["institute_id"]}
    rows = await db(request)[collection].find(query).sort("created_at", -1).to_list(length=500)
    rows = [row for row in rows if intake_course_visible(user["grants"], row.get("course_id") or "")]
    selected_course, _dropped = applied_intake_course(user["grants"], course_id)
    if selected_course:
        rows = [row for row in rows if (row.get("course_id") or "") == selected_course]
    if collection == "enquiries" and follow_up == "due":
        today = _now().date().isoformat()
        rows = [row for row in rows if enquiry_awaiting_follow_up(row, today)]
    if collection == "admissions" and status:
        rows = [row for row in rows if (row.get("status") or "open") == status]
    needle = q.casefold().strip()
    if needle:
        rows = [row for row in rows if needle in _search_text(row)]
    total = len(rows)
    start = (number - 1) * size
    chosen = rows[start : start + size]
    course_ids = list({row.get("course_id") for row in chosen if row.get("course_id")})
    names = {}
    if course_ids:
        for course in await db(request).courses.find({"_id": {"$in": course_ids}}).to_list(length=len(course_ids)):
            names[course["_id"]] = course.get("name") or ""
    items = []
    for row in chosen:
        if collection == "enquiries":
            view = _enquiry_view(row, names.get(row.get("course_id"), ""))
            view["follow_up_count"] = len(row.get("follow_ups") or [])
            items.append(view)
        else:
            items.append(_admission_view(row, names.get(row.get("course_id"), "")))
    return {"items": items, "total": total, "page": number, "pages": max(1, (total + size - 1) // size)}


def _search_text(row: dict) -> str:
    return " ".join(
        str(row.get(key) or "") for key in ("name", "whatsapp", "phone", "present_institution", "interest")
    ).casefold()


_ENQUIRY_HEADERS = {
    "name": "name",
    "whatsapp": "whatsapp",
    "whatsapp number": "whatsapp",
    "present institution": "present_institution",
    "interested course": "course",
    "course": "course",
    "level of interest": "interest",
    "interest": "interest",
    "references": "references",
    "details": "details",
    "other details": "details",
}
_ADMISSION_HEADERS = {
    "course": "course",
    "name": "name",
    "contact number": "phone",
    "phone": "phone",
    "contact": "phone",
    "dob": "date_of_birth",
    "date of birth": "date_of_birth",
    "gender": "gender",
    "blood group": "blood_group",
    "email": "email",
    "address line 1": "street",
    "address line 2": "address_line_2",
    "city": "place",
    "district": "district",
    "state": "state",
    "pin": "pin",
    "parent or guardian": "guardian_name",
    "name of parent/guardian": "guardian_name",
    "guardian": "guardian_name",
    "parent contact": "guardian_phone",
    "contact number of parent/guardian": "guardian_phone",
    "guardian phone": "guardian_phone",
    "qualification": "qualification",
    "stream": "stream",
    "stream/department": "stream",
    "department": "stream",
    "institution": "institution",
    "name of the institution": "institution",
    "mark": "mark",
    "year of passing": "year_of_passing",
    "year": "year_of_passing",
}


def _admission_from_map(
    mapped: dict, course_id: str, extras: list[AnswerBody], business: list[AnswerBody] | None = None
) -> AdmissionBody:
    record = {
        "qualification": mapped.get("qualification") or "",
        "stream": mapped.get("stream") or "",
        "institution": mapped.get("institution") or "",
        "mark": mapped.get("mark") or "",
        "year_of_passing": mapped.get("year_of_passing") or "",
        "board": "",
    }
    records = [record] if any(record.values()) else []
    return AdmissionBody(
        course_id=course_id,
        name=mapped.get("name") or "",
        phone=mapped.get("phone") or "",
        date_of_birth=mapped.get("date_of_birth") or "",
        gender=mapped.get("gender") or "",
        blood_group=mapped.get("blood_group") or "",
        email=mapped.get("email") or "",
        street=mapped.get("street") or "",
        address_line_2=mapped.get("address_line_2") or "",
        place=mapped.get("place") or "",
        district=mapped.get("district") or "",
        state=mapped.get("state") or "",
        pin=mapped.get("pin") or "",
        guardian_name=mapped.get("guardian_name") or "",
        guardian_phone=mapped.get("guardian_phone") or "",
        academic_records=records,
        course_answers=extras,
        business_answers=business or [],
    )


async def _workbook_bytes(file: UploadFile) -> bytes:
    filename = file.filename or "intake.xlsx"
    if not filename.lower().endswith(".xlsx"):
        raise AppError(422, "import.file_type", "Upload an .xlsx workbook.")
    data = await file.read()
    if len(data) > _MAX_BYTES:
        raise AppError(422, "import.too_large", "The workbook is larger than 5 MB.")
    return data


def _sheet_rows(data: bytes) -> list[tuple[int, dict[str, str]]]:
    try:
        workbook = load_workbook(BytesIO(data), data_only=True, read_only=True)
    except Exception as exc:
        raise AppError(422, "import.unreadable", "This workbook could not be read.") from exc
    sheet = workbook.worksheets[0]
    rows = list(sheet.iter_rows(values_only=True))
    if not rows:
        raise AppError(422, "import.unreadable", "The workbook has no rows.")
    headers = [_cell_text(value) for value in rows[0]]
    if not any(headers):
        raise AppError(422, "import.unreadable", "The first row needs column names.")
    parsed = []
    for index, row in enumerate(rows[1:], start=2):
        cells = {}
        for header, value in zip(headers, row):
            if not header:
                continue
            text = _cell_text(value)
            if text:
                cells[header] = text
        if cells:
            parsed.append((index, cells))
    return parsed


def _cell_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, int):
        return str(value)
    return str(value).strip()


def _map_headers(cells: dict[str, str], known: dict[str, str]) -> tuple[dict[str, str], list[str]]:
    mapped: dict[str, str] = {}
    unknown = []
    for header, value in cells.items():
        key = known.get(name_key(header))
        if key is None:
            unknown.append(header)
        else:
            mapped[key] = value
    return mapped, unknown


def _question_columns(
    cells: dict[str, str], unknown: list[str], questions: list[dict]
) -> tuple[list[AnswerBody], list[str]]:
    keys = {name_key(item.get("label") or ""): item for item in questions}
    extras = []
    leftover = []
    for header in unknown:
        question = keys.get(name_key(header))
        if question is None:
            leftover.append(header)
        else:
            extras.append(AnswerBody(question_id=question["_id"], value=cells.get(header) or ""))
    return extras, leftover


def _merge_form_answers(current: list[dict], incoming: list[dict]) -> list[dict]:
    if not incoming:
        return current
    result = [dict(item) for item in current]
    for answer in incoming:
        previous = next((item for item in result if item.get("question_id") == answer.get("question_id")), None)
        if previous is None:
            result.append(dict(answer))
        elif not previous.get("value") and answer.get("value"):
            previous["value"] = answer["value"]
            previous["label"] = answer.get("label") or previous.get("label") or ""
    return result
