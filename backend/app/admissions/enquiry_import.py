"""Mapped enquiry import. Upload and preview never create enquiries."""

from __future__ import annotations

import csv
import hashlib
import io
import re
import zipfile
from datetime import datetime, timedelta, timezone
from io import BytesIO

from openpyxl import Workbook, load_workbook

from app.errors import AppError
from app.security import name_key, phone_key

LIMIT_BYTES = 10_000_000
LIMIT_ROWS = 10_000
LIMIT_SHEETS = 20
RETENTION_DAYS = 30
DECOMPRESSED_LIMIT = 50_000_000

FIELD_LABELS = {
    "name": "Name",
    "whatsapp": "WhatsApp",
    "email": "Email",
    "present_institution": "Present institution",
    "course": "Interested course",
    "interest": "Interest",
    "references": "References",
    "details": "Notes",
}
HEADER_ALIASES = {
    "name": "name",
    "student name": "name",
    "prospect": "name",
    "whatsapp": "whatsapp",
    "whatsapp number": "whatsapp",
    "contact": "whatsapp",
    "contact number": "whatsapp",
    "phone": "whatsapp",
    "mobile": "whatsapp",
    "email": "email",
    "e-mail": "email",
    "present institution": "present_institution",
    "institution": "present_institution",
    "college": "present_institution",
    "interested course": "course",
    "course": "course",
    "course name": "course",
    "level of interest": "interest",
    "interest": "interest",
    "references": "references",
    "reference": "references",
    "details": "details",
    "other details": "details",
    "notes": "details",
    "note": "details",
}
INTERESTS = ("High", "Medium", "Low")
DATE_FORMATS = {"DMY": "%d/%m/%Y", "MDY": "%m/%d/%Y", "YMD": "%Y-%m-%d"}
_AMBIGUOUS_DATE = re.compile(r"^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$")
_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_SCIENTIFIC = re.compile(r"^[+-]?\d+(\.\d+)?[eE][+-]?\d+$")


def template_workbook() -> bytes:
    book = Workbook()
    sheet = book.active
    sheet.title = "Enquiries"
    sheet.append(
        ["Name", "WhatsApp", "Email", "Present institution", "Interested course", "Interest", "References", "Notes"]
    )
    sheet.append(
        [
            "Example Student",
            "09876543210",
            "student@example.com",
            "Town College",
            "CA Foundation",
            "High",
            "Friend",
            "Asked for a brochure",
        ]
    )
    buffer = BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def load_grid(filename: str, data: bytes, delimiter: str = "") -> dict:
    if not data:
        raise AppError(422, "import.empty", "The file is empty.")
    if len(data) > LIMIT_BYTES:
        raise AppError(422, "import.too_large", "The file is larger than 10 MB.")
    lower = (filename or "").lower()
    if lower.endswith(".csv"):
        return {"format": "csv", **_csv_grid(data, delimiter)}
    if lower.endswith(".xlsx"):
        _guard_zip(data)
        return {"format": "xlsx", "delimiter": "", "sheets": _xlsx_sheets(data)}
    raise AppError(422, "import.file_type", "Upload an .xlsx workbook or a CSV file.")


def column_view(grid: dict, sources: list[dict], aliases: dict | None = None) -> list[dict]:
    chosen = _selected(grid, sources)
    lookup = HEADER_ALIASES if aliases is None else aliases
    columns = []
    seen_headings: dict[tuple[int, str], int] = {}
    for sheet_index, sheet_name, header_row, rows in chosen:
        if header_row < 1 or header_row > len(rows):
            raise AppError(422, "import.header", f"Choose a header row on {sheet_name}.", field="header_row")
        header = rows[header_row - 1]
        for col_index, cell in enumerate(header):
            heading = (cell.get("text") or "").strip()
            fold = " ".join(heading.split()).casefold()
            count = seen_headings.get((sheet_index, fold), 0) + 1 if fold else 1
            if fold:
                seen_headings[(sheet_index, fold)] = count
            label = heading or _column_name(col_index)
            if fold and count > 1:
                label = f"{heading} ({count})"
            samples = []
            for data_row in rows[header_row : header_row + 3]:
                if col_index < len(data_row) and data_row[col_index].get("text"):
                    samples.append(data_row[col_index]["text"])
            columns.append(
                {
                    "id": f"{sheet_index}:{col_index}",
                    "sheet": sheet_name,
                    "sheet_index": sheet_index,
                    "heading": heading,
                    "label": label,
                    "samples": samples,
                    "suggestion": lookup.get(fold, ""),
                }
            )
    return columns


def evaluate_plan(
    grid: dict,
    plan: dict,
    courses: list[dict],
    questions: list[dict],
    prospects: list[dict],
    enquiries: list[dict],
) -> dict:
    sources = plan.get("sources") or []
    if not sources:
        return {"phase": "source", "columns": [], "rows": [], "issues": []}
    columns = column_view(grid, sources)
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
            if data_count > LIMIT_ROWS:
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
    _mark_duplicates(rows, prospects, enquiries, course_by_id)
    return {"phase": "review", "columns": columns, "rows": rows, "issues": []}


def counts_for(rows: list[dict]) -> dict:
    blocked = sum(1 for row in rows if row["status"] == "blocked")
    skipped = sum(1 for row in rows if row["status"] == "skipped")
    valid = sum(1 for row in rows if row["status"] == "valid")
    return {"valid": valid, "blocked": blocked, "skipped": skipped, "total": len(rows)}


def error_csv(rows: list[dict]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["Sheet", "Row", "Column", "Field", "Message"])
    for row in rows:
        for issue in row.get("errors") or []:
            writer.writerow(
                [
                    row.get("sheet") or "",
                    row.get("row") or "",
                    _csv_safe(issue.get("column") or ""),
                    _csv_safe(issue.get("field") or ""),
                    _csv_safe(issue.get("message") or ""),
                ]
            )
    return buffer.getvalue()


def mapping_fingerprint(columns: list[dict], mappings: list[dict]) -> list[dict]:
    targets = {item.get("column_id"): item.get("target") or "" for item in mappings}
    saved = []
    for column in columns:
        target = targets.get(column["id"]) or ""
        if not target or target == "ignore":
            continue
        saved.append({"heading": (column.get("heading") or "").casefold(), "target": target})
    return saved


def apply_saved_mapping(columns: list[dict], saved: dict, questions: list[dict], courses: list[dict]) -> dict:
    question_ids = {item["_id"] for item in questions}
    course_ids = {item["_id"] for item in courses}
    by_heading: dict[str, list[dict]] = {}
    for column in columns:
        by_heading.setdefault((column.get("heading") or "").casefold(), []).append(column)
    mappings = []
    stale = []
    used_columns = set()
    for item in saved.get("columns") or []:
        heading = item.get("heading") or ""
        target = item.get("target") or ""
        if target.startswith("question:") and target.split(":", 1)[1] not in question_ids:
            stale.append(f"{heading or target} no longer matches a question.")
            continue
        found = [column for column in by_heading.get(heading, []) if column["id"] not in used_columns]
        if not found:
            stale.append(f"No column headed {heading or 'that field'}.")
            continue
        mappings.append({"column_id": found[0]["id"], "target": target})
        used_columns.add(found[0]["id"])
    courses_map = {}
    for raw, course_id in (saved.get("courses") or {}).items():
        if course_id in course_ids:
            courses_map[raw] = course_id
        else:
            stale.append(f"{raw} no longer matches a course.")
    return {
        "mappings": mappings,
        "courses": courses_map,
        "interests": dict(saved.get("interests") or {}),
        "date_format": saved.get("date_format") or "",
        "defaults": saved.get("defaults") or {"course_id": "", "interest": "", "mode": "blanks"},
        "stale": stale,
    }


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
            text = interpreted
            answers.append({"question_id": question_id, "label": question.get("label") or "", "value": text})
            continue
        interpreted, date_error = _interpret_date(text, plan.get("date_format") or "", column["label"], target)
        if date_error:
            errors.append(date_error)
        if interpreted != text:
            originals[target] = text
        values[target] = interpreted
    for field, replacement in corrections.items():
        if field.startswith("question:"):
            continue
        if field not in values and field in FIELD_LABELS:
            values[field] = str(replacement or "")
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
            errors.append(_issue("Interested course", "course", f"Choose a course for {course_raw}."))
    interest_raw = values.get("interest") or ""
    interest = ""
    if interest_raw:
        canonical = next((item for item in INTERESTS if item.casefold() == interest_raw.casefold()), "")
        mapped = (plan.get("interests") or {}).get(interest_raw) or ""
        if mapped in INTERESTS:
            interest = mapped
        elif canonical:
            interest = canonical
        else:
            errors.append(_issue("Interest", "interest", f"Choose High, Medium, or Low for {interest_raw}."))
    if not (values.get("name") or "").strip():
        errors.append(_issue("Name", "name", "Enter the name."))
    else:
        try:
            from app.admissions.routes import _email, _text

            _text(values.get("name"), 120, "name")
            if values.get("whatsapp"):
                _text(values.get("whatsapp"), 30, "whatsapp")
            if values.get("email"):
                values["email"] = _email(values.get("email"))
        except AppError as exc:
            errors.append(_issue(exc.details.get("field") or "Value", exc.details.get("field") or "value", exc.message))
    phone = values.get("whatsapp") or ""
    if _SCIENTIFIC.match(phone.strip()):
        errors.append(
            _issue("WhatsApp", "whatsapp", "This contact was stored in scientific notation. Enter the full number.")
        )
    try:
        from app.admissions.routes import AnswerBody, _clean_answers

        cleaned = _clean_answers(list(question_by_id.values()), [AnswerBody(**item) for item in answers], require=False)
    except AppError as exc:
        errors.append(_issue(exc.details.get("field") or "Answer", "answers", exc.message))
        cleaned = answers
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
        "prospect_id": decision.get("prospect_id") or "",
        "episode_note": decision.get("episode_note") or "",
        "values": {
            "name": " ".join((values.get("name") or "").split()),
            "whatsapp": " ".join((values.get("whatsapp") or "").split()),
            "email": " ".join((values.get("email") or "").split()),
            "present_institution": " ".join((values.get("present_institution") or "").split()),
            "course_id": course_id,
            "course_name": course_by_id.get(course_id, {}).get("name") or "",
            "course_raw": course_raw,
            "interest": interest,
            "interest_raw": interest_raw,
            "references": (values.get("references") or "").strip(),
            "details": (values.get("details") or "").strip(),
        },
        "originals": originals,
        "answers": cleaned,
        "errors": errors,
        "warnings": _warnings(raw, sheet_index, row_number, mappings, by_id),
        "formulas": formulas,
        "candidates": [],
    }


def _mark_duplicates(rows: list[dict], prospects: list[dict], enquiries: list[dict], course_by_id: dict) -> None:
    open_by_prospect: dict[str, list[dict]] = {}
    for enquiry in enquiries:
        if (enquiry.get("status") or "open") != "open" or enquiry.get("admission_id"):
            continue
        open_by_prospect.setdefault(enquiry.get("prospect_id") or "", []).append(enquiry)
    created_keys: dict[str, dict] = {}
    for row in rows:
        if row["status"] == "skipped":
            continue
        values = row["values"]
        phone = phone_key(values.get("whatsapp") or "")
        folded = name_key(values.get("name") or "")
        candidates = []
        for prospect in prospects:
            attributes = []
            if phone and phone == (prospect.get("whatsapp_key") or ""):
                attributes.append("Same contact number")
            if folded and folded == (prospect.get("name_key") or ""):
                attributes.append("Same name")
            if attributes:
                candidates.append(
                    {
                        "kind": "prospect",
                        "id": prospect["_id"],
                        "name": prospect.get("name") or "",
                        "whatsapp": prospect.get("whatsapp") or "",
                        "attributes": attributes,
                    }
                )
        for earlier in created_keys.values():
            attributes = []
            if phone and phone == earlier["phone"]:
                attributes.append("Same contact number in this file")
            if folded and folded == earlier["name"] and not phone:
                attributes.append("Same name in this file")
            if attributes:
                candidates.append(
                    {
                        "kind": "row",
                        "id": f"row:{earlier['key']}",
                        "name": earlier["label"],
                        "whatsapp": earlier["whatsapp"],
                        "attributes": attributes,
                    }
                )
        row["candidates"] = candidates
        if row["status"] == "blocked":
            continue
        action = row["action"] or "create"
        if candidates and action == "create" and not row.get("explicit"):
            explicit = False
            if not explicit:
                row["status"] = "blocked"
                row["errors"].append(
                    _issue("", "action", "Choose whether to create a new person, link a suggested person, or skip.")
                )
                continue
        if action == "link":
            prospect_id = row.get("prospect_id") or ""
            allowed = {item["id"] for item in candidates}
            if prospect_id not in allowed:
                row["status"] = "blocked"
                row["errors"].append(_issue("", "prospect_id", "Choose one of the suggested people."))
                continue
            _require_episode(
                row, prospect_id, values.get("course_id") or "", open_by_prospect, created_keys, course_by_id
            )
        elif action == "create":
            created_keys[row["key"]] = {
                "key": row["key"],
                "phone": phone,
                "name": folded,
                "label": values.get("name") or "",
                "whatsapp": values.get("whatsapp") or "",
                "course_id": values.get("course_id") or "",
                "prospect_id": f"row:{row['key']}",
            }
        if row["errors"] and row["status"] != "skipped":
            row["status"] = "blocked"


def _course_label(course_id: str, course_by_id: dict) -> str:
    if not course_id:
        return "an unspecified course"
    return course_by_id.get(course_id, {}).get("name") or "this course"


def _require_episode(row, prospect_id, course_id, open_by_prospect, created_keys, course_by_id) -> None:
    existing = []
    if prospect_id.startswith("row:"):
        earlier = created_keys.get(prospect_id.split(":", 1)[1])
        if earlier and earlier["course_id"] == course_id:
            existing.append(_course_label(course_id, course_by_id))
    else:
        for enquiry in open_by_prospect.get(prospect_id, []):
            if (enquiry.get("course_id") or "") == course_id:
                existing.append(_course_label(course_id, course_by_id))
    if existing and not (row.get("episode_note") or "").strip():
        row["status"] = "blocked"
        row["errors"].append(
            _issue(
                "",
                "episode_note",
                f"An open enquiry already exists for {existing[0]}. Explain this new enquiry or skip the row.",
            )
        )


def _apply_defaults(values, originals, defaults, mode, course_by_id) -> str:
    course_id = defaults.get("course_id") or ""
    interest = defaults.get("interest") or ""
    forced = ""
    if course_id and course_id in course_by_id:
        if mode == "override" or not (values.get("course") or "").strip():
            if values.get("course"):
                originals["course"] = values["course"]
            values["course"] = ""
            forced = course_id
    if interest in INTERESTS:
        if mode == "override" or not (values.get("interest") or "").strip():
            if values.get("interest"):
                originals["interest"] = values["interest"]
            values["interest"] = interest
    return forced


def _cell_text(cell: dict, plan: dict, cell_key: str, label: str) -> tuple[str, list[dict]]:
    if not cell.get("formula"):
        text = cell.get("text") or ""
        if cell.get("scientific"):
            return text, [_issue(label, "value", "This value looks truncated. Enter the original text.")]
        return text, []
    chosen = (plan.get("formulas") or {}).get(cell_key) or {}
    use = chosen.get("use") or ""
    if use == "plain":
        return str(chosen.get("value") or ""), []
    if use == "cached" and cell.get("cached"):
        return str(cell.get("cached") or ""), []
    if use == "cached":
        return "", [_issue(label, "value", "The workbook has no cached result for this formula. Enter a plain value.")]
    return "", [_issue(label, "value", "This cell is a formula. Accept its cached value or enter a plain value.")]


def _interpret_date(text: str, date_format: str, label: str, field: str) -> tuple[str, dict | None]:
    raw = (text or "").strip()
    if not raw or _ISO_DATE.match(raw):
        return raw, None
    match = _AMBIGUOUS_DATE.match(raw)
    if not match:
        return raw, None
    first, second = int(match.group(1)), int(match.group(2))
    year = int(match.group(3))
    if year < 1000:
        return raw, _issue(label, field, "Use a four-digit year or choose a date format.")
    if date_format == "YMD":
        return raw, _issue(label, field, "This date is not in YMD order.")
    if date_format == "DMY":
        day, month = first, second
    elif date_format == "MDY":
        month, day = first, second
    elif first > 12:
        day, month = first, second
    elif second > 12:
        month, day = first, second
    else:
        return raw, _issue(label, field, "Choose DMY, MDY, or YMD for this date.")
    try:
        parsed = datetime(year, month, day).date()
    except ValueError:
        return raw, _issue(label, field, "That date is not valid.")
    return parsed.isoformat(), None


def _warnings(raw, sheet_index, row_number, mappings, by_id) -> list[dict]:
    warnings = []
    for col_index, cell in enumerate(raw):
        column = by_id.get(f"{sheet_index}:{col_index}")
        target = mappings.get(f"{sheet_index}:{col_index}") or ""
        if column and target in {"whatsapp", "phone"} and cell.get("numeric") and not cell.get("formula"):
            warnings.append(
                {
                    "column": column["label"],
                    "field": target,
                    "message": "This contact was stored as a number, so missing leading zeros cannot be recovered.",
                }
            )
    return warnings


def _selected(grid: dict, sources: list[dict]) -> list[tuple[int, str, int, list]]:
    if len(sources) > LIMIT_SHEETS:
        raise AppError(422, "import.too_large", "Select 20 sheets or fewer.")
    sheets = grid.get("sheets") or []
    by_name = {item["name"]: item for item in sheets}
    chosen = []
    seen = set()
    for source in sources:
        name = source.get("sheet") or ""
        if name in seen:
            raise AppError(422, "import.field", "Select each sheet once.", field="sheet")
        seen.add(name)
        sheet = by_name.get(name)
        if sheet is None:
            raise AppError(422, "import.field", f"There is no sheet named {name}.", field="sheet")
        header_row = int(source.get("header_row") or 1)
        chosen.append((sheet["index"], sheet["name"], header_row, sheet["rows"]))
    return chosen


def _csv_grid(data: bytes, delimiter: str) -> dict:
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise AppError(422, "import.encoding", "Save the CSV as UTF-8 and upload it again.") from exc
    detected = _detect_delimiter(text)
    chosen = delimiter if delimiter in {",", ";", "\t"} else detected
    reader = csv.reader(io.StringIO(text), delimiter=chosen)
    rows = []
    for record in reader:
        rows.append([_plain(value) for value in record])
    width = max((len(row) for row in rows), default=0)
    for row in rows:
        while len(row) < width:
            row.append(_plain(""))
    if not rows:
        raise AppError(422, "import.empty", "The CSV file has no rows.")
    return {"delimiter": chosen, "detected_delimiter": detected, "sheets": [{"name": "CSV", "index": 0, "rows": rows}]}


def _detect_delimiter(text: str) -> str:
    line = next((item for item in text.splitlines() if item.strip()), "")
    counts = {",": line.count(","), ";": line.count(";"), "\t": line.count("\t")}
    best = max(counts, key=lambda item: counts[item])
    return best if counts[best] else ","


def _xlsx_sheets(data: bytes) -> list[dict]:
    try:
        formulas = load_workbook(BytesIO(data), data_only=False, read_only=True)
        cached = load_workbook(BytesIO(data), data_only=True, read_only=True)
    except zipfile.BadZipFile as exc:
        raise AppError(422, "import.malformed", "The workbook could not be read.") from exc
    except Exception as exc:
        raise AppError(422, "import.malformed", "The workbook could not be read.") from exc
    sheets = []
    try:
        if len(formulas.worksheets) > 50:
            raise AppError(422, "import.too_large", "The workbook has too many sheets to inspect.")
        for index, sheet in enumerate(formulas.worksheets):
            cached_sheet = cached[sheet.title]
            rows = []
            cached_rows = cached_sheet.iter_rows()
            for cells, cached_cells in zip(sheet.iter_rows(), cached_rows):
                built = []
                for cell, cached_cell in zip(cells, cached_cells):
                    built.append(_xlsx_cell(cell, cached_cell.value if cached_cell is not None else None))
                rows.append(built)
            sheets.append({"name": sheet.title, "index": index, "rows": rows})
    finally:
        formulas.close()
        cached.close()
    if not sheets:
        raise AppError(422, "import.empty", "The workbook has no sheets.")
    return sheets


def _xlsx_cell(cell, cached) -> dict:
    value = cell.value
    if getattr(cell, "data_type", "") == "f" or (isinstance(value, str) and value.startswith("=")):
        cached_text = "" if cached is None else _number_text(cached)[0]
        return {"text": "", "formula": True, "cached": cached_text, "scientific": False, "numeric": False}
    text, scientific, numeric = _number_text(value)
    if isinstance(value, datetime):
        text = value.date().isoformat()
        numeric = False
    return {"text": text, "formula": False, "cached": None, "scientific": scientific, "numeric": numeric}


def _number_text(value) -> tuple[str, bool, bool]:
    if value is None:
        return "", False, False
    if isinstance(value, bool):
        return ("TRUE" if value else "FALSE"), False, False
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value), False, True
    if isinstance(value, float):
        rendered = format(value, ".16g")
        scientific = "e" in rendered.lower()
        if value.is_integer() and abs(value) < 10**15:
            return str(int(value)), scientific, True
        return rendered, scientific, True
    return str(value).strip(), _SCIENTIFIC.match(str(value).strip()) is not None, False


def _plain(value: str) -> dict:
    text = str(value or "").strip()
    return {
        "text": text,
        "formula": text.startswith("="),
        "cached": None,
        "scientific": _SCIENTIFIC.match(text) is not None,
        "numeric": False,
    }


def _guard_zip(data: bytes) -> None:
    try:
        with zipfile.ZipFile(BytesIO(data)) as archive:
            total = sum(item.file_size for item in archive.infolist())
    except zipfile.BadZipFile as exc:
        raise AppError(422, "import.malformed", "The workbook could not be read.") from exc
    if total > DECOMPRESSED_LIMIT:
        raise AppError(422, "import.too_large", "The workbook expands beyond the allowed size.")


def _column_name(index: int) -> str:
    label = ""
    number = index + 1
    while number:
        number, remainder = divmod(number - 1, 26)
        label = chr(65 + remainder) + label
    return f"Column {label}"


def _issue(column: str, field: str, message: str) -> dict:
    return {"column": column, "field": field, "message": message}


def _csv_safe(value: str) -> str:
    text = str(value or "")
    if text.startswith(("=", "+", "-", "@", "\t", "\r")):
        return "'" + text
    return text


def expiry_from(moment: datetime | None = None) -> datetime:
    base = moment or datetime.now(timezone.utc)
    return base + timedelta(days=RETENTION_DAYS)


def _now():
    return datetime.now(timezone.utc)


async def _visible_courses(request, user) -> list[dict]:
    from app.admissions.routes import db, intake_course_visible

    rows = await db(request).courses.find({"institute_id": user["institute_id"]}).to_list(length=500)
    return [
        {
            "_id": item["_id"],
            "name": item.get("name") or "",
            "name_key": item.get("name_key") or name_key(item.get("name") or ""),
        }
        for item in rows
        if intake_course_visible(user["grants"], item["_id"])
    ]


async def _questions(request, user) -> list[dict]:
    from app.admissions.routes import _form_questions

    return await _form_questions(request, user["institute_id"], "enquiry")


async def _operation(request, user, operation_id: str) -> dict:
    from app.admissions.routes import db

    row = await db(request).enquiry_imports.find_one({"_id": operation_id, "institute_id": user["institute_id"]})
    if row is None:
        raise AppError(404, "not_found", "That import was not found.")
    return row


def _expired(row: dict) -> bool:
    expires = row.get("expires_at")
    if not hasattr(expires, "timestamp"):
        return False
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    return expires <= _now()


async def _context(request, user, row: dict) -> tuple[dict, dict]:
    from app.admissions.routes import db, enquiry_status

    if _expired(row):
        raise AppError(422, "import.expired", "This import expired. Upload the file again.")
    plan = row.get("plan") or {}
    grid = load_grid(
        row.get("filename") or "import.xlsx", bytes(row.get("content") or b""), plan.get("delimiter") or ""
    )
    courses = await _visible_courses(request, user)
    questions = await _questions(request, user)
    prospects = await db(request).prospects.find({"institute_id": user["institute_id"]}).to_list(length=5000)
    enquiries = []
    async for enquiry in db(request).enquiries.find(
        {"institute_id": user["institute_id"]},
        {"prospect_id": 1, "course_id": 1, "status": 1, "admission_id": 1, "name": 1},
    ):
        enquiry["status"] = enquiry_status(enquiry)
        enquiries.append(enquiry)
    reviewed = evaluate_plan(grid, plan, courses, questions, prospects, enquiries)
    return grid, {
        "courses": courses,
        "questions": questions,
        "reviewed": reviewed,
        "grid": grid,
    }


def _public_row(item: dict) -> dict:
    return {
        "key": item["key"],
        "sheet": item["sheet"],
        "row": item["row"],
        "status": item["status"],
        "action": item["action"],
        "prospect_id": item.get("prospect_id") or "",
        "episode_note": item.get("episode_note") or "",
        "values": item.get("values") or {},
        "originals": item.get("originals") or {},
        "answers": item.get("answers") or [],
        "errors": item.get("errors") or [],
        "warnings": item.get("warnings") or [],
        "formulas": item.get("formulas") or [],
        "candidates": item.get("candidates") or [],
    }


async def present_operation(request, user, row: dict) -> dict:
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
        "limits": {"bytes": LIMIT_BYTES, "rows": LIMIT_ROWS, "sheets": LIMIT_SHEETS},
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
    grid = load_grid(
        row.get("filename") or "import.xlsx", bytes(row.get("content") or b""), plan.get("delimiter") or ""
    )
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
        return base
    _grid, context = await _context(request, user, row)
    reviewed = context["reviewed"]
    base["phase"] = reviewed["phase"]
    base["issues"] = reviewed["issues"]
    base["columns"] = [
        {
            **column,
            "target": next(
                (
                    item.get("target") or ""
                    for item in plan.get("mappings") or []
                    if item.get("column_id") == column["id"]
                ),
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
    base["unresolved_interests"] = sorted(
        {
            item["values"].get("interest_raw")
            for item in reviewed["rows"]
            if any(error.get("field") == "interest" for error in item["errors"])
        }
    )
    saved = []
    from app.admissions.routes import db

    query = {
        "institute_id": user["institute_id"],
        "$or": [{"owner_id": user["_id"]}, {"shared": True}],
    }
    async for mapping in db(request).enquiry_mappings.find(query):
        saved.append({"id": mapping["_id"], "name": mapping.get("name") or "", "shared": bool(mapping.get("shared"))})
    base["saved_mappings"] = saved
    return base


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
    await db(request).enquiry_imports.insert_one(document)
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
            {
                "sheet": "CSV",
                "header_row": int((stored["sources"][0].get("header_row") if stored["sources"] else 1) or 1),
            }
        ]
    trial = dict(row)
    trial["plan"] = stored
    await _context(request, user, trial)
    revision = int(row.get("revision") or 1) + 1
    await db(request).enquiry_imports.update_one(
        {"_id": operation_id, "revision": row.get("revision")},
        {
            "$set": {"plan": stored, "revision": revision, "status": "open", "result": None},
            "$unset": {"idempotency_key": "", "plan_hash": ""},
        },
    )
    fresh = await _operation(request, user, operation_id)
    # Evaluating raises when the plan itself is invalid, after the revision is stored.
    return await present_operation(request, user, fresh)


async def commit_saved_plan(request, user, operation_id: str, revision: int, idempotency_key: str) -> dict:
    from app.admissions.routes import _insert_enquiry, db
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
    claimed = await db(request).enquiry_imports.update_one(
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
    created = []
    skipped = [
        {"key": item["key"], "sheet": item["sheet"], "row": item["row"]}
        for item in reviewed
        if item["status"] == "skipped"
    ]
    client = request.app.state.client
    try:
        async with await client.start_session() as session:
            async with session.start_transaction():
                prospects_for_rows: dict[str, str] = {}
                for item in eligible:
                    values = item["values"]
                    fields = {
                        "name": values.get("name") or "",
                        "name_key": name_key(values.get("name") or ""),
                        "whatsapp": values.get("whatsapp") or "",
                        "whatsapp_key": phone_key(values.get("whatsapp") or ""),
                        "email": values.get("email") or "",
                        "email_key": name_key(values.get("email") or ""),
                        "present_institution": values.get("present_institution") or "",
                        "course_id": values.get("course_id") or "",
                        "interest": values.get("interest") or "",
                        "references": values.get("references") or "",
                        "details": values.get("details") or "",
                        "answers": item.get("answers") or [],
                    }
                    prospect_id = item.get("prospect_id") or ""
                    if item["action"] == "link" and prospect_id.startswith("row:"):
                        prospect_id = prospects_for_rows.get(prospect_id.split(":", 1)[1], "")
                        if not prospect_id:
                            raise AppError(
                                422,
                                "import.field",
                                "Link the row to a person created in this import.",
                                field="prospect_id",
                            )
                    if item["action"] != "link":
                        prospect_id = ""
                    before = await db(request).prospects.count_documents(
                        {"institute_id": user["institute_id"]}, session=session
                    )
                    enquiry_id = await _insert_enquiry(
                        request,
                        user,
                        fields,
                        prospect_id=prospect_id,
                        episode_note=item.get("episode_note") or "",
                        session=session,
                    )
                    stored = await db(request).enquiries.find_one({"_id": enquiry_id}, session=session)
                    prospects_for_rows[item["key"]] = stored.get("prospect_id") or ""
                    after = await db(request).prospects.count_documents(
                        {"institute_id": user["institute_id"]}, session=session
                    )
                    created.append(
                        {
                            "id": enquiry_id,
                            "key": item["key"],
                            "sheet": item["sheet"],
                            "row": item["row"],
                            "name": stored.get("name") or "",
                            "prospect_created": after > before,
                        }
                    )
                result = {"created": created, "skipped": skipped}
                await db(request).enquiry_imports.update_one(
                    {"_id": operation_id},
                    {"$set": {"status": "committed", "result": result}},
                    session=session,
                )
    except Exception:
        await db(request).enquiry_imports.update_one(
            {"_id": operation_id, "status": "committing"},
            {"$set": {"status": "failed"}},
        )
        raise
    await write_audit(
        request,
        user,
        "enquiry.import",
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
    from app.security import name_key as fold

    label = " ".join(name.split())
    if not label:
        raise AppError(422, "import.field", "Name the mapping.", field="name")
    row = await _operation(request, user, operation_id)
    _grid, context = await _context(request, user, row)
    if context["reviewed"]["phase"] != "review":
        raise AppError(422, "import.field", "Finish the column mapping before saving it.")
    plan = row.get("plan") or {}
    mapping_id = str(ObjectId())
    await db(request).enquiry_mappings.insert_one(
        {
            "_id": mapping_id,
            "institute_id": user["institute_id"],
            "owner_id": user["_id"],
            "name": label,
            "name_key": fold(label),
            "shared": False,
            "columns": mapping_fingerprint(context["reviewed"]["columns"], plan.get("mappings") or []),
            "courses": plan.get("courses") or {},
            "interests": plan.get("interests") or {},
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
    row = await db(request).enquiry_mappings.find_one({"_id": mapping_id, "institute_id": user["institute_id"]})
    if row is None:
        raise AppError(404, "not_found", "That mapping was not found.")
    await db(request).enquiry_mappings.update_one({"_id": mapping_id}, {"$set": {"shared": True}})
    return {"id": mapping_id, "shared": True}


async def apply_mapping(request, user, operation_id: str, mapping_id: str) -> dict:
    from app.admissions.routes import db

    operation = await _operation(request, user, operation_id)
    mapping = await db(request).enquiry_mappings.find_one({"_id": mapping_id, "institute_id": user["institute_id"]})
    if mapping is None or (mapping.get("owner_id") != user["_id"] and not mapping.get("shared")):
        raise AppError(404, "not_found", "That mapping was not found.")
    plan = operation.get("plan") or {}
    grid = load_grid(
        operation.get("filename") or "import.xlsx", bytes(operation.get("content") or b""), plan.get("delimiter") or ""
    )
    columns = column_view(grid, plan.get("sources") or [])
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
        "interests": applied["interests"],
        "date_format": applied["date_format"],
        "formulas": plan.get("formulas") or {},
        "decisions": [],
    }
    saved = await save_plan(request, user, operation_id, merged)
    saved["stale"] = applied["stale"]
    return saved


def digest_plan(plan: dict) -> str:
    import json

    raw = json.dumps(plan, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()
