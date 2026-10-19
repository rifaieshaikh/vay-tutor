"""Mapped admission import. Upload and preview never create applications."""

from __future__ import annotations

from app.admissions.enquiry_import import (
    _apply_defaults,
    _cell_text,
    _expired,
    _interpret_date,
    _issue,
    _now,
    _selected,
    _warnings,
    apply_saved_mapping,
    column_view,
    counts_for,
    digest_plan,
    error_csv,
    expiry_from,
    load_grid,
    mapping_fingerprint,
)
from app.errors import AppError
from app.security import name_key, phone_key

FIELD_LABELS = {
    "name": "Name",
    "phone": "Contact number",
    "email": "Email",
    "date_of_birth": "Date of birth",
    "gender": "Gender",
    "course": "Course",
    "guardian_name": "Guardian",
    "guardian_phone": "Guardian phone",
    "street": "Street",
    "place": "Place",
    "district": "District",
    "state": "State",
    "pin": "PIN",
}
HEADER_ALIASES = {
    "name": "name",
    "student name": "name",
    "applicant": "name",
    "phone": "phone",
    "contact": "phone",
    "contact number": "phone",
    "mobile": "phone",
    "whatsapp": "phone",
    "email": "email",
    "e-mail": "email",
    "date of birth": "date_of_birth",
    "dob": "date_of_birth",
    "gender": "gender",
    "course": "course",
    "course name": "course",
    "guardian": "guardian_name",
    "parent": "guardian_name",
    "guardian name": "guardian_name",
    "guardian phone": "guardian_phone",
    "parent contact": "guardian_phone",
    "street": "street",
    "address": "street",
    "place": "place",
    "city": "place",
    "district": "district",
    "state": "state",
    "pin": "pin",
    "pincode": "pin",
}
GENDERS = ("Female", "Male", "Other")
_SCIENTIFIC = __import__("re").compile(r"^[+-]?\d+(\.\d+)?[eE][+-]?\d+$")


def template_workbook() -> bytes:
    from io import BytesIO

    from openpyxl import Workbook

    book = Workbook()
    sheet = book.active
    sheet.title = "Applications"
    sheet.append(["Name", "Contact number", "Email", "Course", "Date of birth", "Gender"])
    sheet.append(["Example Student", "09876543210", "student@example.com", "CA Foundation", "2008-04-12", "Female"])
    buffer = BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def evaluate_plan(
    grid: dict,
    plan: dict,
    courses: list[dict],
    questions: list[dict],
    students: list[dict],
    admissions: list[dict],
    prospects: list[dict],
) -> dict:
    sources = plan.get("sources") or []
    if not sources:
        return {"phase": "source", "columns": [], "rows": [], "issues": []}
    columns = column_view(grid, sources, HEADER_ALIASES)
    by_id = {item["id"]: item for item in columns}
    mappings = {item.get("column_id"): item.get("target") or "" for item in plan.get("mappings") or []}
    issues = []
    used: dict[str, str] = {}
    for column in columns:
        target = mappings.get(column["id"], "")
        if not target:
            issues.append(f"Choose a field or Ignore for {column['label']}.")
            continue
        if target == "ignore":
            continue
        if target in used:
            issues.append(f"{FIELD_LABELS.get(target, target)} is already mapped.")
        used[target] = column["id"]
        if target not in FIELD_LABELS and not target.startswith("question:"):
            issues.append(f"{column['label']} uses an unknown field.")
    if "name" not in used:
        issues.append("Map a column to Name.")
    if "course" not in used and not (plan.get("defaults") or {}).get("course_id"):
        issues.append("Map a column to Course or choose a default course.")
    if issues:
        return {"phase": "mapping", "columns": columns, "rows": [], "issues": issues}

    question_by_id = {item["_id"]: item for item in questions}
    course_by_id = {item["_id"]: item for item in courses}
    decisions = {item.get("key"): item for item in plan.get("decisions") or []}
    defaults = plan.get("defaults") or {}
    mode = defaults.get("mode") or "blanks"
    if mode not in {"blanks", "override"}:
        raise AppError(422, "import.field", "Choose whether defaults fill blanks or override.", field="defaults")
    rows = []
    data_count = 0
    for sheet_index, sheet_name, header_row, table in _selected(grid, sources):
        width = len(table[header_row - 1])
        for offset, raw in enumerate(table[header_row:], start=header_row + 1):
            if not any((cell.get("text") or cell.get("formula")) for cell in raw):
                continue
            data_count += 1
            if data_count > 10_000:
                raise AppError(422, "import.too_large", "The file has more than 10,000 data rows.")
            key = f"{sheet_index}:{offset}"
            rows.append(
                _review_row(
                    key,
                    sheet_index,
                    sheet_name,
                    offset,
                    raw,
                    width,
                    by_id,
                    mappings,
                    plan,
                    question_by_id,
                    course_by_id,
                    decisions.get(key) or {},
                    defaults,
                    mode,
                )
            )
    _mark_duplicates(rows, students, admissions, prospects, course_by_id)
    return {"phase": "review", "columns": columns, "rows": rows, "issues": []}


def _review_row(
    key,
    sheet_index,
    sheet_name,
    row_number,
    raw,
    width,
    by_id,
    mappings,
    plan,
    question_by_id,
    course_by_id,
    decision,
    defaults,
    mode,
) -> dict:
    errors = []
    values: dict[str, str] = {}
    originals: dict[str, str] = {}
    answers = []
    formulas = []
    corrections = decision.get("values") or {}
    for col_index in range(width):
        column_id = f"{sheet_index}:{col_index}"
        column = by_id.get(column_id)
        if column is None:
            continue
        target = mappings.get(column_id) or ""
        if target in {"", "ignore"}:
            continue
        cell = raw[col_index] if col_index < len(raw) else {"text": ""}
        formula_key = f"{column_id}:{row_number}"
        text, cell_errors = _cell_text(cell, plan, formula_key, column["label"])
        if cell.get("formula"):
            chosen = (plan.get("formulas") or {}).get(formula_key) or {}
            formulas.append(
                {
                    "key": formula_key,
                    "label": column["label"],
                    "cached": cell.get("cached") or "",
                    "use": chosen.get("use") or "",
                    "value": chosen.get("value") or "",
                }
            )
        errors.extend(cell_errors)
        if target in corrections:
            originals[target] = text
            text = str(corrections.get(target) or "")
        if target.startswith("question:"):
            question_id = target.split(":", 1)[1]
            question = question_by_id.get(question_id)
            if question is None:
                errors.append(_issue(column["label"], target, "That question is no longer available."))
                continue
            interpreted, date_error = _interpret_date(text, plan.get("date_format") or "", column["label"], target)
            if date_error:
                errors.append(date_error)
            answers.append({"question_id": question_id, "label": question.get("label") or "", "value": interpreted})
            continue
        interpreted, date_error = _interpret_date(text, plan.get("date_format") or "", column["label"], target)
        if date_error and target == "date_of_birth":
            errors.append(date_error)
        elif date_error is None and target == "date_of_birth":
            text = interpreted
        values[target] = " ".join(text.split())
    course_id = _apply_defaults(values, originals, defaults, mode, course_by_id)
    course_raw = values.get("course") or ""
    if course_raw and not course_id:
        chosen = (plan.get("courses") or {}).get(course_raw) or ""
        folded = name_key(course_raw)
        exact = [
            item
            for item in course_by_id.values()
            if (item.get("name_key") or name_key(item.get("name") or "")) == folded
        ]
        if chosen and chosen in course_by_id:
            course_id = chosen
        elif len(exact) == 1:
            course_id = exact[0]["_id"]
        else:
            errors.append(_issue("Course", "course", f"Choose a course for {course_raw}."))
    if not course_id:
        errors.append(_issue("Course", "course", "Choose a course."))
    gender_raw = values.get("gender") or ""
    gender = ""
    if gender_raw:
        gender = next((item for item in GENDERS if item.casefold() == gender_raw.casefold()), "")
        if not gender:
            errors.append(_issue("Gender", "gender", f"Choose Female, Male, or Other for {gender_raw}."))
    if not (values.get("name") or "").strip():
        errors.append(_issue("Name", "name", "Enter the name."))
    phone = values.get("phone") or ""
    if _SCIENTIFIC.match(phone.strip()):
        errors.append(_issue("Contact number", "phone", "This contact was stored in scientific notation. Enter the full number."))
    try:
        from app.admissions.routes import AdmissionBody, _admission_contact, _clean_answers

        body = AdmissionBody(
            name=values.get("name") or " ",
            phone=phone,
            email=values.get("email") or "",
            date_of_birth=values.get("date_of_birth") or "",
            gender=gender,
            course_id=course_id or "pending",
            guardian_name=values.get("guardian_name") or "",
            guardian_phone=values.get("guardian_phone") or "",
            street=values.get("street") or "",
            place=values.get("place") or "",
            district=values.get("district") or "",
            state=values.get("state") or "",
            pin=values.get("pin") or "",
        )
        if (values.get("name") or "").strip():
            cleaned_contact = _admission_contact(body)
            values["email"] = cleaned_contact["email"]
            values["date_of_birth"] = cleaned_contact["date_of_birth"]
            values["pin"] = cleaned_contact["pin"]
    except AppError as exc:
        errors.append(_issue(exc.details.get("field") or "Value", exc.details.get("field") or "value", exc.message))
    course_questions = [
        item for item in question_by_id.values() if item.get("course_id") and item.get("course_id") == course_id
    ]
    business_questions = [item for item in question_by_id.values() if not item.get("course_id")]
    course_answers = []
    business_answers = []
    for answer in answers:
        question = question_by_id.get(answer["question_id"]) or {}
        if question.get("course_id"):
            if question.get("course_id") != course_id:
                errors.append(
                    _issue(answer.get("label") or "Answer", answer["question_id"], "That question belongs to another course.")
                )
                continue
            course_answers.append(answer)
        else:
            business_answers.append(answer)
    try:
        from app.admissions.routes import AnswerBody, _clean_answers

        course_answers = _clean_answers(
            course_questions, [AnswerBody(**item) for item in course_answers], require=False
        )
        business_answers = _clean_answers(
            business_questions, [AnswerBody(**item) for item in business_answers], require=False
        )
    except AppError as exc:
        errors.append(_issue(exc.details.get("field") or "Answer", "answers", exc.message))
    action = decision.get("action") or ""
    status = "blocked" if errors else "valid"
    if action == "skip":
        status = "skipped"
    return {
        "key": key,
        "sheet": sheet_name,
        "sheet_index": sheet_index,
        "row": row_number,
        "status": status,
        "action": "skip" if action == "skip" else (action or "create"),
        "explicit": bool(action),
        "student_id": decision.get("student_id") or "",
        "prospect_id": decision.get("prospect_id") or "",
        "episode_note": decision.get("episode_note") or "",
        "values": {
            "name": " ".join((values.get("name") or "").split()),
            "phone": " ".join((values.get("phone") or "").split()),
            "email": " ".join((values.get("email") or "").split()),
            "course_id": course_id,
            "course_name": course_by_id.get(course_id, {}).get("name") or "",
            "course_raw": course_raw,
            "date_of_birth": values.get("date_of_birth") or "",
            "gender": gender,
            "guardian_name": values.get("guardian_name") or "",
            "guardian_phone": values.get("guardian_phone") or "",
            "street": values.get("street") or "",
            "place": values.get("place") or "",
            "district": values.get("district") or "",
            "state": values.get("state") or "",
            "pin": values.get("pin") or "",
        },
        "originals": originals,
        "course_answers": course_answers,
        "business_answers": business_answers,
        "answers": course_answers + business_answers,
        "errors": errors,
        "warnings": _warnings(raw, sheet_index, row_number, mappings, by_id),
        "formulas": formulas,
        "candidates": [],
        "readiness": "",
        "_course_questions": course_questions,
        "_business_questions": business_questions,
    }


def _mark_duplicates(rows, students, admissions, prospects, course_by_id) -> None:
    created_keys: dict[str, dict] = {}
    for row in rows:
        if row["status"] == "skipped":
            continue
        values = row["values"]
        phone = phone_key(values.get("phone") or "")
        folded = name_key(values.get("name") or "")
        candidates = []
        for student in students:
            attributes = []
            same_phone = bool(phone and phone == (student.get("phone_key") or phone_key(student.get("phone") or "")))
            same_name = bool(folded and folded == (student.get("name_key") or ""))
            if same_phone and same_name:
                attributes.append("Same name and contact number")
            elif same_phone:
                attributes.append("Same contact number")
            elif same_name:
                attributes.append("Same name")
            if attributes:
                candidates.append(
                    {
                        "kind": "student",
                        "id": student["_id"],
                        "name": student.get("display_name") or student.get("name") or "",
                        "whatsapp": student.get("phone") or "",
                        "code": student.get("student_code") or "",
                        "attributes": attributes,
                        "linkable": same_phone and same_name,
                    }
                )
        for prospect in prospects:
            attributes = []
            if phone and phone == (prospect.get("whatsapp_key") or ""):
                attributes.append("Same contact number")
            if folded and folded == (prospect.get("name_key") or ""):
                attributes.append("Same name")
            if phone and folded and attributes:
                candidates.append(
                    {
                        "kind": "prospect",
                        "id": prospect["_id"],
                        "name": prospect.get("name") or "",
                        "whatsapp": prospect.get("whatsapp") or "",
                        "code": "",
                        "attributes": attributes,
                        "linkable": True,
                    }
                )
        for earlier in created_keys.values():
            if phone and phone == earlier["phone"] and folded == earlier["name"] and values.get("course_id") == earlier["course_id"]:
                candidates.append(
                    {
                        "kind": "application",
                        "id": f"row:{earlier['key']}",
                        "name": earlier["label"],
                        "whatsapp": earlier["phone_text"],
                        "code": "",
                        "attributes": ["Another row in this file for the same person and course"],
                        "linkable": False,
                    }
                )
        for existing in admissions:
            if (existing.get("status") or "open") != "open":
                continue
            same_person = phone and phone == (existing.get("phone_key") or "") and folded == (existing.get("name_key") or "")
            same_course = (existing.get("course_id") or "") == (values.get("course_id") or "")
            if same_person and same_course:
                candidates.append(
                    {
                        "kind": "application",
                        "id": existing["_id"],
                        "name": existing.get("name") or "",
                        "whatsapp": existing.get("phone") or "",
                        "code": existing.get("reference") or "",
                        "attributes": ["Open application for this person and course"],
                        "linkable": False,
                    }
                )
        row["candidates"] = candidates
        if row["status"] == "blocked":
            _readiness(row)
            continue
        action = row["action"] or "create"
        student_matches = [item for item in candidates if item["kind"] == "student"]
        needs_choice = student_matches or any(item["kind"] == "application" for item in candidates)
        if needs_choice and action == "create" and not row.get("explicit"):
            row["status"] = "blocked"
            row["errors"].append(
                _issue("", "action", "Choose a separate application, a matching student, or skip. A shared name or phone is not proof.")
            )
            _readiness(row)
            continue
        if action == "link":
            allowed = {item["id"] for item in candidates if item.get("linkable") and item["kind"] == "student"}
            if (row.get("student_id") or "") not in allowed:
                row["status"] = "blocked"
                row["errors"].append(_issue("", "student_id", "Choose a student with the same name and contact number."))
            else:
                row["values"]["match_decision"] = "attach"
        elif action == "prospect":
            allowed = {item["id"] for item in candidates if item["kind"] == "prospect" and item.get("linkable")}
            if (row.get("prospect_id") or "") not in allowed:
                row["status"] = "blocked"
                row["errors"].append(_issue("", "prospect_id", "Choose one of the suggested prospects."))
        elif action == "create" and student_matches and row.get("explicit"):
            row["values"]["match_decision"] = "create"
        duplicates = [item for item in candidates if item["kind"] == "application"]
        if duplicates and action != "skip" and not (row.get("episode_note") or "").strip():
            label = course_by_id.get(values.get("course_id") or "", {}).get("name") or "this course"
            row["status"] = "blocked"
            row["errors"].append(
                _issue("", "episode_note", f"An open application already exists for {label}. Explain this application or skip the row.")
            )
        if action == "create" and row["status"] != "blocked":
            created_keys[row["key"]] = {
                "key": row["key"],
                "phone": phone,
                "phone_text": values.get("phone") or "",
                "name": folded,
                "label": values.get("name") or "",
                "course_id": values.get("course_id") or "",
            }
        if row["errors"] and row["status"] != "skipped":
            row["status"] = "blocked"
        _readiness(row)


def _readiness(row: dict) -> None:
    from app.admissions.routes import admission_readiness, admission_requirements

    values = row["values"]
    draft = {
        "status": "open",
        "phone": values.get("phone") or "",
        "course_id": values.get("course_id") or "",
        "course_answers": row.get("course_answers") or [],
        "business_answers": row.get("business_answers") or [],
        "match_decision": values.get("match_decision") or "",
        "match_student_id": row.get("student_id") or "",
    }
    requirements = admission_requirements(
        draft, row.get("_course_questions") or [], row.get("_business_questions") or []
    )
    row["readiness"] = admission_readiness(draft, requirements, batch_open=False)
    row["requirement_messages"] = [item["message"] for item in requirements]


def _public_row(item: dict) -> dict:
    return {
        "key": item["key"],
        "sheet": item["sheet"],
        "row": item["row"],
        "status": item["status"],
        "action": item["action"],
        "student_id": item.get("student_id") or "",
        "prospect_id": item.get("prospect_id") or "",
        "episode_note": item.get("episode_note") or "",
        "values": item.get("values") or {},
        "originals": item.get("originals") or {},
        "answers": item.get("answers") or [],
        "errors": item.get("errors") or [],
        "warnings": item.get("warnings") or [],
        "formulas": item.get("formulas") or [],
        "candidates": item.get("candidates") or [],
        "readiness": item.get("readiness") or "",
    }


async def _visible_courses(request, user) -> list[dict]:
    from app.admissions.enquiry_import import _visible_courses as courses

    return await courses(request, user)


async def _questions(request, user) -> list[dict]:
    from app.admissions.routes import _form_questions, db

    course_questions = await db(request).course_questions.find({"institute_id": user["institute_id"]}).to_list(length=500)
    business = await _form_questions(request, user["institute_id"], "admission")
    return course_questions + business


async def _operation(request, user, operation_id: str) -> dict:
    from app.admissions.routes import db

    row = await db(request).admission_imports.find_one({"_id": operation_id, "institute_id": user["institute_id"]})
    if row is None:
        raise AppError(404, "not_found", "That import was not found.")
    return row


async def _context(request, user, row: dict) -> tuple[dict, dict]:
    from app.admissions.routes import db

    if _expired(row):
        raise AppError(422, "import.expired", "This import expired. Upload the file again.")
    plan = row.get("plan") or {}
    grid = load_grid(row.get("filename") or "import.xlsx", bytes(row.get("content") or b""), plan.get("delimiter") or "")
    courses = await _visible_courses(request, user)
    questions = await _questions(request, user)
    students = await db(request).students.find(
        {"institute_id": user["institute_id"], "archived": {"$ne": True}}
    ).to_list(length=5000)
    admissions = await db(request).admissions.find(
        {"institute_id": user["institute_id"], "status": "open"},
        {"name": 1, "name_key": 1, "phone": 1, "phone_key": 1, "course_id": 1, "status": 1, "reference": 1},
    ).to_list(length=5000)
    prospects = await db(request).prospects.find({"institute_id": user["institute_id"]}).to_list(length=5000)
    reviewed = evaluate_plan(grid, plan, courses, questions, students, admissions, prospects)
    return grid, {"courses": courses, "questions": questions, "reviewed": reviewed}


async def present_operation(request, user, row: dict) -> dict:
    from app.admissions.routes import db

    plan = row.get("plan") or {}
    expired = _expired(row)
    base = {
        "id": row["_id"],
        "revision": row.get("revision") or 1,
        "filename": row.get("filename") or "",
        "format": row.get("format") or "",
        "delimiter": (plan.get("delimiter") or row.get("delimiter") or ""),
        "detected_delimiter": row.get("detected_delimiter") or "",
        "expires_at": row.get("expires_at").isoformat() if row.get("expires_at") is not None else "",
        "expired": expired,
        "status": row.get("status") or "open",
        "limits": {"bytes": 10_000_000, "rows": 10_000, "sheets": 20},
        "result": row.get("result"),
        "phase": "source",
        "sheets": [],
        "columns": [],
        "rows": [],
        "issues": [],
        "counts": {"valid": 0, "blocked": 0, "skipped": 0, "total": 0},
        "targets": [{"id": key, "label": label} for key, label in FIELD_LABELS.items()],
        "defaults": plan.get("defaults") or {"course_id": "", "interest": "", "mode": "blanks"},
        "date_format": plan.get("date_format") or "",
        "mappings": plan.get("mappings") or [],
    }
    if expired:
        base["issues"] = ["This import expired. Upload the file again."]
        return base
    grid = load_grid(row.get("filename") or "import.xlsx", bytes(row.get("content") or b""), plan.get("delimiter") or "")
    base["format"] = grid["format"]
    base["delimiter"] = grid.get("delimiter") or base["delimiter"]
    base["detected_delimiter"] = grid.get("detected_delimiter") or base["detected_delimiter"]
    base["sheets"] = [
        {
            "name": sheet["name"],
            "index": sheet["index"],
            "row_count": len(sheet["rows"]),
            "selected": any(source.get("sheet") == sheet["name"] for source in plan.get("sources") or []),
            "header_row": next(
                (
                    int(source.get("header_row") or 1)
                    for source in plan.get("sources") or []
                    if source.get("sheet") == sheet["name"]
                ),
                1,
            ),
        }
        for sheet in grid["sheets"]
    ]
    questions = await _questions(request, user)
    base["targets"].extend(
        {"id": f"question:{item['_id']}", "label": item.get("label") or "Question"} for item in questions
    )
    if not (plan.get("sources") or []):
        saved = await _saved_mappings(request, user)
        base["saved_mappings"] = saved
        return base
    _grid, context = await _context(request, user, row)
    reviewed = context["reviewed"]
    base["phase"] = reviewed["phase"]
    base["issues"] = reviewed["issues"]
    base["columns"] = [
        {
            **column,
            "target": next(
                (item.get("target") or "" for item in plan.get("mappings") or [] if item.get("column_id") == column["id"]),
                "",
            ),
        }
        for column in reviewed["columns"]
    ]
    base["rows"] = [_public_row(item) for item in reviewed["rows"]]
    base["counts"] = counts_for(reviewed["rows"])
    base["unresolved_courses"] = sorted(
        {
            item["values"].get("course_raw")
            for item in reviewed["rows"]
            if any(error.get("field") == "course" for error in item["errors"])
        }
    )
    base["saved_mappings"] = await _saved_mappings(request, user)
    return base


async def _saved_mappings(request, user) -> list[dict]:
    from app.admissions.routes import db

    saved = []
    query = {"institute_id": user["institute_id"], "$or": [{"owner_id": user["_id"]}, {"shared": True}]}
    async for mapping in db(request).admission_mappings.find(query):
        saved.append({"id": mapping["_id"], "name": mapping.get("name") or "", "shared": bool(mapping.get("shared"))})
    return saved


async def store_upload(request, user, filename: str, data: bytes) -> dict:
    from bson import ObjectId
    from bson.binary import Binary

    from app.admissions.routes import db

    grid = load_grid(filename, data)
    operation_id = str(ObjectId())
    document = {
        "_id": operation_id,
        "institute_id": user["institute_id"],
        "actor_id": user["_id"],
        "filename": filename or "import",
        "content": Binary(data),
        "format": grid["format"],
        "delimiter": grid.get("delimiter") or "",
        "detected_delimiter": grid.get("detected_delimiter") or "",
        "plan": {},
        "revision": 1,
        "status": "open",
        "result": None,
        "created_at": _now(),
        "expires_at": expiry_from(_now()),
    }
    await db(request).admission_imports.insert_one(document)
    return await present_operation(request, user, document)


async def save_plan(request, user, operation_id: str, plan: dict) -> dict:
    from app.admissions.routes import db

    row = await _operation(request, user, operation_id)
    if row.get("status") == "committed":
        raise AppError(409, "import.committed", "This import is already saved.")
    if _expired(row):
        raise AppError(422, "import.expired", "This import expired. Upload the file again.")
    if int(plan.get("revision") or 0) != int(row.get("revision") or 1):
        raise AppError(409, "import.revision", "This preview changed. Review the latest rows before continuing.")
    stored = {
        "delimiter": plan.get("delimiter") or "",
        "sources": plan.get("sources") or [],
        "mappings": plan.get("mappings") or [],
        "defaults": plan.get("defaults") or {"course_id": "", "interest": "", "mode": "blanks"},
        "courses": plan.get("courses") or {},
        "interests": plan.get("interests") or {},
        "date_format": plan.get("date_format") or "",
        "formulas": plan.get("formulas") or {},
        "decisions": plan.get("decisions") or [],
    }
    grid = load_grid(row.get("filename") or "import.xlsx", bytes(row.get("content") or b""), stored["delimiter"])
    if grid["format"] == "csv" and stored["sources"] and stored["sources"][0].get("sheet") not in {"", "CSV"}:
        raise AppError(422, "import.field", "A CSV file has no sheets to select.", field="sheet")
    if grid["format"] == "csv":
        stored["sources"] = [
            {"sheet": "CSV", "header_row": int((stored["sources"][0].get("header_row") if stored["sources"] else 1) or 1)}
        ]
    trial = dict(row)
    trial["plan"] = stored
    await _context(request, user, trial)
    revision = int(row.get("revision") or 1) + 1
    await db(request).admission_imports.update_one(
        {"_id": operation_id, "revision": row.get("revision")},
        {"$set": {"plan": stored, "revision": revision, "status": "open", "result": None}, "$unset": {"idempotency_key": "", "plan_hash": ""}},
    )
    fresh = await _operation(request, user, operation_id)
    return await present_operation(request, user, fresh)


async def commit_saved_plan(request, user, operation_id: str, revision: int, idempotency_key: str) -> dict:
    from app.admissions.routes import AdmissionBody, _save_admission, db
    from app.deps import write_audit

    if not idempotency_key:
        raise AppError(422, "import.field", "Retry with an idempotency key.", field="idempotency_key")
    row = await _operation(request, user, operation_id)
    if _expired(row):
        raise AppError(422, "import.expired", "This import expired. Upload the file again.")
    if row.get("status") == "committed" and row.get("result"):
        if row.get("idempotency_key") != idempotency_key or int(row.get("revision") or 0) != revision:
            raise AppError(409, "intake.idempotency", "This retry does not match the original import.")
        return await present_operation(request, user, row)
    if int(row.get("revision") or 0) != revision:
        raise AppError(409, "import.revision", "This preview changed. Review the latest rows before continuing.")
    plan_hash = digest_plan(row.get("plan") or {})
    if row.get("idempotency_key") and (
        row.get("idempotency_key") != idempotency_key or row.get("plan_hash") not in {"", plan_hash}
    ):
        raise AppError(409, "intake.idempotency", "This retry does not match the original import.")
    _grid, context = await _context(request, user, row)
    reviewed = context["reviewed"]["rows"]
    if any(item["status"] == "blocked" for item in reviewed):
        raise AppError(422, "import.blocked", "Correct or skip every blocked row before saving.")
    eligible = [item for item in reviewed if item["status"] == "valid"]
    claimed = await db(request).admission_imports.update_one(
        {"_id": operation_id, "revision": revision, "status": {"$in": ["open", "failed"]}},
        {"$set": {"status": "committing", "idempotency_key": idempotency_key, "plan_hash": plan_hash}},
    )
    if claimed.modified_count == 0:
        fresh = await _operation(request, user, operation_id)
        if fresh.get("status") == "committed" and fresh.get("idempotency_key") == idempotency_key:
            return await present_operation(request, user, fresh)
        if fresh.get("status") == "committing" and fresh.get("idempotency_key") == idempotency_key:
            raise AppError(409, "intake.idempotency", "That import is already in progress.")
        raise AppError(409, "import.revision", "This preview changed. Review the latest rows before continuing.")
    skipped = [
        {"key": item["key"], "sheet": item["sheet"], "row": item["row"]}
        for item in reviewed
        if item["status"] == "skipped"
    ]
    created = []
    client = request.app.state.client
    try:
        async with await client.start_session() as session:
            async with session.start_transaction():
                for item in eligible:
                    values = item["values"]
                    decision = values.get("match_decision") or ""
                    student_id = item.get("student_id") or "" if decision == "attach" else ""
                    body = AdmissionBody(
                        course_id=values.get("course_id") or "",
                        name=values.get("name") or "",
                        phone=values.get("phone") or "",
                        email=values.get("email") or "",
                        date_of_birth=values.get("date_of_birth") or "",
                        gender=values.get("gender") or "",
                        guardian_name=values.get("guardian_name") or "",
                        guardian_phone=values.get("guardian_phone") or "",
                        street=values.get("street") or "",
                        place=values.get("place") or "",
                        district=values.get("district") or "",
                        state=values.get("state") or "",
                        pin=values.get("pin") or "",
                        prospect_id=item.get("prospect_id") or "",
                        episode_note=item.get("episode_note") or "",
                        course_answers=item.get("course_answers") or [],
                        business_answers=item.get("business_answers") or [],
                    )
                    saved = await _save_admission(
                        request,
                        user,
                        None,
                        body,
                        decision=decision,
                        student_id=student_id,
                        session=session,
                        quiet=True,
                        source={"operation_id": operation_id, "sheet": item["sheet"], "row": item["row"]},
                    )
                    created.append(
                        {
                            "id": saved["id"],
                            "key": item["key"],
                            "sheet": item["sheet"],
                            "row": item["row"],
                            "name": values.get("name") or "",
                        }
                    )
                result = {"created": created, "skipped": skipped}
                await db(request).admission_imports.update_one(
                    {"_id": operation_id},
                    {"$set": {"status": "committed", "result": result}},
                    session=session,
                )
    except Exception:
        await db(request).admission_imports.update_one(
            {"_id": operation_id, "status": "committing"},
            {"$set": {"status": "failed"}},
        )
        raise
    await write_audit(
        request,
        user,
        "admission.import",
        None,
        {"count": len(created), "skipped": len(skipped), "operation_id": operation_id},
        {"institute_id": user["institute_id"]},
    )
    fresh = await _operation(request, user, operation_id)
    return await present_operation(request, user, fresh)


async def error_report(request, user, operation_id: str) -> str:
    row = await _operation(request, user, operation_id)
    _grid, context = await _context(request, user, row)
    return error_csv(context["reviewed"]["rows"])


async def remember_mapping(request, user, operation_id: str, name: str) -> dict:
    from bson import ObjectId

    from app.admissions.routes import db

    label = " ".join(name.split())
    if not label:
        raise AppError(422, "import.field", "Name the mapping.", field="name")
    row = await _operation(request, user, operation_id)
    _grid, context = await _context(request, user, row)
    if context["reviewed"]["phase"] != "review":
        raise AppError(422, "import.field", "Finish the column mapping before saving it.")
    plan = row.get("plan") or {}
    mapping_id = str(ObjectId())
    await db(request).admission_mappings.insert_one(
        {
            "_id": mapping_id,
            "institute_id": user["institute_id"],
            "owner_id": user["_id"],
            "name": label,
            "name_key": name_key(label),
            "shared": False,
            "columns": mapping_fingerprint(context["reviewed"]["columns"], plan.get("mappings") or []),
            "courses": plan.get("courses") or {},
            "interests": {},
            "date_format": plan.get("date_format") or "",
            "defaults": plan.get("defaults") or {},
            "created_at": _now(),
        }
    )
    return {"id": mapping_id, "name": label, "shared": False}


async def publish_mapping(request, user, mapping_id: str) -> dict:
    from app.admissions.routes import db

    allowed = any("user.manage" in (grant.get("actions") or []) for grant in user["grants"])
    if not allowed:
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    row = await db(request).admission_mappings.find_one({"_id": mapping_id, "institute_id": user["institute_id"]})
    if row is None:
        raise AppError(404, "not_found", "That mapping was not found.")
    await db(request).admission_mappings.update_one({"_id": mapping_id}, {"$set": {"shared": True}})
    return {"id": mapping_id, "shared": True}


async def apply_mapping(request, user, operation_id: str, mapping_id: str) -> dict:
    from app.admissions.routes import db

    operation = await _operation(request, user, operation_id)
    mapping = await db(request).admission_mappings.find_one({"_id": mapping_id, "institute_id": user["institute_id"]})
    if mapping is None or (mapping.get("owner_id") != user["_id"] and not mapping.get("shared")):
        raise AppError(404, "not_found", "That mapping was not found.")
    plan = operation.get("plan") or {}
    grid = load_grid(
        operation.get("filename") or "import.xlsx", bytes(operation.get("content") or b""), plan.get("delimiter") or ""
    )
    columns = column_view(grid, plan.get("sources") or [], HEADER_ALIASES)
    questions = await _questions(request, user)
    courses = await _visible_courses(request, user)
    applied = apply_saved_mapping(columns, mapping, questions, courses)
    merged = {
        "revision": operation.get("revision") or 1,
        "delimiter": plan.get("delimiter") or "",
        "sources": plan.get("sources") or [],
        "mappings": applied["mappings"],
        "defaults": applied["defaults"],
        "courses": applied["courses"],
        "interests": {},
        "date_format": applied["date_format"],
        "formulas": plan.get("formulas") or {},
        "decisions": [],
    }
    saved = await save_plan(request, user, operation_id, merged)
    saved["stale"] = applied["stale"]
    return saved
