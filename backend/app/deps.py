"""Request access, permission checks, and audit shared by every domain router."""

from __future__ import annotations

from datetime import datetime, timezone

from bson import ObjectId
from fastapi import Request

from app.acl import allows
from app.errors import AppError
from app.security import SESSION_COOKIE, hash_token


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


def public_user(user: dict) -> dict:
    return {
        "id": user["_id"],
        "name": user["name"],
        "email": user["email"],
        "active": user["active"],
    }


def public_grant(grant: dict) -> dict:
    return {
        "role": grant.get("role"),
        "scope": grant.get("scope") or {},
        "unit_ids": list(grant.get("unit_ids") or []),
    }
