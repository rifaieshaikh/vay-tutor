from __future__ import annotations

from app.security import name_key

_KINDS = ("academic", "students", "enrollments", "results")
_BUCKETS = ("insert", "update", "unchanged", "skip", "reject")


def empty_counts() -> dict:
    return {kind: {bucket: 0 for bucket in _BUCKETS} for kind in _KINDS}


def _same_mark(existing: dict, student: dict) -> bool:
    if existing.get("status") != student.get("status"):
        return False
    left, right = existing.get("score"), student.get("score")
    if left is None or right is None:
        return left is None and right is None
    return float(left) == float(right)


def _add(total: dict, kind: str, bucket: str, seen: set, key: str) -> None:
    if key in seen:
        return
    seen.add(key)
    total[kind][bucket] += 1


async def annotate_plan(db, institute_id: str, plan: dict) -> dict:
    """Label each preview row and count unique records that would be inserted, updated, reused, skipped, or rejected."""
    totals = empty_counts()
    seen = {kind: set() for kind in _KINDS}
    for sheet in plan["sheets"]:
        sheet_counts = empty_counts()
        sheet_seen = {kind: set() for kind in _KINDS}
        if not sheet["included"]:
            for group in sheet["groups"]:
                for student in group["students"]:
                    student["change"] = "skip"
                    _add(sheet_counts, "results", "skip", sheet_seen["results"], f"{sheet['id']}:{student['row']}")
                    _add(totals, "results", "skip", seen["results"], f"{sheet['id']}:{student['row']}")
            sheet["planned"] = sheet_counts
            continue
        context = await _context(db, institute_id, sheet)
        for key, created in context["academic"]:
            bucket = "insert" if created else "unchanged"
            _add(sheet_counts, "academic", bucket, sheet_seen["academic"], key)
            _add(totals, "academic", bucket, seen["academic"], key)
        for group in sheet["groups"]:
            if group["interpretation"] == "skip_duplicate":
                for student in group["students"]:
                    student["change"] = "skip"
                    _add(sheet_counts, "results", "skip", sheet_seen["results"], f"{group['id']}:{student['row']}")
                    _add(totals, "results", "skip", seen["results"], f"{group['id']}:{student['row']}")
                continue
            for student in group["students"]:
                label, before = _result_change(context, group, student)
                student["change"] = label
                student["before_score"] = before
                if label == "reject" and before is not None:
                    plan["blockers"].append(
                        {
                            "code": "import.correction_needed",
                            "sheet_id": sheet["id"],
                            "row": student["row"],
                            "message": (
                                f"{student['display_name']} on {sheet['name']} is {student.get('score')} in the file "
                                f"and {before} on the published marksheet. Enter the correct score or keep the saved score."
                            ),
                        }
                    )
                result_key = f"{sheet['id']}|{group['id']}|{student.get('row')}|{student.get('name_key')}"
                _add(sheet_counts, "results", label, sheet_seen["results"], result_key)
                _add(totals, "results", label, seen["results"], result_key)
                person_key = f"{student.get('name_key')}|{student.get('batch_session')}"
                person_bucket = "unchanged" if context["names"].get((student.get("batch_session"), student.get("name_key"))) else "insert"
                if label == "reject" and person_bucket == "insert":
                    person_bucket = "reject"
                _add(sheet_counts, "students", person_bucket, sheet_seen["students"], person_key)
                _add(totals, "students", person_bucket, seen["students"], person_key)
                _add(sheet_counts, "enrollments", person_bucket, sheet_seen["enrollments"], person_key)
                _add(totals, "enrollments", person_bucket, seen["enrollments"], person_key)
        sheet["planned"] = sheet_counts
    plan["totals"]["planned"] = totals
    plan["totals"]["updates"] = totals["results"]["update"]
    plan["ready"] = not plan["blockers"]
    return totals


def _result_change(context: dict, group: dict, student: dict) -> tuple[str, float | None]:
    if not student.get("batch_session"):
        return "reject", None
    marksheet = context["marksheets"].get(group["id"])
    if marksheet is None:
        return "insert", None
    person = context["names"].get((student.get("batch_session"), student.get("name_key")))
    existing = context["results"].get(group["id"], {}).get(person["student_id"]) if person else None
    if student.get("correction") == "keep" and existing is not None:
        student["score"] = existing.get("score")
        student["status"] = existing.get("status")
        student["percentage"] = existing.get("percentage")
        return "unchanged", existing.get("score")
    if existing is None:
        return ("reject", None) if marksheet.get("status") == "published" else ("insert", None)
    if _same_mark(existing, student):
        return "unchanged", existing.get("score")
    if marksheet.get("status") == "published":
        if student.get("correction") == "replace" and str(student.get("correction_reason") or "").strip():
            return "update", existing.get("score")
        return "reject", existing.get("score")
    return "update", existing.get("score")


async def _context(db, institute_id: str, sheet: dict) -> dict:
    academic = []
    branch = await db.branches.find_one({"institute_id": institute_id, "name_key": name_key(sheet["branch_name"])})
    academic.append((f"branch:{name_key(sheet['branch_name'])}", branch is None))
    course = None
    if branch:
        course = await db.courses.find_one({"institute_id": institute_id, "name_key": name_key(sheet["course_name"])})
    academic.append((f"course:{name_key(sheet['course_name'])}", course is None))
    subject = None
    if course:
        subject = await db.subjects.find_one({"course_id": course["_id"], "name_key": name_key(sheet["subject_name"])})
    academic.append((f"subject:{name_key(sheet['subject_name'])}", subject is None))
    paper = None
    if subject and sheet.get("paper_number") is not None:
        paper = await db.papers.find_one({"subject_id": subject["_id"], "number": sheet["paper_number"]})
    academic.append((f"paper:{name_key(sheet['subject_name'])}:{sheet.get('paper_number')}", paper is None))
    offering = None
    if branch and course:
        offering = await db.offerings.find_one({"branch_id": branch["_id"], "course_id": course["_id"]})
    academic.append((f"offering:{name_key(sheet['branch_name'])}:{name_key(sheet['course_name'])}", offering is None))
    batches = {}
    batch_ids = []
    for batch in sheet["batches"]:
        found = None
        if offering:
            found = await db.batches.find_one({"offering_id": offering["_id"], "session_key": batch["session_key"]})
        academic.append((f"batch:{name_key(sheet['branch_name'])}:{batch['session_key']}", found is None))
        if found:
            batches[batch["session_key"]] = found
            batch_ids.append(found["_id"])
        else:
            batch_ids = []
    names = {}
    if batches:
        rows = await db.enrollment_names.find({"batch_id": {"$in": [item["_id"] for item in batches.values()]}}).to_list(length=5000)
        by_id = {item["_id"]: key for key, item in batches.items()}
        for row in rows:
            session_key = by_id.get(row["batch_id"])
            if session_key:
                names[(session_key, row["name_key"])] = row
    marksheets = {}
    results = {}
    if subject and paper and batch_ids:
        for group in sheet["groups"]:
            if group["interpretation"] == "skip_duplicate":
                continue
            title_key = sheet["title_key"]
            if group["interpretation"] in {"separate_assessment", "component"}:
                title_key = f"{sheet['title_key']} {group['maximum']} {group['interpretation']}"
            sessions = tuple(batch["session_key"] for batch in sheet["batches"])
            identity = "|".join((name_key(sheet["subject_name"]), title_key, sheet["format"], ",".join(sessions)))
            academic.append((f"assessment:{identity}", False))
            assessment = await db.assessments.find_one({"institute_id": institute_id, "identity_key": identity})
            if assessment is None:
                academic[-1] = (f"assessment:{identity}", True)
                continue
            attempt_kind = "retest" if sheet["attempt"] == "retest" or group["interpretation"] == "retest" else "original"
            attempt = await db.attempts.find_one({"assessment_id": assessment["_id"], "kind": attempt_kind})
            if attempt is None:
                continue
            marksheet = await db.marksheets.find_one(
                {"assessment_id": assessment["_id"], "attempt_id": attempt["_id"], "cohort_key": "|".join(batch_ids)}
            )
            if marksheet is None:
                continue
            marksheets[group["id"]] = marksheet
            stored = await db.results.find({"marksheet_id": marksheet["_id"]}).to_list(length=5000)
            revision = marksheet.get("active_revision") or marksheet.get("revision") or 1
            results[group["id"]] = {
                row["student_id"]: row for row in stored if row.get("revision") == revision
            }
    return {
        "academic": academic,
        "names": names,
        "marksheets": marksheets,
        "results": results,
        "result_prefix": "|".join(batch_ids),
    }
