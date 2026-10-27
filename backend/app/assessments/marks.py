"""Shared marksheet score refresh: percentage, rank, and band."""

from __future__ import annotations


async def band_policy_for_sheet(database, sheet: dict) -> dict | None:
    """Marksheet bands, else course bands, else institute settings."""
    if sheet.get("bands"):
        return {"bands": sheet["bands"]}
    course_id = sheet.get("course_id")
    if course_id:
        course = await database.courses.find_one(
            {"_id": course_id, "institute_id": sheet.get("institute_id")}
        )
        if course and course.get("bands"):
            return {"bands": course["bands"]}
    return await database.policies.find_one(
        {"institute_id": sheet["institute_id"]}, sort=[("version", -1)]
    )


async def refresh_sheet_marks(database, sheet: dict) -> None:
    from app.calculating import band, dense_ranks, display_percentage, percentage

    revision = sheet.get("active_revision") or sheet.get("revision") or 1
    rows = await database.results.find({"marksheet_id": sheet["_id"], "revision": revision}).to_list(length=500)
    policy = await band_policy_for_sheet(database, sheet)
    ranked = dense_ranks(
        [{"id": row["_id"], "status": row.get("status"), "score": row.get("score")} for row in rows]
    )
    for row in rows:
        exact = percentage(
            row.get("score"), row.get("maximum") if row.get("maximum") is not None else sheet.get("maximum")
        )
        exact = exact if row.get("status") == "scored" else None
        await database.results.update_one(
            {"_id": row["_id"]},
            {
                "$set": {
                    "percentage": display_percentage(exact),
                    "band": band(exact, policy) if row.get("status") == "scored" else None,
                    "rank": ranked.get(row["_id"]),
                }
            },
        )


async def refresh_course_marksheets(database, institute_id: str, course_id: str) -> None:
    """Recompute bands on marksheets that follow the course (no sheet override)."""
    sheets = await database.marksheets.find(
        {
            "institute_id": institute_id,
            "course_id": course_id,
            "$or": [{"bands": {"$exists": False}}, {"bands": None}],
        }
    ).to_list(length=500)
    for sheet in sheets:
        await refresh_sheet_marks(database, sheet)
