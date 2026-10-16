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


def _metric(board, key):
    return next(item for item in board["metrics"] if item["key"] == key)


def _queue(board, key):
    return next(item for item in board["queues"] if item["key"] == key)


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
    past = client.post(
        f"/api/v1/enquiries/{due.json()['id']}/follow-ups",
        json={"at": "2026-01-01", "note": "Overdue", "next_on": "2026-01-02"},
    )
    other_past = client.post(
        f"/api/v1/enquiries/{other.json()['id']}/follow-ups",
        json={"at": "2026-01-01", "note": "Overdue", "next_on": "2026-01-03"},
    )
    assert past.status_code == other_past.status_code == 200
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
        {
            "_id": "job-failed",
            "institute_id": institute_id,
            "state": "failed",
            "filename": "bad.xlsx",
            "created_at": now,
            "batch_ids": [january],
        },
        {
            "_id": "job-loose",
            "institute_id": institute_id,
            "state": "failed",
            "filename": "loose.xlsx",
            "created_at": now,
        },
        {"_id": "job-ok", "institute_id": institute_id, "state": "committed", "filename": "ok.xlsx", "created_at": now},
    ])
    database.students.insert_one({
        "_id": "stu-1",
        "institute_id": institute_id,
        "display_name": "Meera Nair",
        "student_code": "IAM-000099",
        "name_key": "meera nair",
    })
    database.enrollments.insert_many([
        {
            "_id": "enr-current",
            "institute_id": institute_id,
            "student_id": "stu-1",
            "branch_id": tirur,
            "course_id": ca,
            "batch_id": january,
        },
        {
            "_id": "enr-ended",
            "institute_id": institute_id,
            "student_id": "stu-1",
            "branch_id": kozhikode,
            "course_id": ca,
            "batch_id": september,
            "ended_on": "2026-02-01",
        },
    ])

    board = client.get("/api/v1/dashboard")
    assert board.status_code == 200, board.text
    body = board.json()
    assert body["rejected"] == []
    assert "period" not in body["applied"]
    assert _metric(body, "follow_ups")["count"] == 2
    assert _metric(body, "admissions")["count"] == 3
    assert _metric(body, "students")["count"] == 1
    assert _queue(body, "marksheets")["count"] == 2
    assert _queue(body, "imports")["count"] == 1
    assert "batch_id" not in _metric(body, "follow_ups")["href"]
    assert any(item["action"] == "Added an enquiry" for item in body["activity"])
    api_for = {
        "follow_ups": "/api/v1/enquiries",
        "admissions": "/api/v1/admissions",
        "students": "/api/v1/students",
        "marksheets": "/api/v1/marksheets",
        "imports": "/api/v1/imports",
    }
    linked = [_metric(body, key) for key in ("follow_ups", "admissions", "students")]
    linked.append(_queue(body, "marksheets"))
    linked.append(_queue(body, "imports"))
    for item in linked:
        query = item["href"].split("?", 1)[1] if "?" in item["href"] else ""
        listed = client.get(f"{api_for[item['key']]}?{query}")
        assert listed.status_code == 200, listed.text
        payload = listed.json()
        found = payload["total"] if "total" in payload else len(payload["items"])
        assert found == item["count"], item["key"]

    narrowed = client.get("/api/v1/dashboard?period=2027-01&branch_id=" + tirur)
    assert _queue(narrowed.json(), "marksheets")["count"] == 1
    assert "period" not in _queue(narrowed.json(), "marksheets")["href"]
    assert _metric(narrowed.json(), "follow_ups")["scope"]
    other_period = client.get("/api/v1/dashboard?period=2026-09&branch_id=" + tirur)
    assert _queue(other_period.json(), "marksheets")["count"] == 1
    listed = client.get("/api/v1/marksheets?status=submitted&branch_id=" + tirur)
    assert listed.json()["total"] == 1

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
    assert _metric(scoped, "follow_ups")["count"] == 1
    assert _metric(scoped, "admissions")["count"] == 2
    assert _metric(scoped, "students")["count"] == 1
    assert _queue(scoped, "marksheets")["count"] == 1
    assert _queue(scoped, "imports")["count"] == 1
    enquiry_href = _metric(scoped, "follow_ups")["href"]
    enquiry_list = client.get("/api/v1/enquiries?" + enquiry_href.split("?", 1)[1])
    assert enquiry_list.json()["total"] == 1
    hidden = client.get(f"/api/v1/enquiries?follow_up=overdue&course_id={cma}")
    assert hidden.json()["total"] == 1
    assert all(item["course_id"] != cma for item in hidden.json()["items"])

    leaked = client.get(f"/api/v1/dashboard?branch_id={kozhikode}")
    assert leaked.status_code == 200, leaked.text
    assert leaked.json()["rejected"] == ["branch_id"]
    assert leaked.json()["metrics"] == []
    assert leaked.json()["queues"] == []
    review = client.get(f"/api/v1/marksheets?status=submitted&branch_id={kozhikode}")
    assert review.json()["total"] == 1
    assert review.json()["items"][0]["id"] == "sheet-review"

    batches = client.get("/api/v1/context/options?dimension=batch")
    assert batches.status_code == 200, batches.text
    assert {item["id"] for item in batches.json()["items"]} == {january}
    courses = client.get("/api/v1/context/options?dimension=course")
    assert {item["id"] for item in courses.json()["items"]} == {ca}
    listed_batches = client.get("/api/v1/catalog").json()["batches"]
    assert {item["id"] for item in listed_batches} == {january}


def test_disjoint_grants_do_not_combine_on_the_dashboard(client):
    bootstrap(client)
    database = sync_db(client)
    institute_id = database.institutes.find_one()["_id"]
    tirur = client.post("/api/v1/branches", json={"name": "Tirur"}).json()["id"]
    kozhikode = client.post("/api/v1/branches", json={"name": "Kozhikode"}).json()["id"]
    ca = client.post("/api/v1/courses", json={"name": "CA Foundation"}).json()["id"]
    cma = client.post("/api/v1/courses", json={"name": "CMA Foundation"}).json()["id"]
    client.post(f"/api/v1/branches/{tirur}/courses", json={"course_id": ca})
    client.post(f"/api/v1/branches/{kozhikode}/courses", json={"course_id": ca})
    client.post(f"/api/v1/branches/{kozhikode}/courses", json={"course_id": cma})
    january = client.post(
        f"/api/v1/branches/{tirur}/batches", json={"course_id": ca, "name": "January 2027"}
    ).json()["id"]
    september = client.post(
        f"/api/v1/branches/{kozhikode}/batches", json={"course_id": cma, "name": "September 2026"}
    ).json()["id"]
    other = client.post(
        f"/api/v1/branches/{kozhikode}/batches", json={"course_id": ca, "name": "March 2026"}
    ).json()["id"]
    database.students.insert_many([
        {"_id": "stu-a", "institute_id": institute_id, "display_name": "A", "name_key": "a", "student_code": "IAM-000101"},
        {"_id": "stu-b", "institute_id": institute_id, "display_name": "B", "name_key": "b", "student_code": "IAM-000102"},
        {"_id": "stu-c", "institute_id": institute_id, "display_name": "C", "name_key": "c", "student_code": "IAM-000103"},
    ])
    database.enrollments.insert_many([
        {"_id": "enr-a", "institute_id": institute_id, "student_id": "stu-a", "branch_id": tirur, "course_id": ca, "batch_id": january},
        {"_id": "enr-b", "institute_id": institute_id, "student_id": "stu-b", "branch_id": kozhikode, "course_id": cma, "batch_id": september},
        {"_id": "enr-c", "institute_id": institute_id, "student_id": "stu-c", "branch_id": kozhikode, "course_id": ca, "batch_id": other},
    ])
    created = client.post(
        "/api/v1/users",
        json={
            "name": "Split",
            "email": "split@iam.test",
            "password": "correct-horse",
            "role": "viewer",
            "scope": {"branch_id": tirur, "course_id": ca},
            "acknowledge_scope": True,
        },
    )
    assert created.status_code == 200, created.text
    added = client.post(
        "/api/v1/grants",
        json={
            "user_id": created.json()["user"]["id"],
            "role": "viewer",
            "scope": {"branch_id": kozhikode, "course_id": cma},
            "acknowledge_scope": True,
        },
    )
    assert added.status_code == 200, added.text
    _login(client, "split@iam.test")
    board = client.get("/api/v1/dashboard").json()
    assert _metric(board, "students")["count"] == 2
    assert _metric(board, "batches")["count"] == 2
    narrowed = client.get(f"/api/v1/dashboard?branch_id={kozhikode}").json()
    assert narrowed["rejected"] == []
    assert _metric(narrowed, "students")["count"] == 1
    assert _metric(narrowed, "batches")["count"] == 1


def test_failed_import_keeps_the_batch_it_belongs_to(client, monkeypatch):
    from pathlib import Path

    bootstrap(client)
    data = (Path(__file__).resolve().parents[2] / "sample-import-files" / "ACCOUNTANCY  RANK LIST.xlsx").read_bytes()
    uploaded = client.post(
        "/api/v1/imports",
        files={"file": ("ACCOUNTANCY  RANK LIST.xlsx", data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert uploaded.status_code == 200, uploaded.text
    preview = client.get(f"/api/v1/imports/{uploaded.json()['id']}")
    assert preview.status_code == 200, preview.text
    sheet = preview.json()["sheets"][0]
    assert preview.json()["ready"] is True
    branch = client.post("/api/v1/branches", json={"name": sheet["branch_name"]}).json()["id"]
    course = client.post("/api/v1/courses", json={"name": sheet["course_name"]}).json()["id"]
    offered = client.post(f"/api/v1/branches/{branch}/courses", json={"course_id": course})
    assert offered.status_code == 200, offered.text
    session_key = sheet["batches"][0]["session_key"]
    year, month = session_key.split("-")
    months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    batch = client.post(
        f"/api/v1/branches/{branch}/batches",
        json={"course_id": course, "name": f"{months[int(month) - 1]} {year}"},
    )
    assert batch.status_code == 200, batch.text

    async def explode(*_args, **_kwargs):
        raise RuntimeError("storage")

    monkeypatch.setattr("app.importing.commit._commit_sheet", explode)
    with pytest.raises(RuntimeError, match="storage"):
        client.post(f"/api/v1/imports/{uploaded.json()['id']}/commit")
    job = sync_db(client).import_jobs.find_one({"_id": uploaded.json()["id"]})
    assert job["state"] == "failed"
    assert batch.json()["id"] in job["batch_ids"]
    board = client.get("/api/v1/dashboard").json()
    assert _queue(board, "imports")["count"] == 1
    listed = client.get(f"/api/v1/imports?state=failed&batch_id={batch.json()['id']}")
    assert listed.json()["total"] == 1
