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


def pending_published_correction(sheet: dict) -> bool:
    """Submitted sheet that still has a live published revision awaiting approval of a newer one."""
    active = sheet.get("active_revision")
    revision = sheet.get("revision") or 1
    return sheet.get("status") == "submitted" and active is not None and revision > active


def normalize_result_status(status: str | None, score) -> tuple[str, float | None]:
    """Map staff input to scored | absent | exempt with a consistent score."""
    if status in {"absent", "missing"}:
        return "absent", None
    if status == "exempt":
        return "exempt", None
    if status == "scored" or (status is None and score is not None):
        if score is None:
            raise AppError(422, "import.invalid_mark", "Enter a score, or mark the row absent or joined after exam.")
        return "scored", float(score)
    if status:
        raise AppError(422, "import.invalid_mark", "Choose scored, absent, or joined after exam.")
    raise AppError(422, "import.invalid_mark", "Choose scored, absent, or joined after exam.")


async def publish_revision(db, client, user: dict, sheet: dict) -> dict:
    blockers = publication_blockers(sheet)
    if blockers:
        raise AppError(422, "marksheet.not_ready", blockers[0]["message"], blockers=blockers)
    if sheet.get("status") not in {"draft", "submitted"}:
        raise AppError(422, "marksheet.state", "Only a draft or submitted marksheet can be published.")
    revision = sheet.get("revision") or 1
    policy = await db.policies.find_one({"institute_id": user["institute_id"]}, sort=[("version", -1)])
    policy_version = policy.get("version", 1) if policy else 1
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
                {"$set": {"status": "published", "active_revision": revision, "reviewer_id": user["_id"], "published_at": _now(), "policy_version": policy_version}},
                session=session,
            )
    await _audit(db, user, "marksheet.publish", {"marksheet_id": sheet["_id"], "revision": revision})
    from app.assessments.marks import refresh_sheet_marks

    published = {
        **sheet,
        "status": "published",
        "active_revision": revision,
        "policy_version": policy_version,
    }
    await refresh_sheet_marks(db, published)
    return {"id": sheet["_id"], "status": "published", "revision": revision}


async def submit_marksheet(db, user: dict, sheet: dict) -> dict:
    if sheet.get("status") != "draft":
        raise AppError(422, "marksheet.state", "Only a draft can be submitted.")
    await db.marksheets.update_one(
        {"_id": sheet["_id"]}, {"$set": {"status": "submitted", "submitted_at": _now()}}
    )
    await _audit(db, user, "marksheet.submit", {"marksheet_id": sheet["_id"]})
    from app.business import write_business

    batch_ids = sheet.get("batch_ids") or []
    await write_business(
        db,
        user,
        action="Submitted a marksheet",
        record=sheet.get("title") or "Marksheet",
        href=f"/marksheets/{sheet['_id']}",
        permission="marksheet.view",
        collection="marksheets",
        record_id=sheet["_id"],
        course_id=sheet.get("course_id") or "",
        branch_id=sheet.get("branch_id") or "",
        batch_id=batch_ids[0] if batch_ids else "",
    )
    return {"id": sheet["_id"], "status": "submitted"}


async def reject_marksheet(db, user: dict, sheet: dict) -> dict:
    if sheet.get("status") != "submitted":
        raise AppError(422, "marksheet.state", "Only a submitted marksheet can be returned.")
    if pending_published_correction(sheet):
        active = sheet["active_revision"]
        pending = sheet.get("revision") or 1
        await db.results.delete_many({"marksheet_id": sheet["_id"], "revision": pending})
        await db.marksheets.update_one(
            {"_id": sheet["_id"]},
            {"$set": {"status": "published", "revision": active}},
        )
        await _audit(
            db,
            user,
            "marksheet.reject",
            {"marksheet_id": sheet["_id"], "pending_revision": pending, "active_revision": active},
        )
        return {"id": sheet["_id"], "status": "published", "revision": active}
    await db.marksheets.update_one({"_id": sheet["_id"]}, {"$set": {"status": "draft"}})
    await _audit(db, user, "marksheet.reject", {"marksheet_id": sheet["_id"]})
    return {"id": sheet["_id"], "status": "draft"}


def require_current_version(sheet: dict, edit_version: int | None) -> None:
    if edit_version is None:
        return
    if edit_version != sheet.get("edit_version", 0):
        raise AppError(409, "marksheet.conflict", "Someone else saved this marksheet. Reload and try again.")


async def correct_marksheet(
    db,
    client,
    user: dict,
    sheet: dict,
    reason: str,
    changes: list[dict],
    edit_version: int | None = None,
    inserts: list[dict] | None = None,
) -> dict:
    """Propose a new revision for a published sheet. Cards keep the prior active revision until publish."""
    require_current_version(sheet, edit_version)
    if sheet.get("status") != "published":
        raise AppError(422, "marksheet.state", "Correct a published marksheet.")
    if not reason.strip():
        raise AppError(422, "marksheet.reason", "A correction needs a reason.")
    inserts = inserts or []
    if not changes and not inserts:
        raise AppError(422, "marksheet.empty", "Add at least one change or student.")
    live = sheet.get("active_revision") or sheet.get("revision") or 1
    revision = live + 1
    async with await client.start_session() as session:
        async with session.start_transaction():
            current = await db.results.find({"marksheet_id": sheet["_id"], "revision": live}).to_list(length=5000)
            by_id = {item["_id"]: item for item in current}
            for result in current:
                clone = {key: value for key, value in result.items() if key != "_id"}
                clone["_id"] = str(ObjectId())
                clone["revision"] = revision
                clone["active"] = False
                clone["previous_result_id"] = result["_id"]
                clone["previous_score"] = result.get("score")
                await db.results.insert_one(clone, session=session)
            for change in changes:
                target = by_id.get(change["result_id"])
                if target is None:
                    raise AppError(404, "not_found", "That result was not found.")
                status = change.get("status", target.get("status"))
                score = change.get("score", target.get("score"))
                status, score = normalize_result_status(
                    status,
                    score if status == "scored" else None if status in {"absent", "missing", "exempt"} else score,
                )
                if status == "scored":
                    maximum = target.get("maximum") if target.get("maximum") is not None else sheet.get("maximum")
                    if score is None or score < 0 or (maximum is not None and score > maximum):
                        raise AppError(422, "import.invalid_mark", "The score must be from 0 through the maximum.")
                update = {"score": score, "status": status}
                if status == "exempt":
                    update["reason_code"] = change.get("reason_code") or "joined_after_exam"
                await db.results.update_one(
                    {"marksheet_id": sheet["_id"], "revision": revision, "previous_result_id": change["result_id"]},
                    {"$set": update},
                    session=session,
                )
            for row in inserts:
                document = dict(row.get("document") or row)
                document["_id"] = str(ObjectId())
                document["revision"] = revision
                document["active"] = False
                status = document.get("status") or "absent"
                score = document.get("score")
                status, score = normalize_result_status(
                    status,
                    score if status == "scored" else None if status in {"absent", "missing", "exempt"} else score,
                )
                document["status"] = status
                document["score"] = score
                if status == "exempt":
                    document["reason_code"] = document.get("reason_code") or "joined_after_exam"
                await db.results.insert_one(document, session=session)
            await db.marksheets.update_one(
                {"_id": sheet["_id"]},
                {
                    "$set": {
                        "revision": revision,
                        "active_revision": live,
                        "status": "submitted",
                        "submitted_at": _now(),
                        "correction_reason": reason.strip(),
                    },
                    "$inc": {"edit_version": 1},
                },
                session=session,
            )
    await _audit(db, user, "marksheet.correct", {"marksheet_id": sheet["_id"], "revision": revision, "reason": reason})
    return {"id": sheet["_id"], "status": "submitted", "revision": revision, "active_revision": live}


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
