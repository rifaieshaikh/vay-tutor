from __future__ import annotations

import logging

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ReturnDocument
from pymongo.errors import ConfigurationError, InvalidOperation, OperationFailure
from pymongo.synchronous.client_session import ClientSession

from app.academics.curriculum import seed_curriculum_kinds, seed_exam_types
from app.config import Settings

log = logging.getLogger("vay")
_standalone_transactions_patched = False


class _StandaloneTransaction:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


def _is_transaction_unsupported(error: BaseException) -> bool:
    message = str(error).lower()
    return any(
        phrase in message
        for phrase in (
            "transaction numbers are only allowed",
            "not started with replication",
            "replication not enabled",
            "transactions are not supported",
        )
    )


def _patch_standalone_transactions() -> None:
    """Motor starts transactions on the PyMongo session; skip them on standalone MongoDB."""
    global _standalone_transactions_patched
    if _standalone_transactions_patched:
        return
    original = ClientSession.start_transaction

    def start_transaction(self, *args, **kwargs):
        if getattr(self._client, "_vay_standalone", False):
            return _StandaloneTransaction()
        try:
            return original(self, *args, **kwargs)
        except (OperationFailure, InvalidOperation, ConfigurationError) as error:
            if not _is_transaction_unsupported(error):
                raise
            self._client._vay_standalone = True
            log.warning("MongoDB does not support transactions here; continuing without them.")
            return _StandaloneTransaction()

    ClientSession.start_transaction = start_transaction  # type: ignore[method-assign]
    _standalone_transactions_patched = True


def connect(settings: Settings) -> tuple[AsyncIOMotorClient, AsyncIOMotorDatabase]:
    client = AsyncIOMotorClient(settings.mongo_url)
    return client, client[settings.db_name]


async def configure_mongo(client: AsyncIOMotorClient, settings: Settings | None = None) -> None:
    """Allow local standalone MongoDB when this computer is not a replica set."""
    _patch_standalone_transactions()
    use_standalone = False
    if settings is not None and "replicaset=" not in settings.mongo_url.lower():
        use_standalone = True
    try:
        hello = await client.admin.command("hello")
        if not hello.get("setName"):
            use_standalone = True
    except Exception:
        use_standalone = True
    if not use_standalone:
        return
    client.delegate._vay_standalone = True
    log.info("MongoDB is standalone; local writes continue without a replica set.")


async def ensure_schema(db: AsyncIOMotorDatabase) -> None:
    await db.policies.create_index([("institute_id", 1), ("version", 1)], unique=True)
    await db.teachers.create_index(
        [("institute_id", 1), ("user_id", 1)],
        unique=True,
        partialFilterExpression={"user_id": {"$type": "string"}},
    )
    await db.enquiries.create_index([("institute_id", 1), ("created_at", -1)])
    await db.enquiries.create_index([("institute_id", 1), ("prospect_id", 1)])
    await db.prospects.create_index([("institute_id", 1), ("name_key", 1)])
    await db.prospects.create_index([("institute_id", 1), ("whatsapp_key", 1)])
    await db.enquiry_imports.create_index([("institute_id", 1), ("expires_at", 1)])
    await db.enquiry_imports.create_index(
        [("institute_id", 1), ("idempotency_key", 1)], unique=True, sparse=True
    )
    await db.enquiry_mappings.create_index([("institute_id", 1), ("owner_id", 1), ("name_key", 1)])
    await db.admission_imports.create_index([("institute_id", 1), ("expires_at", 1)])
    await db.admission_imports.create_index(
        [("institute_id", 1), ("idempotency_key", 1)], unique=True, sparse=True
    )
    await db.admission_mappings.create_index([("institute_id", 1), ("owner_id", 1), ("name_key", 1)])
    await db.intake_operations.create_index("created_at")
    await db.admissions.create_index([("institute_id", 1), ("status", 1), ("created_at", -1)])
    await db.course_questions.create_index([("course_id", 1), ("order", 1)])
    await db.form_questions.create_index([("institute_id", 1), ("order", 1)])
    await db.students.create_index([("institute_id", 1), ("name_key", 1)])
    await db.business_events.create_index([("institute_id", 1), ("at", -1)])
    await db.exams.create_index([("institute_id", 1), ("batch_ids", 1)])
    await seed_curriculum_kinds(db)
    await seed_exam_types(db)
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
    indexes = await db.batches.index_information()
    if "offering_id_1_session_key_1" in indexes:
        await db.batches.drop_index("offering_id_1_session_key_1")
    await db.batches.create_index([("offering_id", 1), ("name_key", 1)], unique=True)
    await db.subjects.create_index([("course_id", 1), ("name_key", 1)], unique=True)
    await db.papers.create_index([("subject_id", 1), ("number", 1)], unique=True)
    await db.students.create_index("student_code", unique=True)
    await db.enrollments.create_index([("student_id", 1), ("batch_id", 1)], unique=True)
    await db.enrollments.create_index(
        [("institute_id", 1), ("enrollment_code", 1)],
        unique=True,
        partialFilterExpression={"enrollment_code": {"$type": "string"}},
    )
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
    await db.counters.update_one({"_id": "enrollment_code"}, {"$setOnInsert": {"value": 0}}, upsert=True)
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


async def allocate_enrollment_code(db: AsyncIOMotorDatabase, session=None) -> str:
    counter = await db.counters.find_one_and_update(
        {"_id": "enrollment_code"},
        {"$inc": {"value": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
        session=session,
    )
    return f"ENR-{counter['value']:06d}"
