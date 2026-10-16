"""Staff-facing business changes. This log is not the technical audit trail."""

from __future__ import annotations

from datetime import datetime, timezone

from app.deps import new_id


async def write_business(
    database,
    actor: dict,
    *,
    action: str,
    record: str,
    href: str,
    permission: str,
    collection: str = "",
    record_id: str = "",
    course_id: str = "",
    branch_id: str = "",
    batch_id: str = "",
) -> None:
    await database.business_events.insert_one(
        {
            "_id": new_id(),
            "institute_id": actor["institute_id"],
            "actor_id": actor["_id"],
            "action": action,
            "record": record,
            "href": href,
            "permission": permission,
            "collection": collection,
            "record_id": record_id,
            "course_id": course_id or "",
            "branch_id": branch_id or "",
            "batch_id": batch_id or "",
            "at": datetime.now(timezone.utc),
        }
    )
