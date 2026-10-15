"""Student directory rules: one enrollment tuple at a time, and shared names stay shared."""

from __future__ import annotations

from app.acl import allows, grant_matches


async def directory_facts(database, institute_id: str) -> dict:
    subjects = await database.subjects.find({"institute_id": institute_id}).to_list(length=200)
    papers = await database.papers.find({"institute_id": institute_id}).to_list(length=200)
    stored = await database.rosters.find({"institute_id": institute_id}).to_list(length=200)
    branches = await database.branches.find({"institute_id": institute_id}).to_list(length=200)
    courses = await database.courses.find({"institute_id": institute_id}).to_list(length=200)
    batches = await database.batches.find({"institute_id": institute_id}).to_list(length=200)
    return {
        "subject_by_id": {item["_id"]: item for item in subjects},
        "paper_subject": {item["_id"]: item.get("subject_id") or "" for item in papers},
        "rosters": {
            item["batch_id"]: set(item.get("student_ids") or [])
            for item in stored
            if item.get("batch_id")
        },
        "branch_name": {item["_id"]: item.get("name") or "" for item in branches},
        "course_name": {item["_id"]: item.get("name") or "" for item in courses},
        "batch_name": {item["_id"]: item.get("name") or "" for item in batches},
    }


def _recorded_date(value) -> str | None:
    text = str(value or "").strip()
    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        return text[:10]
    return None


def enrollment_status(row: dict) -> str | None:
    recorded = str(row.get("status") or "").strip().casefold()
    if recorded in {"current", "historical"}:
        return recorded
    if _recorded_date(row.get("ended_on")) or row.get("archived"):
        return "historical"
    return None


def enrollment_context(rows: list[dict], facts: dict) -> list[dict]:
    ordered = sorted(rows, key=lambda row: facts["batch_name"].get(row.get("batch_id"), "").casefold())
    return [
        {
            "id": row.get("_id"),
            "branch_id": row.get("branch_id"),
            "course_id": row.get("course_id"),
            "batch_id": row.get("batch_id"),
            "branch_name": facts["branch_name"].get(row.get("branch_id"), ""),
            "course_name": facts["course_name"].get(row.get("course_id"), ""),
            "batch_name": facts["batch_name"].get(row.get("batch_id"), ""),
            "started_on": _recorded_date(row.get("started_on")),
            "ended_on": _recorded_date(row.get("ended_on")),
            "status": enrollment_status(row),
        }
        for row in ordered
    ]


def enrollment_resource(row: dict) -> dict:
    return {
        "institute_id": row.get("institute_id"),
        "branch_id": row.get("branch_id"),
        "course_id": row.get("course_id"),
        "batch_id": row.get("batch_id"),
    }


def lookup_subject_ids(grants: list[dict], resource: dict, paper_subject: dict[str, str]) -> set[str] | None:
    """None when a grant leaves the subject open. A set when every matching grant names a subject or paper."""
    matched = [
        grant for grant in grants if grant_matches(grant, "student.lookup", resource, resource_fields_only=True)
    ]
    if not matched:
        return set()
    limited: set[str] = set()
    for grant in matched:
        scope = grant.get("scope") or {}
        subject_id = scope.get("subject_id")
        paper_id = scope.get("paper_id")
        if not subject_id and not paper_id:
            return None
        if subject_id:
            limited.add(subject_id)
        mapped = paper_subject.get(paper_id or "")
        if mapped:
            limited.add(mapped)
    return limited


def enrollment_visible(
    grants: list[dict],
    enrollment: dict,
    subject_by_id: dict[str, dict],
    paper_subject: dict[str, str],
    rosters: dict[str, set[str]],
) -> bool:
    resource = enrollment_resource(enrollment)
    limits = lookup_subject_ids(grants, resource, paper_subject)
    if limits is None:
        return True
    if not limits:
        return False
    batch_id = enrollment.get("batch_id") or ""
    if batch_id in rosters and enrollment.get("student_id") not in rosters[batch_id]:
        return False
    known = [subject_by_id[subject_id] for subject_id in limits if subject_id in subject_by_id]
    if not known:
        return True
    course_id = enrollment.get("course_id")
    return any(item.get("course_id") == course_id for item in known)


def identity_editable(grants: list[dict], enrollments: list[dict]) -> bool:
    if not enrollments:
        return False
    return all(allows(grants, "student.manage", enrollment_resource(row)) for row in enrollments)


def card_visible(grants: list[dict], enrollments: list[dict]) -> bool:
    return any(
        allows(grants, "progress_card.view", enrollment_resource(row), resource_fields_only=True)
        for row in enrollments
    )


def history_permitted(grants: list[dict], enrollments: list[dict]) -> bool:
    if not enrollments:
        return False
    institute = {"institute_id": enrollments[0].get("institute_id")}
    if allows(grants, "audit.view", institute):
        return True
    return any(allows(grants, "audit.view", enrollment_resource(row)) for row in enrollments)


def _event_mentions(event: dict, student_id: str) -> bool:
    scope = event.get("scope") or {}
    context = event.get("context") or {}
    if scope.get("student_id") == student_id or context.get("student_id") == student_id:
        return True
    if context.get("source_id") == student_id or context.get("target_id") == student_id:
        return True
    return context.get("kind") == "student" and context.get("id") == student_id


def history_visible(grants: list[dict], event: dict, student_id: str, enrollments: list[dict]) -> bool:
    if not _event_mentions(event, student_id):
        return False
    scope = event.get("scope") or {}
    resource = {
        "institute_id": scope.get("institute_id") or (enrollments[0].get("institute_id") if enrollments else None),
        "branch_id": scope.get("branch_id"),
        "course_id": scope.get("course_id"),
        "batch_id": scope.get("batch_id"),
        "subject_id": scope.get("subject_id"),
        "paper_id": scope.get("paper_id"),
    }
    if allows(grants, "audit.view", resource):
        return True
    if not any(scope.get(field) for field in ("branch_id", "course_id", "batch_id", "subject_id", "paper_id")):
        return history_permitted(grants, enrollments)
    return False


def history_item(event: dict, actor_name: str) -> dict:
    def names(value) -> dict | None:
        if not isinstance(value, dict):
            return None
        kept = {}
        for key in (
            "display_name", "student_code", "started_on", "ended_on", "photo", "alias", "batch_name",
            "date_of_birth", "blood_group", "phone", "guardian_name", "guardian_phone", "notes",
            "street", "place", "district", "state", "pin",
            "qualification", "institution", "board", "passing_year",
        ):
            if value.get(key):
                kept[key] = value[key]
        return kept or None

    action = event.get("action") or ""
    before = names(event.get("before"))
    after = names(event.get("after"))
    context = event.get("context") if isinstance(event.get("context"), dict) else {}
    if action == "catalog.correct":
        if context.get("previous_name") and before is None:
            before = {"display_name": context["previous_name"]}
        label = context.get("display_name") or context.get("name")
        if label and after is None:
            after = {"display_name": label}
    notes = {
        "student.update": "Student details were saved. Enrollments were left as they were.",
        "student.photo": "The student photo was changed.",
        "student.alias": "A previous name was recorded for this student.",
        "student.merge": "Student records were merged under the existing merge rules.",
        "enrollment.update": "Enrollment dates were recorded. Branch, course, and batch stayed as they were.",
        "enrollment.create": "An enrollment was added. Existing results stayed on their enrollments.",
        "catalog.correct": "A catalog correction was recorded for this student.",
    }
    moment = event.get("at")
    return {
        "id": event.get("_id"),
        "action": action,
        "at": moment.isoformat() if hasattr(moment, "isoformat") else str(moment or ""),
        "actor_name": actor_name or "Unknown",
        "before": before,
        "after": after,
        "note": notes.get(action, "A permitted change was recorded."),
    }
