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


def test_student_directory_keeps_scope_identity_and_edits(client):
    bootstrap(client)
    database = sync_db(client)
    institute_id = database.institutes.find_one()["_id"]
    branch_a, branch_b, course_a, course_b = (str(ObjectId()) for _ in range(4))
    batch_a, batch_b, subject, other_subject = (str(ObjectId()) for _ in range(4))
    shared, only_a, only_b, outsider = (str(ObjectId()) for _ in range(4))
    database.branches.insert_many([
        {"_id": branch_a, "institute_id": institute_id, "name": "Tirur", "name_key": "tirur"},
        {"_id": branch_b, "institute_id": institute_id, "name": "Calicut", "name_key": "calicut"},
    ])
    database.courses.insert_many([
        {"_id": course_a, "institute_id": institute_id, "name": "Foundation", "name_key": "foundation"},
        {"_id": course_b, "institute_id": institute_id, "name": "Intermediate", "name_key": "intermediate"},
    ])
    database.offerings.insert_many([
        {"_id": str(ObjectId()), "institute_id": institute_id, "branch_id": branch_a, "course_id": course_a},
        {"_id": str(ObjectId()), "institute_id": institute_id, "branch_id": branch_b, "course_id": course_b},
    ])
    database.batches.insert_many([
        {"_id": batch_a, "institute_id": institute_id, "branch_id": branch_a, "course_id": course_a, "name": "January 2027", "name_key": "january 2027", "session_key": "2027-01"},
        {"_id": batch_b, "institute_id": institute_id, "branch_id": branch_b, "course_id": course_b, "name": "May 2027", "name_key": "may 2027", "session_key": "2027-05"},
    ])
    database.subjects.insert_many([
        {"_id": subject, "institute_id": institute_id, "course_id": course_a, "name": "Accounting", "name_key": "accounting"},
        {"_id": other_subject, "institute_id": institute_id, "course_id": course_b, "name": "Law", "name_key": "law"},
    ])
    database.students.insert_many([
        {"_id": shared, "institute_id": institute_id, "display_name": "SHARED STUDENT", "student_code": "IAM-000201", "name_key": "shared student"},
        {"_id": only_a, "institute_id": institute_id, "display_name": "TIRUR STUDENT", "student_code": "IAM-000202", "name_key": "tirur student"},
        {"_id": only_b, "institute_id": institute_id, "display_name": "CALICUT STUDENT", "student_code": "IAM-000203", "name_key": "calicut student"},
        {"_id": outsider, "institute_id": institute_id, "display_name": "ROSTER STUDENT", "student_code": "IAM-000204", "name_key": "roster student"},
    ])
    database.enrollments.insert_many([
        {"_id": str(ObjectId()), "institute_id": institute_id, "student_id": shared, "branch_id": branch_a, "course_id": course_a, "batch_id": batch_a},
        {"_id": str(ObjectId()), "institute_id": institute_id, "student_id": shared, "branch_id": branch_b, "course_id": course_b, "batch_id": batch_b},
        {"_id": str(ObjectId()), "institute_id": institute_id, "student_id": only_a, "branch_id": branch_a, "course_id": course_a, "batch_id": batch_a},
        {"_id": str(ObjectId()), "institute_id": institute_id, "student_id": only_b, "branch_id": branch_b, "course_id": course_b, "batch_id": batch_b},
        {"_id": str(ObjectId()), "institute_id": institute_id, "student_id": outsider, "branch_id": branch_a, "course_id": course_a, "batch_id": batch_a},
    ])
    database.rosters.insert_one({
        "_id": str(ObjectId()),
        "institute_id": institute_id,
        "batch_id": batch_a,
        "student_ids": [shared, only_a],
    })

    crossed = client.get("/api/v1/students", params={"branch_id": branch_a, "course_id": course_b, "page": 1})
    assert crossed.status_code == 200, crossed.text
    assert crossed.json()["total"] == 0
    matched = client.get("/api/v1/students", params={"branch_id": branch_a, "course_id": course_a, "page": 1, "page_size": 8})
    ids = [item["id"] for item in matched.json()["items"]]
    assert shared in ids and only_a in ids and only_b not in ids
    shared_row = next(item for item in matched.json()["items"] if item["id"] == shared)
    assert len(shared_row["enrollments"]) == 1
    assert shared_row["enrollments"][0]["batch_id"] == batch_a
    assert shared_row["actions"]["edit"] is True

    viewer = client.post(
        "/api/v1/users",
        json={
            "name": "Split viewer",
            "email": "split-viewer@iam.test",
            "password": "correct-horse",
            "role": "viewer",
            "scope": {"branch_id": branch_a, "course_id": course_a},
            "acknowledge_scope": True,
        },
    )
    assert viewer.status_code == 200, viewer.text
    second = client.post(
        "/api/v1/grants",
        json={
            "user_id": viewer.json()["user"]["id"],
            "role": "viewer",
            "scope": {"branch_id": branch_b, "course_id": course_b},
            "acknowledge_scope": True,
        },
    )
    assert second.status_code == 200, second.text
    teacher = client.post(
        "/api/v1/users",
        json={
            "name": "Accounting teacher",
            "email": "accounts-mod30@iam.test",
            "password": "correct-horse",
            "role": "teacher",
            "scope": {"branch_id": branch_a, "course_id": course_a, "subject_id": subject},
            "acknowledge_scope": True,
        },
    )
    assert teacher.status_code == 200, teacher.text
    manager = client.post(
        "/api/v1/users",
        json={
            "name": "Tirur admin",
            "email": "tirur-admin@iam.test",
            "password": "correct-horse",
            "role": "branch_admin",
            "scope": {"branch_id": branch_a},
            "acknowledge_scope": True,
        },
    )
    assert manager.status_code == 200, manager.text

    _login(client, "split-viewer@iam.test")
    options = client.get("/api/v1/students/options").json()
    foundation = next(item for item in options["courses"] if item["id"] == course_a)
    intermediate = next(item for item in options["courses"] if item["id"] == course_b)
    assert foundation["parents"]["branch_ids"] == [branch_a]
    assert intermediate["parents"]["branch_ids"] == [branch_b]
    assert client.get("/api/v1/students", params={"branch_id": branch_a, "course_id": course_b, "page": 1}).json()["total"] == 0
    visible = client.get("/api/v1/students", params={"branch_id": branch_a, "course_id": course_a, "page": 1}).json()
    assert only_b not in [item["id"] for item in visible["items"]]
    shared_visible = next(item for item in visible["items"] if item["id"] == shared)
    assert [item["batch_id"] for item in shared_visible["enrollments"]] == [batch_a]
    assert all(item["actions"]["edit"] is False and item["actions"]["card"] is True for item in visible["items"])
    denied = client.patch(f"/api/v1/students/{only_a}", json={"display_name": "Changed", "edit_version": 0})
    assert denied.status_code == 403
    detail = client.get(f"/api/v1/students/{shared}/enrollments")
    assert detail.status_code == 200, detail.text
    assert {item["batch_id"] for item in detail.json()["enrollments"]} == {batch_a, batch_b}
    assert client.get("/api/v1/students/missing-student/enrollments").status_code == 404
    empty = client.get("/api/v1/students", params={"q": "zzzz-no-student", "page": 1})
    assert empty.json()["total"] == 0
    assert empty.json()["items"] == []

    _login(client, "accounts-mod30@iam.test")
    taught = client.get("/api/v1/students", params={"page": 1, "page_size": 20}).json()
    taught_ids = [item["id"] for item in taught["items"]]
    assert shared in taught_ids and only_a in taught_ids
    assert outsider not in taught_ids and only_b not in taught_ids
    taught_detail = client.get(f"/api/v1/students/{shared}/enrollments").json()
    assert [item["course_id"] for item in taught_detail["enrollments"]] == [course_a]
    assert "name_key" not in taught_detail

    _login(client, "tirur-admin@iam.test")
    blocked = client.patch(f"/api/v1/students/{shared}", json={"display_name": "Renamed Shared", "edit_version": 0})
    assert blocked.status_code == 403
    local = client.get(f"/api/v1/students/{shared}/enrollments").json()
    assert local["actions"]["edit"] is False
    assert [item["branch_id"] for item in local["enrollments"]] == [branch_a]

    _login(client, "admin@iam.test")
    saved = client.patch(f"/api/v1/students/{only_a}", json={"display_name": "Tirur Renamed", "edit_version": 0})
    assert saved.status_code == 200, saved.text
    assert saved.json()["student_code"] == "IAM-000202"
    assert saved.json()["edit_version"] == 1
    stored = database.students.find_one({"_id": only_a})
    assert stored["student_code"] == "IAM-000202"
    assert database.enrollments.count_documents({"student_id": only_a}) == 1
    conflict = client.patch(f"/api/v1/students/{only_a}", json={"display_name": "Again", "edit_version": 0})
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "student.conflict"
    identity = client.patch(
        f"/api/v1/students/{only_a}",
        json={"display_name": "Nope", "edit_version": 1, "student_code": "IAM-999999"},
    )
    assert identity.status_code == 422
    collision = client.patch(
        f"/api/v1/students/{only_a}",
        json={"display_name": "Tirur Renamed", "edit_version": 1},
    )
    assert collision.status_code == 200
    taken = client.patch(
        f"/api/v1/students/{outsider}",
        json={"display_name": "Tirur Renamed", "edit_version": 0},
    )
    assert taken.status_code == 409
    assert taken.json()["error"]["code"] == "student.identity"
    audit = client.get("/api/v1/audit").json()["items"]
    change = next(
        item for item in audit
        if item["action"] == "student.update" and (item.get("before") or {}).get("display_name") == "TIRUR STUDENT"
    )
    assert change["after"]["student_code"] == "IAM-000202"
    database.users.update_one({"email_key": "split-viewer@iam.test"}, {"$inc": {"session_version": 1}})
    _login(client, "split-viewer@iam.test")
    assert client.get("/api/v1/students", params={"page": 1}).status_code == 200
    database.users.update_one({"email_key": "split-viewer@iam.test"}, {"$inc": {"session_version": 1}})
    assert client.get("/api/v1/students", params={"page": 1}).status_code == 401


def test_student_directory_pages_the_matching_count(client):
    bootstrap(client)
    database = sync_db(client)
    institute_id = database.institutes.find_one()["_id"]
    branch, course, batch = (str(ObjectId()) for _ in range(3))
    database.branches.insert_one({"_id": branch, "institute_id": institute_id, "name": "Tirur", "name_key": "tirur"})
    database.courses.insert_one({"_id": course, "institute_id": institute_id, "name": "Foundation", "name_key": "foundation"})
    database.offerings.insert_one({"_id": str(ObjectId()), "institute_id": institute_id, "branch_id": branch, "course_id": course})
    database.batches.insert_one({"_id": batch, "institute_id": institute_id, "branch_id": branch, "course_id": course, "name": "January 2027", "name_key": "january 2027", "session_key": "2027-01"})
    for index in range(9):
        student = str(ObjectId())
        database.students.insert_one({
            "_id": student,
            "institute_id": institute_id,
            "display_name": f"STUDENT {index:02d}",
            "student_code": f"IAM-0003{index:02d}",
            "name_key": f"student {index:02d}",
        })
        database.enrollments.insert_one({
            "_id": str(ObjectId()),
            "institute_id": institute_id,
            "student_id": student,
            "branch_id": branch,
            "course_id": course,
            "batch_id": batch,
        })
    first = client.get("/api/v1/students", params={"batch_id": batch, "page": 1, "page_size": 8, "sort": "code"})
    assert first.status_code == 200, first.text
    assert first.json()["total"] == 9
    assert len(first.json()["items"]) == 8
    assert first.json()["pages"] == 2
    second = client.get("/api/v1/students", params={"batch_id": batch, "page": 2, "page_size": 8, "sort": "code"})
    assert len(second.json()["items"]) == 1
    assert second.json()["total"] == 9
    assert first.json()["items"][0]["student_code"] < second.json()["items"][0]["student_code"]
    descending = client.get("/api/v1/students", params={"batch_id": batch, "page": 1, "page_size": 8, "sort": "code", "direction": "desc"})
    assert descending.json()["items"][0]["student_code"] > first.json()["items"][0]["student_code"]
    by_branch = client.get("/api/v1/students", params={"batch_id": batch, "page": 1, "sort": "branch"})
    assert by_branch.status_code == 200
