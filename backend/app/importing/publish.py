from __future__ import annotations

from datetime import datetime, timezone

from bson import ObjectId

from app.errors import AppError


def _now() -> datetime:
    return datetime.now(timezone.utc)


def publication_blockers(sheet: dict) -> list[dict]:
    blockers = []
    if not sheet.get("exam_date"):
        blockers.append({"code": "marksheet.exam_date", "message": "Add the exam date before publishing."})
    if sheet.get("heading_conflict") and not sheet.get("heading_acknowledged"):
        blockers.append({"code": "import.heading_conflict", "message": "Acknowledge the heading conflict before publishing."})
    return blockers


async def publish_revision(db, client, user: dict, sheet: dict) -> dict:
    blockers = publication_blockers(sheet)
    if blockers:
        raise AppError(422, "marksheet.not_ready", blockers[0]["message"], blockers=blockers)
    if sheet.get("status") not in {"draft", "submitted"}:
        raise AppError(422, "marksheet.state", "Only a draft or submitted marksheet can be published.")
    revision = sheet.get("revision") or 1
    async with await client.start_session() as session:
        async with session.start_transaction():
            await db.results.update_many(
                {"marksheet_id": sheet["_id"], "active": True},
                {"$set": {"active": False}},
                session=session,
            )
            await db.results.update_many(
                {"marksheet_id": sheet["_id"], "revision": revision},
                {"$set": {"active": True}},
                session=session,
            )
            await db.marksheets.update_one(
                {"_id": sheet["_id"]},
                {"$set": {"status": "published", "active_revision": revision, "reviewer_id": user["_id"], "published_at": _now()}},
                session=session,
            )
    await _audit(db, user, "marksheet.publish", {"marksheet_id": sheet["_id"], "revision": revision})
    return {"id": sheet["_id"], "status": "published", "revision": revision}


async def submit_marksheet(db, user: dict, sheet: dict) -> dict:
    if sheet.get("status") != "draft":
        raise AppError(422, "marksheet.state", "Only a draft can be submitted.")
    await db.marksheets.update_one({"_id": sheet["_id"]}, {"$set": {"status": "submitted"}})
    await _audit(db, user, "marksheet.submit", {"marksheet_id": sheet["_id"]})
    return {"id": sheet["_id"], "status": "submitted"}


async def reject_marksheet(db, user: dict, sheet: dict) -> dict:
    if sheet.get("status") != "submitted":
        raise AppError(422, "marksheet.state", "Only a submitted marksheet can be returned.")
    await db.marksheets.update_one({"_id": sheet["_id"]}, {"$set": {"status": "draft"}})
    await _audit(db, user, "marksheet.reject", {"marksheet_id": sheet["_id"]})
    return {"id": sheet["_id"], "status": "draft"}


def require_current_version(sheet: dict, edit_version: int | None) -> None:
    if edit_version is None:
        return
    if edit_version != sheet.get("edit_version", 0):
        raise AppError(409, "marksheet.conflict", "Someone else saved this marksheet. Reload and try again.")


async def correct_marksheet(db, client, user: dict, sheet: dict, reason: str, changes: list[dict], edit_version: int | None = None) -> dict:
    require_current_version(sheet, edit_version)
    if sheet.get("status") != "published":
        raise AppError(422, "marksheet.state", "Correct a published marksheet.")
    if not reason.strip():
        raise AppError(422, "marksheet.reason", "A correction needs a reason.")
    revision = (sheet.get("active_revision") or sheet.get("revision") or 1) + 1
    async with await client.start_session() as session:
        async with session.start_transaction():
            current = await db.results.find({"marksheet_id": sheet["_id"], "revision": revision - 1}).to_list(length=5000)
            by_id = {item["_id"]: item for item in current}
            await db.results.update_many(
                {"marksheet_id": sheet["_id"], "active": True},
                {"$set": {"active": False}},
                session=session,
            )
            for result in current:
                clone = {key: value for key, value in result.items() if key != "_id"}
                clone["_id"] = str(ObjectId())
                clone["revision"] = revision
                clone["active"] = True
                clone["previous_result_id"] = result["_id"]
                clone["previous_score"] = result.get("score")
                await db.results.insert_one(clone, session=session)
            for change in changes:
                target = by_id.get(change["result_id"])
                if target is None:
                    raise AppError(404, "not_found", "That result was not found.")
                await db.results.update_one(
                    {"marksheet_id": sheet["_id"], "revision": revision, "previous_result_id": change["result_id"]},
                    {"$set": {"score": change.get("score", target.get("score")), "status": change.get("status", target.get("status"))}},
                    session=session,
                )
            await db.marksheets.update_one(
                {"_id": sheet["_id"]},
                {
                    "$set": {"revision": revision, "active_revision": revision, "status": "published"},
                    "$inc": {"edit_version": 1},
                },
                session=session,
            )
    await _audit(db, user, "marksheet.correct", {"marksheet_id": sheet["_id"], "revision": revision, "reason": reason})
    return {"id": sheet["_id"], "status": "published", "revision": revision}


async def withdraw_marksheet(db, client, user: dict, sheet: dict, reason: str, edit_version: int | None = None) -> dict:
    require_current_version(sheet, edit_version)
    if sheet.get("status") != "published":
        raise AppError(422, "marksheet.state", "Only a published marksheet can be withdrawn.")
    if not reason.strip():
        raise AppError(422, "marksheet.reason", "A withdrawal needs a reason.")
    async with await client.start_session() as session:
        async with session.start_transaction():
            await db.results.update_many(
                {"marksheet_id": sheet["_id"], "active": True},
                {"$set": {"active": False}},
                session=session,
            )
            await db.marksheets.update_one(
                {"_id": sheet["_id"]},
                {"$set": {"status": "withdrawn", "active_revision": None, "withdrawn_reason": reason}, "$inc": {"edit_version": 1}},
                session=session,
            )
    await _audit(db, user, "marksheet.withdraw", {"marksheet_id": sheet["_id"], "reason": reason})
    return {"id": sheet["_id"], "status": "withdrawn"}


async def _audit(db, user: dict, action: str, context: dict) -> None:
    await db.audit_events.insert_one(
        {
            "_id": str(ObjectId()),
            "institute_id": user["institute_id"],
            "action": action,
            "actor_id": user["_id"],
            "at": _now(),
            "context": context,
        }
    )
