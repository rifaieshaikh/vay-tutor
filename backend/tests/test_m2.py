from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pyotp
import pytest
from fastapi.testclient import TestClient
from pymongo import MongoClient, ReturnDocument

from app.main import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_NAME", f"vay_test_{uuid4().hex}")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("WORKER_ENABLED", "0")
    monkeypatch.setenv("DEPLOYMENT_MODE", "local")
    monkeypatch.setenv("COOKIE_SECURE", "0")
    app = create_app()
    with TestClient(app) as test_client:
        yield test_client


def sync_db(client):
    settings = client.app.state.settings
    return MongoClient(settings.mongo_url)[settings.db_name]


def bootstrap(client, email="admin@iam.test", password="correct-horse"):
    response = client.post(
        "/api/v1/bootstrap",
        json={
            "institute_name": "IAM",
            "institute_code": "IAM",
            "admin_name": "Admin",
            "admin_email": email,
            "admin_password": password,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_bootstrap_is_once_and_needs_no_catalog(client):
    payload = bootstrap(client)
    assert payload["institute"]["code"] == "IAM"
    assert payload["recovery_codes"]
    health = client.get("/api/v1/health")
    assert health.json()["bootstrapped"] is True
    assert health.json()["database"] == "ok"
    again = client.post(
        "/api/v1/bootstrap",
        json={
            "institute_name": "Other",
            "institute_code": "OTHER",
            "admin_name": "Other",
            "admin_email": "other@iam.test",
            "admin_password": "correct-horse",
        },
    )
    assert again.status_code == 409
    session = client.get("/api/v1/auth/session")
    assert session.status_code == 200
    assert "marksheet.upload" in session.json()["actions"]
    assert client.get("/api/v1/views/institute").json()["branches"] == 0


def test_login_rate_limit_and_recovery(client):
    payload = bootstrap(client)
    client.post("/api/v1/auth/logout")
    for _ in range(5):
        failed = client.post(
            "/api/v1/auth/login", json={"email": "admin@iam.test", "password": "wrong-password"}
        )
        assert failed.status_code == 401
    blocked = client.post(
        "/api/v1/auth/login", json={"email": "admin@iam.test", "password": "wrong-password"}
    )
    assert blocked.status_code == 429
    redeemed = client.post(
        "/api/v1/auth/recovery/redeem",
        json={
            "email": "admin@iam.test",
            "recovery_code": payload["recovery_codes"][0],
            "new_password": "new-password-1",
        },
    )
    assert redeemed.status_code == 200
    client.post("/api/v1/auth/logout")
    signed_in = client.post(
        "/api/v1/auth/login", json={"email": "admin@iam.test", "password": "new-password-1"}
    )
    assert signed_in.status_code == 200


def test_cloud_admin_requires_totp(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_NAME", f"vay_test_{uuid4().hex}")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("WORKER_ENABLED", "0")
    monkeypatch.setenv("DEPLOYMENT_MODE", "cloud")
    monkeypatch.setenv("COOKIE_SECURE", "0")
    app = create_app()
    with TestClient(app) as client:
        created = bootstrap(client)
        secret = created["totp_uri"].split("secret=")[1].split("&")[0]
        client.post("/api/v1/auth/logout")
        missing = client.post(
            "/api/v1/auth/login", json={"email": "admin@iam.test", "password": "correct-horse"}
        )
        assert missing.status_code == 401
        code = pyotp.TOTP(secret).now()
        signed_in = client.post(
            "/api/v1/auth/login",
            json={"email": "admin@iam.test", "password": "correct-horse", "totp": code},
        )
        assert signed_in.status_code == 200


def test_disjoint_grants_and_hidden_aggregates(client):
    bootstrap(client)
    database = sync_db(client)
    institute_id = client.get("/api/v1/auth/session").json()["institute"]["id"]
    branch_a = "branch-a"
    branch_b = "branch-b"
    database.branches.insert_many(
        [
            {"_id": branch_a, "institute_id": institute_id, "name": "Branch A", "name_key": "branch a"},
            {"_id": branch_b, "institute_id": institute_id, "name": "Branch B", "name_key": "branch b"},
        ]
    )
    database.students.insert_many(
        [
            {"_id": "student-a", "institute_id": institute_id, "student_code": "IAM-000010", "display_name": "A"},
            {"_id": "student-b", "institute_id": institute_id, "student_code": "IAM-000011", "display_name": "B"},
        ]
    )
    database.enrollments.insert_many(
        [
            {"_id": "enr-a", "institute_id": institute_id, "student_id": "student-a", "branch_id": branch_a, "course_id": "ca", "batch_id": "sept"},
            {"_id": "enr-b", "institute_id": institute_id, "student_id": "student-b", "branch_id": branch_b, "course_id": "ca", "batch_id": "jan"},
        ]
    )
    database.marksheets.insert_many(
        [
            {"_id": "sheet-acc", "institute_id": institute_id, "branch_id": branch_a, "course_id": "ca", "subject_id": "accounting", "status": "draft"},
            {"_id": "sheet-law", "institute_id": institute_id, "branch_id": branch_b, "course_id": "ca", "subject_id": "law", "status": "draft"},
        ]
    )
    database.results.insert_many(
        [
                {"_id": "result-acc", "institute_id": institute_id, "student_id": "student-a", "marksheet_id": "sheet-acc", "enrollment_id": "enr-a", "revision": 1, "branch_id": branch_a, "course_id": "ca", "batch_id": "sept", "subject_id": "accounting", "status": "scored", "score": 18},
                {"_id": "result-law", "institute_id": institute_id, "student_id": "student-a", "marksheet_id": "sheet-law", "enrollment_id": "enr-a", "revision": 1, "branch_id": branch_a, "course_id": "ca", "batch_id": "sept", "subject_id": "law", "status": "scored", "score": 10},
        ]
    )
    created = client.post(
        "/api/v1/users",
        json={
            "name": "Teacher",
            "email": "teacher@iam.test",
            "password": "correct-horse",
            "role": "teacher",
            "scope": {"branch_id": branch_a, "course_id": "ca", "subject_id": "accounting"},
            "acknowledge_scope": True,
        },
    )
    assert created.status_code == 200, created.text
    client.post("/api/v1/auth/logout")
    assert client.post(
        "/api/v1/auth/login", json={"email": "teacher@iam.test", "password": "correct-horse"}
    ).status_code == 200
    overview = client.get("/api/v1/views/institute")
    assert overview.json()["branches"] == 1
    assert overview.json()["students"] == 1
    assert client.get("/api/v1/marksheets/sheet-acc").status_code == 200
    assert client.get("/api/v1/marksheets/sheet-law").status_code == 404
    assert client.post("/api/v1/marksheets/sheet-acc/publish").status_code == 403
    denied = client.post(
        "/api/v1/imports/commit",
        json={"sheets": [{"name": "Law", "scope": {"branch_id": branch_b, "course_id": "ca", "subject_id": "law"}}]},
    )
    assert denied.status_code == 403
    allowed = client.post(
        "/api/v1/imports/commit",
        json={"sheets": [{"name": "Accounting", "scope": {"branch_id": branch_a, "course_id": "ca", "subject_id": "accounting"}}]},
    )
    assert allowed.status_code == 422
    assert allowed.json()["error"]["code"] == "import.not_ready"
    sibling = client.post(
        "/api/v1/imports/commit",
        json={"sheets": [{"name": "New branch", "create": "branch", "scope": {"branch_id": branch_a}}]},
    )
    assert sibling.status_code == 403
    card = client.get("/api/v1/students/student-a/card")
    assert card.status_code == 200
    assert card.json()["partial"] is True
    assert [item["subject_id"] for item in card.json()["results"]] == ["accounting"]
    assert client.get("/api/v1/students").json()["items"][0]["student_code"] == "IAM-000010"
    assert "name_key" not in client.get("/api/v1/students").json()["items"][0]
    assert client.get("/api/v1/users").status_code == 403


def test_cannot_escalate_or_remove_last_admin(client):
    bootstrap(client)
    unacked = client.post(
        "/api/v1/users",
        json={
            "name": "Wide",
            "email": "wide@iam.test",
            "password": "correct-horse",
            "role": "viewer",
            "scope": {},
            "acknowledge_scope": False,
        },
    )
    assert unacked.status_code == 422
    assert "branches" in unacked.json()["error"]["message"]
    role = client.post(
        "/api/v1/roles",
        json={"name": "limited-admin", "actions": ["grant.manage", "user.manage", "dashboard.view"]},
    )
    assert role.status_code == 200, role.text
    created = client.post(
        "/api/v1/users",
        json={
            "name": "Limited",
            "email": "limited@iam.test",
            "password": "correct-horse",
            "role": "limited-admin",
            "scope": {"branch_id": "branch-a"},
            "acknowledge_scope": True,
        },
    )
    assert created.status_code == 200, created.text
    client.post("/api/v1/auth/logout")
    client.post("/api/v1/auth/login", json={"email": "limited@iam.test", "password": "correct-horse"})
    limited_id = client.get("/api/v1/auth/session").json()["user"]["id"]
    escalated = client.post(
        "/api/v1/grants",
        json={
            "user_id": limited_id,
            "role": "institute_admin",
            "scope": {},
            "acknowledge_scope": True,
        },
    )
    assert escalated.status_code == 403
    client.post("/api/v1/auth/logout")
    client.post("/api/v1/auth/login", json={"email": "admin@iam.test", "password": "correct-horse"})
    session = client.get("/api/v1/auth/session").json()
    removed = client.patch(f"/api/v1/users/{session['user']['id']}", json={"active": False})
    assert removed.status_code == 422


def test_revocation_blocks_session_and_export(client):
    bootstrap(client)
    session = client.get("/api/v1/auth/session").json()
    queued = client.post(
        "/api/v1/reports/cards",
        json={"format": "pdf", "scope": {}},
        headers={"Idempotency-Key": "export-1"},
    )
    assert queued.status_code == 200, queued.text
    again = client.post(
        "/api/v1/reports/cards",
        json={"format": "pdf", "scope": {}},
        headers={"Idempotency-Key": "export-1"},
    )
    assert again.json()["id"] == queued.json()["id"]
    database = sync_db(client)
    database.users.update_one({"_id": session["user"]["id"]}, {"$inc": {"session_version": 1}})
    assert client.get("/api/v1/auth/session").status_code == 401
    operator = client.post(
        "/api/v1/users",
        json={
            "name": "Operator",
            "email": "ops@iam.test",
            "password": "correct-horse",
            "role": "institute_admin",
            "scope": {},
            "acknowledge_scope": True,
        },
    )
    assert operator.status_code == 401
    client.post(
        "/api/v1/auth/login", json={"email": "admin@iam.test", "password": "correct-horse"}
    )
    # The revoked session cannot create the operator. Sign in is still the original password
    # because revocation did not change it. Create the operator, then revoke the exporter again.
    created = client.post(
        "/api/v1/users",
        json={
            "name": "Operator",
            "email": "ops@iam.test",
            "password": "correct-horse",
            "role": "institute_admin",
            "scope": {},
            "acknowledge_scope": True,
        },
    )
    assert created.status_code == 200, created.text
    database.users.update_one({"_id": session["user"]["id"]}, {"$inc": {"session_version": 1}})
    client.post("/api/v1/auth/logout")
    assert client.post(
        "/api/v1/auth/login", json={"email": "ops@iam.test", "password": "correct-horse"}
    ).status_code == 200
    processed = client.post("/api/v1/jobs/process")
    assert processed.status_code == 200, processed.text
    job = database.jobs.find_one({"_id": queued.json()["id"]})
    assert job["state"] == "failed"
    assert database.files.count_documents({}) == 0


def test_expired_lease_resumes_without_a_second_file(client):
    bootstrap(client)
    queued = client.post(
        "/api/v1/reports/cards",
        json={"format": "pdf", "scope": {}},
        headers={"Idempotency-Key": "export-resume"},
    )
    assert queued.status_code == 200, queued.text
    database = sync_db(client)
    past = datetime.now(timezone.utc) - timedelta(minutes=5)
    database.jobs.update_one(
        {"_id": queued.json()["id"]},
        {"$set": {"state": "leased", "lease_until": past, "attempts": 1}},
    )
    processed = client.post("/api/v1/jobs/process")
    assert processed.status_code == 200, processed.text
    job = database.jobs.find_one({"_id": queued.json()["id"]})
    assert job["state"] == "succeeded"
    assert job["attempts"] == 2
    assert database.files.count_documents({}) == 1
    assert client.post("/api/v1/jobs/process").status_code == 200
    assert database.files.count_documents({}) == 1
    assert database.jobs.find_one({"_id": queued.json()["id"]})["attempts"] == 2


def test_transaction_rollback_and_unique_branch(client):
    bootstrap(client)
    database = sync_db(client)
    mongo = database.client

    def abort():
        with mongo.start_session() as session:
            with session.start_transaction():
                counter = database.counters.find_one_and_update(
                    {"_id": "student_code"},
                    {"$inc": {"value": 1}},
                    return_document=ReturnDocument.AFTER,
                    session=session,
                )
                database.students.insert_one(
                    {
                        "_id": "temp-student",
                        "institute_id": "iam",
                        "student_code": f"IAM-{counter['value']:06d}",
                        "display_name": "Temp",
                    },
                    session=session,
                )
                raise RuntimeError("stop")

    with pytest.raises(RuntimeError):
        abort()
    assert database.students.count_documents({}) == 0
    counter = database.counters.find_one({"_id": "student_code"})
    assert counter["value"] == 0
    database.branches.insert_one(
        {"_id": "b1", "institute_id": "iam", "name": "IAM Tirur", "name_key": "iam tirur"}
    )
    with pytest.raises(Exception):
        database.branches.insert_one(
            {"_id": "b2", "institute_id": "iam", "name": "IAM TIRUR", "name_key": "iam tirur"}
        )


def test_audit_is_append_only(client):
    bootstrap(client)
    events = client.get("/api/v1/audit")
    assert events.status_code == 200
    assert events.json()["items"]
    rejected = client.patch("/api/v1/audit", json={"action": "changed"})
    assert rejected.status_code == 405
    client.post("/api/v1/auth/logout")
    assert client.get("/api/v1/audit").status_code == 401


def test_custom_role_permissions_can_be_changed_for_later_grants(client):
    bootstrap(client)
    created = client.post("/api/v1/roles", json={"name": "Card reader", "actions": ["progress_card.view"]})
    assert created.status_code == 200, created.text
    empty = client.post("/api/v1/roles", json={"name": "Empty", "actions": []})
    assert empty.status_code == 422
    assert empty.json()["error"]["code"] == "role.empty"
    role_id = created.json()["id"]
    updated = client.patch(f"/api/v1/roles/{role_id}", json={"actions": ["dashboard.view", "progress_card.view"]})
    assert updated.status_code == 200, updated.text
    assert updated.json()["actions"] == ["dashboard.view", "progress_card.view"]
    listed = client.get("/api/v1/roles").json()["items"]
    stored = next(item for item in listed if item["id"] == role_id)
    assert stored["actions"] == ["dashboard.view", "progress_card.view"]
    unknown = client.patch(f"/api/v1/roles/{role_id}", json={"actions": ["not.real"]})
    assert unknown.status_code == 422


def test_incompatible_client_is_rejected(client):
    response = client.get("/api/v1/auth/session", headers={"X-Client-Version": "2.0.0"})
    assert response.status_code == 426
    health = client.get("/api/v1/health", headers={"X-Client-Version": "2.0.0"})
    assert health.status_code == 200
