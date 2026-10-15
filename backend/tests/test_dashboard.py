from datetime import datetime, timezone
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


def _item(board, key):
    return next(item for item in board["items"] if item["key"] == key)


def test_dashboard_counts_match_the_filtered_lists(client):
    bootstrap(client)
    database = sync_db(client)
    institute_id = database.institutes.find_one()["_id"]
    tirur = client.post("/api/v1/branches", json={"name": "Tirur"}).json()["id"]
    kozhikode = client.post("/api/v1/branches", json={"name": "Kozhikode"}).json()["id"]
    ca = client.post("/api/v1/courses", json={"name": "CA Foundation"}).json()["id"]
    cma = client.post("/api/v1/courses", json={"name": "CMA Foundation"}).json()["id"]
    client.post(f"/api/v1/branches/{tirur}/courses", json={"course_id": ca})
    client.post(f"/api/v1/branches/{kozhikode}/courses", json={"course_id": ca})
    january = client.post(
        f"/api/v1/branches/{tirur}/batches",
        json={"course_id": ca, "name": "January 2027"},
    ).json()["id"]
    september = client.post(
        f"/api/v1/branches/{kozhikode}/batches",
        json={"course_id": ca, "name": "September 2026"},
    ).json()["id"]

    due = client.post("/api/v1/enquiries", json={"name": "Due CA", "course_id": ca})
    later = client.post("/api/v1/enquiries", json={"name": "Later CA", "course_id": ca})
    other = client.post("/api/v1/enquiries", json={"name": "Due CMA", "course_id": cma})
    converted = client.post(
        "/api/v1/enquiries",
        json={"name": "Converted CA", "course_id": ca, "whatsapp": "9000000099"},
    )
    assert due.status_code == later.status_code == other.status_code == converted.status_code == 200
    follow = client.post(
        f"/api/v1/enquiries/{later.json()['id']}/follow-ups",
        json={"at": "2026-10-01", "note": "Call next winter", "next_on": "2026-12-01"},
    )
    assert follow.status_code == 200, follow.text
    made = client.post(f"/api/v1/enquiries/{converted.json()['id']}/convert")
    assert made.status_code == 200, made.text
    open_ca = client.post("/api/v1/admissions", json={"name": "Open CA", "phone": "9000000001", "course_id": ca})
    open_cma = client.post("/api/v1/admissions", json={"name": "Open CMA", "phone": "9000000002", "course_id": cma})
    assert open_ca.status_code == open_cma.status_code == 200

    now = datetime.now(timezone.utc)
    database.marksheets.insert_many([
        {
            "_id": "sheet-review",
            "institute_id": institute_id,
            "status": "submitted",
            "title": "Tirur review",
            "branch_id": tirur,
            "course_id": ca,
            "batch_ids": [january],
        },
        {
            "_id": "sheet-other-branch",
            "institute_id": institute_id,
            "status": "submitted",
            "title": "Kozhikode review",
            "branch_id": kozhikode,
            "course_id": ca,
            "batch_ids": [september],
        },
        {
            "_id": "sheet-draft",
            "institute_id": institute_id,
            "status": "draft",
            "title": "Tirur draft",
            "branch_id": tirur,
            "course_id": ca,
            "batch_ids": [january],
        },
    ])
    database.import_jobs.insert_many([
        {"_id": "job-failed", "institute_id": institute_id, "state": "failed", "filename": "bad.xlsx", "created_at": now},
        {"_id": "job-ok", "institute_id": institute_id, "state": "committed", "filename": "ok.xlsx", "created_at": now},
    ])

    board = client.get("/api/v1/dashboard")
    assert board.status_code == 200, board.text
    body = board.json()
    assert _item(body, "enquiries")["count"] == 2
    assert _item(body, "admissions")["count"] == 3
    assert _item(body, "marksheets")["count"] == 2
    assert _item(body, "imports")["count"] == 1
    assert _item(body, "imports")["href"] == "/import?state=failed"
    api_for = {
        "enquiries": "/api/v1/enquiries",
        "admissions": "/api/v1/admissions",
        "marksheets": "/api/v1/marksheets",
        "imports": "/api/v1/imports",
    }
    for item in body["items"]:
        query = item["href"].split("?", 1)[1] if "?" in item["href"] else ""
        listed = client.get(f"{api_for[item['key']]}?{query}")
        assert listed.status_code == 200, listed.text
        payload = listed.json()
        found = payload["total"] if "total" in payload else len(payload["items"])
        assert found == item["count"]

    narrowed = client.get("/api/v1/dashboard?period=2027-01&branch_id=" + tirur)
    assert _item(narrowed.json(), "marksheets")["count"] == 1
    other_period = client.get("/api/v1/dashboard?period=2026-09&branch_id=" + tirur)
    assert _item(other_period.json(), "marksheets")["count"] == 0
    listed = client.get("/api/v1/marksheets?status=submitted&period=2026-09&branch_id=" + tirur)
    assert listed.json()["total"] == 0

    viewer = client.post(
        "/api/v1/users",
        json={
            "name": "Tirur CA",
            "email": "dashboard-viewer@iam.test",
            "password": "correct-horse",
            "role": "viewer",
            "scope": {"branch_id": tirur, "course_id": ca},
            "acknowledge_scope": True,
        },
    )
    assert viewer.status_code == 200, viewer.text
    _login(client, "dashboard-viewer@iam.test")
    scoped = client.get("/api/v1/dashboard").json()
    assert _item(scoped, "enquiries")["count"] == 1
    assert _item(scoped, "admissions")["count"] == 2
    enquiry_href = _item(scoped, "enquiries")["href"]
    enquiry_list = client.get("/api/v1/enquiries?" + enquiry_href.split("?", 1)[1])
    assert enquiry_list.json()["total"] == 1
    hidden = client.get(f"/api/v1/enquiries?follow_up=due&course_id={cma}")
    assert hidden.json()["total"] == 1
    assert all(item["course_id"] != cma for item in hidden.json()["items"])

    leaked = client.get(f"/api/v1/dashboard?branch_id={kozhikode}")
    assert leaked.status_code == 200, leaked.text
    assert "branch_id" in leaked.json()["dropped"]
    assert _item(leaked.json(), "marksheets")["count"] == 1
    assert _item(leaked.json(), "marksheets")["href"].find(kozhikode) == -1
    review = client.get(f"/api/v1/marksheets?status=submitted&branch_id={kozhikode}")
    assert review.json()["total"] == 1
    assert review.json()["items"][0]["id"] == "sheet-review"

    batches = client.get("/api/v1/context/options?dimension=batch")
    assert batches.status_code == 200, batches.text
    assert {item["id"] for item in batches.json()["items"]} == {january}
    courses = client.get("/api/v1/context/options?dimension=course")
    assert {item["id"] for item in courses.json()["items"]} == {ca}
