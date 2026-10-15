"""Teaching records. A teaching assignment is not a login grant."""

from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from app.accounts import _guard_delegate, _role, _role_actions, bump_session
from app.acl import allows, clean_scope, describe_scope
from app.deps import current_user, db, grants_for, institute_resource, new_id, public_grant, require, write_audit
from app.errors import AppError
from app.security import hash_password, name_key

router = APIRouter(prefix="/api/v1")

class TeachingSubject(BaseModel):
    subject_id: str
    paper_ids: list[str] = Field(default_factory=list)
    unit_ids: list[str] = Field(default_factory=list)


class TeachingBody(BaseModel):
    course_id: str
    subjects: list[TeachingSubject] = Field(default_factory=list)
    acknowledge_scope: bool = False


class TeacherBody(BaseModel):
    name: str = Field(min_length=1)
    app_user: bool = False
    email: str = ""
    password: str = ""


class TeacherPatch(BaseModel):
    active: bool | None = None


def _part_grants(
    paper_ids: list[str], unit_ids: list[str], known_papers: set[str], known_units: set[str]
) -> list[dict]:
    papers = list(dict.fromkeys(paper_ids))
    units = list(dict.fromkeys(unit_ids))
    papers_narrowed = bool(papers) and set(papers) != known_papers
    units_narrowed = bool(units) and set(units) != known_units
    if not papers_narrowed and not units_narrowed:
        return [{"paper_id": None, "unit_ids": []}]
    if papers_narrowed:
        return [{"paper_id": paper_id, "unit_ids": units} for paper_id in papers]
    return [{"paper_id": None, "unit_ids": units}]

def _shown_grant(row: dict) -> dict:
    scope = row.get("scope") or {}
    return {
        "id": row.get("_id"),
        "role": row.get("role") or "teacher",
        "actions": list(row.get("actions") or []),
        "scope": scope,
        "unit_ids": list(row.get("unit_ids") or []),
        "consequence": describe_scope(scope) if scope else "",
    }


def _assignment_grants(teacher: dict) -> list[dict]:
    rows = []
    for item in teacher.get("assignments") or []:
        rows.append({
            "_id": ":".join([
                item.get("batch_id") or "",
                item.get("course_id") or "",
                item.get("subject_id") or "",
                item.get("paper_id") or "",
            ]),
            "role": "teacher",
            "actions": [],
            "scope": {
                "institute_id": teacher["institute_id"],
                "branch_id": item.get("branch_id"),
                "course_id": item.get("course_id"),
                "batch_id": item.get("batch_id"),
                "subject_id": item.get("subject_id"),
                "paper_id": item.get("paper_id"),
            },
            "unit_ids": list(item.get("unit_ids") or []),
        })
    return rows


async def _teacher_payload(
    request: Request,
    teacher: dict,
    user: dict | None = None,
    grants: list[dict] | None = None,
) -> dict:
    if teacher.get("user_id") and user is None:
        user = await db(request).users.find_one(
            {"_id": teacher["user_id"], "institute_id": teacher["institute_id"]}
        )
    if teacher.get("user_id") and grants is None:
        grants = await grants_for(request, teacher["user_id"])
    rows = grants if teacher.get("user_id") else _assignment_grants(teacher)
    return {
        "id": teacher["_id"],
        "name": teacher["name"],
        "active": user["active"] if user else bool(teacher.get("active", True)),
        "app_user": bool(teacher.get("user_id")),
        "user_id": teacher.get("user_id"),
        "email": user.get("email") if user else None,
        "grants": [_shown_grant(row) for row in rows or []],
    }


@router.get("/teachers")
async def list_teachers(request: Request) -> dict:
    actor = await current_user(request)
    require(actor, "user.manage", institute_resource(actor))
    teachers = await db(request).teachers.find({"institute_id": actor["institute_id"]}).to_list(length=500)
    user_ids = [item["user_id"] for item in teachers if item.get("user_id")]
    users = {}
    grants: dict[str, list[dict]] = {}
    if user_ids:
        for user in await db(request).users.find(
            {"institute_id": actor["institute_id"], "_id": {"$in": user_ids}}
        ).to_list(length=500):
            users[user["_id"]] = user
        for grant in await db(request).grants.find(
            {"institute_id": actor["institute_id"], "user_id": {"$in": user_ids}}
        ).to_list(length=2000):
            grants.setdefault(grant["user_id"], []).append(grant)
    items = []
    for teacher in teachers:
        linked = users.get(teacher.get("user_id"))
        held = grants.get(teacher.get("user_id"), []) if teacher.get("user_id") else None
        items.append(await _teacher_payload(request, teacher, linked, held))
    return {"items": items}


@router.post("/teachers")
async def create_teacher(request: Request, body: TeacherBody) -> dict:
    actor = await current_user(request)
    require(actor, "user.manage", institute_resource(actor))
    name = " ".join(body.name.split())
    if not name:
        raise AppError(422, "teacher.empty", "Enter a name.")
    user_id = None
    if body.app_user:
        email = body.email.strip()
        if not email or len(body.password) < 10:
            raise AppError(422, "teacher.account", "Enter an email and a password of at least 10 characters.")
        user_id = new_id()
        try:
            await db(request).users.insert_one({
                "_id": user_id,
                "institute_id": actor["institute_id"],
                "name": name,
                "email": email,
                "email_key": name_key(email),
                "password_hash": hash_password(body.password),
                "recovery_hashes": [],
                "totp_secret": None,
                "active": True,
                "session_version": 1,
            })
        except DuplicateKeyError:
            raise AppError(409, "user.exists", "A user with that email already exists.") from None
        await write_audit(
            request, actor, "user.create", None, {"user_id": user_id, "role": "teacher"}, institute_resource(actor)
        )
    teacher_id = new_id()
    teacher = {
        "_id": teacher_id,
        "institute_id": actor["institute_id"],
        "name": name,
        "active": True,
        "user_id": user_id,
        "assignments": [],
    }
    await db(request).teachers.insert_one(teacher)
    await write_audit(
        request,
        actor,
        "teacher.create",
        None,
        {"teacher_id": teacher_id, "name": name, "app_user": bool(user_id)},
        institute_resource(actor),
    )
    return await _teacher_payload(request, teacher)


@router.get("/teachers/{teacher_id}")
async def get_teacher(request: Request, teacher_id: str) -> dict:
    actor = await current_user(request)
    require(actor, "user.manage", institute_resource(actor))
    teacher = await db(request).teachers.find_one(
        {"_id": teacher_id, "institute_id": actor["institute_id"]}
    )
    if teacher is None:
        raise AppError(404, "not_found", "That record was not found.")
    return await _teacher_payload(request, teacher)


@router.patch("/teachers/{teacher_id}")
async def patch_teacher(request: Request, teacher_id: str, body: TeacherPatch) -> dict:
    actor = await current_user(request)
    require(actor, "user.manage", institute_resource(actor))
    teacher = await db(request).teachers.find_one(
        {"_id": teacher_id, "institute_id": actor["institute_id"]}
    )
    if teacher is None:
        raise AppError(404, "not_found", "That record was not found.")
    if teacher.get("user_id"):
        raise AppError(422, "teacher.app_user", "Deactivate this person from Users and access.")
    if body.active is not None and body.active != bool(teacher.get("active", True)):
        await db(request).teachers.update_one({"_id": teacher_id}, {"$set": {"active": body.active}})
        await write_audit(
            request,
            actor,
            "teacher.update",
            {"active": bool(teacher.get("active", True))},
            {"active": body.active},
            institute_resource(actor),
        )
        teacher["active"] = body.active
    return await _teacher_payload(request, teacher)


@router.put("/users/{user_id}/teaching")
async def save_teaching(request: Request, user_id: str, body: TeachingBody) -> dict:
    actor = await current_user(request)
    target = await db(request).users.find_one(
        {"_id": user_id, "institute_id": actor["institute_id"]}
    )
    if target is None:
        raise AppError(404, "not_found", "That record was not found.")
    course = await db(request).courses.find_one(
        {"_id": body.course_id, "institute_id": actor["institute_id"]}
    )
    if course is None:
        raise AppError(404, "not_found", "That record was not found.")
    role = await _role(request, actor["institute_id"], "teacher")
    planned = await _teaching_grants(request, actor, course["_id"], body.subjects)
    for scope, _unit_ids in planned:
        _guard_delegate(actor, scope, _role_actions(role), body.acknowledge_scope)
    existing = await db(request).grants.find(
        {
            "institute_id": actor["institute_id"],
            "user_id": target["_id"],
            "role": "teacher",
            "scope.course_id": course["_id"],
        }
    ).to_list(length=500)
    for grant in existing:
        if not allows(actor["grants"], "grant.manage", grant["scope"]):
            raise AppError(403, "auth.forbidden", "You cannot assign access outside your own scope.")
    if existing:
        await db(request).grants.delete_many({"_id": {"$in": [grant["_id"] for grant in existing]}})
        await write_audit(
            request,
            actor,
            "grant.delete",
            {"user_id": target["_id"], "course_id": course["_id"], "grants": [grant["_id"] for grant in existing]},
            None,
            {"institute_id": actor["institute_id"], "course_id": course["_id"]},
        )
    created = []
    for scope, unit_ids in planned:
        grant = {
            "_id": new_id(),
            "institute_id": actor["institute_id"],
            "user_id": target["_id"],
            "role": role["name"],
            "role_id": role["_id"],
            "actions": list(role["actions"]),
            "scope": scope,
            "unit_ids": unit_ids,
        }
        await db(request).grants.insert_one(grant)
        created.append(grant)
        await write_audit(
            request,
            actor,
            "grant.create",
            None,
            {"role": role["name"], "user_id": target["_id"], "unit_ids": unit_ids},
            scope,
        )
    await bump_session(request, target["_id"])
    return {"grants": [{**public_grant(grant), "id": grant["_id"]} for grant in created]}


@router.put("/teachers/{teacher_id}/teaching")
async def save_teacher_teaching(request: Request, teacher_id: str, body: TeachingBody) -> dict:
    actor = await current_user(request)
    require(actor, "user.manage", institute_resource(actor))
    teacher = await db(request).teachers.find_one(
        {"_id": teacher_id, "institute_id": actor["institute_id"]}
    )
    if teacher is None:
        raise AppError(404, "not_found", "That record was not found.")
    if teacher.get("user_id"):
        await save_teaching(request, teacher["user_id"], body)
        return await _teacher_payload(request, teacher)
    course = await db(request).courses.find_one(
        {"_id": body.course_id, "institute_id": actor["institute_id"]}
    )
    if course is None:
        raise AppError(404, "not_found", "That record was not found.")
    planned = await _teaching_grants(request, actor, course["_id"], body.subjects)
    kept = [item for item in teacher.get("assignments") or [] if item.get("course_id") != course["_id"]]
    for scope, unit_ids in planned:
        kept.append({
            "course_id": scope.get("course_id"),
            "subject_id": scope.get("subject_id"),
            "paper_id": scope.get("paper_id"),
            "unit_ids": unit_ids,
        })
    await db(request).teachers.update_one({"_id": teacher["_id"]}, {"$set": {"assignments": kept}})
    await write_audit(
        request,
        actor,
        "teacher.update",
        {"course_id": course["_id"]},
        {"course_id": course["_id"], "subjects": [item.subject_id for item in body.subjects]},
        {"institute_id": actor["institute_id"], "course_id": course["_id"]},
    )
    teacher["assignments"] = kept
    return await _teacher_payload(request, teacher)


async def _teaching_grants(
    request: Request, actor: dict, course_id: str, subjects: list[TeachingSubject]
) -> list[tuple[dict, list[str]]]:
    seen: set[str] = set()
    planned: list[tuple[dict, list[str]]] = []
    for item in subjects:
        if item.subject_id in seen:
            raise AppError(422, "teaching.subject", "Choose each subject once.")
        seen.add(item.subject_id)
        subject = await db(request).subjects.find_one(
            {"_id": item.subject_id, "institute_id": actor["institute_id"], "course_id": course_id}
        )
        if subject is None:
            raise AppError(422, "teaching.subject", "Choose a subject in this course.")
        known_units = {unit.get("id") for unit in subject.get("units") or [] if unit.get("id")}
        unknown_units = [unit_id for unit_id in item.unit_ids if unit_id not in known_units]
        if unknown_units:
            raise AppError(422, "teaching.part", "Choose a chapter or module on that subject.")
        papers = await db(request).papers.find(
            {"institute_id": actor["institute_id"], "subject_id": subject["_id"]}
        ).to_list(length=200)
        known_papers = {paper["_id"] for paper in papers}
        unknown_papers = [paper_id for paper_id in item.paper_ids if paper_id not in known_papers]
        if unknown_papers:
            raise AppError(422, "teaching.part", "Choose a paper on that subject.")
        for part in _part_grants(item.paper_ids, item.unit_ids, known_papers, known_units):
            scope = clean_scope(
                {"course_id": course_id, "subject_id": subject["_id"], "paper_id": part["paper_id"]},
                actor["institute_id"],
            )
            planned.append((scope, list(part["unit_ids"])))
    return planned

