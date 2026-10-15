from uuid import uuid4

import pytest
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


def test_batch_workspace_connects_the_academic_workflow(client):
    bootstrap(client)
    database = sync_db(client)
    institute_id = database.institutes.find_one()["_id"]
    grants_before = database.grants.count_documents({})

    branch = client.post("/api/v1/branches", json={"name": "Tirur"})
    other = client.post("/api/v1/branches", json={"name": "Kozhikode"})
    course = client.post("/api/v1/courses", json={"name": "CA Foundation"})
    assert branch.status_code == other.status_code == course.status_code == 200
    branch_id = branch.json()["id"]
    other_id = other.json()["id"]
    course_id = course.json()["id"]
    offered = client.post(f"/api/v1/branches/{branch_id}/courses", json={"course_id": course_id})
    assert offered.status_code == 200, offered.text
    duplicate = client.post(f"/api/v1/branches/{branch_id}/courses", json={"course_id": course_id})
    assert duplicate.status_code == 409
    missing = client.post(
        f"/api/v1/branches/{other_id}/batches",
        json={"course_id": course_id, "name": "January 2027"},
    )
    assert missing.status_code == 404
    created = client.post(
        f"/api/v1/branches/{branch_id}/batches",
        json={"course_id": course_id, "name": "January 2027"},
    )
    assert created.status_code == 200, created.text
    batch_id = created.json()["id"]
    again = client.post(
        f"/api/v1/branches/{branch_id}/batches",
        json={"course_id": course_id, "name": "January 2027"},
    )
    assert again.status_code == 409
    later = client.post(
        f"/api/v1/branches/{branch_id}/batches",
        json={"course_id": course_id, "name": "May 2027"},
    )
    assert later.status_code == 200, later.text
    subject = client.post(f"/api/v1/courses/{course_id}/subjects", json={"name": "Accounting"})
    assert subject.status_code == 200, subject.text

    empty = client.get(f"/api/v1/batches/{batch_id}")
    assert empty.status_code == 200, empty.text
    assert empty.json()["students"]["total"] == 0
    assert empty.json()["assignments"] == []
    assert empty.json()["assessments"]["total"] == 0
    assert empty.json()["curriculum"][0]["name"] == "Accounting"

    enquiry = client.post(
        "/api/v1/enquiries",
        json={"name": "Aisha", "whatsapp": "9000001111", "course_id": course_id},
    )
    assert enquiry.status_code == 200, enquiry.text
    admission = client.post(f"/api/v1/enquiries/{enquiry.json()['id']}/convert")
    assert admission.status_code == 200, admission.text
    enrolled = client.post(
        f"/api/v1/admissions/{admission.json()['id']}/convert",
        json={"branch_id": branch_id, "batch_id": batch_id},
    )
    assert enrolled.status_code == 200, enrolled.text
    student_id = enrolled.json()["id"]
    moved = client.post(
        f"/api/v1/students/{student_id}/enrollments",
        json={"branch_id": branch_id, "course_id": course_id, "batch_id": later.json()["id"]},
    )
    assert moved.status_code == 200, moved.text

    plain = client.post("/api/v1/teachers", json={"name": "Desk teacher"})
    signed = client.post(
        "/api/v1/teachers",
        json={"name": "Signed teacher", "app_user": True, "email": "batch-teacher@iam.test", "password": "correct-horse"},
    )
    assert plain.status_code == signed.status_code == 200
    first = client.post(
        f"/api/v1/batches/{batch_id}/assignments",
        json={"teacher_id": plain.json()["id"], "subject_id": subject.json()["id"], "started_on": "2027-01-04"},
    )
    assert first.status_code == 200, first.text
    second = client.post(
        f"/api/v1/batches/{later.json()['id']}/assignments",
        json={"teacher_id": plain.json()["id"], "subject_id": subject.json()["id"]},
    )
    assert second.status_code == 200, second.text
    repeat = client.post(
        f"/api/v1/batches/{batch_id}/assignments",
        json={"teacher_id": plain.json()["id"], "subject_id": subject.json()["id"]},
    )
    assert repeat.status_code == 409
    account_assignment = client.post(
        f"/api/v1/batches/{batch_id}/assignments",
        json={"teacher_id": signed.json()["id"], "subject_id": subject.json()["id"]},
    )
    assert account_assignment.status_code == 200, account_assignment.text
    assert database.grants.count_documents({}) == grants_before
    stored = database.teachers.find_one({"_id": plain.json()["id"]})
    assert len(stored["assignments"]) == 2
    ended = client.post(
        f"/api/v1/batches/{batch_id}/assignments/{first.json()['id']}/end",
        json={"ended_on": "2027-03-01"},
    )
    assert ended.status_code == 200, ended.text
    stored = database.teachers.find_one({"_id": plain.json()["id"]})
    statuses = {item["batch_id"]: item["status"] for item in stored["assignments"]}
    assert statuses[batch_id] == "ended"
    assert statuses[later.json()["id"]] == "current"
    assert database.grants.count_documents({}) == grants_before

    database.marksheets.insert_one({
        "_id": "sheet-batch",
        "institute_id": institute_id,
        "status": "submitted",
        "title": "Accounting unit",
        "branch_id": branch_id,
        "course_id": course_id,
        "subject_id": subject.json()["id"],
        "batch_ids": [batch_id],
    })
    board = client.get(f"/api/v1/batches/{batch_id}?page_size=1")
    assert board.status_code == 200, board.text
    body = board.json()
    assert body["students"]["total"] == 1
    assert body["students"]["pages"] == 1
    assert body["students"]["items"][0]["id"] == student_id
    assert body["assessments"]["total"] == 1
    assert body["assessments"]["items"][0]["id"] == "sheet-batch"
    assert any(item["status"] == "ended" for item in body["assignments"])
    assert client.get("/api/v1/catalog").status_code == 200
    assert client.get("/api/v1/students").status_code == 200

    database.batches.update_one({"_id": later.json()["id"]}, {"$set": {"ended_on": "2027-06-01"}})
    closed = client.post(
        f"/api/v1/students/{student_id}/enrollments",
        json={"branch_id": branch_id, "course_id": course_id, "batch_id": later.json()["id"]},
    )
    assert closed.status_code == 422
    closed_post = client.post(
        f"/api/v1/batches/{later.json()['id']}/assignments",
        json={"teacher_id": signed.json()["id"], "subject_id": subject.json()["id"]},
    )
    assert closed_post.status_code == 422

    viewer = client.post(
        "/api/v1/users",
        json={
            "name": "Tirur viewer",
            "email": "batch-viewer@iam.test",
            "password": "correct-horse",
            "role": "viewer",
            "scope": {"branch_id": branch_id},
            "acknowledge_scope": True,
        },
    )
    outsider = client.post(
        "/api/v1/users",
        json={
            "name": "Kozhikode viewer",
            "email": "other-batch-viewer@iam.test",
            "password": "correct-horse",
            "role": "viewer",
            "scope": {"branch_id": other_id},
            "acknowledge_scope": True,
        },
    )
    assert viewer.status_code == outsider.status_code == 200
    _login(client, "batch-viewer@iam.test")
    seen = client.get(f"/api/v1/batches/{batch_id}")
    assert seen.status_code == 200, seen.text
    assert seen.json()["students"]["total"] == 1
    assert client.post("/api/v1/branches", json={"name": "Elsewhere"}).status_code == 403
    denied = client.post(
        f"/api/v1/batches/{batch_id}/assignments",
        json={"teacher_id": plain.json()["id"], "subject_id": subject.json()["id"]},
    )
    assert denied.status_code == 404
    _login(client, "other-batch-viewer@iam.test")
    hidden = client.get(f"/api/v1/batches/{batch_id}")
    assert hidden.status_code == 404
    assert client.get("/api/v1/catalog").status_code == 200
    assert client.get("/api/v1/marksheets").status_code == 200
