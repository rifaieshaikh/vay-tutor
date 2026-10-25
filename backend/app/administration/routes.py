"""Accounts, access, audit, and institute policies."""

from __future__ import annotations

from datetime import timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from app.academics.curriculum import DEFAULT_CURRICULUM_KINDS, DEFAULT_EXAM_TYPES
from app.accounts import (
    _checked_actions,
    _ensure_admin_remains,
    _guard_delegate,
    _role,
    _role_actions,
    bump_session,
    clear_session_cookie,
    open_session,
    public_institute,
)
from app.acl import ACTIONS, ROLE_TEMPLATES, actions_for, allows, clean_scope, describe_scope
from app.deps import (
    _now,
    current_user,
    db,
    grants_for,
    institute_resource,
    new_id,
    public_grant,
    public_user,
    require,
    settings,
    write_audit,
)
from app.errors import AppError
from app.jobs import process_due_jobs
from app.security import (
    CHALLENGE_MINUTES,
    LOGIN_WINDOW_MINUTES,
    MAX_CHALLENGE_ATTEMPTS,
    MAX_LOGIN_FAILURES,
    SESSION_COOKIE,
    hash_password,
    hash_token,
    name_key,
    new_token,
    new_totp_secret,
    password_error,
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
    admin_email: str = Field(min_length=1)
    admin_password: str = Field(min_length=1)


class LoginBody(BaseModel):
    email: str
    password: str
    totp: str | None = None


class ChallengeBody(BaseModel):
    challenge: str
    code: str = ""


class RecoveryBody(BaseModel):
    email: str
    recovery_code: str
    new_password: str = Field(min_length=1)


class PasswordBody(BaseModel):
    current_password: str
    new_password: str = Field(min_length=1)


class FactoryResetBody(BaseModel):
    confirm: str = ""


class UserBody(BaseModel):
    name: str = Field(min_length=1)
    email: str = Field(min_length=1)
    password: str = Field(min_length=1)
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


class RolePatch(BaseModel):
    actions: list[str]


class BandBody(BaseModel):
    name: str = ""
    through: float | None = None


class PolicyBody(BaseModel):
    bands: list[BandBody] | None = None
    danger_below: float | None = None
    safe_above: float | None = None
    passing_threshold: float | None = None
    self_publication: bool | None = None


class ScopeBody(BaseModel):
    scope: dict[str, Any] = Field(default_factory=dict)


class ImportCommitBody(BaseModel):
    sheets: list[dict[str, Any]]


class ReportBody(BaseModel):
    format: str
    scope: dict[str, Any] = Field(default_factory=dict)


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
    problem = password_error(body.admin_password)
    if problem:
        raise AppError(422, "auth.password", problem, field="admin_password")
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
                        "timezone": "Asia/Kolkata",
                        "curriculum_kinds": [dict(item) for item in DEFAULT_CURRICULUM_KINDS],
                        "exam_types": [dict(item) for item in DEFAULT_EXAM_TYPES],
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


class InstituteTimezone(BaseModel):
    timezone: str = Field(min_length=1)


@router.patch("/institute")
async def update_institute_timezone(request: Request) -> dict:
    from pydantic import ValidationError

    from app.academics.catalog import PlaceBody, save_institute
    from app.clock import require_timezone

    payload = await request.json()
    if not isinstance(payload, dict):
        raise AppError(422, "catalog.profile", "That field cannot be changed here.")
    if "timezone" in payload:
        try:
            body = InstituteTimezone.model_validate(payload)
        except ValidationError as exc:
            raise AppError(422, "institute.timezone", "Choose a known timezone.", field="timezone") from exc
        user = await current_user(request)
        require(user, "grant.manage", institute_resource(user))
        try:
            zone = require_timezone(body.timezone)
        except ValueError:
            raise AppError(422, "institute.timezone", "Choose a known timezone.", field="timezone") from None
        await db(request).institutes.update_one({"_id": user["institute_id"]}, {"$set": {"timezone": zone}})
        await write_audit(request, user, "institute.timezone", None, {"timezone": zone}, institute_resource(user))
        return await public_institute(request, user["institute_id"])
    try:
        place = PlaceBody.model_validate(payload)
    except ValidationError as exc:
        raise AppError(422, "catalog.profile", "That field cannot be changed here.") from exc
    return await save_institute(request, place)


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
        raise AppError(401, "auth.invalid", "The username or password is not correct.")
    grants = await grants_for(request, user["_id"])
    needs_totp = settings(request).deployment_mode == "cloud" and allows(
        grants, "grant.manage", {"institute_id": user["institute_id"]}
    )
    if needs_totp and not body.totp:
        token = new_token()
        await db(request).login_challenges.insert_one(
            {
                "_id": new_id(),
                "token_hash": hash_token(token),
                "user_id": user["_id"],
                "expires_at": _now() + timedelta(minutes=CHALLENGE_MINUTES),
                "attempts": 0,
                "used": False,
            }
        )
        return JSONResponse({"verification": "totp", "challenge": token})
    if needs_totp and not verify_totp(user.get("totp_secret") or "", body.totp or ""):
        raise AppError(401, "auth.totp_required", "Enter the current authentication code.")
    await db(request).login_attempts.delete_many({"email_key": email_key})
    response = JSONResponse(
        {"user": public_user(user), "institute": await public_institute(request, user["institute_id"])}
    )
    await open_session(request, user, response)
    return response


@router.post("/auth/login/verify")
async def verify_login(request: Request, body: ChallengeBody):
    from fastapi.responses import JSONResponse

    challenge = await db(request).login_challenges.find_one({"token_hash": hash_token(body.challenge)})
    expires_at = challenge["expires_at"] if challenge else None
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if challenge is None or expires_at <= _now():
        raise AppError(401, "auth.challenge_expired", "That sign-in expired. Start again.")
    if challenge.get("attempts", 0) >= MAX_CHALLENGE_ATTEMPTS:
        raise AppError(429, "auth.rate_limited", "Too many sign-in attempts. Try again later.")
    if challenge.get("used"):
        raise AppError(401, "auth.challenge_expired", "That sign-in expired. Start again.")
    user = await db(request).users.find_one({"_id": challenge["user_id"], "active": True})
    if user is None or not verify_totp(user.get("totp_secret") or "", body.code):
        attempts = challenge.get("attempts", 0) + 1
        await db(request).login_challenges.update_one(
            {"_id": challenge["_id"]}, {"$set": {"attempts": attempts, "used": attempts >= MAX_CHALLENGE_ATTEMPTS}}
        )
        if attempts >= MAX_CHALLENGE_ATTEMPTS:
            raise AppError(429, "auth.rate_limited", "Too many sign-in attempts. Try again later.")
        raise AppError(401, "auth.totp_required", "Enter the current authentication code.")
    await db(request).login_challenges.update_one({"_id": challenge["_id"]}, {"$set": {"used": True}})
    await db(request).login_attempts.delete_many({"email_key": user["email_key"]})
    response = JSONResponse(
        {"user": public_user(user), "institute": await public_institute(request, user["institute_id"])}
    )
    await open_session(request, user, response)
    return response


@router.post("/auth/login/cancel")
async def cancel_login(request: Request, body: ChallengeBody):
    await db(request).login_challenges.delete_many({"token_hash": hash_token(body.challenge)})
    return {"ok": True}


@router.post("/auth/logout")
async def logout(request: Request):
    from fastapi.responses import JSONResponse

    token = request.cookies.get(SESSION_COOKIE)
    if token:
        await db(request).sessions.delete_one({"token_hash": hash_token(token)})
    response = JSONResponse({"ok": True})
    clear_session_cookie(request, response)
    return response


@router.post("/factory-reset")
async def factory_reset(request: Request, body: FactoryResetBody):
    from fastapi.responses import JSONResponse

    user = await current_user(request)
    require(user, "grant.manage", {"institute_id": user["institute_id"]})
    if body.confirm != "RESET":
        raise AppError(422, "reset.confirm", "Type RESET to wipe this install.")
    database = db(request)
    for name in await database.list_collection_names():
        if name == "schema_meta":
            continue
        await database[name].delete_many({})
    await database.counters.update_one({"_id": "student_code"}, {"$set": {"value": 0}}, upsert=True)
    _clear_stored_files(settings(request).data_dir / "files")
    response = JSONResponse({"ok": True})
    clear_session_cookie(request, response)
    return response


def _clear_stored_files(folder: Path) -> None:
    if not folder.exists():
        return
    for child in folder.iterdir():
        if child.is_dir():
            _clear_stored_files(child)
            child.rmdir()
        else:
            child.unlink()


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
        raise AppError(401, "auth.invalid", "The username or password is not correct.")
    problem = password_error(body.new_password)
    if problem:
        raise AppError(422, "auth.password", problem, field="new_password")
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
        raise AppError(401, "auth.invalid", "The username or password is not correct.")
    problem = password_error(body.new_password)
    if problem:
        raise AppError(422, "auth.password", problem, field="new_password")
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
    actions = _checked_actions(user, body.actions)
    document = {
        "_id": new_id(),
        "institute_id": user["institute_id"],
        "name": body.name.strip(),
        "name_key": name_key(body.name),
        "actions": actions,
    }
    try:
        await db(request).roles.insert_one(document)
    except DuplicateKeyError:
        raise AppError(409, "role.exists", "A role with that name already exists.") from None
    await write_audit(request, user, "role.create", None, {"name": document["name"]}, institute_resource(user))
    return {"id": document["_id"], "name": document["name"], "actions": document["actions"]}


@router.patch("/roles/{role_id}")
async def update_role(request: Request, role_id: str, body: RolePatch) -> dict:
    user = await current_user(request)
    require(user, "grant.manage", institute_resource(user))
    actions = _checked_actions(user, body.actions)
    role = await db(request).roles.find_one({"_id": role_id, "institute_id": user["institute_id"]})
    if role is None:
        raise AppError(404, "not_found", "That record was not found.")
    await db(request).roles.update_one({"_id": role_id}, {"$set": {"actions": actions}})
    await write_audit(
        request,
        user,
        "role.update",
        {"actions": role.get("actions") or []},
        {"actions": actions},
        institute_resource(user),
    )
    return {"id": role["_id"], "name": role["name"], "actions": actions}


@router.get("/users")
async def list_users(request: Request) -> dict:
    user = await current_user(request)
    if not any("user.manage" in grant["actions"] for grant in user["grants"]):
        raise AppError(403, "auth.forbidden", "You do not have permission for that action.")
    require(user, "user.manage", institute_resource(user))
    users = await db(request).users.find({"institute_id": user["institute_id"]}).to_list(length=500)
    user_ids = [item["_id"] for item in users]
    grants = await db(request).grants.find(
        {"institute_id": user["institute_id"], "user_id": {"$in": user_ids}}
    ).to_list(length=2000)
    grouped: dict[str, list[dict]] = {}
    for grant in grants:
        grouped.setdefault(grant["user_id"], []).append(public_grant(grant))
    return {"items": [{**public_user(item), "grants": grouped.get(item["_id"], [])} for item in users]}


@router.post("/users")
async def create_user(request: Request, body: UserBody) -> dict:
    actor = await current_user(request)
    require(actor, "user.manage", institute_resource(actor))
    problem = password_error(body.password)
    if problem:
        raise AppError(422, "auth.password", problem, field="password")
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
        raise AppError(409, "user.exists", "A user with that username already exists.") from None
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
                "unit_ids": list(row.get("unit_ids") or []),
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
    from app.calculating import public_bands

    policy["bands"] = public_bands(policy.get("bands"))
    return policy


def _percent(value: float, label: str) -> int | float:
    number = float(value)
    if number != number or number < 0 or number > 100:
        raise AppError(422, "policy.range", f"{label} must be from 0 through 100.")
    hundredths = round(number, 2)
    whole = round(hundredths)
    if abs(hundredths - whole) < 1e-9:
        return int(whole)
    return hundredths


@router.post("/policies")
async def create_policy(request: Request, body: PolicyBody) -> dict:
    user = await current_user(request)
    require(user, "grant.manage", institute_resource(user))
    current = await db(request).policies.find_one(
        {"institute_id": user["institute_id"]}, sort=[("version", -1)]
    )
    if current is None:
        raise AppError(404, "not_found", "That record was not found.")
    from app.calculating import prepare_bands, public_bands

    if body.bands:
        try:
            chosen = prepare_bands([item.model_dump() for item in body.bands])
        except ValueError as error:
            raise AppError(422, "policy.bands", str(error)) from None
    elif body.danger_below is not None and body.safe_above is not None:
        try:
            chosen = prepare_bands([
                {"name": "Danger", "through": body.danger_below},
                {"name": "Fifty-fifty", "through": body.safe_above},
                {"name": "Safe"},
            ])
        except ValueError as error:
            raise AppError(422, "policy.bands", str(error)) from None
    else:
        raise AppError(422, "policy.bands", "Choose the bands.")
    threshold = current.get("passing_threshold")
    if "passing_threshold" in body.model_fields_set:
        if body.passing_threshold is None:
            threshold = None
        else:
            threshold = _percent(body.passing_threshold, "The passing threshold")
    publication = bool(current.get("self_publication", False))
    if body.self_publication is not None:
        publication = body.self_publication
    current_bands = public_bands(current.get("bands"))
    chosen_bands = public_bands(chosen)
    same = (
        [(item["name"], item.get("through")) for item in current_bands]
        == [(item["name"], item.get("through")) for item in chosen_bands]
        and current.get("passing_threshold") == threshold
        and publication == bool(current.get("self_publication", False))
    )
    if same:
        raise AppError(422, "policy.unchanged", "Those rules are already in use.")
    version = int(current.get("version") or 1) + 1
    document = {
        "_id": new_id(),
        "institute_id": user["institute_id"],
        "version": version,
        "bands": chosen,
        "ranking": current.get("ranking") or "dense",
        "aggregate": current.get("aggregate") or "maximum-marks-weighted",
        "attempt": current.get("attempt") or "latest-by-date",
        "passing_threshold": threshold,
        "self_publication": publication,
    }
    try:
        await db(request).policies.insert_one(document)
    except DuplicateKeyError:
        raise AppError(409, "policy.conflict", "Someone else saved a policy. Reload and try again.") from None
    before = {
        "version": current.get("version"),
        "bands": [{"name": item["name"], "through": item.get("through")} for item in current_bands],
        "passing_threshold": current.get("passing_threshold"),
        "self_publication": bool(current.get("self_publication", False)),
    }
    after = {
        "version": version,
        "bands": [{"name": item["name"], "through": item.get("through")} for item in chosen_bands],
        "passing_threshold": threshold,
        "self_publication": publication,
    }
    await write_audit(request, user, "policy.update", before, after, institute_resource(user))
    earlier = await db(request).marksheets.count_documents(
        {"institute_id": user["institute_id"], "status": "published", "policy_version": {"$ne": version}}
    )
    document["id"] = document.pop("_id")
    document["bands"] = chosen_bands
    document["published_on_earlier_version"] = earlier
    return document


async def _job_view(request: Request, job: dict) -> dict:
    filename = None
    if job.get("file_id"):
        file_doc = await db(request).files.find_one(
            {"_id": job["file_id"], "institute_id": job.get("institute_id")}
        )
        if file_doc:
            filename = file_doc.get("filename")
    return {
        "id": job["_id"],
        "state": job["state"],
        "last_error": job.get("last_error"),
        "file_id": job.get("file_id"),
        "filename": filename,
    }


@router.get("/jobs/{job_id}")
async def get_job(request: Request, job_id: str) -> dict:
    user = await current_user(request)
    job = await db(request).jobs.find_one({"_id": job_id, "actor_id": user["_id"]})
    if job is None:
        raise AppError(404, "not_found", "That record was not found.")
    return await _job_view(request, job)


@router.post("/jobs/{job_id}/run")
async def run_job(request: Request, job_id: str) -> dict:
    user = await current_user(request)
    from app.jobs import run_actor_job

    job = await run_actor_job(db(request), settings(request).data_dir, job_id, user["_id"])
    if job is None:
        raise AppError(404, "not_found", "That record was not found.")
    return await _job_view(request, job)


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
    if file_doc.get("kind") == "student_photo":
        raise AppError(404, "not_found", "That record was not found.")
    if file_doc.get("kind") == "source_xlsx":
        if not any("marksheet.view" in grant["actions"] for grant in user["grants"]):
            raise AppError(404, "not_found", "That record was not found.")
        return FileResponse(file_doc["path"], filename=file_doc.get("filename") or "marklist.xlsx")
    action = "export.pdf" if file_doc["kind"] == "report_pdf" else "export.xlsx"
    scope = file_doc.get("scope") or {}
    if not allows(user["grants"], action, scope):
        raise AppError(404, "not_found", "That record was not found.")
    media = {
        "report_pdf": "application/pdf",
        "report_xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }.get(file_doc.get("kind"))
    return FileResponse(file_doc["path"], filename=file_doc.get("filename") or "export.txt", media_type=media)

