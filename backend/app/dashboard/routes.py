"""Operational dashboard and the shared academic context options."""

from __future__ import annotations

from fastapi import APIRouter, Request

from app.acl import allows, mongo_clause
from app.context import _href, _option_resource
from app.deps import current_user, db
from app.errors import AppError
from app.security import name_key

router = APIRouter(prefix="/api/v1")

_CONTEXT_ACTIONS = (
    "dashboard.view",
    "marksheet.view",
    "marksheet.upload",
    "student.lookup",
    "progress_card.view",
    "catalog.correct",
    "catalog.manage",
)
_CONTEXT_FIELDS = {
    "branch": {"institute_id": "institute_id", "branch_id": "_id"},
    "course": {"institute_id": "institute_id", "course_id": "_id"},
    "subject": {"institute_id": "institute_id", "course_id": "course_id", "subject_id": "_id"},
    "batch": {
        "institute_id": "institute_id",
        "branch_id": "branch_id",
        "course_id": "course_id",
        "batch_id": "_id",
    },
    "paper": {"institute_id": "institute_id", "subject_id": "subject_id", "paper_id": "_id"},
}

@router.get("/context/options")
async def context_options(request: Request, dimension: str, q: str = "") -> dict:
    user = await current_user(request)
    collection_name = {
        "branch": "branches",
        "course": "courses",
        "subject": "subjects",
        "batch": "batches",
        "paper": "papers",
    }.get(dimension)
    if dimension == "exam_type":
        return {"items": [
            {"id": "unit", "label": "Unit", "parents": {}},
            {"id": "part", "label": "Part", "parents": {}},
            {"id": "chapter", "label": "Chapter", "parents": {}},
        ]}
    if collection_name is None:
        raise AppError(422, "context.unknown", "Choose a known context level.")
    field_map = _CONTEXT_FIELDS[dimension]
    query = {
        "institute_id": user["institute_id"],
        "$or": [mongo_clause(user["grants"], action, field_map) for action in _CONTEXT_ACTIONS],
    }
    if q:
        query["name_key"] = {"$regex": name_key(q)}
    rows = await db(request)[collection_name].find(query).limit(200).to_list(length=200)
    offerings = await db(request).offerings.find({"institute_id": user["institute_id"]}).to_list(length=200)
    branches_for_course: dict[str, list[str]] = {}
    for offering in offerings:
        branches_for_course.setdefault(offering["course_id"], []).append(offering["branch_id"])
    subject_course = {
        item["_id"]: item.get("course_id")
        for item in await db(request).subjects.find({"institute_id": user["institute_id"]}).to_list(length=200)
    }
    items = []
    for row in rows:
        resource = _option_resource(dimension, row, user["institute_id"], subject_course)
        if not any(allows(user["grants"], action, resource, True) for action in _CONTEXT_ACTIONS):
            continue
        label = row.get("name") or (f"Paper {row['number']}" if row.get("number") is not None else row["_id"])
        parents = {key: row[key] for key in ("branch_id", "course_id", "subject_id", "session_key") if row.get(key)}
        if dimension == "course":
            parents["branch_ids"] = branches_for_course.get(row["_id"], [])
        if dimension == "paper" and row.get("subject_id"):
            parents["course_id"] = subject_course.get(row["subject_id"])
        items.append({"id": row["_id"], "label": label, "parents": parents})
    return {"items": items}


def _holds(user: dict, action: str) -> bool:
    return any(action in (grant.get("actions") or []) for grant in user["grants"])


def _sees(user: dict, action: str, resource: dict) -> bool:
    return allows(user["grants"], action, resource, True)


@router.get("/dashboard")
async def dashboard(
    request: Request, branch_id: str = "", course_id: str = "", batch_id: str = "", period: str = ""
) -> dict:
    """`period` is ignored. Dashboard scope is branch, course, and batch."""
    del period
    user = await current_user(request)
    if not _holds(user, "dashboard.view"):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    from app.assessments.routes import _import_batch_ids
    from app.clock import coerce_timezone, local_today

    institute = await db(request).institutes.find_one({"_id": user["institute_id"]}) or {}
    zone = coerce_timezone(institute.get("timezone"))
    today = local_today(zone)
    header = {"name": institute.get("name") or "", "timezone": zone, "today": today}
    rejected = await _rejected_filters(request, user, branch_id, course_id, batch_id)
    if rejected:
        return {
            "institute": header,
            "applied": {},
            "rejected": rejected,
            "message": "That filter is outside your access. Clear it to see your overview.",
            "metrics": [],
            "queues": [],
            "activity": [],
            "activity_scope": "",
            "actions": [],
        }
    applied = {"branch_id": branch_id, "course_id": course_id, "batch_id": batch_id}
    course_only = bool(branch_id or batch_id)
    scope_note = "Course only. Branch and batch do not apply." if course_only else ""
    metrics = []
    queues = []
    if _holds(user, "student.lookup"):
        metrics.extend(await _people_metrics(request, user, applied, today, scope_note))
    if _holds(user, "student.lookup") or _holds(user, "catalog.manage") or _holds(user, "catalog.correct"):
        metrics.append(await _batch_metric(request, user, applied))
    if _holds(user, "marksheet.view"):
        queues.append(await _marksheet_queue(request, user, applied))
    if _holds(user, "marksheet.view") or _holds(user, "marksheet.upload"):
        queues.append(await _import_queue(request, user, applied, _import_batch_ids))
    activity, activity_scope = await _activity(request, user, applied, course_only, zone)
    return {
        "institute": header,
        "applied": {key: value for key, value in applied.items() if value},
        "rejected": [],
        "message": "",
        "metrics": [item for item in metrics if item],
        "queues": [item for item in queues if item],
        "activity": activity,
        "activity_scope": activity_scope,
        "actions": _quick_actions(user),
    }


async def _rejected_filters(request: Request, user: dict, branch_id: str, course_id: str, batch_id: str) -> list[str]:
    rejected = []
    institute_id = user["institute_id"]
    if branch_id:
        branch = await db(request).branches.find_one({"_id": branch_id, "institute_id": institute_id})
        if branch is None or not _sees(user, "dashboard.view", {"institute_id": institute_id, "branch_id": branch_id}):
            rejected.append("branch_id")
    if course_id:
        course = await db(request).courses.find_one({"_id": course_id, "institute_id": institute_id})
        if course is None or not _sees(user, "dashboard.view", {"institute_id": institute_id, "course_id": course_id}):
            rejected.append("course_id")
    if batch_id:
        batch = await db(request).batches.find_one({"_id": batch_id, "institute_id": institute_id})
        resource = {
            "institute_id": institute_id,
            "branch_id": (batch or {}).get("branch_id"),
            "course_id": (batch or {}).get("course_id"),
            "batch_id": batch_id,
        }
        fits = bool(batch) and _sees(user, "dashboard.view", resource)
        if fits and branch_id and batch.get("branch_id") != branch_id:
            fits = False
        if fits and course_id and batch.get("course_id") != course_id:
            fits = False
        if not fits:
            rejected.append("batch_id")
    return rejected


async def _people_metrics(request: Request, user: dict, applied: dict, today: str, scope_note: str) -> list[dict]:
    from app.admissions.routes import enquiry_next_on
    from app.intake import applied_intake_course, intake_course_visible
    from app.students.directory import directory_facts, enrollment_status, enrollment_visible

    facts = await directory_facts(db(request), user["institute_id"])
    query: dict = {"institute_id": user["institute_id"]}
    for field in ("branch_id", "course_id", "batch_id"):
        if applied.get(field):
            query[field] = applied[field]
    enrollments = await db(request).enrollments.find(query).to_list(length=1000)
    people = {
        row["student_id"]
        for row in enrollments
        if enrollment_status(row) != "historical"
        and enrollment_visible(user["grants"], row, facts["subject_by_id"], facts["paper_subject"], facts["rosters"])
    }
    students = {
        "key": "students",
        "label": "Currently enrolled",
        "count": len(people),
        "href": _href(
            "/students",
            enrollment="current",
            branch_id=applied["branch_id"],
            course_id=applied["course_id"],
            batch_id=applied["batch_id"],
        ),
        "scope": "",
    }
    intake_course, _dropped = applied_intake_course(user["grants"], applied["course_id"])
    follow_ups = 0
    for row in await db(request).enquiries.find({"institute_id": user["institute_id"]}).to_list(length=500):
        course = row.get("course_id") or ""
        if not intake_course_visible(user["grants"], course):
            continue
        if intake_course and course != intake_course:
            continue
        if row.get("admission_id"):
            continue
        next_on = enquiry_next_on(row)
        if next_on and next_on < today:
            follow_ups += 1
    admissions = 0
    for row in await db(request).admissions.find({"institute_id": user["institute_id"]}).to_list(length=500):
        course = row.get("course_id") or ""
        if not intake_course_visible(user["grants"], course):
            continue
        if intake_course and course != intake_course:
            continue
        if (row.get("status") or "open") == "open":
            admissions += 1
    return [
        students,
        {
            "key": "admissions",
            "label": "Admissions awaiting enrollment",
            "count": admissions,
            "href": _href("/students/admissions", status="open", course_id=intake_course),
            "scope": scope_note,
        },
        {
            "key": "follow_ups",
            "label": "Follow-ups due",
            "count": follow_ups,
            "href": _href("/students/enquiries", follow_up="overdue", course_id=intake_course),
            "scope": scope_note,
        },
    ]


async def _batch_metric(request: Request, user: dict, applied: dict) -> dict:
    from app.academics.catalog import batch_visible

    rows = await db(request).batches.find({"institute_id": user["institute_id"]}).to_list(length=500)
    count = 0
    for batch in rows:
        if batch.get("ended_on"):
            continue
        if applied["branch_id"] and batch.get("branch_id") != applied["branch_id"]:
            continue
        if applied["course_id"] and batch.get("course_id") != applied["course_id"]:
            continue
        if applied["batch_id"] and batch["_id"] != applied["batch_id"]:
            continue
        if not batch_visible(user, batch):
            continue
        count += 1
    return {
        "key": "batches",
        "label": "Active batches",
        "count": count,
        "href": _href(
            "/batches",
            active="1",
            branch_id=applied["branch_id"],
            course_id=applied["course_id"],
            batch_id=applied["batch_id"],
        ),
        "scope": "",
    }


async def _marksheet_queue(request: Request, user: dict, applied: dict) -> dict:
    from app.assessments.routes import marksheet_visible

    query: dict = {"institute_id": user["institute_id"], "status": "submitted"}
    for field in ("branch_id", "course_id"):
        if applied.get(field):
            query[field] = applied[field]
    if applied.get("batch_id"):
        query["batch_ids"] = applied["batch_id"]
    found = await db(request).marksheets.find(query).to_list(length=500)
    sheets = [sheet for sheet in found if marksheet_visible(user, sheet)]
    oldest = ""
    for sheet in sheets:
        stamp = sheet.get("submitted_at") or sheet.get("created_at")
        text = stamp.date().isoformat() if hasattr(stamp, "date") else str(stamp or "")[:10]
        if text and (not oldest or text < oldest):
            oldest = text
    return {
        "key": "marksheets",
        "label": "Marksheets awaiting review",
        "count": len(sheets),
        "href": _href(
            "/marksheets",
            status="submitted",
            branch_id=applied["branch_id"],
            course_id=applied["course_id"],
            batch_id=applied["batch_id"],
        ),
        "oldest": oldest,
    }


async def _import_queue(request: Request, user: dict, applied: dict, batch_ids_for) -> dict:
    allowed = await batch_ids_for(request, user, applied["branch_id"], applied["course_id"], applied["batch_id"])
    jobs = await db(request).import_jobs.find(
        {"institute_id": user["institute_id"], "state": "failed"}
    ).to_list(length=500)
    matched = [job for job in jobs if set(job.get("batch_ids") or []).intersection(allowed)]
    oldest = ""
    for job in matched:
        stamp = job.get("created_at")
        text = stamp.date().isoformat() if hasattr(stamp, "date") else ""
        if text and (not oldest or text < oldest):
            oldest = text
    return {
        "key": "imports",
        "label": "Failed imports",
        "count": len(matched),
        "href": _href(
            "/import",
            state="failed",
            branch_id=applied["branch_id"],
            course_id=applied["course_id"],
            batch_id=applied["batch_id"],
        ),
        "oldest": oldest,
    }


def _quick_actions(user: dict) -> list[dict]:
    actions = []
    if _holds(user, "student.manage"):
        actions.append({"key": "enquiry", "label": "Add enquiry", "href": "/students/enquiries"})
        actions.append({"key": "admission", "label": "Create admission", "href": "/students/admissions"})
    if _holds(user, "marksheet.upload"):
        actions.append({"key": "marks", "label": "Enter marks", "href": "/marksheets"})
    return actions


async def _activity(
    request: Request, user: dict, applied: dict, course_only: bool, zone: str
) -> tuple[list[dict], str]:
    institute_id = user["institute_id"]
    events = await db(request).business_events.find({"institute_id": institute_id}).sort("at", -1).to_list(length=40)
    names = await _record_names(request, institute_id)
    visible = []
    showed_course_only = False
    for event in events:
        if not _event_visible(user, event, applied):
            continue
        if not event.get("branch_id") and not event.get("batch_id"):
            showed_course_only = True
        record = event.get("record") or "Record"
        href = event.get("href") or ""
        collection = event.get("collection") or ""
        record_id = event.get("record_id") or ""
        if collection and record_id:
            found = await db(request)[collection].find_one({"_id": record_id, "institute_id": institute_id})
            if found is None:
                record = "This record is no longer available"
                href = ""
        visible.append({
            "id": event["_id"],
            "action": event.get("action") or "Updated a record",
            "record": record,
            "context": _event_context(event, names),
            "at": _local_stamp(event.get("at"), zone),
            "href": href,
        })
        if len(visible) == 8:
            break
    note = "Enquiry and admission activity follows the course only." if course_only and showed_course_only else ""
    return visible, note


async def _record_names(request: Request, institute_id: str) -> dict[str, dict[str, str]]:
    database = db(request)
    courses = await database.courses.find({"institute_id": institute_id}).to_list(length=200)
    branches = await database.branches.find({"institute_id": institute_id}).to_list(length=200)
    batches = await database.batches.find({"institute_id": institute_id}).to_list(length=200)
    return {
        "course": {row["_id"]: row.get("name") or "" for row in courses},
        "branch": {row["_id"]: row.get("name") or "" for row in branches},
        "batch": {row["_id"]: row.get("name") or "" for row in batches},
    }


def _local_stamp(stamp, zone: str) -> str:
    if not hasattr(stamp, "astimezone"):
        return ""
    from zoneinfo import ZoneInfo

    local = stamp.astimezone(ZoneInfo(zone))
    return f"{local.day} {local.strftime('%b')} {local.year}, {local.strftime('%H:%M')}"


def _event_context(event: dict, names: dict[str, dict[str, str]]) -> str:
    parts = []
    course = names["course"].get(event.get("course_id") or "")
    branch = names["branch"].get(event.get("branch_id") or "")
    batch = names["batch"].get(event.get("batch_id") or "")
    for label in (course, branch, batch):
        if label and label not in parts:
            parts.append(label)
    return ", ".join(parts)


def _event_visible(user: dict, event: dict, applied: dict) -> bool:
    from app.intake import intake_course_visible

    course = event.get("course_id") or ""
    branch = event.get("branch_id") or ""
    batch = event.get("batch_id") or ""
    if not branch and not batch:
        if not intake_course_visible(user["grants"], course):
            return False
        if applied["course_id"] and course != applied["course_id"]:
            return False
        return True
    resource = {
        "institute_id": user["institute_id"],
        "branch_id": branch,
        "course_id": course,
        "batch_id": batch,
    }
    if not _sees(user, event.get("permission") or "dashboard.view", resource):
        return False
    if applied["branch_id"] and branch != applied["branch_id"]:
        return False
    if applied["course_id"] and course and course != applied["course_id"]:
        return False
    if applied["batch_id"] and batch != applied["batch_id"]:
        return False
    return True

