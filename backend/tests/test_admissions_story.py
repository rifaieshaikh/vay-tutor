from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

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


def _context(client):
    branch = client.post("/api/v1/branches", json={"name": "Tirur"})
    course = client.post("/api/v1/courses", json={"name": "CA Foundation"})
    client.post(f"/api/v1/branches/{branch.json()['id']}/courses", json={"course_id": course.json()["id"]})
    batch = client.post(
        f"/api/v1/branches/{branch.json()['id']}/batches",
        json={"course_id": course.json()["id"], "name": "January 2027"},
    )
    return branch.json()["id"], course.json()["id"], batch.json()["id"]


def test_draft_readiness_identity_and_enrollment(client):
    bootstrap(client)
    branch_id, course_id, batch_id = _context(client)
    draft = client.post("/api/v1/admissions", json={"name": "Meera", "course_id": course_id})
    assert draft.status_code == 200, draft.text
    detail = client.get(f"/api/v1/admissions/{draft.json()['id']}").json()
    assert detail["reference"].startswith("ADM-")
    assert detail["readiness"] == "needs_information"
    assert detail["requirements"][0]["key"] == "contact.phone"
    listed = client.get("/api/v1/admissions", params={"readiness": "needs_information"}).json()
    assert listed["total"] == 1
    assert client.get("/api/v1/admissions", params={"readiness": "ready"}).json()["total"] == 0

    saved = client.patch(
        f"/api/v1/admissions/{draft.json()['id']}",
        json={"name": "Meera", "phone": "9000000101", "course_id": course_id},
    )
    assert saved.status_code == 200, saved.text
    ready_for_identity = client.get(f"/api/v1/admissions/{draft.json()['id']}").json()
    assert ready_for_identity["readiness"] == "needs_identity"
    assert ready_for_identity["next_action"] == "Confirm identity"
    refused = client.post(
        f"/api/v1/admissions/{draft.json()['id']}/convert",
        json={"branch_id": branch_id, "batch_id": batch_id},
    )
    assert refused.status_code == 409
    assert refused.json()["error"]["code"] == "admission.identity"
    early_batch = client.post(
        f"/api/v1/admissions/{draft.json()['id']}/selection",
        json={"branch_id": branch_id, "batch_id": batch_id},
    )
    assert early_batch.status_code == 409

    confirmed = client.post(
        f"/api/v1/admissions/{draft.json()['id']}/identity",
        json={"decision": "create"},
    )
    assert confirmed.status_code == 200, confirmed.text
    choosing = client.get(f"/api/v1/admissions/{draft.json()['id']}").json()
    assert choosing["readiness"] == "needs_batch"
    selected = client.post(
        f"/api/v1/admissions/{draft.json()['id']}/selection",
        json={"branch_id": branch_id, "batch_id": batch_id},
    )
    assert selected.status_code == 200, selected.text
    assert selected.json()["batch_name"] == "January 2027"
    prepared = client.get(f"/api/v1/admissions/{draft.json()['id']}").json()
    assert prepared["readiness"] == "ready"
    assert prepared["next_action"] == "Enroll in January 2027"
    enrolled = client.post(
        f"/api/v1/admissions/{draft.json()['id']}/convert",
        json={"branch_id": branch_id, "batch_id": batch_id, "decision": "create"},
    )
    assert enrolled.status_code == 200, enrolled.text
    finished = client.get(f"/api/v1/admissions/{draft.json()['id']}").json()
    assert finished["lifecycle"] == "enrolled"
    assert finished["readiness"] == "enrolled"
    assert finished["requirements"] == []
    closed = client.post(
        f"/api/v1/admissions/{draft.json()['id']}/close",
        json={"reason": "Not interested"},
    )
    assert closed.status_code == 409


def test_existing_student_profile_stays_unchanged_and_closure_is_audited(client):
    bootstrap(client)
    branch_id, course_id, batch_id = _context(client)
    first = client.post(
        "/api/v1/admissions",
        json={"name": "Risha", "phone": "9000000001", "course_id": course_id, "email": "first@example.com"},
    )
    enrolled = client.post(
        f"/api/v1/admissions/{first.json()['id']}/convert",
        json={"branch_id": branch_id, "batch_id": batch_id, "decision": "create"},
    )
    assert enrolled.status_code == 200, enrolled.text
    student_id = enrolled.json()["id"]
    later = client.post(
        f"/api/v1/branches/{branch_id}/batches",
        json={"course_id": course_id, "name": "May 2027"},
    )
    second = client.post(
        "/api/v1/admissions",
        json={"name": "Risha", "phone": "9000000001", "course_id": course_id, "email": "second@example.com"},
    )
    detail = client.get(f"/api/v1/admissions/{second.json()['id']}").json()
    assert detail["matches"][0]["id"] == student_id
    linked = client.post(
        f"/api/v1/admissions/{second.json()['id']}/identity",
        json={"decision": "attach", "student_id": student_id},
    )
    assert linked.status_code == 200, linked.text
    client.post(
        f"/api/v1/admissions/{second.json()['id']}/convert",
        json={
            "branch_id": branch_id,
            "batch_id": later.json()["id"],
            "decision": "attach",
            "student_id": student_id,
        },
    )
    profile = client.get(f"/api/v1/students/{student_id}/enrollments").json()
    assert profile["email"] == "first@example.com"

    other = client.post("/api/v1/admissions", json={"name": "Neha", "phone": "9000000008", "course_id": course_id})
    closed = client.post(f"/api/v1/admissions/{other.json()['id']}/close", json={"reason": "Other"})
    assert closed.status_code == 422
    closed = client.post(
        f"/api/v1/admissions/{other.json()['id']}/close",
        json={"reason": "Other", "note": "Duplicate of another file"},
    )
    assert closed.status_code == 200, closed.text
    stored = client.get(f"/api/v1/admissions/{other.json()['id']}").json()
    assert stored["lifecycle"] == "closed"
    assert stored["readiness"] == "closed"
    assert any(item["kind"] == "closed" for item in stored["activity"])
    reopened = client.post(f"/api/v1/admissions/{other.json()['id']}/reopen", json={"reason": "The family called back"})
    assert reopened.status_code == 200, reopened.text
    assert client.get(f"/api/v1/admissions/{other.json()['id']}").json()["lifecycle"] == "open"


def test_repeat_course_change_conflict_and_source_correction(client):
    bootstrap(client)
    branch_id, course_id, batch_id = _context(client)
    other = client.post("/api/v1/courses", json={"name": "CA Intermediate"})
    question = client.post(
        f"/api/v1/courses/{course_id}/questions",
        json={"label": "Previous attempt", "answer_type": "choice", "choices": ["Yes", "No"], "required": True},
    )
    first = client.post(
        "/api/v1/admissions",
        json={"name": "Anu", "phone": "9000002222", "course_id": course_id, "email": "anu@example.com"},
    )
    assert first.status_code == 200, first.text
    repeated = client.post(
        "/api/v1/admissions",
        json={"name": "Anu", "phone": "9000002222", "course_id": course_id},
    )
    assert repeated.status_code == 422
    assert repeated.json()["error"]["code"] == "admission.repeat"
    explained = client.post(
        "/api/v1/admissions",
        json={
            "name": "Anu",
            "phone": "9000002222",
            "course_id": course_id,
            "episode_note": "A second intake was requested before a batch was chosen.",
        },
    )
    assert explained.status_code == 200, explained.text

    saved = client.patch(
        f"/api/v1/admissions/{first.json()['id']}",
        json={
            "name": "Anu",
            "phone": "9000002222",
            "course_id": course_id,
            "email": "anu@example.com",
            "course_answers": [{"question_id": question.json()["id"], "value": "Yes"}],
        },
    )
    assert saved.status_code == 200, saved.text
    client.post(f"/api/v1/admissions/{first.json()['id']}/identity", json={"decision": "create"})
    client.post(
        f"/api/v1/admissions/{first.json()['id']}/selection",
        json={"branch_id": branch_id, "batch_id": batch_id},
    )
    current = client.get(f"/api/v1/admissions/{first.json()['id']}").json()
    stale = client.patch(
        f"/api/v1/admissions/{first.json()['id']}",
        json={"name": "Anu", "phone": "9000002222", "course_id": course_id, "expected_updated_at": "2000-01-01T00:00:00"},
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "admission.conflict"
    preview = client.get(
        f"/api/v1/admissions/{first.json()['id']}/course-change",
        params={"course_id": other.json()["id"]},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["needs_confirmation"] is True
    refused = client.patch(
        f"/api/v1/admissions/{first.json()['id']}",
        json={
            "name": "Anu",
            "phone": "9000002222",
            "course_id": other.json()["id"],
            "expected_updated_at": current["updated_at"],
        },
    )
    assert refused.status_code == 409
    assert refused.json()["error"]["code"] == "admission.course"
    changed = client.patch(
        f"/api/v1/admissions/{first.json()['id']}",
        json={
            "name": "Anu",
            "phone": "9000002222",
            "course_id": other.json()["id"],
            "confirm_course_change": True,
            "expected_updated_at": current["updated_at"],
        },
    )
    assert changed.status_code == 200, changed.text
    moved = client.get(f"/api/v1/admissions/{first.json()['id']}").json()
    assert moved["batch_id"] in {None, ""}
    assert any(item["value"] == "Yes" for item in moved["course_answers"])

    answered = client.patch(
        f"/api/v1/admissions/{explained.json()['id']}",
        json={
            "name": "Anu",
            "phone": "9000002222",
            "course_id": course_id,
            "course_answers": [{"question_id": question.json()["id"], "value": "No"}],
        },
    )
    assert answered.status_code == 200, answered.text
    enrolled = client.post(
        f"/api/v1/admissions/{explained.json()['id']}/convert",
        json={"branch_id": branch_id, "batch_id": batch_id, "decision": "create"},
        headers={"Idempotency-Key": "enroll-anu"},
    )
    assert enrolled.status_code == 200, enrolled.text
    again = client.post(
        f"/api/v1/admissions/{explained.json()['id']}/convert",
        json={"branch_id": branch_id, "batch_id": batch_id, "decision": "create"},
        headers={"Idempotency-Key": "enroll-anu"},
    )
    assert again.status_code == 200, again.text
    assert again.json()["id"] == enrolled.json()["id"]
    source = client.get(f"/api/v1/admissions/{explained.json()['id']}").json()
    corrected = client.post(
        f"/api/v1/admissions/{explained.json()['id']}/correction",
        json={
            "name": "Anu",
            "phone": "9000002222",
            "course_id": course_id,
            "email": "corrected@example.com",
            "note": "The application email was mistyped.",
            "expected_updated_at": source["updated_at"],
        },
    )
    assert corrected.status_code == 200, corrected.text
    student = client.get(f"/api/v1/students/{enrolled.json()['id']}/enrollments").json()
    assert student["email"] != "corrected@example.com"
    history = client.get(f"/api/v1/admissions/{explained.json()['id']}").json()
    assert history["email"] == "corrected@example.com"
    assert any(item["kind"] == "correction" for item in history["activity"])
    listed = client.get("/api/v1/admissions", params={"branch_id": branch_id, "batch_id": batch_id})
    assert listed.status_code == 200, listed.text
    assert explained.json()["id"] in {item["id"] for item in listed.json()["items"]}


def test_mapped_import_creates_applications_once(client):
    bootstrap(client)
    _branch_id, course_id, _batch_id = _context(client)
    student = client.post(
        "/api/v1/admissions",
        json={"name": "Meera", "phone": "9000000001", "course_id": course_id, "email": "meera@example.com"},
    )
    enrolled = client.post(
        f"/api/v1/admissions/{student.json()['id']}/convert",
        json={"branch_id": _branch_id, "batch_id": _batch_id, "decision": "create"},
    )
    assert enrolled.status_code == 200, enrolled.text
    missing_batch = client.post(
        "/api/v1/admission-imports",
        data={"branch_id": _branch_id, "course_id": course_id},
        files={"file": ("applications.csv", b"Applicant,Mobile,Course\nAnu,09870000001,CA Fdn\n", "text/csv")},
    )
    assert missing_batch.status_code == 422
    closed = client.post(
        f"/api/v1/branches/{_branch_id}/batches",
        json={"course_id": course_id, "name": "Closed intake", "started_on": "2026-01-01", "ended_on": "2026-02-01"},
    )
    assert closed.status_code == 200, closed.text
    marked = client.patch(f"/api/v1/catalog/batch/{closed.json()['id']}", json={"closed": True})
    assert marked.status_code == 200, marked.text
    refused_batch = client.post(
        "/api/v1/admission-imports",
        data={"branch_id": _branch_id, "course_id": course_id, "batch_id": closed.json()["id"]},
        files={"file": ("applications.csv", b"Applicant,Mobile,Course\nAnu,09870000001,CA Fdn\n", "text/csv")},
    )
    assert refused_batch.status_code == 422
    uploaded = client.post(
        "/api/v1/admission-imports",
        data={"branch_id": _branch_id, "course_id": course_id, "batch_id": _batch_id},
        files={"file": ("applications.csv", "Applicant,Mobile,Course\nAnu,09870000001,CA Fdn\nMeera,9000000001,CA Fdn\n".encode(), "text/csv")},
    )
    assert uploaded.status_code == 200, uploaded.text
    operation_id = uploaded.json()["id"]
    planned = client.put(
        f"/api/v1/admission-imports/{operation_id}",
        json={
            "revision": uploaded.json()["revision"],
            "sources": [{"sheet": "CSV", "header_row": 1}],
            "mappings": [
                {"column_id": "0:0", "target": "name"},
                {"column_id": "0:1", "target": "phone"},
                {"column_id": "0:2", "target": "course"},
            ],
            "courses": {"CA Fdn": course_id},
        },
    )
    assert planned.status_code == 200, planned.text
    rows = planned.json()["rows"]
    assert rows[0]["status"] == "valid"
    assert rows[0]["values"]["phone"] == "09870000001"
    assert rows[0]["readiness"] == "needs_identity"
    assert rows[1]["status"] == "blocked"
    assert any(item["kind"] == "student" for item in rows[1]["candidates"])
    resolved = client.put(
        f"/api/v1/admission-imports/{operation_id}",
        json={
            "revision": planned.json()["revision"],
            "sources": [{"sheet": "CSV", "header_row": 1}],
            "mappings": [
                {"column_id": "0:0", "target": "name"},
                {"column_id": "0:1", "target": "phone"},
                {"column_id": "0:2", "target": "course"},
            ],
            "courses": {"CA Fdn": course_id},
            "decisions": [
                {"key": rows[1]["key"], "action": "create", "episode_note": ""},
            ],
        },
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["counts"]["blocked"] == 0
    committed = client.post(
        f"/api/v1/admission-imports/{operation_id}/commit",
        json={"revision": resolved.json()["revision"], "idempotency_key": "adm-import-1"},
    )
    assert committed.status_code == 200, committed.text
    assert len(committed.json()["result"]["created"]) == 2
    again = client.post(
        f"/api/v1/admission-imports/{operation_id}/commit",
        json={"revision": resolved.json()["revision"], "idempotency_key": "adm-import-1"},
    )
    assert again.json()["result"]["created"][0]["id"] == committed.json()["result"]["created"][0]["id"]
    created = client.get(f"/api/v1/admissions/{committed.json()['result']['created'][0]['id']}").json()
    assert created["status"] == "open"
    assert created["student_id"] in {None, ""}
    assert created["branch_id"] == _branch_id
    assert created["batch_id"] == _batch_id
    identified = client.post(
        f"/api/v1/admissions/{created['id']}/identity",
        json={"decision": "create", "expected_updated_at": created["updated_at"]},
    )
    assert identified.status_code == 200, identified.text
    ready = client.get(f"/api/v1/admissions/{created['id']}").json()
    assert ready["readiness"] == "ready"
    assert ready["student_id"] in {None, ""}
    meera = next(item for item in committed.json()["result"]["created"] if item["name"] == "Meera")
    linked = client.get(f"/api/v1/admissions/{meera['id']}").json()
    assert linked["match_decision"] == "create"
    assert client.get(f"/api/v1/students/{enrolled.json()['id']}/enrollments").json()["email"] == "meera@example.com"
    removed = client.delete(f"/api/v1/admission-imports/{operation_id}")
    assert removed.status_code == 422
    assert client.get("/api/v1/admission-imports").json()["items"][0]["id"] == operation_id
    assert client.get(f"/api/v1/admissions/{created['id']}").json()["status"] == "open"


def test_automatic_import_matches_name_and_phone(client):
    bootstrap(client)
    branch_id, course_id, batch_id = _context(client)
    existing = client.post(
        "/api/v1/admissions",
        json={"name": "Meera", "phone": "9000000001", "course_id": course_id, "email": "meera@example.com"},
    )
    assert existing.status_code == 200, existing.text
    enrolled = client.post(
        f"/api/v1/admissions/{existing.json()['id']}/convert",
        json={"branch_id": branch_id, "batch_id": batch_id, "decision": "create"},
        headers={"Idempotency-Key": "enroll-meera-auto"},
    )
    assert enrolled.status_code == 200, enrolled.text
    uploaded = client.post(
        "/api/v1/admission-imports",
        data={"branch_id": branch_id, "course_id": course_id, "batch_id": batch_id},
        files={
            "file": (
                "applications.csv",
                b"Applicant,Mobile,Course,Email\nAnu,9000000011,CA Fdn,anu@example.com\nMeera,9000000001,CA Fdn,other@example.com\nMeera,9000000099,CA Fdn,third@example.com\n",
                "text/csv",
            )
        },
    )
    assert uploaded.status_code == 200, uploaded.text
    operation_id = uploaded.json()["id"]
    mappings = [
        {"column_id": "0:0", "target": "name"},
        {"column_id": "0:1", "target": "phone"},
        {"column_id": "0:2", "target": "course"},
        {"column_id": "0:3", "target": "email"},
    ]
    planned = client.put(
        f"/api/v1/admission-imports/{operation_id}",
        json={
            "revision": uploaded.json()["revision"],
            "sources": [{"sheet": "CSV", "header_row": 1}],
            "mappings": mappings,
            "courses": {"CA Fdn": course_id},
            "identity_mode": "automatic",
        },
    )
    assert planned.status_code == 200, planned.text
    rows = {item["values"]["phone"]: item for item in planned.json()["rows"]}
    assert rows["9000000011"]["status"] == "valid"
    assert rows["9000000011"]["values"]["match_decision"] == "create"
    assert rows["9000000001"]["status"] == "valid"
    assert rows["9000000001"]["values"]["match_decision"] == "attach"
    assert rows["9000000001"]["student_id"] == enrolled.json()["id"]
    assert rows["9000000099"]["status"] == "blocked"
    anu = rows["9000000011"]
    corrected = client.put(
        f"/api/v1/admission-imports/{operation_id}",
        json={
            "revision": planned.json()["revision"],
            "sources": [{"sheet": "CSV", "header_row": 1}],
            "mappings": mappings,
            "courses": {"CA Fdn": course_id},
            "identity_mode": "automatic",
            "decisions": [
                {"key": anu["key"], "action": "create", "values": {"email": "anu.corrected@example.com"}},
                {"key": rows["9000000099"]["key"], "action": "skip"},
            ],
        },
    )
    assert corrected.status_code == 200, corrected.text
    assert corrected.json()["counts"]["blocked"] == 0
    committed = client.post(
        f"/api/v1/admission-imports/{operation_id}/commit",
        json={"revision": corrected.json()["revision"], "idempotency_key": "adm-auto-1"},
    )
    assert committed.status_code == 200, committed.text
    created = {item["name"]: item for item in committed.json()["result"]["created"]}
    assert created["Anu"]["student_created"] is True
    assert created["Meera"]["student_created"] is False
    assert created["Meera"]["student_id"] == enrolled.json()["id"]
    anu_application = client.get(f"/api/v1/admissions/{created['Anu']['id']}").json()
    assert anu_application["status"] == "converted"
    assert anu_application["lifecycle"] == "enrolled"
    anu_student = client.get(f"/api/v1/students/{created['Anu']['student_id']}/enrollments").json()
    assert anu_student["email"] == "anu.corrected@example.com"
    assert len(anu_student["enrollments"]) == 1
    meera_student = client.get(f"/api/v1/students/{enrolled.json()['id']}/enrollments").json()
    assert meera_student["email"] == "meera@example.com"
    assert len(meera_student["enrollments"]) == 1
