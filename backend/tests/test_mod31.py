from datetime import datetime, timezone
from uuid import uuid4

import pytest
from bson import ObjectId
from fastapi.testclient import TestClient

from app.main import create_app
from tests.test_m2 import bootstrap, sync_db


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


def _login(client, email):
    client.post("/api/v1/auth/logout")
    response = client.post("/api/v1/auth/login", json={"email": email, "password": "correct-horse"})
    assert response.status_code == 200, response.text


def test_student_page_keeps_history_private_and_a_proposed_name(client):
    bootstrap(client)
    database = sync_db(client)
    institute_id = database.institutes.find_one()["_id"]
    branch_a, branch_b, course_a, course_b = (str(ObjectId()) for _ in range(4))
    batch_a, batch_b, subject = (str(ObjectId()) for _ in range(3))
    student, other = (str(ObjectId()) for _ in range(2))
    offering_a, offering_b = str(ObjectId()), str(ObjectId())
    database.branches.insert_many([
        {"_id": branch_a, "institute_id": institute_id, "name": "Tirur", "name_key": "tirur"},
        {"_id": branch_b, "institute_id": institute_id, "name": "Calicut", "name_key": "calicut"},
    ])
    database.courses.insert_many([
        {"_id": course_a, "institute_id": institute_id, "name": "Foundation", "name_key": "foundation"},
        {"_id": course_b, "institute_id": institute_id, "name": "Intermediate", "name_key": "intermediate"},
    ])
    database.offerings.insert_many([
        {"_id": offering_a, "institute_id": institute_id, "branch_id": branch_a, "course_id": course_a},
        {"_id": offering_b, "institute_id": institute_id, "branch_id": branch_b, "course_id": course_b},
    ])
    database.batches.insert_many([
        {"_id": batch_a, "institute_id": institute_id, "offering_id": offering_a, "branch_id": branch_a, "course_id": course_a, "name": "January 2027", "name_key": "january 2027", "session_key": "2027-01"},
        {"_id": batch_b, "institute_id": institute_id, "offering_id": offering_b, "branch_id": branch_b, "course_id": course_b, "name": "May 2027", "name_key": "may 2027", "session_key": "2027-05"},
    ])
    database.subjects.insert_one({
        "_id": subject, "institute_id": institute_id, "course_id": course_a, "name": "Accounting", "name_key": "accounting",
    })
    database.students.insert_many([
        {"_id": student, "institute_id": institute_id, "display_name": "SHARED STUDENT", "student_code": "IAM-000401", "name_key": "shared student", "edit_version": 0},
        {"_id": other, "institute_id": institute_id, "display_name": "OTHER STUDENT", "student_code": "IAM-000402", "name_key": "other student", "edit_version": 0},
    ])
    database.enrollments.insert_many([
        {
            "_id": str(ObjectId()), "institute_id": institute_id, "student_id": student,
            "branch_id": branch_a, "course_id": course_a, "batch_id": batch_a,
            "started_on": "2026-09-01", "ended_on": "2027-01-15",
        },
        {
            "_id": str(ObjectId()), "institute_id": institute_id, "student_id": student,
            "branch_id": branch_b, "course_id": course_b, "batch_id": batch_b,
        },
        {
            "_id": str(ObjectId()), "institute_id": institute_id, "student_id": other,
            "branch_id": branch_a, "course_id": course_a, "batch_id": batch_a,
        },
    ])
    viewer = client.post("/api/v1/users", json={
        "name": "Viewer", "email": "viewer-mod31@iam.test", "password": "correct-horse",
        "role": "viewer", "scope": {"branch_id": branch_a, "course_id": course_a}, "acknowledge_scope": True,
    })
    assert viewer.status_code == 200, viewer.text
    teacher = client.post("/api/v1/users", json={
        "name": "Teacher", "email": "teacher-mod31@iam.test", "password": "correct-horse",
        "role": "teacher", "scope": {"branch_id": branch_a, "course_id": course_a, "subject_id": subject}, "acknowledge_scope": True,
    })
    assert teacher.status_code == 200, teacher.text
    manager = client.post("/api/v1/users", json={
        "name": "Tirur admin", "email": "admin-mod31@iam.test", "password": "correct-horse",
        "role": "branch_admin", "scope": {"branch_id": branch_a}, "acknowledge_scope": True,
    })
    assert manager.status_code == 200, manager.text

    detail = client.get(f"/api/v1/students/{student}/enrollments")
    assert detail.status_code == 200, detail.text
    rows = {item["batch_id"]: item for item in detail.json()["enrollments"]}
    assert rows[batch_a]["started_on"] == "2026-09-01"
    assert rows[batch_a]["ended_on"] == "2027-01-15"
    assert rows[batch_a]["status"] == "historical"
    assert rows[batch_a]["branch_name"] == "Tirur"
    assert rows[batch_b]["started_on"] is None
    assert rows[batch_b]["ended_on"] is None
    assert rows[batch_b]["status"] is None

    _login(client, "viewer-mod31@iam.test")
    private = client.get(f"/api/v1/students/{student}/history")
    assert private.status_code == 200, private.text
    assert private.json() == {"permitted": False, "items": []}
    taught_before = client.get(f"/api/v1/students/{student}/enrollments").json()
    assert [item["branch_id"] for item in taught_before["enrollments"]] == [branch_a]

    _login(client, "teacher-mod31@iam.test")
    taught = client.get(f"/api/v1/students/{student}/enrollments").json()
    assert [item["course_id"] for item in taught["enrollments"]] == [course_a]
    assert client.get(f"/api/v1/students/{student}/history").json()["permitted"] is False

    _login(client, "admin@iam.test")
    saved = client.patch(f"/api/v1/students/{student}", json={"display_name": "Shared Renamed", "edit_version": 0})
    assert saved.status_code == 200, saved.text
    conflict = client.patch(f"/api/v1/students/{student}", json={"display_name": "Proposed Name", "edit_version": 0})
    assert conflict.status_code == 409
    body = conflict.json()["error"]
    assert body["code"] == "student.conflict"
    assert body["details"]["current_display_name"] == "Shared Renamed"
    assert body["details"]["edit_version"] == 1
    stored = database.students.find_one({"_id": student})
    assert stored["display_name"] == "Shared Renamed"
    assert stored["student_code"] == "IAM-000401"
    assert database.enrollments.count_documents({"student_id": student, "batch_id": batch_a}) == 1
    database.audit_events.insert_one({
        "_id": str(ObjectId()),
        "institute_id": institute_id,
        "actor_id": database.users.find_one({"email_key": "admin@iam.test"})["_id"],
        "action": "student.update",
        "at": datetime.now(timezone.utc),
        "before": {"display_name": "SECRET BEFORE"},
        "after": {"display_name": "SECRET AFTER"},
        "scope": {"institute_id": institute_id, "student_id": student, "branch_id": branch_b},
    })
    database.audit_events.insert_one({
        "_id": str(ObjectId()),
        "institute_id": institute_id,
        "actor_id": "someone",
        "action": "student.update",
        "at": datetime.now(timezone.utc),
        "before": {"display_name": "OTHER BEFORE"},
        "after": {"display_name": "OTHER AFTER"},
        "scope": {"student_id": other},
    })
    history = client.get(f"/api/v1/students/{student}/history")
    assert history.status_code == 200, history.text
    payload = history.json()
    assert payload["permitted"] is True
    names = [item.get("before", {}).get("display_name") for item in payload["items"]]
    assert "SHARED STUDENT" in names
    assert "SECRET BEFORE" in names
    assert "OTHER BEFORE" not in names
    assert all("context" not in item and "scope" not in item for item in payload["items"])
    preview = client.post("/api/v1/students/merge-preview", json={"source_id": other, "target_id": student})
    assert preview.status_code == 200, preview.text
    shown = preview.json()["moves"] or preview.json()["kept"]
    assert shown[0]["branch_name"] == "Tirur"
    assert "move" in preview.json()

    _login(client, "admin-mod31@iam.test")
    local = client.get(f"/api/v1/students/{student}/history")
    assert local.status_code == 200, local.text
    local_body = local.json()
    assert local_body["permitted"] is True
    local_names = [((item.get("before") or {}).get("display_name")) for item in local_body["items"]]
    assert "SHARED STUDENT" in local_names
    assert "SECRET BEFORE" not in local_names
    visible = client.get(f"/api/v1/students/{student}/enrollments").json()
    assert [item["branch_id"] for item in visible["enrollments"]] == [branch_a]

    _login(client, "viewer-mod31@iam.test")
    again = client.get(f"/api/v1/students/{student}/history")
    assert again.json() == {"permitted": False, "items": []}
    assert "SECRET" not in again.text
    assert client.get("/api/v1/students/missing-student/history").status_code == 404
