from uuid import uuid4

import pytest
from bson import ObjectId
from fastapi.testclient import TestClient

from app.importing.parse import session_key_for_label
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


def test_dated_batch_labels_still_match_january_and_september():
    assert session_key_for_label("September 2026") == "2026-09"
    assert session_key_for_label("January 2027") == "2027-01"
    assert session_key_for_label("Morning batch") is None


def test_branch_course_and_subject_details(client):
    bootstrap(client)
    database = sync_db(client)
    institute_id = database.institutes.find_one()["_id"]
    course_id, subject_id = str(ObjectId()), str(ObjectId())
    database.courses.insert_one({"_id": course_id, "institute_id": institute_id, "name": "Foundation", "name_key": "foundation"})
    database.subjects.insert_one({"_id": subject_id, "institute_id": institute_id, "course_id": course_id, "name": "Accounting", "name_key": "accounting"})

    created = client.post("/api/v1/branches", json={"name": "North"})
    assert created.status_code == 200, created.text
    branch_id = created.json()["id"]
    duplicate = client.post("/api/v1/branches", json={"name": "north"})
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "branch.exists"

    saved = client.patch(f"/api/v1/catalog/branch/{branch_id}", json={"street": "Near the bridge", "place": "Tirur", "pin": "676101"})
    assert saved.status_code == 200, saved.text
    renamed = client.patch(f"/api/v1/catalog/branch/{branch_id}", json={"name": "North hall"})
    assert renamed.status_code == 200, renamed.text
    archived = client.patch(f"/api/v1/catalog/branch/{branch_id}", json={"archived": True})
    assert archived.status_code == 200, archived.text
    profile = client.get(f"/api/v1/branches/{branch_id}")
    assert profile.status_code == 200, profile.text
    body = profile.json()
    assert body["name"] == "North hall"
    assert body["archived"] is True
    assert body["street"] == "Near the bridge"
    assert body["place"] == "Tirur"
    assert body["pin"] == "676101"
    assert body["phone"] is None
    assert body["student_count"] == 0

    missing = client.post(f"/api/v1/branches/{branch_id}/batches", json={"course_id": course_id, "name": "September 2026"})
    assert missing.status_code == 404

    offered = client.post(f"/api/v1/branches/{branch_id}/courses", json={"course_id": course_id})
    assert offered.status_code == 200, offered.text
    again = client.post(f"/api/v1/branches/{branch_id}/courses", json={"course_id": course_id})
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "offering.exists"

    early = client.post(
        f"/api/v1/branches/{branch_id}/batches",
        json={"course_id": course_id, "name": "Too soon", "started_on": "2026-09-01", "ended_on": "2026-08-01"},
    )
    assert early.status_code == 422
    assert early.json()["error"]["code"] == "catalog.date"

    batch = client.post(
        f"/api/v1/branches/{branch_id}/batches",
        json={
            "course_id": course_id,
            "name": "September 2026",
            "started_on": "2026-09-01",
            "ended_on": "2026-12-15",
            "timings": "Monday to Friday, 9:30–12:30",
        },
    )
    assert batch.status_code == 200, batch.text
    stored = database.batches.find_one({"_id": batch.json()["id"]})
    assert stored["session_key"] == "2026-09"
    assert stored["started_on"] == "2026-09-01"
    assert stored["ended_on"] == "2026-12-15"
    assert stored["timings"] == "Monday to Friday, 9:30–12:30"
    repeat = client.post(f"/api/v1/branches/{branch_id}/batches", json={"course_id": course_id, "name": "September 2026"})
    assert repeat.status_code == 409
    morning = client.post(f"/api/v1/branches/{branch_id}/batches", json={"course_id": course_id, "name": "Morning batch"})
    assert morning.status_code == 200, morning.text
    assert database.batches.find_one({"_id": morning.json()["id"]})["session_key"] == "morning batch"

    coded = client.patch("/api/v1/institute", json={"name": "IAM", "code": "OTHER"})
    assert coded.status_code == 422
    institute = client.patch("/api/v1/institute", json={"street": "Main road", "email": "desk@iam.test"})
    assert institute.status_code == 200, institute.text
    shown = client.get("/api/v1/institute")
    assert shown.json()["code"] == "IAM"
    assert shown.json()["street"] == "Main road"
    assert shown.json()["email"] == "desk@iam.test"

    chapter = client.post(f"/api/v1/subjects/{subject_id}/items", json={"name": "Bank reconciliation", "kind": "chapter"})
    assert chapter.status_code == 200, chapter.text
    paper = client.post(f"/api/v1/subjects/{subject_id}/items", json={"name": "Paper 1", "kind": "paper"})
    assert paper.status_code == 200, paper.text
    subject = database.subjects.find_one({"_id": subject_id})
    assert subject["units"][0]["kind"] == "chapter"
    assert subject["units"][0]["name"] == "Bank reconciliation"
    assert database.papers.count_documents({"subject_id": subject_id, "kind": "chapter"}) == 0
    stored_paper = database.papers.find_one({"subject_id": subject_id})
    assert stored_paper["kind"] == "paper"
    assert stored_paper["number"] == 1
    renamed_item = client.patch(
        f"/api/v1/subjects/{subject_id}/items/{chapter.json()['id']}",
        json={"name": "Bank reconciliation statement"},
    )
    assert renamed_item.status_code == 200, renamed_item.text
    updated = database.subjects.find_one({"_id": subject_id})["units"][0]
    assert updated["name"] == "Bank reconciliation statement"
    assert updated["previous_name"] == "Bank reconciliation"

    created_course = client.post("/api/v1/courses", json={"name": "Intermediate", "notes": "Second level"})
    assert created_course.status_code == 200, created_course.text
    stored_course = database.courses.find_one({"_id": created_course.json()["id"]})
    assert stored_course["name"] == "Intermediate"
    assert stored_course["name_key"] == "intermediate"
    assert stored_course["notes"] == "Second level"
    duplicate_course = client.post("/api/v1/courses", json={"name": "intermediate"})
    assert duplicate_course.status_code == 409
    assert duplicate_course.json()["error"]["code"] == "course.exists"
    new_course_id = created_course.json()["id"]
    created_subject = client.post(f"/api/v1/courses/{new_course_id}/subjects", json={"name": "Taxation"})
    assert created_subject.status_code == 200, created_subject.text
    new_subject_id = created_subject.json()["id"]
    stored_subject = database.subjects.find_one({"_id": new_subject_id})
    assert stored_subject["course_id"] == new_course_id
    assert stored_subject["name_key"] == "taxation"
    duplicate_subject = client.post(f"/api/v1/courses/{new_course_id}/subjects", json={"name": "taxation"})
    assert duplicate_subject.status_code == 409
    assert duplicate_subject.json()["error"]["code"] == "subject.exists"
    module = client.post(f"/api/v1/subjects/{new_subject_id}/items", json={"name": "Direct tax", "kind": "module"})
    assert module.status_code == 200, module.text
    chapter = client.post(f"/api/v1/subjects/{new_subject_id}/items", json={"name": "Income", "kind": "chapter"})
    assert chapter.status_code == 200, chapter.text
    first_paper = client.post(f"/api/v1/subjects/{new_subject_id}/items", json={"name": "Paper A", "kind": "paper"})
    second_paper = client.post(f"/api/v1/subjects/{new_subject_id}/items", json={"name": "Paper B", "kind": "paper"})
    assert first_paper.status_code == 200, first_paper.text
    assert second_paper.status_code == 200, second_paper.text
    numbers = sorted(item["number"] for item in database.papers.find({"subject_id": new_subject_id}))
    assert numbers == [1, 2]
    stored_units = database.subjects.find_one({"_id": new_subject_id})["units"]
    assert {(item["kind"], item["name"]) for item in stored_units} == {("module", "Direct tax"), ("chapter", "Income")}

    catalog = client.get("/api/v1/catalog").json()
    listed = next(item for item in catalog["subjects"] if item["id"] == subject_id)
    assert listed["units"][0]["name"] == "Bank reconciliation statement"
    assert listed["units"][0]["kind"] == "chapter"
