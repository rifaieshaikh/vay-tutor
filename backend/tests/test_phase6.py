"""Phase 6 checks: record links stay consistent, and a revoked or disjoint grant cannot see them."""

from io import BytesIO
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook

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


def reconcile(database):
    students = {row["_id"] for row in database.students.find()}
    branches = {row["_id"] for row in database.branches.find()}
    courses = {row["_id"] for row in database.courses.find()}
    batches = {row["_id"]: row for row in database.batches.find()}
    enrollments = list(database.enrollments.find())
    enrollment_ids = set()
    for row in enrollments:
        enrollment_ids.add(row["_id"])
        assert row["student_id"] in students
        assert row["branch_id"] in branches
        assert row["course_id"] in courses
        batch = batches[row["batch_id"]]
        assert batch["branch_id"] == row["branch_id"]
        assert batch["course_id"] == row["course_id"]
    for result in database.results.find():
        assert result["student_id"] in students
        assert result["enrollment_id"] in enrollment_ids
    for admission in database.admissions.find({"status": "converted"}):
        assert admission.get("student_id") in students
        assert admission.get("enrollment_id") in enrollment_ids
    for enquiry in database.enquiries.find():
        if enquiry.get("admission_id"):
            assert database.admissions.find_one({"_id": enquiry["admission_id"]})
    for sheet in database.marksheets.find():
        active = list(database.results.find({"marksheet_id": sheet["_id"], "active": True}))
        if sheet.get("status") == "published":
            revision = sheet.get("active_revision") or sheet.get("revision")
            assert active
            assert all(row.get("revision") == revision for row in active)
        else:
            assert active == []


def test_connected_records_survive_retry_and_a_rejected_enrollment(client):
    bootstrap(client)
    branch = client.post("/api/v1/branches", json={"name": "Tirur"})
    course = client.post("/api/v1/courses", json={"name": "CA Foundation"})
    branch_id = branch.json()["id"]
    course_id = course.json()["id"]
    assert client.post(f"/api/v1/branches/{branch_id}/courses", json={"course_id": course_id}).status_code == 200
    batch = client.post(
        f"/api/v1/branches/{branch_id}/batches",
        json={"course_id": course_id, "name": "January 2027"},
    )
    assert batch.status_code == 200, batch.text
    batch_id = batch.json()["id"]
    subject = client.post(f"/api/v1/courses/{course_id}/subjects", json={"name": "Accounting"})
    paper = client.post(
        f"/api/v1/subjects/{subject.json()['id']}/items",
        json={"kind": "paper", "name": "Paper 1"},
    )

    enquiry = client.post(
        "/api/v1/enquiries",
        json={"name": "Aisha", "whatsapp": "9000001111", "course_id": course_id, "interest": "High"},
    )
    admitted = client.post(f"/api/v1/enquiries/{enquiry.json()['id']}/convert")
    repeated = client.post(f"/api/v1/enquiries/{enquiry.json()['id']}/convert")
    assert repeated.json()["id"] == admitted.json()["id"]
    converted = client.post(
        f"/api/v1/admissions/{admitted.json()['id']}/convert",
        json={"branch_id": branch_id, "batch_id": batch_id, "decision": "create"},
    )
    assert converted.status_code == 200, converted.text
    student_id = converted.json()["id"]
    again = client.post(
        f"/api/v1/admissions/{admitted.json()['id']}/convert",
        json={"branch_id": branch_id, "batch_id": batch_id},
    )
    assert again.json()["existing"] is True
    assert again.json()["id"] == student_id

    database = sync_db(client)
    before = {
        "students": database.students.count_documents({}),
        "enrollments": database.enrollments.count_documents({}),
        "results": database.results.count_documents({}),
    }
    closed = client.post(
        f"/api/v1/branches/{branch_id}/batches",
        json={"course_id": course_id, "name": "Closed 2027"},
    )
    closed_id = closed.json()["id"]
    database.batches.update_one({"_id": closed_id}, {"$set": {"closed": True}})
    rejected = client.post(
        f"/api/v1/students/{student_id}/enrollments",
        json={"branch_id": branch_id, "course_id": course_id, "batch_id": closed_id},
    )
    assert rejected.status_code == 422
    assert database.students.count_documents({}) == before["students"]
    assert database.enrollments.count_documents({}) == before["enrollments"]

    sheet = client.post(
        "/api/v1/marksheets",
        json={
            "title": "Unit test",
            "branch_id": branch_id,
            "course_id": course_id,
            "batch_id": batch_id,
            "subject_id": subject.json()["id"],
            "paper_id": paper.json()["id"],
            "exam_type": "unit",
            "maximum": 20,
            "exam_date": "2027-01-20",
            "attempt": "original",
        },
    )
    assert sheet.status_code == 200, sheet.text
    assert client.post(
        f"/api/v1/marksheets/{sheet.json()['id']}/results",
        json={"student_id": student_id, "status": "scored", "score": 18},
    ).status_code == 200
    assert client.post(f"/api/v1/marksheets/{sheet.json()['id']}/publish").status_code == 200
    reconcile(database)
    assert database.results.count_documents({}) == before["results"] + 1

    for path in (
        "/api/v1/dashboard",
        "/api/v1/enquiries",
        "/api/v1/admissions",
        "/api/v1/students",
        "/api/v1/catalog",
        "/api/v1/marksheets",
        "/api/v1/teachers",
        "/api/v1/imports",
        "/api/v1/views/institute",
        "/api/v1/context/options?dimension=branch",
        f"/api/v1/students/{student_id}/enrollments",
        f"/api/v1/students/{student_id}/card",
        f"/api/v1/batches/{batch_id}",
        f"/api/v1/enquiries/{enquiry.json()['id']}",
        f"/api/v1/admissions/{admitted.json()['id']}",
        f"/api/v1/marksheets/{sheet.json()['id']}",
    ):
        response = client.get(path)
        assert response.status_code == 200, path


def test_disjoint_scope_and_revocation_hide_connected_records(client):
    bootstrap(client)
    tirur = client.post("/api/v1/branches", json={"name": "Tirur"}).json()["id"]
    kozhikode = client.post("/api/v1/branches", json={"name": "Kozhikode"}).json()["id"]
    course_id = client.post("/api/v1/courses", json={"name": "CA Foundation"}).json()["id"]
    for branch_id in (tirur, kozhikode):
        assert client.post(f"/api/v1/branches/{branch_id}/courses", json={"course_id": course_id}).status_code == 200
    batch_id = client.post(
        f"/api/v1/branches/{tirur}/batches",
        json={"course_id": course_id, "name": "January 2027"},
    ).json()["id"]
    subject_id = client.post(f"/api/v1/courses/{course_id}/subjects", json={"name": "Accounting"}).json()["id"]
    paper_id = client.post(
        f"/api/v1/subjects/{subject_id}/items",
        json={"kind": "paper", "name": "Paper 1"},
    ).json()["id"]
    enquiry = client.post(
        "/api/v1/enquiries",
        json={"name": "Aisha", "whatsapp": "9000001111", "course_id": course_id, "interest": "High"},
    )
    admission_id = client.post(f"/api/v1/enquiries/{enquiry.json()['id']}/convert").json()["id"]
    student_id = client.post(
        f"/api/v1/admissions/{admission_id}/convert",
        json={"branch_id": tirur, "batch_id": batch_id, "decision": "create"},
    ).json()["id"]
    sheet = client.post(
        "/api/v1/marksheets",
        json={
            "title": "Unit test",
            "branch_id": tirur,
            "course_id": course_id,
            "batch_id": batch_id,
            "subject_id": subject_id,
            "paper_id": paper_id,
            "exam_type": "unit",
            "maximum": 20,
            "exam_date": "2027-01-20",
            "attempt": "original",
        },
    )
    sheet_id = sheet.json()["id"]
    assert client.post(
        f"/api/v1/marksheets/{sheet_id}/results",
        json={"student_id": student_id, "status": "scored", "score": 18},
    ).status_code == 200
    assert client.post(f"/api/v1/marksheets/{sheet_id}/submit").status_code == 200
    book = Workbook()
    book.active.append(["Name"])
    buffer = BytesIO()
    book.save(buffer)
    uploaded = client.post(
        "/api/v1/imports",
        files={"file": ("empty.xlsx", buffer.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert uploaded.status_code == 200, uploaded.text
    source_id = sync_db(client).import_jobs.find_one({"_id": uploaded.json()["id"]})["file_id"]

    viewer = client.post(
        "/api/v1/users",
        json={
            "name": "Kozhikode viewer",
            "email": "kozhikode-viewer@iam.test",
            "password": "correct-horse",
            "role": "viewer",
            "scope": {"branch_id": kozhikode, "course_id": course_id},
            "acknowledge_scope": True,
        },
    )
    assert viewer.status_code == 200, viewer.text
    _login(client, "kozhikode-viewer@iam.test")
    assert client.get(f"/api/v1/students/{student_id}/enrollments").status_code == 404
    assert client.get(f"/api/v1/students/{student_id}/card").status_code == 404
    assert client.get(f"/api/v1/marksheets/{sheet_id}").status_code == 404
    assert client.get(f"/api/v1/batches/{batch_id}").status_code == 404
    dashboard = client.get("/api/v1/dashboard").json()
    counts = {item["key"]: item["count"] for item in dashboard["queues"]}
    assert counts["marksheets"] == 0
    listed = client.get("/api/v1/students", params={"branch_id": tirur}).json()
    assert listed["items"] == []
    views = client.get("/api/v1/views/institute", params={"branch_id": tirur}).json()
    assert views["performance"]["scored"] == 0
    # A source workbook has no single branch tuple, so anyone who can view marksheets may download it.
    assert client.get(f"/api/v1/files/{source_id}").status_code == 200

    revoked = client.cookies.get("vay_session")
    _login(client, "admin@iam.test")
    grant = sync_db(client).grants.find_one({"role": "viewer"})
    assert client.delete(f"/api/v1/grants/{grant['_id']}").status_code == 200
    client.cookies.clear()
    client.cookies.set("vay_session", revoked, domain="testserver")
    assert client.get("/api/v1/dashboard").status_code == 401
    assert client.get("/api/v1/students").status_code == 401
    signed_in = client.post(
        "/api/v1/auth/login",
        json={"email": "kozhikode-viewer@iam.test", "password": "correct-horse"},
    )
    assert signed_in.status_code == 200
    assert client.get(f"/api/v1/students/{student_id}/enrollments").status_code == 404
    hidden = client.get(f"/api/v1/marksheets/{sheet_id}")
    assert hidden.status_code in {403, 404}
    assert client.get(f"/api/v1/files/{source_id}").status_code == 404
