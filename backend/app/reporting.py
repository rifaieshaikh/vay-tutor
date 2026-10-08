from __future__ import annotations

import hashlib
from io import BytesIO

from openpyxl import Workbook

from app.acl import allows
from app.calculating import (
    aggregate,
    band,
    dense_ranks,
    display_percentage,
    percentage,
    percentage_change,
    selected_attempts,
)


async def policy_for(db, institute_id: str) -> dict:
    policy = await db.policies.find_one({"institute_id": institute_id}, sort=[("version", -1)])
    return policy or {"version": 1, "bands": {"danger_below": 40, "safe_above": 60}, "aggregate": "maximum-marks-weighted", "passing_threshold": None}


async def hydrate(db, results: list[dict]) -> list[dict]:
    sheet_ids = list({item.get("marksheet_id") for item in results if item.get("marksheet_id")})
    sheets = {}
    if sheet_ids:
        for sheet in await db.marksheets.find({"_id": {"$in": sheet_ids}}).to_list(length=len(sheet_ids)):
            sheets[sheet["_id"]] = sheet
    rows = []
    for result in results:
        sheet = sheets.get(result.get("marksheet_id"), {})
        row = dict(result)
        row["id"] = result["_id"]
        row["exam_date"] = result.get("exam_date") or sheet.get("exam_date")
        row["title"] = result.get("title") or sheet.get("title") or sheet.get("status")
        row["assessment_id"] = result.get("assessment_id") or sheet.get("assessment_id")
        row["exam_type"] = result.get("exam_type") or sheet.get("exam_type")
        row["maximum"] = result.get("maximum") if result.get("maximum") is not None else sheet.get("maximum")
        row["attempt_kind"] = result.get("attempt_kind") or "original"
        row["published"] = sheet.get("status") == "published" or result.get("active") is True
        row["policy_version"] = sheet.get("policy_version")
        rows.append(row)
    return rows


def present(row: dict, policy: dict, rank: int | None, batch_rank: int | None) -> dict:
    exact = percentage(row.get("score"), row.get("maximum")) if row.get("status") == "scored" else None
    return {
        "id": row["id"],
        "subject_id": row.get("subject_id"),
        "paper_id": row.get("paper_id"),
        "batch_id": row.get("batch_id"),
        "status": row.get("status"),
        "score": row.get("score"),
        "maximum": row.get("maximum"),
        "percentage": display_percentage(exact),
        "band": band(exact, policy) if row.get("status") == "scored" else None,
        "rank": rank,
        "batch_rank": batch_rank,
        "rank_label": "Cohort rank" if rank is not None else None,
        "exam_date": row.get("exam_date"),
        "title": row.get("title"),
        "exam_type": row.get("exam_type"),
        "attempt": row.get("attempt_kind") or "original",
        "assessment_id": row.get("assessment_id"),
        "marksheet_id": row.get("marksheet_id"),
        "included_in_total": row.get("counts_in_aggregate") is not False,
    }


def comparisons(rows: list[dict], outside: list[dict] | None = None) -> list[dict]:
    outside = outside or []
    included = {row["id"] for row in rows}
    grouped: dict[str, list[dict]] = {}
    for row in list(rows) + list(outside):
        key = row.get("assessment_id") or row["id"]
        grouped.setdefault(key, []).append(row)
    items = []
    for group in grouped.values():
        ordered = sorted(group, key=lambda item: (str(item.get("exam_date") or ""), item.get("revision") or 0))
        if len(ordered) < 2 or ordered[-1]["id"] not in included:
            continue
        items.append(
            {
                "title": ordered[-1].get("title"),
                "original_percentage": display_percentage(percentage(ordered[0].get("score"), ordered[0].get("maximum"))),
                "latest_percentage": display_percentage(percentage(ordered[-1].get("score"), ordered[-1].get("maximum"))),
                "change": percentage_change(ordered[0], ordered[-1]),
                "baseline_outside_period": ordered[0]["id"] not in included,
            }
        )
    return items


def ranks_for(row: dict, siblings: list[dict]) -> tuple[int | None, int | None]:
    if row.get("status") != "scored":
        return None, None
    cohort = dense_ranks(siblings)
    same_batch = [item for item in siblings if item.get("batch_id") == row.get("batch_id")]
    batch = dense_ranks(same_batch)
    combined = cohort.get(row["id"])
    per_batch = batch.get(row["id"]) if len({item.get("batch_id") for item in siblings}) > 1 else None
    return combined, per_batch


def matches(row: dict, filters: dict) -> bool:
    for field in ("branch_id", "course_id", "batch_id", "subject_id", "paper_id", "exam_type"):
        if filters.get(field) and row.get(field) != filters[field]:
            return False
    exam_date = str(row.get("exam_date") or "")
    if filters.get("exam_date") and exam_date != filters["exam_date"]:
        return False
    if filters.get("exam_date_from") and exam_date < filters["exam_date_from"]:
        return False
    if filters.get("exam_date_to") and (not exam_date or exam_date > filters["exam_date_to"]):
        return False
    attempt = filters.get("attempt")
    if attempt in {"original", "retest"} and (row.get("attempt_kind") or "original") != attempt:
        return False
    return True


def view_sections(level: str, rows: list[dict], enrollments: list[dict], names: dict[str, str], policy: dict | None = None) -> list[dict]:
    key = {
        "institute": "branch_id",
        "branch": "course_id",
        "course": "batch_id",
        "batch": "subject_id",
        "subject": "paper_id",
        "paper": "assessment_id",
    }[level]
    grouped: dict[str, list[dict]] = {}
    for row in selected_attempts(rows):
        grouped.setdefault(row.get(key) or "", []).append(row)
    sections = []
    for section_id, section_rows in grouped.items():
        people = {row.get("student_id") for row in section_rows if row.get("student_id")}
        summary = aggregate(section_rows, policy)
        sections.append(
            {
                "id": section_id,
                "label": names.get(section_id) or section_id or "Unassigned",
                "students": len(people),
                "results": len(section_rows),
                "percentage": summary["percentage"],
                "band": summary["band"],
                "coverage": f"{summary['scored']}/{summary['expected']}" if summary["expected"] else "0/0",
                "missing": summary["missing"],
                "absent": summary["absent"],
                "marksheet_ids": sorted({row["marksheet_id"] for row in section_rows if row.get("marksheet_id")}),
            }
        )
    if level == "batch":
        listed = {item["student_id"] for item in enrollments}
        for section in sections:
            section["listed_students"] = len(listed)
    return sections


async def names_for(db, rows: list[dict]) -> dict[str, str]:
    names = {}
    for collection, field in (
        ("branches", "branch_id"),
        ("courses", "course_id"),
        ("batches", "batch_id"),
        ("subjects", "subject_id"),
        ("papers", "paper_id"),
        ("assessments", "assessment_id"),
    ):
        ids = list({row.get(field) for row in rows if row.get(field)})
        if not ids:
            continue
        for item in await db[collection].find({"_id": {"$in": ids}}).to_list(length=len(ids)):
            names[item["_id"]] = item.get("name") or item.get("title") or (f"Paper {item['number']}" if item.get("number") is not None else item["_id"])
    return names


def authorized(rows: list[dict], grants: list[dict], action: str) -> list[dict]:
    visible = []
    for row in rows:
        resource = {
            "institute_id": row.get("institute_id"),
            "branch_id": row.get("branch_id"),
            "course_id": row.get("course_id"),
            "batch_id": row.get("batch_id"),
            "subject_id": row.get("subject_id"),
            "paper_id": row.get("paper_id"),
        }
        if allows(grants, action, resource):
            visible.append(row)
    return visible


def participation_summary(rows: list[dict], eligible_by_batch: dict[str, set[str]]) -> dict:
    """One opportunity per confirmed eligible student and assessment. Exemptions stay out of the denominator."""
    cohorts: dict[tuple, dict] = {}
    for row in selected_attempts(rows):
        batch_id = row.get("batch_id") or ""
        if batch_id not in eligible_by_batch:
            continue
        assessment = row.get("assessment_id") or row.get("marksheet_id") or row.get("id")
        cohorts.setdefault((assessment, batch_id), {})[row.get("student_id")] = row.get("status")
    scored = missing = absent = exempt = 0
    for (_assessment, batch_id), statuses in cohorts.items():
        for student_id in eligible_by_batch[batch_id]:
            status = statuses.get(student_id)
            if status == "exempt":
                exempt += 1
            elif status == "scored":
                scored += 1
            elif status == "absent":
                absent += 1
            else:
                missing += 1
    expected = scored + missing + absent
    ratio = round(scored / expected, 4) if expected else None
    return {
        "participation": ratio,
        "participation_scored": scored,
        "participation_expected": expected,
        "participation_missing": missing,
        "participation_absent": absent,
        "participation_exempt": exempt,
        "participation_basis": "confirmed eligible students for each assessment in this report",
    }


SECTION_FIELD = {
    "institute": "course_id",
    "branch": "course_id",
    "course": "batch_id",
    "batch": "subject_id",
    "subject": "paper_id",
    "paper": "assessment_id",
}


def _ranked_students(by_student: dict[str, list[dict]], policy: dict, limit: int) -> tuple[list[dict], int]:
    items = []
    for student_id, student_rows in by_student.items():
        if not student_id:
            continue
        summary = aggregate(student_rows, policy)
        if summary["band"] != "safe":
            continue
        items.append(
            {
                "student_id": student_id,
                "percentage": summary["percentage"],
                "band": summary["band"],
                "scored": summary["scored"],
                "expected": summary["expected"],
            }
        )
    items.sort(key=lambda item: (-item["percentage"], item["student_id"]))
    return items[:limit], len(items)


def student_boards(level: str, rows: list[dict], policy: dict, names: dict[str, str], limit: int = 20, attention_page: int = 1) -> dict:
    """Highest students, and danger results grouped by the next academic step."""
    field = SECTION_FIELD[level]
    chosen = selected_attempts(rows)
    grouped: dict[str, dict[str, list[dict]]] = {}
    section_of = {row.get("id"): (row.get(field) or "") for row in rows}
    for row in chosen:
        section = section_of.get(row.get("id"), "")
        grouped.setdefault(section, {}).setdefault(row.get("student_id") or "", []).append(row)
    danger_by_section: dict[str, list[dict]] = {}
    for item in attention(rows, policy):
        danger_by_section.setdefault(section_of.get(item["id"], ""), []).append(item)
    boards = []
    for section_id in set(grouped) | set(danger_by_section):
        shown, total = _ranked_students(grouped.get(section_id, {}), policy, limit)
        danger_items = danger_by_section.get(section_id, [])
        pages = max(1, (len(danger_items) + limit - 1) // limit) if danger_items else 1
        current = min(max(attention_page, 1), pages)
        boards.append(
            {
                "id": section_id,
                "label": names.get(section_id) or section_id or "Unassigned",
                "top_students": shown,
                "top_student_count": total,
                "attention": danger_items,
                "attention_result_count": len(danger_items),
                "attention_student_count": len({item.get("student_id") for item in danger_items if item.get("student_id")}),
                "attention_page": current,
                "attention_pages": pages,
            }
        )
    boards = [item for item in boards if item["top_student_count"] or item["attention_result_count"]]
    boards.sort(key=lambda item: item["label"])
    return {"top_students": [], "top_student_count": 0, "boards": boards}


def attention(rows: list[dict], policy: dict) -> list[dict]:
    items = []
    for row in rows:
        if row.get("status") != "scored":
            continue
        exact = percentage(row.get("score"), row.get("maximum"))
        label = band(exact, policy)
        if label != "danger":
            continue
        items.append(
            {
                "id": row["id"],
                "student_id": row.get("student_id"),
                "title": row.get("title"),
                "score": row.get("score"),
                "maximum": row.get("maximum"),
                "percentage": display_percentage(exact),
                "band": label,
                "marksheet_id": row.get("marksheet_id"),
            }
        )
    items.sort(key=lambda item: (item["percentage"] is None, item["percentage"] if item["percentage"] is not None else 0, item.get("title") or ""))
    return items


def rank_page(rows: list[dict], page: int, size: int = 20) -> dict:
    scored = [row for row in rows if row.get("status") == "scored" and row.get("score") is not None]
    places = dense_ranks(scored)
    ordered = sorted(scored, key=lambda row: (places.get(row["id"], 10**6), str(row.get("title") or "")))
    start = max(page - 1, 0) * size
    pages = max(1, (len(ordered) + size - 1) // size) if ordered else 1
    return {
        "page": page,
        "pages": pages,
        "items": [
            {
                "id": row["id"],
                "title": row.get("title"),
                "score": row.get("score"),
                "maximum": row.get("maximum"),
                "rank": places.get(row["id"]),
            }
            for row in ordered[start : start + size]
        ],
    }


def export_bytes(kind: str, lines: list[str]) -> tuple[bytes, str]:
    if kind == "report_xlsx":
        book = Workbook()
        sheet = book.active
        sheet.title = "Progress cards"
        for line in lines:
            sheet.append([line])
        buffer = BytesIO()
        book.save(buffer)
        return buffer.getvalue(), "progress-cards.xlsx"
    return _pdf(lines), "progress-cards.pdf"


def _pdf(lines: list[str]) -> bytes:
    chunks = [lines[index : index + 40] for index in range(0, max(len(lines), 1), 40)]
    font_id = 3 + len(chunks) * 2
    kids = " ".join(f"{3 + index * 2} 0 R" for index in range(len(chunks)))
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        f"<< /Type /Pages /Kids [{kids}] /Count {len(chunks)} >>".encode(),
    ]
    for index, chunk in enumerate(chunks):
        content_id = 4 + index * 2
        page = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Contents {content_id} 0 R /Resources << /Font << /F1 {font_id} 0 R >> >> >>"
        )
        objects.append(page.encode())
        objects.append(_pdf_stream(chunk, index + 1, len(chunks)))
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    output = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, body in enumerate(objects, start=1):
        offsets.append(len(output))
        output += f"{index} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(output)
    output += f"xref\n0 {len(objects) + 1}\n".encode()
    output += b"0000000000 65535 f \n"
    for offset in offsets[1:]:
        output += f"{offset:010d} 00000 n \n".encode()
    trailer = f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    output += trailer.encode()
    return bytes(output)


def _pdf_stream(lines: list[str], page: int, pages: int) -> bytes:
    commands = ["BT", "/F1 11 Tf", "1 0 0 1 48 760 Tm", f"(Page {page} of {pages}) Tj"]
    y_pos = 736
    for line in lines:
        safe = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")[:110]
        commands.append(f"1 0 0 1 48 {y_pos} Tm ({safe}) Tj")
        y_pos -= 16
    commands.append("ET")
    stream = "\n".join(commands).encode("latin-1", errors="replace")
    return b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream"


def file_digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()
