"""A workbook import where each sheet is an exam for batches the user chose."""

from __future__ import annotations

import math
from datetime import datetime

from app.academics.curriculum import active_exam_type, active_kind, public_exam_types, public_kinds
from app.importing.counts import _add, _same_mark, empty_counts
from app.importing.parse import _band
from app.security import name_key

_CONTEXT_CODES = {"import.heading_conflict", "import.context_conflict", "import.batch_unassigned", "import.invalid_mark"}
_KINDS = ("academic", "students", "enrollments", "results")


async def bundle_context(db, job: dict) -> dict:
    institute_id = job["institute_id"]
    course_id = job.get("course_id") or ""
    batch_ids = list(job.get("batch_ids") or [])
    subjects = await db.subjects.find({"institute_id": institute_id, "course_id": course_id}).to_list(length=200)
    subject_ids = [item["_id"] for item in subjects]
    papers = []
    if subject_ids:
        papers = await db.papers.find({"institute_id": institute_id, "subject_id": {"$in": subject_ids}}).to_list(length=400)
    batches = await db.batches.find({"_id": {"$in": batch_ids}, "institute_id": institute_id}).to_list(length=50)
    return {
        "branch_id": job.get("branch_id") or "",
        "course_id": course_id,
        "batch_ids": batch_ids,
        "batches": [{"id": item["_id"], "name": item.get("name") or ""} for item in batches],
        "subjects": [
            {
                "id": subject["_id"],
                "name": subject.get("name") or "",
                "papers": [
                    {"id": paper["_id"], "name": paper.get("name") or ""}
                    for paper in papers if paper.get("subject_id") == subject["_id"]
                ],
                "units": [
                    {"id": unit.get("id"), "name": unit.get("name") or "", "kind": unit.get("kind") or ""}
                    for unit in subject.get("units") or [] if unit.get("id")
                ],
            }
            for subject in subjects
        ],
    }


async def annotate_bundle_plan(db, plan: dict, job: dict) -> None:
    """Match each included sheet to enrolled students and to an exam when one already exists."""
    _drop_context_blockers(plan)
    institute_id = job["institute_id"]
    course_id = job.get("course_id") or ""
    selected = list(job.get("batch_ids") or [])
    choices = (job.get("decisions") or {}).get("sheets") or {}
    subjects = {
        item["_id"]: item
        for item in await db.subjects.find({"institute_id": institute_id, "course_id": course_id}).to_list(length=200)
    }
    subject_ids = list(subjects)
    papers = []
    if subject_ids:
        papers = await db.papers.find({"institute_id": institute_id, "subject_id": {"$in": subject_ids}}).to_list(length=400)
    paper_ids = {item["_id"] for item in papers}
    institute = await db.institutes.find_one({"_id": institute_id})
    kinds = public_kinds((institute or {}).get("curriculum_kinds"))
    exam_types = public_exam_types((institute or {}).get("exam_types"))
    exams = await db.exams.find({"institute_id": institute_id, "course_id": course_id}).to_list(length=500)
    extra_batches = [batch_id for exam in exams for batch_id in (exam.get("batch_ids") or [])]
    known_batches = list(set(selected) | set(extra_batches))
    names = await db.enrollment_names.find({"batch_id": {"$in": known_batches}}).to_list(length=5000)
    wanted = {
        student.get("name_key")
        for sheet in plan["sheets"]
        for group in sheet["groups"]
        for student in group["students"]
        if student.get("name_key")
    }
    directory: dict[str, list] = {}
    if wanted:
        people = await db.students.find(
            {"institute_id": institute_id, "name_key": {"$in": list(wanted)}}
        ).to_list(length=5000)
        for person in people:
            directory.setdefault(person.get("name_key") or "", []).append(person)
    batches = {
        item["_id"]: item
        for item in await db.batches.find({"_id": {"$in": known_batches}, "institute_id": institute_id}).to_list(length=100)
    }
    sheet_rows = await db.marksheets.find({"institute_id": institute_id, "exam_id": {"$exists": True}}).to_list(length=500)
    marksheets = {item["_id"]: item for item in sheet_rows}
    scored_sheets = set()
    if marksheets:
        cursor = db.results.find({"marksheet_id": {"$in": list(marksheets)}}, {"marksheet_id": 1})
        async for row in cursor:
            scored_sheets.add(row["marksheet_id"])
    totals = empty_counts()
    seen = {kind: set() for kind in _KINDS}
    identities: dict[tuple, list[str]] = {}
    for sheet in plan["sheets"]:
        sheet["planned"] = empty_counts()
        sheet["similar_exams"] = []
        sheet["matched_exam"] = None
        if not sheet.get("included"):
            continue
        choice = choices.get(sheet["id"]) or {}
        exam_fields, problems = _exam_fields(sheet, choice, subjects, paper_ids, kinds, exam_types)
        sheet["exam"] = exam_fields
        for problem in problems:
            plan["blockers"].append({"code": "import.exam_fields", "sheet_id": sheet["id"], "message": problem})
        active = [group for group in sheet["groups"] if group.get("interpretation") != "skip_duplicate"]
        if len(active) != 1:
            plan["blockers"].append({
                "code": "import.exam_column",
                "sheet_id": sheet["id"],
                "message": f"Keep one mark column on {sheet['name']} and skip the others.",
            })
            continue
        group = active[0]
        target = _target_exam(exams, marksheets, exam_fields, selected, choice.get("use_exam_id") or "")
        sheet["matched_exam"] = _public_match(target) if target else None
        if sheet["matched_exam"] and target:
            status = (marksheets.get(target.get("marksheet_id")) or {}).get("status") or "draft"
            sheet["matched_exam"]["status"] = status
        sheet["similar_exams"] = _similar(exams, marksheets, exam_fields, target)
        if target and (marksheets.get(target.get("marksheet_id")) or {}).get("status") == "submitted":
            plan["blockers"].append({
                "code": "import.submitted",
                "sheet_id": sheet["id"],
                "message": f"{sheet['name']} matches a submitted marksheet. Leave this sheet out until it is a draft or published.",
            })
        match_batches = list(target.get("batch_ids") or []) if choice.get("use_exam_id") and target else selected
        if choice.get("use_exam_id") and target is None:
            plan["blockers"].append({
                "code": "import.exam_fields",
                "sheet_id": sheet["id"],
                "message": f"The exam chosen for {sheet['name']} is not on this course.",
            })
        locked = bool(target and target.get("marksheet_id") in scored_sheets)
        maximum = _working_maximum(exam_fields, target, locked)
        if maximum is None:
            continue
        entered = exam_fields.get("maximum")
        if locked and entered not in (None, "") and float(entered) != float(target.get("maximum")):
            plan["blockers"].append({
                "code": "import.maximum",
                "sheet_id": sheet["id"],
                "message": (
                    f"{target.get('title')} is out of {target.get('maximum')}. "
                    "That maximum stays because the exam already has scores."
                ),
            })
        group["maximum"] = maximum
        key = ("exam", target["_id"]) if target else _identity(exam_fields, selected)
        identities.setdefault(key, []).append(sheet["name"])
        await _score_sheet(
            db, plan, sheet, group, names, batches, target, marksheets, choice,
            match_batches, maximum, totals, seen, directory,
        )
    for names_on_key in identities.values():
        if len(names_on_key) < 2:
            continue
        plan["blockers"].append({
            "code": "import.exam_duplicate",
            "message": f"{' and '.join(names_on_key)} describe the same exam. Leave one of them out.",
        })
    plan["totals"]["planned"] = totals
    plan["totals"]["updates"] = totals["results"]["update"]
    plan["ready"] = not plan["blockers"]


def _drop_context_blockers(plan: dict) -> None:
    plan["blockers"] = [item for item in plan.get("blockers") or [] if item.get("code") not in _CONTEXT_CODES]
    for sheet in plan["sheets"]:
        sheet["heading_conflict"] = False
        sheet["blockers"] = [item for item in sheet.get("blockers") or [] if item.get("code") not in _CONTEXT_CODES]
        for group in sheet["groups"]:
            group["blockers"] = [item for item in group.get("blockers") or [] if item.get("code") not in _CONTEXT_CODES]


def _exam_fields(sheet: dict, choice: dict, subjects: dict, paper_ids: set, kinds: list, exam_types: list) -> tuple[dict, list[str]]:
    saved = choice.get("exam") or {}
    scope = saved.get("scope") or {}
    kind = str(scope.get("kind") or "subject")
    item_ids = [item for item in (scope.get("item_ids") or []) if item]
    raw_maximum = saved.get("maximum")
    if raw_maximum in (None, ""):
        detected = next((group.get("maximum") for group in sheet["groups"] if group.get("maximum")), None)
        raw_maximum = detected
    maximum = None
    if raw_maximum not in (None, ""):
        maximum = float(raw_maximum)
    title = " ".join(str(saved.get("title") or sheet.get("suggested_title") or sheet["name"]).split())
    exam_date = str(saved.get("exam_date") or sheet.get("exam_date") or "")
    subject_id = str(saved.get("subject_id") or "")
    problems = []
    if not title:
        problems.append(f"Enter a name for {sheet['name']}.")
    if not exam_date:
        problems.append(f"Enter the exam date for {sheet['name']}.")
    else:
        try:
            datetime.strptime(exam_date, "%Y-%m-%d")
        except ValueError:
            problems.append(f"Enter the exam date for {sheet['name']} as a calendar date.")
    if maximum is None or not math.isfinite(maximum) or maximum <= 0:
        problems.append(f"Enter the maximum for {sheet['name']}.")
    subject = subjects.get(subject_id)
    if subject is None:
        problems.append(f"Choose a subject for {sheet['name']}.")
    paper_id = ""
    if kind == "subject":
        item_ids = []
    elif subject is not None:
        kind_row = active_kind(kinds, kind)
        if kind_row is None:
            problems.append(f"Choose a subject partition for {sheet['name']}.")
        elif not item_ids:
            problems.append(f"Choose the {kind_row['label'].lower()} items for {sheet['name']}.")
        elif kind == "paper" or kind_row["storage"] == "paper":
            if any(item not in paper_ids for item in item_ids):
                problems.append(f"Choose papers of {subject.get('name')} for {sheet['name']}.")
            elif len(item_ids) == 1:
                paper_id = item_ids[0]
        else:
            units = {unit.get("id"): unit.get("kind") for unit in subject.get("units") or []}
            if any(units.get(item) != kind for item in item_ids):
                problems.append(f"Choose items of one type for {sheet['name']}.")
    exam_kind = saved.get("exam_kind")
    if exam_kind is not None:
        exam_kind = str(exam_kind or "")
        if active_exam_type(exam_types, exam_kind) is None:
            problems.append(f"Choose an exam type for {sheet['name']}.")
    else:
        exam_kind = ""
    return {
        "title": title,
        "exam_date": exam_date,
        "maximum": maximum,
        "subject_id": subject_id,
        "scope": {"kind": kind, "item_ids": item_ids},
        "paper_id": paper_id,
        "exam_kind": exam_kind,
        "use_exam_id": choice.get("use_exam_id") or "",
    }, problems


def _identity(exam_fields: dict, batch_ids: list[str]) -> tuple:
    scope = exam_fields.get("scope") or {}
    return (
        name_key(exam_fields.get("title") or ""),
        scope.get("kind") or "subject",
        exam_fields.get("subject_id") or "",
        tuple(sorted(scope.get("item_ids") or [])),
        exam_fields.get("exam_date") or "",
        float(exam_fields["maximum"]) if exam_fields.get("maximum") not in (None, "") else None,
        tuple(sorted(batch_ids)),
    )


def _exam_identity(exam: dict) -> tuple:
    scope = exam.get("scope") or {}
    return (
        name_key(exam.get("title") or ""),
        scope.get("kind") or exam.get("exam_type") or "subject",
        exam.get("subject_id") or "",
        tuple(sorted(scope.get("item_ids") or [])),
        exam.get("exam_date") or "",
        float(exam.get("maximum")),
        tuple(sorted(exam.get("batch_ids") or [])),
    )


def _target_exam(exams: list, marksheets: dict, exam_fields: dict, selected: list[str], use_exam_id: str) -> dict | None:
    if use_exam_id:
        return next((item for item in exams if item["_id"] == use_exam_id), None)
    if exam_fields.get("maximum") in (None, ""):
        return None
    wanted = _identity(exam_fields, selected)
    return next((item for item in exams if _exam_identity(item) == wanted), None)


def _public_match(exam: dict) -> dict:
    return {
        "id": exam["_id"],
        "title": exam.get("title") or "",
        "exam_date": exam.get("exam_date") or "",
        "maximum": exam.get("maximum"),
        "subject_id": exam.get("subject_id") or "",
        "scope": exam.get("scope") or {"kind": "subject", "item_ids": []},
        "exam_kind": exam.get("exam_kind") or "",
        "batch_ids": list(exam.get("batch_ids") or []),
        "marksheet_id": exam.get("marksheet_id") or "",
    }


def _similar(exams: list, marksheets: dict, exam_fields: dict, target: dict | None) -> list[dict]:
    found = []
    for exam in exams:
        if target and exam["_id"] == target["_id"]:
            continue
        same_name = name_key(exam.get("title") or "") == name_key(exam_fields.get("title") or "")
        same_subject = (exam.get("subject_id") or "") == (exam_fields.get("subject_id") or "")
        if same_name and same_subject and exam_fields.get("subject_id"):
            row = _public_match(exam)
            row["status"] = (marksheets.get(exam.get("marksheet_id")) or {}).get("status") or "draft"
            found.append(row)
    return found


def _working_maximum(exam_fields: dict, target: dict | None, locked: bool):
    if locked and target:
        return float(target.get("maximum"))
    if exam_fields.get("maximum") in (None, ""):
        return None
    return float(exam_fields["maximum"])


async def _score_sheet(
    db, plan, sheet, group, enrollment_rows, batches, target, marksheets, choice,
    match_batches, maximum, totals, seen, directory,
) -> None:
    by_name: dict[str, dict[str, list[dict]]] = {}
    allowed = set(match_batches)
    for row in enrollment_rows:
        if row.get("batch_id") not in allowed:
            continue
        by_name.setdefault(row["name_key"], {}).setdefault(row["student_id"], []).append(row)
    marksheet = marksheets.get((target or {}).get("marksheet_id")) if target else None
    published = (marksheet or {}).get("status") == "published"
    revision = (marksheet or {}).get("active_revision") or (marksheet or {}).get("revision") or 1
    stored = []
    if marksheet:
        stored = await db.results.find({"marksheet_id": marksheet["_id"]}).to_list(length=5000)
    by_student = {row["student_id"]: row for row in stored if row.get("revision") == revision}
    sheet_counts = empty_counts()
    sheet_seen = {kind: set() for kind in _KINDS}
    picks = choice.get("row_batch_ids") or {}
    for student in group["students"]:
        if not str(student.get("display_name") or "").strip():
            student["change"] = "skip"
            continue
        _apply_maximum(student, maximum, sheet, plan)
        result_key = f"{sheet['id']}|{student.get('row')}|{student.get('name_key')}"
        if student.get("status") == "invalid":
            student["change"] = "reject"
            _count(sheet_counts, totals, sheet_seen, seen, "results", "reject", result_key)
            continue
        people = by_name.get(student.get("name_key") or "", {})
        if len(people) == 0:
            _plan_enrollment(
                student, directory, match_batches, batches, picks, sheet, plan, published,
                sheet_counts, totals, sheet_seen, seen, result_key,
            )
            continue
        if len(people) > 1:
            student["change"] = "reject"
            student["match"] = "ambiguous"
            plan["blockers"].append({
                "code": "import.ambiguous_name",
                "sheet_id": sheet["id"],
                "row": student["row"],
                "message": f"More than one student in the selected batches is named {student['display_name']}.",
            })
            _count(sheet_counts, totals, sheet_seen, seen, "results", "reject", result_key)
            continue
        person_id, rows = next(iter(people.items()))
        choices = []
        for row in rows:
            batch = batches.get(row["batch_id"]) or {}
            choices.append({"id": row["batch_id"], "name": batch.get("name") or row["batch_id"]})
        student["batch_choices"] = choices
        student["student_id"] = person_id
        chosen = picks.get(str(student["row"])) or picks.get(student["row"]) or ""
        if len(choices) == 1:
            chosen = choices[0]["id"]
        elif chosen not in {item["id"] for item in choices}:
            student["change"] = "reject"
            student["match"] = "choose"
            plan["blockers"].append({
                "code": "import.batch_unassigned",
                "sheet_id": sheet["id"],
                "row": student["row"],
                "message": f"Choose a batch for {student['display_name']} on {sheet['name']}.",
            })
            _count(sheet_counts, totals, sheet_seen, seen, "results", "reject", result_key)
            continue
        student["batch_id"] = chosen
        student["match"] = "enrolled"
        existing = by_student.get(person_id)
        if student.get("status") == "missing" and existing is not None:
            student["change"] = "skip"
            _count(sheet_counts, totals, sheet_seen, seen, "results", "skip", result_key)
            continue
        if student.get("status") == "missing" and existing is None:
            student["change"] = "skip"
            _count(sheet_counts, totals, sheet_seen, seen, "results", "skip", result_key)
            continue
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
        _count(sheet_counts, totals, sheet_seen, seen, "students", "unchanged", person_id)
        _count(sheet_counts, totals, sheet_seen, seen, "enrollments", "unchanged", f"{person_id}|{chosen}")
    for other in sheet["groups"]:
        if other is group:
            continue
        for student in other["students"]:
            student["change"] = "skip"
    sheet["planned"] = sheet_counts


def _plan_enrollment(
    student, directory, match_batches, batches, picks, sheet, plan, published,
    sheet_counts, totals, sheet_seen, seen, result_key,
) -> None:
    """A named row that is not in the selected batches is enrolled when the import is saved."""
    known = directory.get(student.get("name_key") or "", [])
    if len(known) > 1:
        student["change"] = "reject"
        student["match"] = "ambiguous"
        plan["blockers"].append({
            "code": "import.ambiguous_name",
            "sheet_id": sheet["id"],
            "row": student["row"],
            "message": f"More than one student is named {student['display_name']}.",
        })
        _count(sheet_counts, totals, sheet_seen, seen, "results", "reject", result_key)
        return
    person = known[0] if known else None
    student["create_student"] = person is None
    student["student_id"] = (person or {}).get("_id") or ""
    choices = [
        {"id": batch_id, "name": (batches.get(batch_id) or {}).get("name") or batch_id}
        for batch_id in match_batches
    ]
    student["batch_choices"] = choices
    student["match"] = "enroll"
    chosen = picks.get(str(student["row"])) or picks.get(student["row"]) or ""
    if len(choices) == 1:
        chosen = choices[0]["id"]
    elif chosen not in {item["id"] for item in choices}:
        student["change"] = "reject"
        student["match"] = "choose"
        plan["blockers"].append({
            "code": "import.batch_unassigned",
            "sheet_id": sheet["id"],
            "row": student["row"],
            "message": f"Choose a batch for {student['display_name']} on {sheet['name']}.",
        })
        _count(sheet_counts, totals, sheet_seen, seen, "results", "reject", result_key)
        return
    student["batch_id"] = chosen
    person_key = student["student_id"] or f"new:{student.get('name_key')}"
    if student.get("status") == "missing" or published:
        student["change"] = "skip"
        _count(sheet_counts, totals, sheet_seen, seen, "results", "skip", result_key)
    else:
        student["change"] = "insert"
        _count(sheet_counts, totals, sheet_seen, seen, "results", "insert", result_key)
    _count(
        sheet_counts, totals, sheet_seen, seen, "students",
        "insert" if student["create_student"] else "unchanged", person_key,
    )
    _count(sheet_counts, totals, sheet_seen, seen, "enrollments", "insert", f"{person_key}|{chosen}")


def _apply_maximum(student: dict, maximum: float, sheet: dict, plan: dict) -> None:
    score = student.get("score")
    if student.get("status") == "invalid" and not isinstance(score, (int, float)):
        plan["blockers"].append({
            "code": "import.invalid_mark",
            "sheet_id": sheet["id"],
            "row": student["row"],
            "message": f"{student['display_name']} on {sheet['name']} row {student['row']} is not a mark.",
        })
        return
    if not isinstance(score, (int, float)) or isinstance(score, bool):
        return
    if float(score) < 0 or float(score) > maximum:
        student["status"] = "invalid"
        student["score"] = float(score)
        plan["blockers"].append({
            "code": "import.invalid_mark",
            "sheet_id": sheet["id"],
            "row": student["row"],
            "message": f"{student['display_name']} on {sheet['name']} row {student['row']} is outside 0 to {maximum}.",
        })
        return
    if student.get("status") in {"invalid", "scored"}:
        student["status"] = "scored"
        student["score"] = float(score)
        student["percentage"] = (float(score) / maximum * 100) if maximum else None
        student["band"] = _band(student["percentage"])


def _result_label(student: dict, existing: dict | None, published: bool) -> tuple[str, float | None]:
    if existing is None:
        return ("skip", None) if published else ("insert", None)
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


def _count(sheet_counts, totals, sheet_seen, seen, kind: str, bucket: str, key: str) -> None:
    _add(sheet_counts, kind, bucket, sheet_seen[kind], key)
    _add(totals, kind, bucket, seen[kind], key)
