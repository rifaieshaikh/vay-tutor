"""Rules that keep a marklist upload on the exam it was started from."""

from __future__ import annotations

from app.importing.counts import _add, _same_mark, empty_counts
from app.importing.parse import _band

_CONTEXT_CODES = {"import.heading_conflict", "import.context_conflict", "import.batch_unassigned"}
_KINDS = ("academic", "students", "enrollments", "results")


async def annotate_exam_plan(db, plan: dict, exam: dict) -> None:
    """Score the chosen sheet against the exam. The file only supplies names and marks."""
    _drop_context_blockers(plan)
    included = [sheet for sheet in plan["sheets"] if sheet.get("included")]
    active = None
    if len(included) != 1:
        plan["blockers"].append({
            "code": "import.exam_sheet",
            "message": "Include one sheet for this exam.",
        })
    else:
        sheet = included[0]
        groups = [group for group in sheet["groups"] if group.get("interpretation") != "skip_duplicate"]
        if len(groups) != 1:
            plan["blockers"].append({
                "code": "import.exam_column",
                "sheet_id": sheet["id"],
                "message": "Include one mark column for this exam. Skip the others.",
            })
        else:
            active = (sheet, groups[0])
    if active:
        await _score_exam_sheet(db, plan, exam, active[0], active[1])
    else:
        _clear_plan_counts(plan)
    planned = plan["totals"].get("planned") or empty_counts()
    plan["totals"]["updates"] = planned["results"]["update"]
    plan["ready"] = not plan["blockers"]


def _drop_context_blockers(plan: dict) -> None:
    plan["blockers"] = [item for item in plan.get("blockers") or [] if item.get("code") not in _CONTEXT_CODES]
    for sheet in plan["sheets"]:
        sheet["heading_conflict"] = False
        sheet["blockers"] = [item for item in sheet.get("blockers") or [] if item.get("code") not in _CONTEXT_CODES]
        for group in sheet["groups"]:
            group["blockers"] = [item for item in group.get("blockers") or [] if item.get("code") not in _CONTEXT_CODES]


def _clear_plan_counts(plan: dict) -> None:
    for sheet in plan["sheets"]:
        sheet["planned"] = empty_counts()
    plan["totals"]["planned"] = empty_counts()


async def _score_exam_sheet(db, plan: dict, exam: dict, sheet: dict, group: dict) -> None:
    maximum = float(exam["maximum"])
    group["maximum"] = exam["maximum"]
    batch_ids = list(exam.get("batch_ids") or [])
    rows = await db.enrollment_names.find({"batch_id": {"$in": batch_ids}}).to_list(length=5000)
    by_name: dict[str, dict[str, dict]] = {}
    for row in rows:
        by_name.setdefault(row["name_key"], {})[row["student_id"]] = row
    marksheet = await db.marksheets.find_one({"_id": exam["marksheet_id"]})
    revision = (marksheet or {}).get("active_revision") or (marksheet or {}).get("revision") or 1
    published = (marksheet or {}).get("status") == "published"
    stored = []
    if marksheet:
        stored = await db.results.find({"marksheet_id": exam["marksheet_id"]}).to_list(length=5000)
    by_student = {row["student_id"]: row for row in stored if row.get("revision") == revision}
    plan["blockers"] = [
        item for item in plan["blockers"]
        if not (item.get("code") == "import.invalid_mark" and item.get("sheet_id") == sheet["id"])
    ]

    totals = empty_counts()
    seen = {kind: set() for kind in _KINDS}
    sheet_counts = empty_counts()
    sheet_seen = {kind: set() for kind in _KINDS}
    _add(sheet_counts, "academic", "unchanged", sheet_seen["academic"], exam["marksheet_id"])
    _add(totals, "academic", "unchanged", seen["academic"], exam["marksheet_id"])

    for student in group["students"]:
        if not str(student.get("display_name") or "").strip():
            student["change"] = "skip"
            continue
        _apply_exam_maximum(student, maximum)
        result_key = f"{sheet['id']}|{group['id']}|{student.get('row')}|{student.get('name_key')}"
        if student["status"] == "invalid":
            plan["blockers"].append({
                "code": "import.invalid_mark",
                "sheet_id": sheet["id"],
                "row": student["row"],
                "message": (
                    f"{student['display_name']} on {sheet['name']} row {student['row']} "
                    f"is outside 0 to {exam['maximum']}."
                ),
            })
        matches = by_name.get(student.get("name_key") or "", {})
        if len(matches) != 1:
            if len(matches) > 1:
                student["change"] = "reject"
                plan["blockers"].append({
                    "code": "import.ambiguous_name",
                    "sheet_id": sheet["id"],
                    "row": student["row"],
                    "message": f"More than one student in these batches is named {student['display_name']}.",
                })
                _count(sheet_counts, totals, sheet_seen, seen, "results", "reject", result_key)
            else:
                student["change"] = "skip"
                _count(sheet_counts, totals, sheet_seen, seen, "results", "skip", result_key)
            continue
        person_id = next(iter(matches))
        existing = by_student.get(person_id)
        label, before = _result_label(student, existing, published)
        student["change"] = label
        student["before_score"] = before
        if label == "reject" and before is not None:
            plan["blockers"].append({
                "code": "import.correction_needed",
                "sheet_id": sheet["id"],
                "row": student["row"],
                "message": (
                    f"{student['display_name']} on {sheet['name']} is {student.get('score')} in the file "
                    f"and {before} on the published marksheet. Enter the correct score or keep the saved score."
                ),
            })
        _count(sheet_counts, totals, sheet_seen, seen, "results", label, result_key)
        person_key = f"{person_id}|{next(iter(matches.values()))['batch_id']}"
        _count(sheet_counts, totals, sheet_seen, seen, "students", "unchanged", person_key)
        _count(sheet_counts, totals, sheet_seen, seen, "enrollments", "unchanged", person_key)

    for other in sheet["groups"]:
        if other is group:
            continue
        for student in other["students"]:
            student["change"] = "skip"
            _count(
                sheet_counts, totals, sheet_seen, seen, "results", "skip",
                f"{sheet['id']}|{other['id']}|{student.get('row')}|{student.get('name_key')}",
            )
    sheet["planned"] = sheet_counts
    for other_sheet in plan["sheets"]:
        if other_sheet is not sheet:
            other_sheet["planned"] = empty_counts()
    plan["totals"]["planned"] = totals


def _count(sheet_counts, totals, sheet_seen, seen, kind: str, bucket: str, key: str) -> None:
    _add(sheet_counts, kind, bucket, sheet_seen[kind], key)
    _add(totals, kind, bucket, seen[kind], key)


def _apply_exam_maximum(student: dict, maximum: float) -> None:
    score = student.get("score")
    if not isinstance(score, (int, float)) or isinstance(score, bool):
        return
    if float(score) < 0 or float(score) > maximum:
        student["status"] = "invalid"
        student["score"] = float(score)
        student["percentage"] = None
        student["band"] = None
        return
    if student.get("status") in {"invalid", "scored"}:
        student["status"] = "scored"
        student["score"] = float(score)
        student["percentage"] = (float(score) / maximum * 100) if maximum else None
        student["band"] = _band(student["percentage"])
        student["maximum"] = maximum


def _result_label(student: dict, existing: dict | None, published: bool) -> tuple[str, float | None]:
    if existing is None:
        return ("reject", None) if published else ("insert", None)
    if student.get("correction") == "keep":
        student["score"] = existing.get("score")
        student["status"] = existing.get("status")
        student["percentage"] = existing.get("percentage")
        return "unchanged", existing.get("score")
    if _same_mark(existing, student):
        return "unchanged", existing.get("score")
    if published:
        if student.get("correction") == "replace" and str(student.get("correction_reason") or "").strip():
            return "update", existing.get("score")
        return "reject", existing.get("score")
    return "update", existing.get("score")
