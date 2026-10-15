"""Filters shared by the student directory, progress cards, and academic views."""

from __future__ import annotations

from app.acl import allows
from app.errors import AppError


def _optional_date(value: str | None) -> str:
    text = (value or "").strip()
    if not text:
        return ""
    if len(text) != 10 or text[4] != "-" or text[7] != "-":
        raise AppError(422, "report.period", "Use a real exam date.")
    return text


def _period(exam_date_from: str | None, exam_date_to: str | None) -> tuple[str, str]:
    start = _optional_date(exam_date_from)
    end = _optional_date(exam_date_to)
    if start and end and start > end:
        raise AppError(422, "report.period", "The start date must be on or before the end date.")
    return start, end


def _blank_last(value: str) -> tuple:
    text = str(value or "").casefold()
    return (text == "", text)


def _student_sort_key(item: dict, sort: str):
    name = str(item.get("display_name") or "").casefold()
    code = str(item.get("student_code") or "")
    enrollment = (item.get("enrollments") or [{}])[0] or {}
    if sort == "percentage":
        percentage = (item.get("performance") or {}).get("percentage")
        return (percentage is None, -(percentage if percentage is not None else 0), name, code)
    if sort == "exam_date":
        latest = str(item.get("latest_exam_date") or "")
        return (latest == "", "".join(chr(255 - ord(char)) for char in latest), name, code)
    if sort == "code":
        return (code, name)
    fields = {
        "branch": enrollment.get("branch_name"),
        "course": enrollment.get("course_name"),
        "batch": enrollment.get("batch_name"),
        "started": enrollment.get("started_on"),
        "ended": enrollment.get("ended_on"),
        "status": enrollment.get("status"),
    }
    if sort in fields:
        return (*_blank_last(fields[sort]), name, code)
    return (name, code)


def _report_filters(
    branch_id: str = "",
    course_id: str = "",
    batch_id: str = "",
    subject_id: str = "",
    paper_id: str = "",
    exam_type: str = "",
    exam_date_from: str = "",
    exam_date_to: str = "",
    attempt: str = "",
) -> dict:
    start, end = _period(exam_date_from, exam_date_to)
    return {
        key: value
        for key, value in {
            "branch_id": branch_id,
            "course_id": course_id,
            "batch_id": batch_id,
            "subject_id": subject_id,
            "paper_id": paper_id,
            "exam_type": exam_type,
            "exam_date_from": start,
            "exam_date_to": end,
            "attempt": attempt if attempt in {"original", "retest"} else "",
        }.items()
        if value
    }


def _card_context(raw: dict | None) -> dict:
    raw = raw or {}
    card: dict[str, str] = {}
    student_id = str(raw.get("student_id") or "").strip()
    if student_id:
        card["student_id"] = student_id
    start, end = _period(
        None if raw.get("exam_date_from") is None else str(raw.get("exam_date_from")),
        None if raw.get("exam_date_to") is None else str(raw.get("exam_date_to")),
    )
    if start:
        card["exam_date_from"] = start
    if end:
        card["exam_date_to"] = end
    attempt = str(raw.get("attempt") or "")
    if attempt in {"original", "retest"}:
        card["attempt"] = attempt
    exam_type = str(raw.get("exam_type") or "").strip()
    if exam_type:
        card["exam_type"] = exam_type
    return card


def _export_covers_student(user: dict, enrollments: list[dict], scope: dict, action: str) -> bool:
    for enrollment in enrollments:
        if scope.get("branch_id") and scope["branch_id"] != enrollment.get("branch_id"):
            continue
        if scope.get("course_id") and scope["course_id"] != enrollment.get("course_id"):
            continue
        if scope.get("batch_id") and scope["batch_id"] != enrollment.get("batch_id"):
            continue
        resource = {
            "institute_id": enrollment["institute_id"],
            "branch_id": enrollment.get("branch_id"),
            "course_id": enrollment.get("course_id"),
            "batch_id": enrollment.get("batch_id"),
            "subject_id": scope.get("subject_id"),
            "paper_id": scope.get("paper_id"),
        }
        named = bool(scope.get("subject_id") or scope.get("paper_id"))
        view = allows(user["grants"], "progress_card.view", resource, not named)
        export = allows(user["grants"], action, resource, not named)
        if view and export:
            return True
    return False

