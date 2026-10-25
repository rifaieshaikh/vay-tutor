"""ACD-01 contract: intake identity, archive writes, subject scope, and stale edits."""

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


def test_academics_story_locks_identity_archive_scope_and_revision(client):
    bootstrap(client)
    database = sync_db(client)
    institute_id = database.institutes.find_one()["_id"]

    branch = client.post("/api/v1/branches", json={"name": "North"})
    course = client.post("/api/v1/courses", json={"name": "Science"})
    other = client.post("/api/v1/courses", json={"name": "Commerce"})
    assert branch.status_code == course.status_code == other.status_code == 200
    branch_id = branch.json()["id"]
    course_id = course.json()["id"]
    other_id = other.json()["id"]
    offered = client.post(f"/api/v1/branches/{branch_id}/courses", json={"course_id": course_id})
    assert offered.status_code == 200, offered.text

    morning = client.post(
        f"/api/v1/branches/{branch_id}/batches",
        json={"course_id": course_id, "name": "September 2026 morning"},
    )
    evening = client.post(
        f"/api/v1/branches/{branch_id}/batches",
        json={"course_id": course_id, "name": "September 2026 evening"},
    )
    assert morning.status_code == evening.status_code == 200, (morning.text, evening.text)
    stored = list(database.batches.find({"offering_id": offered.json()["id"]}))
    assert {item["name"] for item in stored} == {"September 2026 morning", "September 2026 evening"}
    assert {item["session_key"] for item in stored} == {"2026-09"}
    duplicate = client.post(
        f"/api/v1/branches/{branch_id}/batches",
        json={"course_id": course_id, "name": "September 2026 morning"},
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "batch.exists"

    physics = client.post(f"/api/v1/courses/{course_id}/subjects", json={"name": "Physics"})
    chemistry = client.post(f"/api/v1/courses/{course_id}/subjects", json={"name": "Chemistry"})
    assert physics.status_code == chemistry.status_code == 200
    physics_id = physics.json()["id"]
    chemistry_id = chemistry.json()["id"]
    first_chapter = client.post(
        f"/api/v1/subjects/{physics_id}/items", json={"name": "Motion", "kind": "chapter"}
    )
    same_name = client.post(
        f"/api/v1/subjects/{chemistry_id}/items", json={"name": "Motion", "kind": "chapter"}
    )
    repeat_chapter = client.post(
        f"/api/v1/subjects/{physics_id}/items", json={"name": "Motion", "kind": "chapter"}
    )
    assert first_chapter.status_code == same_name.status_code == 200
    assert repeat_chapter.status_code == 409

    teacher = client.post("/api/v1/teachers", json={"name": "Desk teacher"})
    assert teacher.status_code == 200
    assigned = client.post(
        f"/api/v1/batches/{morning.json()['id']}/assignments",
        json={"teacher_id": teacher.json()["id"], "subject_id": physics_id, "started_on": "2026-09-01"},
    )
    assert assigned.status_code == 200, assigned.text
    renamed = client.patch(
        f"/api/v1/catalog/subject/{physics_id}",
        json={"name": "Physical science", "expected_revision": 0},
    )
    assert renamed.status_code == 200, renamed.text
    kept = database.teachers.find_one({"_id": teacher.json()["id"]})
    assert kept["assignments"][0]["subject_id"] == physics_id

    stale = client.patch(
        f"/api/v1/catalog/course/{course_id}",
        json={"notes": "First", "expected_revision": 4},
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "catalog.stale"
    saved = client.patch(
        f"/api/v1/catalog/course/{course_id}",
        json={"notes": "First", "expected_revision": 0},
    )
    assert saved.status_code == 200, saved.text
    again = client.patch(
        f"/api/v1/catalog/course/{course_id}",
        json={"notes": "Second", "expected_revision": 0},
    )
    assert again.status_code == 409

    student_id = str(ObjectId())
    database.students.insert_one({
        "_id": student_id,
        "institute_id": institute_id,
        "display_name": "Meera Nair",
        "student_code": "IAM-000010",
        "name_key": "meera nair",
    })
    database.students.insert_one({
        "_id": "historical-student",
        "institute_id": institute_id,
        "display_name": "Arun Dev",
        "student_code": "IAM-000011",
        "name_key": "arun dev",
    })
    database.enrollments.insert_many([
        {
            "_id": str(ObjectId()),
            "institute_id": institute_id,
            "student_id": student_id,
            "branch_id": branch_id,
            "course_id": course_id,
            "batch_id": morning.json()["id"],
            "started_on": "2026-09-01",
        },
        {
            "_id": str(ObjectId()),
            "institute_id": institute_id,
            "student_id": "historical-student",
            "branch_id": branch_id,
            "course_id": course_id,
            "batch_id": morning.json()["id"],
            "started_on": "2026-09-01",
            "ended_on": "2026-10-01",
        },
    ])
    matched = client.get(f"/api/v1/batches/{morning.json()['id']}", params={"student_q": "meera", "student_state": "current"})
    assert matched.status_code == 200, matched.text
    assert [item["display_name"] for item in matched.json()["students"]["items"]] == ["Meera Nair"]
    historical = client.get(
        f"/api/v1/batches/{morning.json()['id']}", params={"student_state": "historical"}
    )
    assert [item["display_name"] for item in historical.json()["students"]["items"]] == ["Arun Dev"]

    dated = client.patch(
        f"/api/v1/catalog/batch/{evening.json()['id']}",
        json={"ended_on": "2099-01-01", "expected_revision": 0},
    )
    assert dated.status_code == 200, dated.text
    workspace = client.get(f"/api/v1/batches/{evening.json()['id']}")
    assert workspace.json()["ended_on"] == "2099-01-01"
    assert workspace.json()["closed"] is False
    still_open = client.post(
        f"/api/v1/students/{student_id}/enrollments",
        json={"branch_id": branch_id, "course_id": course_id, "batch_id": evening.json()["id"]},
    )
    assert still_open.status_code == 200, still_open.text
    marked = client.patch(
        f"/api/v1/catalog/batch/{evening.json()['id']}",
        json={"closed": True},
    )
    assert marked.status_code == 200, marked.text
    future = client.post(
        "/api/v1/students/historical-student/enrollments",
        json={"branch_id": branch_id, "course_id": course_id, "batch_id": evening.json()["id"]},
    )
    assert future.status_code == 422
    assert future.json()["error"]["code"] == "batch.closed"

    archived_batch = client.patch(
        f"/api/v1/catalog/batch/{morning.json()['id']}",
        json={"archived": True, "expected_revision": 0},
    )
    assert archived_batch.status_code == 200, archived_batch.text
    still_there = database.enrollments.count_documents({"batch_id": morning.json()["id"]})
    assert still_there == 2
    blocked = client.post(
        f"/api/v1/students/{student_id}/enrollments",
        json={"branch_id": branch_id, "course_id": course_id, "batch_id": morning.json()["id"]},
    )
    assert blocked.status_code == 422
    assert blocked.json()["error"]["code"] == "batch.archived"
    course_after = database.courses.find_one({"_id": course_id})
    assert course_after.get("archived") is not True

    archived_branch = client.patch(
        f"/api/v1/catalog/branch/{branch_id}",
        json={"archived": True, "expected_revision": 0},
    )
    assert archived_branch.status_code == 200, archived_branch.text
    assert database.courses.find_one({"_id": course_id}).get("archived") is not True
    new_offering = client.post(f"/api/v1/branches/{branch_id}/courses", json={"course_id": other_id})
    assert new_offering.status_code == 422
    assert new_offering.json()["error"]["code"] == "catalog.archived"

    coordinator = client.post(
        "/api/v1/users",
        json={
            "name": "Physics coordinator",
            "email": "physics@iam.test",
            "password": "correct-horse",
            "role": "academic_coordinator",
            "scope": {"branch_id": branch_id, "course_id": course_id, "subject_id": physics_id},
            "acknowledge_scope": True,
        },
    )
    assert coordinator.status_code == 200, coordinator.text
    manager = client.post(
        "/api/v1/users",
        json={
            "name": "North admin",
            "email": "north@iam.test",
            "password": "correct-horse",
            "role": "branch_admin",
            "scope": {"branch_id": branch_id},
            "acknowledge_scope": True,
        },
    )
    assert manager.status_code == 200, manager.text
    viewer = client.post(
        "/api/v1/users",
        json={
            "name": "Reader",
            "email": "reader@iam.test",
            "password": "correct-horse",
            "role": "viewer",
            "scope": {},
            "acknowledge_scope": True,
        },
    )
    assert viewer.status_code == 200, viewer.text

    _login(client, "physics@iam.test")
    catalog = client.get("/api/v1/catalog")
    assert catalog.status_code == 200, catalog.text
    assert [item["name"] for item in catalog.json()["subjects"]] == ["Physical science"]
    board = client.get(f"/api/v1/batches/{morning.json()['id']}")
    assert [item["name"] for item in board.json()["curriculum"]] == ["Physical science"]
    sibling = client.post(f"/api/v1/subjects/{chemistry_id}/items", json={"name": "Atoms", "kind": "chapter"})
    assert sibling.status_code == 403
    own = client.post(f"/api/v1/subjects/{physics_id}/items", json={"name": "Energy", "kind": "chapter"})
    assert own.status_code == 200, own.text
    new_subject = client.post(f"/api/v1/courses/{course_id}/subjects", json={"name": "Biology"})
    assert new_subject.status_code == 403

    _login(client, "north@iam.test")
    added = client.post(f"/api/v1/courses/{course_id}/subjects", json={"name": "Biology"})
    assert added.status_code == 200, added.text

    _login(client, "reader@iam.test")
    denied = client.post(f"/api/v1/courses/{course_id}/subjects", json={"name": "History"})
    assert denied.status_code == 403
