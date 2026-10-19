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


def _place(database, institute_id, name):
    branch, course, batch = (str(ObjectId()) for _ in range(3))
    database.branches.insert_one({"_id": branch, "institute_id": institute_id, "name": name, "name_key": name.casefold()})
    database.courses.insert_one({"_id": course, "institute_id": institute_id, "name": f"{name} Science", "name_key": f"{name.casefold()} science"})
    database.offerings.insert_one({"_id": str(ObjectId()), "institute_id": institute_id, "branch_id": branch, "course_id": course})
    database.batches.insert_one({
        "_id": batch,
        "institute_id": institute_id,
        "branch_id": branch,
        "course_id": course,
        "name": f"{name} batch",
        "name_key": f"{name.casefold()} batch",
        "offering_id": str(ObjectId()),
        "session_key": "2027-01",
    })
    return branch, course, batch


def _enroll(database, institute_id, student_id, branch, course, batch, **extra):
    enrollment_id = str(ObjectId())
    database.enrollments.insert_one({
        "_id": enrollment_id,
        "institute_id": institute_id,
        "student_id": student_id,
        "branch_id": branch,
        "course_id": course,
        "batch_id": batch,
        **extra,
    })
    return enrollment_id


def test_enrollment_filters_archive_transfer_and_merge(client):
    bootstrap(client)
    database = sync_db(client)
    institute_id = database.institutes.find_one()["_id"]
    branch, course, batch = _place(database, institute_id, "North")
    other_branch, other_course, other_batch = _place(database, institute_id, "South")
    current_id, past_id, elsewhere_id = (str(ObjectId()) for _ in range(3))
    database.students.insert_many([
        {"_id": current_id, "institute_id": institute_id, "display_name": "CURRENT STUDENT", "student_code": "IAM-000501", "name_key": "current student"},
        {"_id": past_id, "institute_id": institute_id, "display_name": "PAST STUDENT", "student_code": "IAM-000502", "name_key": "past student"},
        {"_id": elsewhere_id, "institute_id": institute_id, "display_name": "SOUTH STUDENT", "student_code": "IAM-000503", "name_key": "south student"},
    ])
    current_enrollment = _enroll(database, institute_id, current_id, branch, course, batch, started_on="2027-01-01")
    _enroll(database, institute_id, past_id, branch, course, batch, started_on="2026-01-01", ended_on="2026-12-01", status="historical")
    _enroll(database, institute_id, elsewhere_id, other_branch, other_course, other_batch, started_on="2027-01-01")
    database.results.insert_one({
        "_id": str(ObjectId()),
        "institute_id": institute_id,
        "student_id": current_id,
        "batch_id": batch,
        "active": True,
        "published": True,
        "score": 10,
    })

    listed = client.get("/api/v1/students", params={"branch_id": branch, "page": 1})
    assert {item["id"] for item in listed.json()["items"]} == {current_id, past_id}
    current = client.get("/api/v1/students", params={"branch_id": branch, "enrollment": "current", "page": 1})
    assert [item["id"] for item in current.json()["items"]] == [current_id]
    historical = client.get("/api/v1/students", params={"branch_id": branch, "enrollment": "historical", "page": 1})
    assert [item["id"] for item in historical.json()["items"]] == [past_id]
    missing = client.get("/api/v1/students", params={"branch_id": branch, "enrollment": "none", "page": 1})
    assert [item["id"] for item in missing.json()["items"]] == [elsewhere_id]
    assert missing.json()["items"][0]["enrollments"] == []
    assert client.get("/api/v1/students", params={"enrollment": "alumni"}).status_code == 422

    archived = client.post(f"/api/v1/students/{current_id}/archive", json={"archived": True, "reason": "Left the institute"})
    assert archived.status_code == 200, archived.text
    assert archived.json()["enrollments_unchanged"] is True
    stored = database.enrollments.find_one({"_id": current_enrollment})
    assert stored.get("ended_on") in {None, ""}
    assert stored.get("status") != "historical"
    hidden = client.get("/api/v1/students", params={"page": 1})
    assert current_id not in [item["id"] for item in hidden.json()["items"]]
    shown = client.get("/api/v1/students", params={"include_archived": "1", "page": 1})
    assert current_id in [item["id"] for item in shown.json()["items"]]
    again = client.post(f"/api/v1/students/{current_id}/archive", json={"archived": False, "reason": "Returned"})
    assert again.status_code == 200, again.text
    assert database.enrollments.find_one({"_id": current_enrollment}).get("ended_on") in {None, ""}

    preview = client.post(
        f"/api/v1/students/{current_id}/transfers/preview",
        json={
            "from_enrollment_id": current_enrollment,
            "branch_id": other_branch,
            "course_id": other_course,
            "batch_id": other_batch,
            "on": "2027-03-01",
            "reason": "Next campus",
        },
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["source_ends_on"] == "2027-03-01"
    assert preview.json()["target_starts_on"] == "2027-03-01"
    assert "not copied" in preview.json()["results"]
    refused = client.post(
        f"/api/v1/students/{current_id}/transfers",
        json={
            "from_enrollment_id": current_enrollment,
            "branch_id": other_branch,
            "course_id": other_course,
            "batch_id": other_batch,
            "on": "2027-03-01",
        },
    )
    assert refused.status_code == 422
    moved = client.post(
        f"/api/v1/students/{current_id}/transfers",
        json={
            "from_enrollment_id": current_enrollment,
            "branch_id": other_branch,
            "course_id": other_course,
            "batch_id": other_batch,
            "on": "2027-03-01",
            "reason": "Next campus",
        },
        headers={"Idempotency-Key": "transfer-once"},
    )
    assert moved.status_code == 200, moved.text
    replay = client.post(
        f"/api/v1/students/{current_id}/transfers",
        json={
            "from_enrollment_id": current_enrollment,
            "branch_id": other_branch,
            "course_id": other_course,
            "batch_id": other_batch,
            "on": "2027-03-01",
            "reason": "Next campus",
        },
        headers={"Idempotency-Key": "transfer-once"},
    )
    assert replay.status_code == 200, replay.text
    assert replay.json()["id"] == moved.json()["id"]
    assert database.enrollments.count_documents({"student_id": current_id, "batch_id": other_batch}) == 1
    assert database.results.find_one({"student_id": current_id})["batch_id"] == batch

    merge = client.post("/api/v1/students/merge-preview", json={"source_id": past_id, "target_id": elsewhere_id})
    assert merge.status_code == 200, merge.text
    assert merge.json()["recoverable"] is False
    assert "cannot be undone" in merge.json()["recovery"]
    committed = client.post(
        "/api/v1/students/merge",
        json={"source_id": past_id, "target_id": elsewhere_id, "acknowledge": True},
    )
    assert committed.status_code == 200, committed.text
    source = database.students.find_one({"_id": past_id})
    assert source["archived"] is True
    assert source["merged_into"] == elsewhere_id
    blocked = client.post(f"/api/v1/students/{past_id}/archive", json={"archived": False, "reason": "Try again"})
    assert blocked.status_code == 409
    repeated = client.post(
        "/api/v1/students/merge",
        json={"source_id": past_id, "target_id": elsewhere_id, "acknowledge": True},
    )
    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["replayed"] is True
    assert database.aliases.count_documents({"student_id": elsewhere_id, "name_key": "past student"}) == 1
