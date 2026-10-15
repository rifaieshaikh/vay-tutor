from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.security import name_key
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


def test_teacher_list_and_course_assignment(client):
    started = bootstrap(client)
    institute = started["institute"]["id"]
    database = sync_db(client)
    database.courses.insert_many(
        [
            {"_id": "ca", "institute_id": institute, "name": "CA Foundation", "name_key": name_key("CA Foundation")},
            {"_id": "cma", "institute_id": institute, "name": "CMA", "name_key": name_key("CMA")},
        ]
    )
    database.subjects.insert_many(
        [
            {
                "_id": "accounting",
                "institute_id": institute,
                "course_id": "ca",
                "name": "Accounting",
                "name_key": name_key("Accounting"),
                "units": [{"id": "ch1", "name": "Chapter 1", "kind": "chapter"}],
            },
            {"_id": "law", "institute_id": institute, "course_id": "ca", "name": "Business Law", "name_key": name_key("Business Law")},
        ]
    )
    database.papers.insert_many(
        [
            {"_id": "p1", "institute_id": institute, "subject_id": "accounting", "name": "Paper 1", "number": 1},
            {"_id": "p2", "institute_id": institute, "subject_id": "accounting", "name": "Paper 2", "number": 2},
        ]
    )
    viewer = client.post(
        "/api/v1/users",
        json={
            "name": "Viewer",
            "email": "viewer-teachers@iam.test",
            "password": "correct-horse",
            "role": "viewer",
            "scope": {},
            "acknowledge_scope": True,
        },
    )
    assert viewer.status_code == 200, viewer.text
    teacher = client.post(
        "/api/v1/users",
        json={
            "name": "Teacher",
            "email": "teacher-course@iam.test",
            "password": "correct-horse",
            "role": "teacher",
            "scope": {"course_id": "cma"},
            "acknowledge_scope": True,
        },
    )
    assert teacher.status_code == 200, teacher.text
    listed = client.get("/api/v1/users")
    assert listed.status_code == 200, listed.text
    by_email = {item["email"]: item for item in listed.json()["items"]}
    assert "viewer" in [grant["role"] for grant in by_email["viewer-teachers@iam.test"]["grants"]]
    assert "teacher" in [grant["role"] for grant in by_email["teacher-course@iam.test"]["grants"]]
    _login(client, "viewer-teachers@iam.test")
    assert client.get("/api/v1/users").status_code == 403
    assert client.get("/api/v1/teachers").status_code == 403
    _login(client, "admin@iam.test")
    teacher_id = teacher.json()["user"]["id"]
    body = {
        "course_id": "ca",
        "subjects": [
            {"subject_id": "accounting", "paper_ids": ["p1"], "unit_ids": ["ch1"]},
            {"subject_id": "law"},
        ],
    }
    denied = client.put(f"/api/v1/users/{teacher_id}/teaching", json=body)
    assert denied.status_code == 422
    assert denied.json()["error"]["code"] == "grant.acknowledge_scope"
    saved = client.put(f"/api/v1/users/{teacher_id}/teaching", json={**body, "acknowledge_scope": True})
    assert saved.status_code == 200, saved.text
    grants = saved.json()["grants"]
    paper = next(item for item in grants if item["scope"].get("paper_id") == "p1")
    assert paper["scope"]["subject_id"] == "accounting"
    assert paper["unit_ids"] == ["ch1"]
    law = next(item for item in grants if item["scope"]["subject_id"] == "law")
    assert law["scope"]["paper_id"] is None
    assert law["unit_ids"] == []
    narrowed = client.put(
        f"/api/v1/users/{teacher_id}/teaching",
        json={"course_id": "ca", "acknowledge_scope": True, "subjects": [{"subject_id": "law"}]},
    )
    assert narrowed.status_code == 200, narrowed.text
    fresh = client.get("/api/v1/users").json()["items"]
    teacher_grants = next(item for item in fresh if item["email"] == "teacher-course@iam.test")["grants"]
    teacher_only = [item for item in teacher_grants if item["role"] == "teacher"]
    assert any(item["scope"].get("course_id") == "cma" for item in teacher_only)
    ca_grants = [item for item in teacher_only if item["scope"].get("course_id") == "ca"]
    assert [item["scope"]["subject_id"] for item in ca_grants] == ["law"]
    plain = client.post("/api/v1/teachers", json={"name": "Desk teacher"})
    assert plain.status_code == 200, plain.text
    assert plain.json()["app_user"] is False
    assert plain.json()["email"] is None
    assigned = client.put(f"/api/v1/teachers/{plain.json()['id']}/teaching", json=body)
    assert assigned.status_code == 200, assigned.text
    assert any(item["unit_ids"] == ["ch1"] and item["scope"]["paper_id"] == "p1" for item in assigned.json()["grants"])
    assert not any(item["name"] == "Desk teacher" for item in client.get("/api/v1/users").json()["items"])
    inactive = client.patch(f"/api/v1/teachers/{plain.json()['id']}", json={"active": False})
    assert inactive.status_code == 200, inactive.text
    assert inactive.json()["active"] is False
    account = client.post(
        "/api/v1/teachers",
        json={"name": "Signed in", "app_user": True, "email": "signed-teacher@iam.test", "password": "correct-horse"},
    )
    assert account.status_code == 200, account.text
    assert account.json()["app_user"] is True
    assert account.json()["email"] == "signed-teacher@iam.test"
    assert client.patch(f"/api/v1/teachers/{account.json()['id']}", json={"active": False}).status_code == 422
    short = client.post(
        "/api/v1/teachers",
        json={"name": "Short", "app_user": True, "email": "short-teacher@iam.test", "password": "short"},
    )
    assert short.status_code == 422
