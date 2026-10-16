"""Account, role, and grant rules used by administration and staff routes."""

from __future__ import annotations

from datetime import timedelta

from fastapi import Request

from app.acl import ACTIONS, contained_actions, describe_scope
from app.deps import _now, db, institute_resource, new_id, settings
from app.errors import AppError
from app.security import SESSION_COOKIE, SESSION_HOURS, hash_token, name_key, new_token


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


def clear_session_cookie(request: Request, response) -> None:
    response.delete_cookie(
        SESSION_COOKIE,
        path="/",
        secure=settings(request).cookie_secure,
        httponly=True,
        samesite="lax",
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


async def public_institute(request: Request, institute_id: str) -> dict:
    from app.clock import coerce_timezone

    institute = await db(request).institutes.find_one({"_id": institute_id})
    return {
        "id": institute["_id"],
        "name": institute["name"],
        "code": institute["code"],
        "timezone": coerce_timezone(institute.get("timezone")),
    }


def _checked_actions(user: dict, actions: list[str]) -> list[str]:
    if not actions:
        raise AppError(422, "role.empty", "Choose at least one permission.")
    unknown = [action for action in actions if action not in ACTIONS]
    if unknown:
        raise AppError(422, "role.unknown_action", "That role includes an unknown action.")
    held = contained_actions(user["grants"], institute_resource(user))
    if any(action not in held for action in actions):
        raise AppError(403, "auth.forbidden", "You cannot grant an action you do not have.")
    return list(dict.fromkeys(actions))


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
