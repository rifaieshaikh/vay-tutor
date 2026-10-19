from io import BytesIO
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.main import create_app
from tests.test_m2 import bootstrap


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


def _course(client):
    course = client.post("/api/v1/courses", json={"name": "CA Foundation"})
    assert course.status_code == 200, course.text
    other = client.post("/api/v1/courses", json={"name": "CMA Foundation"})
    assert other.status_code == 200, other.text
    return course.json()["id"], other.json()["id"]


def test_name_saves_and_people_are_not_merged_by_name(client):
    bootstrap(client)
    course_id, other_id = _course(client)
    first = client.post("/api/v1/enquiries", json={"name": "Meera"})
    assert first.status_code == 200, first.text
    second = client.post("/api/v1/enquiries", json={"name": "Meera", "course_id": course_id})
    assert second.status_code == 200, second.text
    assert first.json()["id"] != second.json()["id"]
    suggestions = client.get("/api/v1/prospects?q=Meera")
    assert suggestions.status_code == 200, suggestions.text
    assert len(suggestions.json()["items"]) == 2
    detail = client.get(f"/api/v1/enquiries/{first.json()['id']}").json()
    assert detail["status"] == "open"
    assert detail["reference"].startswith("ENQ-")
    assert detail["course_id"] == ""
    linked = client.post(
        "/api/v1/enquiries",
        json={"name": "Ignored", "course_id": other_id, "prospect_id": detail["prospect_id"]},
    )
    assert linked.status_code == 200, linked.text
    linked_detail = client.get(f"/api/v1/enquiries/{linked.json()['id']}").json()
    assert linked_detail["name"] == "Meera"
    assert linked_detail["prospect_id"] == detail["prospect_id"]
    assert linked_detail["course_id"] == other_id
    repeated = client.post(
        "/api/v1/enquiries",
        json={"name": "Meera", "course_id": other_id, "prospect_id": detail["prospect_id"]},
    )
    assert repeated.status_code == 422
    assert repeated.json()["error"]["details"]["field"] == "episode_note"
    explained = client.post(
        "/api/v1/enquiries",
        json={
            "name": "Meera",
            "course_id": other_id,
            "prospect_id": detail["prospect_id"],
            "episode_note": "Asked again for the next intake",
        },
    )
    assert explained.status_code == 200, explained.text
    blocked = client.post(f"/api/v1/enquiries/{first.json()['id']}/convert")
    assert blocked.status_code == 422


def test_follow_up_schedule_close_and_conversion(client):
    bootstrap(client)
    course_id, _other = _course(client)
    created = client.post(
        "/api/v1/enquiries",
        json={"name": "Anu", "whatsapp": "09876543210", "course_id": course_id},
    )
    assert created.status_code == 200, created.text
    enquiry_id = created.json()["id"]
    today = client.get(f"/api/v1/enquiries/{enquiry_id}").json()["today"]
    scheduled = client.post(
        f"/api/v1/enquiries/{enquiry_id}/follow-ups",
        json={"kind": "schedule", "next_on": "2099-01-01", "note": "Call after exams"},
    )
    assert scheduled.status_code == 200, scheduled.text
    detail = client.get(f"/api/v1/enquiries/{enquiry_id}").json()
    assert detail["follow_ups"] == []
    assert detail["next_on"] == "2099-01-01"
    assert detail["follow_up_state"] == "upcoming"
    past = client.post(
        f"/api/v1/enquiries/{enquiry_id}/follow-ups",
        json={"kind": "schedule", "next_on": "2000-01-01"},
    )
    assert past.status_code == 422
    recorded = client.post(
        f"/api/v1/enquiries/{enquiry_id}/follow-ups",
        json={"kind": "record", "at": today, "note": "Spoke to her father", "interest": "High", "next_on": "2099-02-01"},
    )
    assert recorded.status_code == 200, recorded.text
    detail = client.get(f"/api/v1/enquiries/{enquiry_id}").json()
    assert detail["interest"] == "High"
    assert detail["follow_ups"][0]["note"] == "Spoke to her father"
    assert any(item["kind"] == "contact" for item in detail["activity"])
    closed = client.post("/api/v1/enquiries/" + enquiry_id + "/close", json={"reason": "Other"})
    assert closed.status_code == 422
    closed = client.post(
        f"/api/v1/enquiries/{enquiry_id}/close",
        json={"reason": "Other", "note": "Joined another institute"},
    )
    assert closed.status_code == 200, closed.text
    detail = client.get(f"/api/v1/enquiries/{enquiry_id}").json()
    assert detail["status"] == "closed"
    assert detail["next_on"] == ""
    refused = client.post(
        f"/api/v1/enquiries/{enquiry_id}/follow-ups",
        json={"kind": "schedule", "next_on": "2099-03-01"},
    )
    assert refused.status_code == 409
    reopened = client.post(f"/api/v1/enquiries/{enquiry_id}/reopen", json={"reason": "She called back"})
    assert reopened.status_code == 200, reopened.text
    assert client.get(f"/api/v1/enquiries/{enquiry_id}").json()["next_on"] == ""
    admitted = client.post(f"/api/v1/enquiries/{enquiry_id}/convert")
    assert admitted.status_code == 200, admitted.text
    again = client.post(f"/api/v1/enquiries/{enquiry_id}/convert")
    assert again.json()["id"] == admitted.json()["id"]
    blocked = client.post(
        f"/api/v1/enquiries/{enquiry_id}/follow-ups",
        json={"kind": "record", "at": today, "note": "Too late"},
    )
    assert blocked.status_code == 409
    reopen = client.post(f"/api/v1/enquiries/{enquiry_id}/reopen", json={"reason": "No"})
    assert reopen.status_code == 409


def test_needs_follow_up_orders_overdue_then_today_then_unscheduled(client):
    bootstrap(client)
    course_id, _other = _course(client)
    overdue = client.post("/api/v1/enquiries", json={"name": "Overdue", "course_id": course_id}).json()["id"]
    first = client.post("/api/v1/enquiries", json={"name": "Older", "course_id": course_id}).json()["id"]
    second = client.post("/api/v1/enquiries", json={"name": "Newer", "course_id": course_id}).json()["id"]
    today = client.get(f"/api/v1/enquiries/{first}").json()["today"]
    past = client.post(
        f"/api/v1/enquiries/{overdue}/follow-ups",
        json={"at": "2020-01-01", "note": "Missed", "next_on": "2020-01-02"},
    )
    assert past.status_code == 200, past.text
    client.post(f"/api/v1/enquiries/{second}/follow-ups", json={"kind": "schedule", "next_on": today})
    listed = client.get("/api/v1/enquiries?follow_up=due&sort=needs")
    assert listed.status_code == 200, listed.text
    names = [item["name"] for item in listed.json()["items"]]
    assert names == ["Overdue", "Newer", "Older"]
    upcoming = client.post("/api/v1/enquiries", json={"name": "Later", "course_id": course_id}).json()["id"]
    client.post(f"/api/v1/enquiries/{upcoming}/follow-ups", json={"kind": "schedule", "next_on": "2099-05-01"})
    due = client.get("/api/v1/enquiries?follow_up=due").json()
    assert "Later" not in [item["name"] for item in due["items"]]


def _csv(text: str) -> tuple[str, bytes, str]:
    return ("enquiries.csv", text.encode("utf-8"), "text/csv")


def test_mapped_import_resolves_values_and_commits_once(client):
    bootstrap(client)
    course_id, _other = _course(client)
    existing = client.post("/api/v1/enquiries", json={"name": "Meera", "whatsapp": "9000000001", "course_id": course_id})
    assert existing.status_code == 200, existing.text
    uploaded = client.post(
        "/api/v1/enquiry-imports",
        files={"file": _csv("Student,Mobile,Course,Heat\nAnu,09870000001,CA Fdn,Hot\nMeera,9000000001,CA Fdn,High\n")},
    )
    assert uploaded.status_code == 200, uploaded.text
    operation_id = uploaded.json()["id"]
    assert uploaded.json()["format"] == "csv"
    planned = client.put(
        f"/api/v1/enquiry-imports/{operation_id}",
        json={
            "revision": uploaded.json()["revision"],
            "sources": [{"sheet": "CSV", "header_row": 1}],
            "mappings": [
                {"column_id": "0:0", "target": "name"},
                {"column_id": "0:1", "target": "whatsapp"},
                {"column_id": "0:2", "target": "course"},
                {"column_id": "0:3", "target": "interest"},
            ],
            "courses": {"CA Fdn": course_id},
            "interests": {"Hot": "High"},
        },
    )
    assert planned.status_code == 200, planned.text
    rows = planned.json()["rows"]
    assert rows[0]["values"]["whatsapp"] == "09870000001"
    assert rows[0]["values"]["course_id"] == course_id
    assert rows[0]["values"]["interest"] == "High"
    assert rows[0]["status"] == "valid"
    assert rows[1]["status"] == "blocked"
    assert rows[1]["candidates"]
    resolved = client.put(
        f"/api/v1/enquiry-imports/{operation_id}",
        json={
            "revision": planned.json()["revision"],
            "sources": [{"sheet": "CSV", "header_row": 1}],
            "mappings": [
                {"column_id": "0:0", "target": "name"},
                {"column_id": "0:1", "target": "whatsapp"},
                {"column_id": "0:2", "target": "course"},
                {"column_id": "0:3", "target": "interest"},
            ],
            "courses": {"CA Fdn": course_id},
            "interests": {"Hot": "High"},
            "decisions": [
                {"key": rows[1]["key"], "action": "skip"},
            ],
        },
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["counts"]["blocked"] == 0
    assert resolved.json()["counts"]["skipped"] == 1
    refused = client.post(
        f"/api/v1/enquiry-imports/{operation_id}/commit",
        json={"revision": planned.json()["revision"], "idempotency_key": "import-1"},
    )
    assert refused.status_code == 409
    committed = client.post(
        f"/api/v1/enquiry-imports/{operation_id}/commit",
        json={"revision": resolved.json()["revision"], "idempotency_key": "import-1"},
    )
    assert committed.status_code == 200, committed.text
    assert committed.json()["status"] == "committed"
    assert len(committed.json()["result"]["created"]) == 1
    again = client.post(
        f"/api/v1/enquiry-imports/{operation_id}/commit",
        json={"revision": resolved.json()["revision"], "idempotency_key": "import-1"},
    )
    assert again.status_code == 200, again.text
    assert again.json()["result"]["created"][0]["id"] == committed.json()["result"]["created"][0]["id"]
    changed = client.post(
        f"/api/v1/enquiry-imports/{operation_id}/commit",
        json={"revision": resolved.json()["revision"], "idempotency_key": "import-2"},
    )
    assert changed.status_code == 409
    listed = client.get("/api/v1/enquiries?q=09870000001")
    assert listed.json()["total"] == 1
    stored = listed.json()["items"][0]
    assert stored["whatsapp"] == "09870000001"


def test_formula_cells_are_blocked_until_a_plain_value_is_supplied(client):
    bootstrap(client)
    book = Workbook()
    sheet = book.active
    sheet.title = "Sheet1"
    sheet.append(["Name", "WhatsApp"])
    sheet.append(["Anu", "=1+1"])
    buffer = BytesIO()
    book.save(buffer)
    uploaded = client.post(
        "/api/v1/enquiry-imports",
        files={"file": ("people.xlsx", buffer.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert uploaded.status_code == 200, uploaded.text
    operation_id = uploaded.json()["id"]
    planned = client.put(
        f"/api/v1/enquiry-imports/{operation_id}",
        json={
            "revision": uploaded.json()["revision"],
            "sources": [{"sheet": "Sheet1", "header_row": 1}],
            "mappings": [
                {"column_id": "0:0", "target": "name"},
                {"column_id": "0:1", "target": "whatsapp"},
            ],
        },
    )
    assert planned.status_code == 200, planned.text
    row = planned.json()["rows"][0]
    assert row["status"] == "blocked"
    assert any("formula" in error["message"].casefold() for error in row["errors"])
    fixed = client.put(
        f"/api/v1/enquiry-imports/{operation_id}",
        json={
            "revision": planned.json()["revision"],
            "sources": [{"sheet": "Sheet1", "header_row": 1}],
            "mappings": [
                {"column_id": "0:0", "target": "name"},
                {"column_id": "0:1", "target": "whatsapp"},
            ],
            "formulas": {f"0:1:{row['row']}": {"use": "plain", "value": "09870000002"}},
        },
    )
    assert fixed.status_code == 200, fixed.text
    assert fixed.json()["rows"][0]["status"] == "valid"
    assert fixed.json()["rows"][0]["values"]["whatsapp"] == "09870000002"
