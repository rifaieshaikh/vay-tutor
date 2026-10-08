from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from bson import ObjectId
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from app.acl import (
    ACTIONS,
    ROLE_TEMPLATES,
    actions_for,
    allows,
    clean_scope,
    contained_actions,
    describe_scope,
    mongo_clause,
)
from app.errors import AppError
from app.jobs import enqueue, process_due_jobs
from app.security import (
    LOGIN_WINDOW_MINUTES,
    MAX_LOGIN_FAILURES,
    SESSION_COOKIE,
    SESSION_HOURS,
    hash_password,
    hash_token,
    name_key,
    new_token,
    new_totp_secret,
    recovery_codes,
    totp_uri,
    verify_password,
    verify_totp,
)

router = APIRouter(prefix="/api/v1")


class BootstrapBody(BaseModel):
    institute_name: str = Field(min_length=1)
    institute_code: str = Field(min_length=1)
    admin_name: str = Field(min_length=1)
    admin_email: str = Field(min_length=3)
    admin_password: str = Field(min_length=10)


class LoginBody(BaseModel):
    email: str
    password: str
    totp: str | None = None


class RecoveryBody(BaseModel):
    email: str
    recovery_code: str
    new_password: str = Field(min_length=10)


class PasswordBody(BaseModel):
    current_password: str
    new_password: str = Field(min_length=10)


class UserBody(BaseModel):
    name: str = Field(min_length=1)
    email: str = Field(min_length=3)
    password: str = Field(min_length=10)
    role: str
    scope: dict[str, Any] = Field(default_factory=dict)
    acknowledge_scope: bool = False


class UserPatch(BaseModel):
    active: bool | None = None


class GrantBody(BaseModel):
    user_id: str
    role: str
    scope: dict[str, Any] = Field(default_factory=dict)
    acknowledge_scope: bool = False


class RoleBody(BaseModel):
    name: str = Field(min_length=1)
    actions: list[str]


class ScopeBody(BaseModel):
    scope: dict[str, Any] = Field(default_factory=dict)


class ImportCommitBody(BaseModel):
    sheets: list[dict[str, Any]]


class ReportBody(BaseModel):
    format: str
    scope: dict[str, Any] = Field(default_factory=dict)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(ObjectId())


def db(request: Request):
    return request.app.state.db


def settings(request: Request):
    return request.app.state.settings


async def grants_for(request: Request, user_id: str) -> list[dict]:
    return await db(request).grants.find({"user_id": user_id}).to_list(length=500)


async def current_user(request: Request) -> dict:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise AppError(401, "auth.required", "Sign in to continue.")
    session = await db(request).sessions.find_one(
        {"token_hash": hash_token(token), "expires_at": {"$gt": _now()}}
    )
    if session is None:
        raise AppError(401, "auth.required", "Sign in to continue.")
    user = await db(request).users.find_one({"_id": session["user_id"], "active": True})
    if user is None or user.get("session_version") != session.get("session_version"):
        raise AppError(401, "auth.revoked", "This session is no longer valid.")
    user["grants"] = await grants_for(request, user["_id"])
    return user


def require(user: dict, action: str, resource: dict) -> None:
    if allows(user["grants"], action, resource):
        return
    if any(scope_might_hide(user["grants"], resource) for _ in [0]):
        raise AppError(404, "not_found", "That record was not found.")
    raise AppError(403, "auth.forbidden", "You do not have permission for that action.")


def scope_might_hide(grants: list[dict], resource: dict) -> bool:
    visible_actions = (
        "dashboard.view",
        "marksheet.view",
        "student.lookup",
        "student.manage",
        "progress_card.view",
        "audit.view",
    )
    return not any(allows(grants, action, resource) for action in visible_actions)


def institute_resource(user: dict) -> dict:
    return {"institute_id": user["institute_id"]}


async def write_audit(request: Request, actor: dict, action: str, before, after, scope) -> None:
    await db(request).audit_events.insert_one(
        {
            "_id": new_id(),
            "institute_id": actor["institute_id"],
            "actor_id": actor["_id"],
            "action": action,
            "at": _now(),
            "before": before,
            "after": after,
            "scope": scope,
        }
    )


async def bump_session(request: Request, user_id: str) -> None:
    await db(request).users.update_one({"_id": user_id}, {"$inc": {"session_version": 1}})
    await db(request).sessions.delete_many({"user_id": user_id})


def set_session_cookie(request: Request, response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        secure=settings(request).cookie_secure,
        samesite="lax",
        path="/",
        max_age=SESSION_HOURS * 3600,
    )


async def open_session(request: Request, user: dict, response) -> None:
    token = new_token()
    await db(request).sessions.insert_one(
        {
            "_id": new_id(),
            "token_hash": hash_token(token),
            "user_id": user["_id"],
            "session_version": user["session_version"],
            "expires_at": _now() + timedelta(hours=SESSION_HOURS),
        }
    )
    set_session_cookie(request, response, token)


def public_user(user: dict) -> dict:
    return {
        "id": user["_id"],
        "name": user["name"],
        "email": user["email"],
        "active": user["active"],
    }


async def public_institute(request: Request, institute_id: str) -> dict:
    institute = await db(request).institutes.find_one({"_id": institute_id})
    return {"id": institute["_id"], "name": institute["name"], "code": institute["code"]}


def _role_actions(role: dict) -> list[str]:
    unknown = [action for action in role["actions"] if action not in ACTIONS]
    if unknown:
        raise AppError(422, "role.unknown_action", "That role includes an unknown action.")
    return list(role["actions"])


async def _role(request: Request, institute_id: str, role_name: str) -> dict:
    role = await db(request).roles.find_one(
        {"institute_id": institute_id, "name_key": name_key(role_name)}
    )
    if role is None:
        raise AppError(422, "role.unknown", "Choose a role that exists.")
    return role


def _guard_delegate(actor: dict, scope: dict, actions: list[str], acknowledge: bool) -> str:
    held = contained_actions(actor["grants"], scope)
    if "grant.manage" not in held:
        raise AppError(403, "auth.forbidden", "You cannot assign access outside your own scope.")
    missing = [action for action in actions if action not in held]
    if missing:
        raise AppError(403, "auth.forbidden", "You cannot grant an action you do not have.")
    consequence = describe_scope(scope)
    open_scope = any(not scope.get(field) for field in (
        "branch_id", "course_id", "batch_id", "subject_id", "paper_id"
    ))
    if open_scope and not acknowledge:
        raise AppError(
            422,
            "grant.acknowledge_scope",
            consequence,
            consequence=consequence,
        )
    return consequence


async def institute_admin_ids(request: Request, institute_id: str) -> set[str]:
    rows = await db(request).grants.find(
        {
            "institute_id": institute_id,
            "actions": "grant.manage",
            "scope.branch_id": None,
        }
    ).to_list(length=500)
    if not rows:
        return set()
    users = await db(request).users.find(
        {"_id": {"$in": [row["user_id"] for row in rows]}, "active": True}
    ).to_list(length=500)
    return {user["_id"] for user in users}


async def _ensure_admin_remains(request: Request, institute_id: str, removed_user: str | None) -> None:
    admins = await institute_admin_ids(request, institute_id)
    if removed_user:
        admins.discard(removed_user)
    if not admins:
        raise AppError(422, "admin.last", "The institute must keep one active administrator.")


@router.get("/health")
async def health(request: Request) -> dict:
    database = "ok"
    try:
        await db(request).command("ping")
    except Exception:
        database = "down"
    data_dir = settings(request).data_dir
    data_dir.mkdir(parents=True, exist_ok=True)
    disk = "ok" if data_dir.exists() else "down"
    bootstrapped = await db(request).institutes.count_documents({}) > 0
    return {
        "api": "ok",
        "database": database,
        "worker": "ok" if settings(request).worker_enabled else "standby",
        "disk": disk,
        "bootstrapped": bootstrapped,
        "deployment_mode": settings(request).deployment_mode,
    }


@router.get("/compatibility")
async def compatibility(client: str = "1.0.0") -> dict:
    major = client.split(".", 1)[0]
    if major != "1":
        return {
            "status": "upgrade_required",
            "message": "This client cannot use this server. Install a compatible version.",
        }
    return {"status": "compatible", "message": "This client can use this server."}


@router.post("/bootstrap")
async def bootstrap(request: Request, body: BootstrapBody):
    from fastapi.responses import JSONResponse

    if await db(request).institutes.count_documents({}):
        raise AppError(409, "bootstrap.closed", "This server already has an institute.")
    institute_id = new_id()
    user_id = new_id()
    codes = recovery_codes()
    secret = new_totp_secret() if settings(request).deployment_mode == "cloud" else None
    try:
        async with await request.app.state.client.start_session() as session:
            async with session.start_transaction():
                await db(request).institutes.insert_one(
                    {
                        "_id": institute_id,
                        "name": body.institute_name.strip(),
                        "code": body.institute_code.strip(),
                    },
                    session=session,
                )
                for role_name, actions in ROLE_TEMPLATES.items():
                    await db(request).roles.insert_one(
                        {
                            "_id": new_id(),
                            "institute_id": institute_id,
                            "name": role_name,
                            "name_key": name_key(role_name),
                            "actions": list(actions),
                        },
                        session=session,
                    )
                await db(request).policies.insert_one(
                    {
                        "_id": new_id(),
                        "institute_id": institute_id,
                        "version": 1,
                        "bands": {"danger_below": 40, "safe_above": 60},
                        "ranking": "dense",
                        "aggregate": "maximum-marks-weighted",
                        "attempt": "latest-by-date",
                        "passing_threshold": None,
                        "self_publication": False,
                    },
                    session=session,
                )
                await db(request).users.insert_one(
                    {
                        "_id": user_id,
                        "institute_id": institute_id,
                        "name": body.admin_name.strip(),
                        "email": body.admin_email.strip(),
                        "email_key": name_key(body.admin_email),
                        "password_hash": hash_password(body.admin_password),
                        "recovery_hashes": [hash_token(code) for code in codes],
                        "totp_secret": secret,
                        "active": True,
                        "session_version": 1,
                    },
                    session=session,
                )
                await db(request).grants.insert_one(
                    {
                        "_id": new_id(),
                        "institute_id": institute_id,
                        "user_id": user_id,
                        "role": "institute_admin",
                        "actions": list(ACTIONS),
                        "scope": clean_scope({}, institute_id),
                    },
                    session=session,
                )
    except DuplicateKeyError:
        raise AppError(409, "bootstrap.closed", "This server already has an institute.") from None
    user = await db(request).users.find_one({"_id": user_id})
    payload = {
        "institute": await public_institute(request, institute_id),
        "user": public_user(user),
        "recovery_codes": codes,
    }
    if secret:
        payload["totp_uri"] = totp_uri(secret, user["email"])
    response = JSONResponse(payload)
    await open_session(request, user, response)
    await write_audit(
        request,
        user,
        "institute.bootstrap",
        None,
        {"institute_id": institute_id},
        {"institute_id": institute_id},
    )
    return response


@router.post("/auth/login")
async def login(request: Request, body: LoginBody):
    from fastapi.responses import JSONResponse

    email_key = name_key(body.email)
    window_start = _now() - timedelta(minutes=LOGIN_WINDOW_MINUTES)
    failures = await db(request).login_attempts.count_documents(
        {"email_key": email_key, "at": {"$gt": window_start}}
    )
    if failures >= MAX_LOGIN_FAILURES:
        raise AppError(429, "auth.rate_limited", "Too many sign-in attempts. Try again later.")
    user = await db(request).users.find_one({"email_key": email_key, "active": True})
    if user is None or not verify_password(body.password, user["password_hash"]):
        await db(request).login_attempts.insert_one({"email_key": email_key, "at": _now()})
        raise AppError(401, "auth.invalid", "The email or password is not correct.")
    grants = await grants_for(request, user["_id"])
    needs_totp = settings(request).deployment_mode == "cloud" and allows(
        grants, "grant.manage", {"institute_id": user["institute_id"]}
    )
    if needs_totp and not verify_totp(user.get("totp_secret") or "", body.totp or ""):
        raise AppError(401, "auth.totp_required", "Enter the current authentication code.")
    await db(request).login_attempts.delete_many({"email_key": email_key})
    response = JSONResponse(
        {"user": public_user(user), "institute": await public_institute(request, user["institute_id"])}
    )
    await open_session(request, user, response)
    return response


@router.post("/auth/logout")
async def logout(request: Request):
    from fastapi.responses import JSONResponse

    token = request.cookies.get(SESSION_COOKIE)
    if token:
        await db(request).sessions.delete_one({"token_hash": hash_token(token)})
    response = JSONResponse({"ok": True})
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response


@router.get("/auth/session")
async def session(request: Request) -> dict:
    user = await current_user(request)
    return {
        "user": public_user(user),
        "institute": await public_institute(request, user["institute_id"]),
        "actions": actions_for(user["grants"]),
        "deployment_mode": settings(request).deployment_mode,
    }


@router.post("/auth/password")
async def change_password(request: Request, body: PasswordBody) -> dict:
    user = await current_user(request)
    if not verify_password(body.current_password, user["password_hash"]):
        raise AppError(401, "auth.invalid", "The email or password is not correct.")
    await db(request).users.update_one(
        {"_id": user["_id"]}, {"$set": {"password_hash": hash_password(body.new_password)}}
    )
    await bump_session(request, user["_id"])
    return {"ok": True}


@router.post("/auth/recovery/redeem")
async def redeem(request: Request, body: RecoveryBody):
    from fastapi.responses import JSONResponse

    user = await db(request).users.find_one({"email_key": name_key(body.email), "active": True})
    code_hash = hash_token(body.recovery_code.strip().upper())
    if user is None or code_hash not in user.get("recovery_hashes", []):
        raise AppError(401, "auth.invalid", "The email or password is not correct.")
    remaining = [item for item in user["recovery_hashes"] if item != code_hash]
    await db(request).users.update_one(
        {"_id": user["_id"]},
        {"$set": {"password_hash": hash_password(body.new_password), "recovery_hashes": remaining}},
    )
    await db(request).login_attempts.delete_many({"email_key": name_key(body.email)})
    await bump_session(request, user["_id"])
    fresh = await db(request).users.find_one({"_id": user["_id"]})
    response = JSONResponse({"user": public_user(fresh)})
    await open_session(request, fresh, response)
    return response


@router.get("/roles")
async def list_roles(request: Request) -> dict:
    user = await current_user(request)
    require(user, "grant.manage", institute_resource(user))
    roles = await db(request).roles.find({"institute_id": user["institute_id"]}).to_list(length=100)
    return {
        "items": [
            {"id": role["_id"], "name": role["name"], "actions": role["actions"]} for role in roles
        ]
    }


@router.post("/roles")
async def create_role(request: Request, body: RoleBody) -> dict:
    user = await current_user(request)
    require(user, "grant.manage", institute_resource(user))
    unknown = [action for action in body.actions if action not in ACTIONS]
    if unknown:
        raise AppError(422, "role.unknown_action", "That role includes an unknown action.")
    held = contained_actions(user["grants"], institute_resource(user))
    if any(action not in held for action in body.actions):
        raise AppError(403, "auth.forbidden", "You cannot grant an action you do not have.")
    document = {
        "_id": new_id(),
        "institute_id": user["institute_id"],
        "name": body.name.strip(),
        "name_key": name_key(body.name),
        "actions": body.actions,
    }
    try:
        await db(request).roles.insert_one(document)
    except DuplicateKeyError:
        raise AppError(409, "role.exists", "A role with that name already exists.") from None
    await write_audit(request, user, "role.create", None, {"name": document["name"]}, institute_resource(user))
    return {"id": document["_id"], "name": document["name"], "actions": document["actions"]}


@router.get("/users")
async def list_users(request: Request) -> dict:
    user = await current_user(request)
    if not any("user.manage" in grant["actions"] for grant in user["grants"]):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    require(user, "user.manage", institute_resource(user))
    users = await db(request).users.find({"institute_id": user["institute_id"]}).to_list(length=500)
    return {"items": [public_user(item) for item in users]}


@router.post("/users")
async def create_user(request: Request, body: UserBody) -> dict:
    actor = await current_user(request)
    require(actor, "user.manage", institute_resource(actor))
    role = await _role(request, actor["institute_id"], body.role)
    scope = clean_scope(body.scope, actor["institute_id"])
    consequence = _guard_delegate(actor, scope, _role_actions(role), body.acknowledge_scope)
    user_id = new_id()
    try:
        await db(request).users.insert_one(
            {
                "_id": user_id,
                "institute_id": actor["institute_id"],
                "name": body.name.strip(),
                "email": body.email.strip(),
                "email_key": name_key(body.email),
                "password_hash": hash_password(body.password),
                "recovery_hashes": [],
                "totp_secret": None,
                "active": True,
                "session_version": 1,
            }
        )
    except DuplicateKeyError:
        raise AppError(409, "user.exists", "A user with that email already exists.") from None
    grant = {
        "_id": new_id(),
        "institute_id": actor["institute_id"],
        "user_id": user_id,
        "role": role["name"],
        "role_id": role["_id"],
        "actions": list(role["actions"]),
        "scope": scope,
    }
    await db(request).grants.insert_one(grant)
    await write_audit(request, actor, "user.create", None, {"user_id": user_id, "role": role["name"]}, scope)
    created = await db(request).users.find_one({"_id": user_id})
    return {"user": public_user(created), "consequence": consequence}


@router.patch("/users/{user_id}")
async def patch_user(request: Request, user_id: str, body: UserPatch) -> dict:
    actor = await current_user(request)
    require(actor, "user.manage", institute_resource(actor))
    target = await db(request).users.find_one(
        {"_id": user_id, "institute_id": actor["institute_id"]}
    )
    if target is None:
        raise AppError(404, "not_found", "That record was not found.")
    if body.active is False:
        await _ensure_admin_remains(request, actor["institute_id"], user_id)
        await db(request).users.update_one({"_id": user_id}, {"$set": {"active": False}})
        await bump_session(request, user_id)
        await write_audit(
            request, actor, "user.deactivate", {"active": True}, {"active": False}, institute_resource(actor)
        )
    elif body.active is True:
        await db(request).users.update_one({"_id": user_id}, {"$set": {"active": True}})
        await write_audit(
            request, actor, "user.activate", {"active": False}, {"active": True}, institute_resource(actor)
        )
    updated = await db(request).users.find_one({"_id": user_id})
    return public_user(updated)


@router.post("/grants")
async def create_grant(request: Request, body: GrantBody) -> dict:
    actor = await current_user(request)
    target = await db(request).users.find_one(
        {"_id": body.user_id, "institute_id": actor["institute_id"]}
    )
    if target is None:
        raise AppError(404, "not_found", "That record was not found.")
    role = await _role(request, actor["institute_id"], body.role)
    scope = clean_scope(body.scope, actor["institute_id"])
    consequence = _guard_delegate(actor, scope, _role_actions(role), body.acknowledge_scope)
    grant = {
        "_id": new_id(),
        "institute_id": actor["institute_id"],
        "user_id": target["_id"],
        "role": role["name"],
        "role_id": role["_id"],
        "actions": list(role["actions"]),
        "scope": scope,
    }
    await db(request).grants.insert_one(grant)
    await bump_session(request, target["_id"])
    await write_audit(request, actor, "grant.create", None, {"role": role["name"], "user_id": target["_id"]}, scope)
    return {"id": grant["_id"], "consequence": consequence}


@router.delete("/grants/{grant_id}")
async def delete_grant(request: Request, grant_id: str) -> dict:
    actor = await current_user(request)
    grant = await db(request).grants.find_one(
        {"_id": grant_id, "institute_id": actor["institute_id"]}
    )
    if grant is None:
        raise AppError(404, "not_found", "That record was not found.")
    if not allows(actor["grants"], "grant.manage", grant["scope"]):
        raise AppError(403, "auth.forbidden", "You cannot assign access outside your own scope.")
    if "grant.manage" in grant["actions"] and not grant["scope"].get("branch_id"):
        other = await db(request).grants.count_documents(
            {
                "user_id": grant["user_id"],
                "actions": "grant.manage",
                "scope.branch_id": None,
                "_id": {"$ne": grant_id},
            }
        )
        if other == 0:
            await _ensure_admin_remains(request, actor["institute_id"], grant["user_id"])
    await db(request).grants.delete_one({"_id": grant_id})
    await bump_session(request, grant["user_id"])
    await write_audit(request, actor, "grant.delete", {"id": grant_id, "role": grant["role"]}, None, grant["scope"])
    return {"ok": True}


@router.get("/users/{user_id}/effective-access")
async def effective_access(request: Request, user_id: str) -> dict:
    actor = await current_user(request)
    require(actor, "grant.manage", institute_resource(actor))
    target = await db(request).users.find_one(
        {"_id": user_id, "institute_id": actor["institute_id"]}
    )
    if target is None:
        raise AppError(404, "not_found", "That record was not found.")
    rows = await grants_for(request, target["_id"])
    return {
        "user": public_user(target),
        "grants": [
            {
                "id": row["_id"],
                "role": row.get("role"),
                "actions": row["actions"],
                "scope": row["scope"],
                "consequence": describe_scope(row["scope"]),
            }
            for row in rows
        ],
    }


@router.get("/audit")
async def list_audit(request: Request, q: str = "", action: str = "", on: str = "", page: int = 0) -> dict:
    user = await current_user(request)
    require(user, "audit.view", institute_resource(user))
    query: dict = {"institute_id": user["institute_id"]}
    if action:
        query["action"] = action
    events = (
        await db(request)
        .audit_events.find(query)
        .sort("at", -1)
        .to_list(length=500)
    )
    actor_names: dict[str, str] = {}
    for event in events:
        actor_id = event.get("actor_id")
        if actor_id and actor_id not in actor_names:
            person = await db(request).users.find_one({"_id": actor_id})
            actor_names[actor_id] = person["name"] if person else ""
    if q:
        needle = q.casefold()
        events = [
            event
            for event in events
            if needle in event["action"].casefold()
            or needle in str(event.get("actor_id") or "").casefold()
            or needle in actor_names.get(event.get("actor_id"), "").casefold()
        ]
    if on:
        events = [event for event in events if event["at"].date().isoformat() == on]
    total = len(events)
    current = page or 1
    if page:
        events = events[(page - 1) * 25 : page * 25]
    pages = max(1, (total + 24) // 25)
    return {
        "items": [
            {
                "id": event["_id"],
                "action": event["action"],
                "at": event["at"].isoformat(),
                "actor_id": event["actor_id"],
                "actor_name": actor_names.get(event.get("actor_id"), ""),
                "before": event.get("before"),
                "after": event.get("after"),
                "context": event.get("context"),
                "scope": event.get("scope"),
            }
            for event in events
        ],
        "total": total,
        "page": current,
        "pages": pages,
    }


@router.get("/policies/active")
async def active_policy(request: Request) -> dict:
    user = await current_user(request)
    require(user, "dashboard.view", institute_resource(user))
    policy = await db(request).policies.find_one(
        {"institute_id": user["institute_id"]}, sort=[("version", -1)]
    )
    if policy is None:
        raise AppError(404, "not_found", "That record was not found.")
    policy["id"] = policy.pop("_id")
    return policy


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
    field = {
        "branch": "branch_id",
        "course": "course_id",
        "subject": "subject_id",
        "batch": "batch_id",
        "paper": "paper_id",
    }[dimension]
    clause = mongo_clause(
        user["grants"],
        "dashboard.view",
        {"institute_id": "institute_id", field: "_id"},
    )
    upload_clause = mongo_clause(
        user["grants"],
        "marksheet.upload",
        {"institute_id": "institute_id", field: "_id"},
    )
    query = {"institute_id": user["institute_id"], "$or": [clause, upload_clause]}
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
        label = row.get("name") or (f"Paper {row['number']}" if row.get("number") is not None else row["_id"])
        parents = {key: row[key] for key in ("branch_id", "course_id", "subject_id") if row.get(key)}
        if dimension == "course":
            parents["branch_ids"] = branches_for_course.get(row["_id"], [])
        if dimension == "paper" and row.get("subject_id"):
            parents["course_id"] = subject_course.get(row["subject_id"])
        items.append({"id": row["_id"], "label": label, "parents": parents})
    return {"items": items}


@router.get("/views/{level}")
async def view(
    request: Request,
    level: str,
    branch_id: str = "",
    course_id: str = "",
    batch_id: str = "",
    subject_id: str = "",
    paper_id: str = "",
    exam_type: str = "",
    exam_date: str = "",
    exam_date_from: str = "",
    exam_date_to: str = "",
    attempt: str = "",
    page: int = 1,
    attention_page: int = 1,
) -> dict:
    user = await current_user(request)
    if level not in {"institute", "branch", "course", "batch", "subject", "paper"}:
        raise AppError(404, "not_found", "That record was not found.")
    if not any("dashboard.view" in grant["actions"] for grant in user["grants"]):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    start, end = _period(exam_date_from, exam_date_to)
    filters = {
        "branch_id": branch_id,
        "course_id": course_id,
        "batch_id": batch_id,
        "subject_id": subject_id,
        "paper_id": paper_id,
        "exam_type": exam_type,
        "exam_date": exam_date,
        "exam_date_from": start,
        "exam_date_to": end,
        "attempt": attempt if attempt in {"original", "retest"} else "",
    }
    branch_clause = mongo_clause(
        user["grants"], "dashboard.view", {"institute_id": "institute_id", "branch_id": "_id"}
    )
    branch_query = {"institute_id": user["institute_id"], **_and(branch_clause)}
    if branch_id:
        branch_query["_id"] = branch_id
    branches = await db(request).branches.count_documents(branch_query)
    enrollment_clause = mongo_clause(
        user["grants"],
        "dashboard.view",
        {
            "institute_id": "institute_id",
            "branch_id": "branch_id",
            "course_id": "course_id",
            "batch_id": "batch_id",
        },
    )
    enrollment_query = {"institute_id": user["institute_id"], **_and(enrollment_clause)}
    for field in ("branch_id", "course_id", "batch_id"):
        if filters[field]:
            enrollment_query[field] = filters[field]
    enrollment_rows = await _every(db(request).enrollments.find(enrollment_query))
    student_ids = {item["student_id"] for item in enrollment_rows}
    from app.calculating import aggregate
    from app.reporting import (
        attention,
        authorized,
        hydrate,
        matches,
        names_for,
        participation_summary,
        policy_for,
        rank_page,
        student_boards,
        view_sections,
    )

    policy = await policy_for(db(request), user["institute_id"])
    result_clause = mongo_clause(
        user["grants"],
        "dashboard.view",
        {
            "institute_id": "institute_id",
            "branch_id": "branch_id",
            "course_id": "course_id",
            "batch_id": "batch_id",
            "subject_id": "subject_id",
            "paper_id": "paper_id",
        },
    )
    result_query = {"institute_id": user["institute_id"], "active": {"$ne": False}, **_and(result_clause)}
    for field in ("branch_id", "course_id", "batch_id", "subject_id", "paper_id"):
        if filters.get(field):
            result_query[field] = filters[field]
    stored = await _every(db(request).results.find(result_query))
    rows = [row for row in await hydrate(db(request), stored) if row.get("published") and matches(row, filters)]
    rows = authorized(rows, user["grants"], "dashboard.view")
    academic_fields = ("subject_id", "paper_id", "exam_type", "exam_date", "exam_date_from", "exam_date_to", "attempt")
    academic = any(filters.get(field) for field in academic_fields)
    if academic:
        matched_students = {row.get("student_id") for row in rows if row.get("student_id")}
        enrollment_rows = [item for item in enrollment_rows if item.get("student_id") in matched_students]
        student_count = len(matched_students)
    else:
        student_count = len(student_ids)
    summary = aggregate(rows, policy)
    summary["participation"] = None
    confirmed, eligible = await _eligible_rosters(request, user["institute_id"], rows)
    if confirmed:
        summary.update(participation_summary(rows, eligible))
    current_policy = policy.get("version")
    published_versions = (row.get("policy_version") for row in rows)
    pending = any(item is not None and item != current_policy for item in published_versions)
    names = await names_for(db(request), rows)
    boards = student_boards(level, rows, policy, names, attention_page=attention_page)
    danger = attention(rows, policy)
    attention_students = {item.get("student_id") for item in danger if item.get("student_id")}
    attention_size = 20
    attention_pages = max(1, (len(danger) + attention_size - 1) // attention_size) if danger else 1
    current_attention = min(max(attention_page, 1), attention_pages)
    shown_attention = danger[(current_attention - 1) * attention_size : current_attention * attention_size]
    named_rows = list(shown_attention) + list(boards["top_students"])
    for group in boards["boards"]:
        named_rows.extend(group["top_students"])
        named_rows.extend(group["attention"])
    attention_ids = list({item.get("student_id") for item in named_rows if item.get("student_id")})
    student_names = {}
    student_codes = {}
    if attention_ids:
        query = {"_id": {"$in": attention_ids}}
        projection = {"display_name": 1, "student_code": 1}
        found = await db(request).students.find(query, projection).to_list(length=len(attention_ids))
        for person in found:
            student_names[person["_id"]] = person.get("display_name") or ""
            student_codes[person["_id"]] = person.get("student_code") or ""
    for item in named_rows:
        item["student_name"] = student_names.get(item.get("student_id"), "")
        item["student_code"] = student_codes.get(item.get("student_id"), "")
    return {
        "level": level,
        "branches": branches,
        "students": student_count,
        "enrollments": len(enrollment_rows),
        "roster_confirmed": confirmed,
        "membership_label": "students listed in imported marklists",
        "policy_version": policy.get("version", 1),
        "policy_label": policy.get("aggregate") or "maximum-marks-weighted",
        "pending_recalculation": pending,
        "sample_size": summary["scored"],
        "performance": summary,
        "sections": view_sections(level, rows, enrollment_rows, names, policy),
        "top_students": boards["top_students"],
        "top_student_count": boards["top_student_count"],
        "boards": boards["boards"],
        "attention": shown_attention,
        "attention_count": len(danger),
        "attention_result_count": len(danger),
        "attention_student_count": len(attention_students),
        "attention_sample_count": len(shown_attention),
        "attention_page": current_attention,
        "attention_pages": attention_pages,
        "ranks": rank_page(rows, page),
        "empty": not rows,
        "filters": {key: value for key, value in filters.items() if value},
    }


async def _every(cursor) -> list:
    return [item async for item in cursor]


async def _eligible_rosters(request: Request, institute_id: str, rows: list[dict]) -> tuple[bool, dict]:
    batch_ids = {row.get("batch_id") for row in rows if row.get("batch_id")}
    if not batch_ids:
        return False, {}
    stored = await _every(
        db(request).rosters.find({"institute_id": institute_id, "batch_id": {"$in": list(batch_ids)}})
    )
    eligible = {item["batch_id"]: set(item.get("student_ids") or []) for item in stored}
    return batch_ids <= set(eligible), eligible


@router.post("/rosters/confirm")
async def confirm_roster(request: Request) -> dict:
    user = await current_user(request)
    body = await request.json()
    batch_id = str(body.get("batch_id") or "")
    batch = await db(request).batches.find_one({"_id": batch_id, "institute_id": user["institute_id"]})
    if batch is None:
        raise AppError(404, "not_found", "That record was not found.")
    resource = {
        "institute_id": user["institute_id"],
        "branch_id": batch.get("branch_id"),
        "course_id": batch.get("course_id"),
        "batch_id": batch_id,
    }
    if not allows(user["grants"], "catalog.manage", resource):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    listed = await _every(db(request).enrollments.find({"batch_id": batch_id}))
    await db(request).rosters.update_one(
        {"institute_id": user["institute_id"], "batch_id": batch_id},
        {"$set": {"student_ids": [item["student_id"] for item in listed], "confirmed_by": user["_id"]}},
        upsert=True,
    )
    return {"batch_id": batch_id, "listed": len(listed), "roster_confirmed": True}


def _and(clause: dict) -> dict:
    if "$or" in clause or clause == {"_id": {"$exists": False}}:
        return clause
    return clause


@router.get("/students")
async def list_students(
    request: Request,
    q: str = "",
    branch_id: str = "",
    course_id: str = "",
    batch_id: str = "",
    subject_id: str = "",
    paper_id: str = "",
    exam_type: str = "",
    exam_date_from: str = "",
    exam_date_to: str = "",
    attempt: str = "",
    sort: str = "name",
    page: int = 0,
    page_size: int = 8,
) -> dict:
    user = await current_user(request)
    clause = mongo_clause(
        user["grants"],
        "student.lookup",
        {
            "institute_id": "institute_id",
            "branch_id": "branch_id",
            "course_id": "course_id",
            "batch_id": "batch_id",
        },
    )
    if not any("student.lookup" in grant["actions"] for grant in user["grants"]):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    enrollment_query: dict = {"institute_id": user["institute_id"], **clause}
    for field, value in (("branch_id", branch_id), ("course_id", course_id), ("batch_id", batch_id)):
        if value:
            enrollment_query[field] = value
    enrollments = await db(request).enrollments.find(enrollment_query).to_list(length=1000)
    student_ids = list({item["student_id"] for item in enrollments})
    filters = _report_filters(
        branch_id, course_id, batch_id, subject_id, paper_id, exam_type, exam_date_from, exam_date_to, attempt,
    )
    academic_fields = ("subject_id", "paper_id", "exam_type", "exam_date_from", "exam_date_to", "attempt")
    academic = any(filters.get(field) for field in academic_fields)
    students = []
    if student_ids:
        students = await db(request).students.find({"_id": {"$in": student_ids}}).to_list(length=len(student_ids))
    needle = q.casefold().strip()
    if needle:
        students = [
            student for student in students
            if needle in f"{student.get('student_code', '')} {student.get('display_name', '')}".casefold()
        ]
    from app.calculating import aggregate
    from app.reporting import hydrate, matches, policy_for

    policy = await policy_for(db(request), user["institute_id"])
    grouped: dict[str, list] = {}
    if student_ids:
        found = await db(request).results.find(
            {"institute_id": user["institute_id"], "active": {"$ne": False}, "student_id": {"$in": student_ids}}
        ).to_list(length=5000)
        for row in await hydrate(db(request), found):
            resource = {
                "institute_id": row.get("institute_id"),
                "branch_id": row.get("branch_id"),
                "course_id": row.get("course_id"),
                "batch_id": row.get("batch_id"),
                "subject_id": row.get("subject_id"),
                "paper_id": row.get("paper_id"),
            }
            if not allows(user["grants"], "progress_card.view", resource) or not matches(row, filters):
                continue
            grouped.setdefault(row.get("student_id"), []).append(row)
    manage = allows(user["grants"], "student.manage", institute_resource(user))
    items = []
    included_rows: list = []
    for student in students:
        rows = grouped.get(student["_id"], [])
        if academic and not rows:
            continue
        summary = aggregate(rows, policy)
        latest = max((str(row.get("exam_date") or "") for row in rows), default="")
        item = {
            "id": student["_id"],
            "student_code": student["student_code"],
            "display_name": student["display_name"],
            "performance": {
                "percentage": summary["percentage"],
                "scored": summary["scored"],
                "expected": summary["expected"],
                "missing": summary["missing"],
                "absent": summary["absent"],
                "band": summary["band"],
            },
            "latest_exam_date": latest or None,
            "empty_reason": None if rows else "unpublished",
        }
        if manage:
            item["name_key"] = student.get("name_key")
        items.append(item)
        included_rows.extend(rows)
    report = aggregate(included_rows, policy)
    summary = {
        "percentage": report["percentage"],
        "scored": report["scored"],
        "expected": report["expected"],
        "missing": report["missing"],
        "absent": report["absent"],
        "band": report["band"],
        "students": len(items),
        "with_results": sum(1 for item in items if item["empty_reason"] is None),
    }
    total = len(items)
    current = page or 1
    size = min(max(page_size, 1), 50)
    if page:
        items.sort(key=lambda item: _student_sort_key(item, sort))
        offset = (current - 1) * size
        items = items[offset:offset + size]
    pages = max(1, (total + size - 1) // size) if total else 1
    return {"items": items, "total": total, "page": current if page else 0, "pages": pages, "summary": summary}


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


def _student_sort_key(item: dict, sort: str):
    name = str(item.get("display_name") or "").casefold()
    code = str(item.get("student_code") or "")
    if sort == "percentage":
        percentage = (item.get("performance") or {}).get("percentage")
        return (percentage is None, -(percentage if percentage is not None else 0), name, code)
    if sort == "exam_date":
        latest = str(item.get("latest_exam_date") or "")
        return (latest == "", "".join(chr(255 - ord(char)) for char in latest), name, code)
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


@router.get("/students/{student_id}/card")
async def student_card(
    request: Request,
    student_id: str,
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
    user = await current_user(request)
    student = await db(request).students.find_one(
        {"_id": student_id, "institute_id": user["institute_id"]}
    )
    if student is None:
        raise AppError(404, "not_found", "That record was not found.")
    enrollments = await db(request).enrollments.find({"student_id": student_id}).to_list(length=50)
    visible = False
    for enrollment in enrollments:
        resource = {
            "institute_id": enrollment["institute_id"],
            "branch_id": enrollment["branch_id"],
            "course_id": enrollment["course_id"],
            "batch_id": enrollment["batch_id"],
        }
        if allows(user["grants"], "progress_card.view", resource, resource_fields_only=True):
            visible = True
    if not visible:
        raise AppError(404, "not_found", "That record was not found.")
    results = await db(request).results.find({"student_id": student_id, "active": {"$ne": False}}).to_list(length=500)
    from app.calculating import aggregate
    from app.reporting import comparisons, hydrate, matches, policy_for, present, ranks_for

    policy = await policy_for(db(request), user["institute_id"])
    hydrated = await hydrate(db(request), results)
    shown_rows = []
    hidden = False
    for result in hydrated:
        resource = {
            "institute_id": result["institute_id"],
            "branch_id": result["branch_id"],
            "course_id": result["course_id"],
            "batch_id": result.get("batch_id"),
            "subject_id": result.get("subject_id"),
            "paper_id": result.get("paper_id"),
        }
        if allows(user["grants"], "progress_card.view", resource):
            shown_rows.append(result)
        else:
            hidden = True
    siblings = {}
    if not hidden:
        sheet_ids = list({row.get("marksheet_id") for row in shown_rows if row.get("marksheet_id")})
        if sheet_ids:
            found = await db(request).results.find(
                {"marksheet_id": {"$in": sheet_ids}, "active": {"$ne": False}}
            ).to_list(length=5000)
            cohort = await hydrate(db(request), found)
            for row in cohort:
                siblings.setdefault(row.get("marksheet_id"), []).append(row)
    start_filters = _report_filters(
        branch_id, course_id, batch_id, subject_id, paper_id, exam_type, exam_date_from, exam_date_to, attempt,
    )
    card_filters = start_filters
    start = card_filters.get("exam_date_from") or ""
    end = card_filters.get("exam_date_to") or ""
    enrolled = [
        item for item in enrollments
        if all(
            not card_filters.get(field) or item.get(field) == card_filters[field]
            for field in ("branch_id", "course_id", "batch_id")
        )
    ]
    context_selected = any(card_filters.get(field) for field in ("branch_id", "course_id", "batch_id"))
    if context_selected and not enrolled:
        selected = []
        empty_reason = "enrollment"
    else:
        selected = [row for row in shown_rows if matches(row, card_filters)]
        if not shown_rows and hidden:
            empty_reason = "restricted"
        elif not shown_rows:
            empty_reason = "unpublished"
        elif not selected:
            empty_reason = "filters"
        else:
            empty_reason = None
    presented = []
    for row in selected:
        rank = batch_rank = None
        if not hidden:
            rank, batch_rank = ranks_for(row, siblings.get(row.get("marksheet_id"), [row]))
        presented.append(present(row, policy, rank, batch_rank))
    summary = aggregate(selected, policy)
    grouped: dict[tuple, list] = {}
    for row in selected:
        grouped.setdefault((row.get("subject_id") or "", row.get("paper_id") or ""), []).append(row)
    subjects = [
        {"subject_id": key[0] or None, "paper_id": key[1] or None, **aggregate(rows, policy)}
        for key, rows in grouped.items()
    ]
    outside = []
    if empty_reason != "enrollment" and (start or end):
        undated = {key: value for key, value in card_filters.items() if key not in {"exam_date_from", "exam_date_to"}}
        outside = [row for row in shown_rows if matches(row, undated) and not matches(row, card_filters)]
    facet_batches = {item.get("batch_id") for item in enrollments if item.get("batch_id")}
    facet_batches.update(row.get("batch_id") for row in shown_rows if row.get("batch_id"))
    return {
        "student_code": student["student_code"],
        "display_name": student["display_name"],
        "partial": hidden,
        "coverage_note": "Authorized subjects only." if hidden else None,
        "empty_reason": empty_reason,
        "membership_label": "students listed in imported marklists",
        "policy_version": policy.get("version", 1),
        "performance": summary,
        "subjects": subjects,
        "retests": comparisons(selected, outside),
        "filters": card_filters,
        "result_count": len(presented),
        "facets": {
            "batch_ids": sorted(facet_batches),
            "subject_ids": sorted({row.get("subject_id") for row in shown_rows if row.get("subject_id")}),
            "paper_ids": sorted({row.get("paper_id") for row in shown_rows if row.get("paper_id")}),
        },
        "enrollments": [
            {
                "id": item["_id"],
                "batch_id": item["batch_id"],
                "branch_id": item.get("branch_id"),
                "course_id": item.get("course_id"),
            }
            for item in enrollments
        ],
        "results": presented,
    }


@router.get("/marksheets/{marksheet_id}")
async def get_marksheet(request: Request, marksheet_id: str) -> dict:
    user = await current_user(request)
    sheet = await db(request).marksheets.find_one(
        {"_id": marksheet_id, "institute_id": user["institute_id"]}
    )
    if sheet is None:
        raise AppError(404, "not_found", "That record was not found.")
    resource = _sheet_resource(sheet)
    if not allows(user["grants"], "marksheet.view", resource):
        raise AppError(404, "not_found", "That record was not found.")
    revision = sheet.get("active_revision") or sheet.get("revision") or 1
    results = await db(request).results.find(
        {"marksheet_id": sheet["_id"], "revision": revision}
    ).to_list(length=500)
    student_ids = list({item.get("student_id") for item in results if item.get("student_id")})
    names = {}
    codes = {}
    if student_ids:
        for person in await db(request).students.find({"_id": {"$in": student_ids}}).to_list(length=len(student_ids)):
            names[person["_id"]] = person.get("display_name") or ""
            codes[person["_id"]] = person.get("student_code") or ""
    available = []
    if sheet.get("status") in {"draft", "submitted"}:
        batch_ids = sheet.get("batch_ids") or []
        enrolled = await db(request).enrollments.find({"batch_id": {"$in": batch_ids}}).to_list(length=500)
        waiting = [item["student_id"] for item in enrolled if item["student_id"] not in set(student_ids)]
        if waiting:
            for person in await db(request).students.find({"_id": {"$in": waiting}}).to_list(length=len(waiting)):
                available.append({
                    "id": person["_id"],
                    "display_name": person.get("display_name") or "",
                    "student_code": person.get("student_code") or "",
                })
    return {
        "id": sheet["_id"],
        "status": sheet.get("status"),
        "branch_id": sheet.get("branch_id"),
        "course_id": sheet.get("course_id"),
        "subject_id": sheet.get("subject_id"),
        "paper_id": sheet.get("paper_id"),
        "batch_ids": sheet.get("batch_ids") or [],
        "attempt_kind": sheet.get("attempt_kind") or "original",
        "title": sheet.get("title"),
        "exam_date": sheet.get("exam_date"),
        "exam_type": sheet.get("exam_type"),
        "maximum": sheet.get("maximum"),
        "source_file": sheet.get("source_file"),
        "source_sheet": sheet.get("source_sheet"),
        "revision": revision,
        "edit_version": sheet.get("edit_version", 0),
        "file_id": sheet.get("file_id"),
        "uploader_id": sheet.get("uploader_id"),
        "reviewer_id": sheet.get("reviewer_id"),
        "available_students": available,
        "results": [
            {
                "id": item["_id"],
                "student_id": item.get("student_id"),
                "display_name": names.get(item.get("student_id"), ""),
                "student_code": codes.get(item.get("student_id"), ""),
                "status": item.get("status"),
                "score": item.get("score"),
                "rank": item.get("rank"),
                "percentage": item.get("percentage"),
                "previous_score": item.get("previous_score"),
                "source": item.get("source"),
            }
            for item in results
        ],
    }


@router.post("/marksheets/{marksheet_id}/publish")
async def publish_marksheet(request: Request, marksheet_id: str) -> dict:
    user = await current_user(request)
    sheet = await db(request).marksheets.find_one(
        {"_id": marksheet_id, "institute_id": user["institute_id"]}
    )
    if sheet is None or not allows(user["grants"], "marksheet.view", _sheet_resource(sheet)):
        raise AppError(404, "not_found", "That record was not found.")
    if not allows(user["grants"], "marksheet.publish", _sheet_resource(sheet)):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    if not sheet.get("assessment_id"):
        raise AppError(422, "marksheet.not_ready", "Publication is available after a marklist is imported.")
    from app.importing.publish import publish_revision

    return await publish_revision(db(request), request.app.state.client, user, sheet)


@router.post("/imports/commit")
async def commit_import(request: Request, body: ImportCommitBody) -> dict:
    user = await current_user(request)
    for sheet in body.sheets:
        if sheet.get("skipped"):
            continue
        scope = clean_scope(sheet.get("scope"), user["institute_id"])
        if not allows(user["grants"], "marksheet.upload", scope):
            raise AppError(
                403,
                "auth.forbidden",
                "You do not have permission to import that sheet.",
                sheet=sheet.get("name"),
            )
        dimension = sheet.get("create")
        if dimension:
            from app.acl import CREATE_ACTION

            action = CREATE_ACTION[dimension]
            if not allows(user["grants"], action, scope):
                raise AppError(
                    403,
                    "auth.forbidden",
                    "You do not have permission to create that record.",
                    dimension=dimension,
                )
    raise AppError(422, "import.not_ready", "Workbook import is the next milestone.")


@router.post("/reports/cards")
async def queue_cards(request: Request, body: ReportBody) -> dict:
    user = await current_user(request)
    if body.format not in {"pdf", "xlsx"}:
        raise AppError(422, "report.format", "Choose a PDF or spreadsheet export.")
    action = "export.pdf" if body.format == "pdf" else "export.xlsx"
    scope = clean_scope(body.scope, user["institute_id"])
    card = _card_context(body.scope)
    if card.get("student_id"):
        student = await db(request).students.find_one(
            {"_id": card["student_id"], "institute_id": user["institute_id"]}
        )
        if student is None:
            raise AppError(404, "not_found", "That record was not found.")
        enrollments = await db(request).enrollments.find({"student_id": student["_id"]}).to_list(length=50)
        if not _export_covers_student(user, enrollments, scope, action):
            raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    elif not allows(user["grants"], "progress_card.view", scope) or not allows(user["grants"], action, scope):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    key = request.headers.get("Idempotency-Key")
    job = await enqueue(
        db(request),
        kind="report_pdf" if body.format == "pdf" else "report_xlsx",
        actor=user,
        payload={"scope": scope, "card": card},
        idempotency_key=key,
    )
    await write_audit(request, user, "export.queue", None, {"job_id": job["_id"]}, scope)
    return {"id": job["_id"], "state": job["state"]}


@router.get("/jobs/{job_id}")
async def get_job(request: Request, job_id: str) -> dict:
    user = await current_user(request)
    job = await db(request).jobs.find_one({"_id": job_id, "actor_id": user["_id"]})
    if job is None:
        raise AppError(404, "not_found", "That record was not found.")
    return {
        "id": job["_id"],
        "state": job["state"],
        "last_error": job.get("last_error"),
        "file_id": job.get("file_id"),
    }


@router.post("/jobs/{job_id}/run")
async def run_job(request: Request, job_id: str) -> dict:
    user = await current_user(request)
    from app.jobs import run_actor_job

    job = await run_actor_job(db(request), settings(request).data_dir, job_id, user["_id"])
    if job is None:
        raise AppError(404, "not_found", "That record was not found.")
    return {
        "id": job["_id"],
        "state": job["state"],
        "last_error": job.get("last_error"),
        "file_id": job.get("file_id"),
    }


@router.post("/jobs/process")
async def process_jobs(request: Request) -> dict:
    user = await current_user(request)
    require(user, "backup.admin", institute_resource(user))
    count = await process_due_jobs(db(request), settings(request).data_dir)
    return {"processed": count}


@router.get("/files/{file_id}")
async def download_file(request: Request, file_id: str):
    from fastapi.responses import FileResponse

    user = await current_user(request)
    file_doc = await db(request).files.find_one(
        {"_id": file_id, "institute_id": user["institute_id"]}
    )
    if file_doc is None:
        raise AppError(404, "not_found", "That record was not found.")
    if file_doc.get("kind") == "source_xlsx":
        if not any("marksheet.view" in grant["actions"] for grant in user["grants"]):
            raise AppError(404, "not_found", "That record was not found.")
        return FileResponse(file_doc["path"], filename=file_doc.get("filename") or "marklist.xlsx")
    action = "export.pdf" if file_doc["kind"] == "report_pdf" else "export.xlsx"
    scope = file_doc.get("scope") or {}
    if not allows(user["grants"], action, scope):
        raise AppError(404, "not_found", "That record was not found.")
    return FileResponse(file_doc["path"], filename=file_doc.get("filename") or "export.txt")


def _sheet_resource(sheet: dict) -> dict:
    return {
        "institute_id": sheet["institute_id"],
        "branch_id": sheet.get("branch_id"),
        "course_id": sheet.get("course_id"),
        "batch_id": sheet.get("batch_id"),
        "subject_id": sheet.get("subject_id"),
        "paper_id": sheet.get("paper_id"),
    }
