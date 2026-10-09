from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ReturnDocument

from app.config import Settings


def connect(settings: Settings) -> tuple[AsyncIOMotorClient, AsyncIOMotorDatabase]:
    client = AsyncIOMotorClient(settings.mongo_url)
    return client, client[settings.db_name]


async def ensure_schema(db: AsyncIOMotorDatabase) -> None:
    await db.policies.create_index([("institute_id", 1), ("version", 1)], unique=True)
    current = await db.schema_meta.find_one({"_id": "schema"})
    if current and current.get("version", 0) >= 1:
        return
    await db.institutes.create_index("code", unique=True)
    await db.users.create_index("email_key", unique=True)
    await db.sessions.create_index("token_hash", unique=True)
    await db.roles.create_index([("institute_id", 1), ("name_key", 1)], unique=True)
    await db.grants.create_index([("user_id", 1)])
    await db.branches.create_index([("institute_id", 1), ("name_key", 1)], unique=True)
    await db.courses.create_index([("institute_id", 1), ("name_key", 1)], unique=True)
    await db.offerings.create_index([("branch_id", 1), ("course_id", 1)], unique=True)
    await db.batches.create_index([("offering_id", 1), ("session_key", 1)], unique=True)
    await db.subjects.create_index([("course_id", 1), ("name_key", 1)], unique=True)
    await db.papers.create_index([("subject_id", 1), ("number", 1)], unique=True)
    await db.students.create_index("student_code", unique=True)
    await db.enrollments.create_index([("student_id", 1), ("batch_id", 1)], unique=True)
    await db.enrollment_names.create_index([("batch_id", 1), ("name_key", 1)], unique=True)
    await db.results.create_index(
        [("marksheet_id", 1), ("enrollment_id", 1), ("revision", 1)],
        unique=True,
        partialFilterExpression={"marksheet_id": {"$type": "string"}},
    )
    await db.marksheets.create_index(
        [("assessment_id", 1), ("attempt_id", 1), ("cohort_key", 1)], unique=True, sparse=True
    )
    await db.jobs.create_index("idempotency_key", unique=True, sparse=True)
    await db.files.create_index([("institute_id", 1), ("sha256", 1)])
    await db.audit_events.create_index([("institute_id", 1), ("at", -1)])
    await db.counters.update_one({"_id": "student_code"}, {"$setOnInsert": {"value": 0}}, upsert=True)
    await db.schema_meta.update_one(
        {"_id": "schema"}, {"$set": {"version": 1}}, upsert=True
    )


async def allocate_student_code(db: AsyncIOMotorDatabase, session, prefix: str = "IAM") -> str:
    counter = await db.counters.find_one_and_update(
        {"_id": "student_code"},
        {"$inc": {"value": 1}},
        return_document=ReturnDocument.AFTER,
        session=session,
    )
    return f"{prefix}-{counter['value']:06d}"
