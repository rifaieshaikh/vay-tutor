from io import BytesIO
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.importing.plan import apply_decisions
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


def _context(client, batch_name="January 2027"):
    branch = client.post("/api/v1/branches", json={"name": "Tirur"})
    course = client.post("/api/v1/courses", json={"name": "CA Foundation"})
    client.post(f"/api/v1/branches/{branch.json()['id']}/courses", json={"course_id": course.json()['id']})
    batch = client.post(
        f"/api/v1/branches/{branch.json()['id']}/batches",
        json={"course_id": course.json()["id"], "name": batch_name},
    )
    assert batch.status_code == 200, batch.text
    return branch.json()["id"], course.json()["id"], batch.json()["id"]


def test_a_prospect_stays_one_student_through_transfer_and_published_results(client):
    bootstrap(client)
    branch_id, course_id, batch_id = _context(client)
    subject = client.post(f"/api/v1/courses/{course_id}/subjects", json={"name": "Accounting"})
    assert subject.status_code == 200, subject.text
    paper = client.post(
        f"/api/v1/subjects/{subject.json()['id']}/items",
        json={"kind": "paper", "name": "Paper 1"},
    )
    assert paper.status_code == 200, paper.text
    later = client.post(
        f"/api/v1/branches/{branch_id}/batches",
        json={"course_id": course_id, "name": "May 2027"},
    )
    assert later.status_code == 200, later.text
    later_id = later.json()["id"]
    destination = client.post(
        f"/api/v1/branches/{branch_id}/batches",
        json={"course_id": course_id, "name": "September 2027"},
    )
    assert destination.status_code == 200, destination.text
    destination_id = destination.json()["id"]

    enquiry = client.post(
        "/api/v1/enquiries",
        json={"name": "Aisha", "whatsapp": "9000001111", "course_id": course_id, "interest": "High"},
    )
    assert enquiry.status_code == 200, enquiry.text
    listed = client.get("/api/v1/enquiries").json()["items"][0]
    assert listed["stage"] == "Open"
    assert listed["next_action"] == "Record a follow-up"
    admitted = client.post(f"/api/v1/enquiries/{enquiry.json()['id']}/convert")
    assert admitted.status_code == 200, admitted.text
    again = client.post(f"/api/v1/enquiries/{enquiry.json()['id']}/convert")
    assert again.json()["id"] == admitted.json()["id"]
    followed = client.get(f"/api/v1/enquiries/{enquiry.json()['id']}").json()
    assert followed["stage"] == "Converted"
    assert followed["admission_id"] == admitted.json()["id"]

    converted = client.post(
        f"/api/v1/admissions/{admitted.json()['id']}/convert",
        json={"branch_id": branch_id, "batch_id": batch_id, "decision": "create"},
    )
    assert converted.status_code == 200, converted.text
    student_id = converted.json()["id"]
    repeated = client.post(
        f"/api/v1/admissions/{admitted.json()['id']}/convert",
        json={"branch_id": branch_id, "batch_id": batch_id},
    )
    assert repeated.json()["id"] == student_id
    assert repeated.json()["existing"] is True
    profile = client.get(f"/api/v1/students/{student_id}/enrollments").json()
    assert len(profile["enrollments"]) == 1
    assert profile["admissions"][0]["id"] == admitted.json()["id"]
    assert profile["admissions"][0]["enquiry_id"] == enquiry.json()["id"]
    assert profile["actions"]["contact"] is True
    code = profile["student_code"]
    source_enrollment = profile["enrollments"][0]["id"]

    same_name = client.post(
        "/api/v1/admissions",
        json={"course_id": course_id, "name": "Aisha", "phone": "9000002222"},
    )
    other = client.post(
        f"/api/v1/admissions/{same_name.json()['id']}/convert",
        json={"branch_id": branch_id, "batch_id": later_id, "decision": "create"},
    )
    assert other.status_code == 200, other.text
    assert other.json()["id"] != student_id
    ambiguous = client.post(
        "/api/v1/admissions",
        json={"course_id": course_id, "name": "Aisha", "phone": "9000001111"},
    )
    choice = client.post(
        f"/api/v1/admissions/{ambiguous.json()['id']}/convert",
        json={"branch_id": branch_id, "batch_id": later_id},
    )
    assert choice.status_code == 409
    assert choice.json()["error"]["code"] == "admission.match"

    draft = client.post(
        "/api/v1/marksheets",
        json={
            "title": "Draft test",
            "branch_id": branch_id,
            "course_id": course_id,
            "batch_id": batch_id,
            "subject_id": subject.json()["id"],
            "paper_id": paper.json()["id"],
            "exam_type": "unit",
            "maximum": 20,
            "exam_date": "2027-01-10",
            "attempt": "original",
        },
    )
    assert draft.status_code == 200, draft.text
    assert client.post(
        f"/api/v1/marksheets/{draft.json()['id']}/results",
        json={"student_id": student_id, "status": "scored", "score": 4},
    ).status_code == 200
    published = client.post(
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
    assert published.status_code == 200, published.text
    assert client.post(
        f"/api/v1/marksheets/{published.json()['id']}/results",
        json={"student_id": student_id, "status": "scored", "score": 18},
    ).status_code == 200
    assert client.post(f"/api/v1/marksheets/{published.json()['id']}/publish").status_code == 200
    card = client.get(f"/api/v1/students/{student_id}/card").json()
    assert card["performance"]["percentage"] == 90
    assert card["performance"]["scored"] == 1
    overview = client.get("/api/v1/views/institute", params={"batch_id": batch_id}).json()
    assert overview["performance"]["scored"] == 1
    workspace = client.get(f"/api/v1/students/{student_id}/enrollments").json()
    assert workspace["assessments"][0]["id"] == published.json()["id"]
    assert workspace["assessments"][0]["status"] == "published"
    assert all(item["id"] != draft.json()["id"] for item in workspace["assessments"])

    moved = client.post(
        f"/api/v1/students/{student_id}/transfers",
        json={
            "from_enrollment_id": source_enrollment,
            "branch_id": branch_id,
            "course_id": course_id,
            "batch_id": destination_id,
            "on": "2027-02-01",
            "reason": "Moving to the next batch",
        },
    )
    assert moved.status_code == 200, moved.text
    after = client.get(f"/api/v1/students/{student_id}/enrollments").json()
    assert after["student_code"] == code
    by_batch = {item["batch_id"]: item for item in after["enrollments"]}
    assert by_batch[batch_id]["ended_on"] == "2027-02-01"
    assert by_batch[batch_id]["status"] == "historical"
    assert by_batch[destination_id]["started_on"] == "2027-02-01"
    stored = sync_db(client).results.find_one({"marksheet_id": published.json()["id"], "student_id": student_id})
    assert stored["enrollment_id"] == source_enrollment

    database = sync_db(client)
    closed_batch = client.post(
        f"/api/v1/branches/{branch_id}/batches",
        json={"course_id": course_id, "name": "Closed 2027"},
    )
    assert closed_batch.status_code == 200, closed_batch.text
    closed_id = closed_batch.json()["id"]
    database.batches.update_one({"_id": closed_id}, {"$set": {"closed": True}})
    closed = client.post(
        f"/api/v1/students/{student_id}/enrollments",
        json={"branch_id": branch_id, "course_id": course_id, "batch_id": closed_id},
    )
    assert closed.status_code == 422
    assert closed.json()["error"]["code"] == "batch.closed"
    fresh = client.post(
        "/api/v1/admissions",
        json={"course_id": course_id, "name": "Noura", "phone": "9000003333"},
    )
    rejected = client.post(
        f"/api/v1/admissions/{fresh.json()['id']}/convert",
        json={"branch_id": branch_id, "batch_id": closed_id},
    )
    assert rejected.status_code == 422
    assert rejected.json()["error"]["code"] == "batch.closed"

    viewer = client.post(
        "/api/v1/users",
        json={
            "name": "Tirur viewer",
            "email": "connected-viewer@iam.test",
            "password": "correct-horse",
            "role": "viewer",
            "scope": {"branch_id": branch_id},
            "acknowledge_scope": True,
        },
    )
    assert viewer.status_code == 200, viewer.text
    _login(client, "connected-viewer@iam.test")
    scoped = client.get(f"/api/v1/students/{student_id}/enrollments")
    assert scoped.status_code == 200, scoped.text
    assert scoped.json()["actions"]["contact"] is False
    assert scoped.json()["phone"] is None
    assert scoped.json()["admissions"] == []
    denied = client.post(
        f"/api/v1/students/{student_id}/transfers",
        json={
            "from_enrollment_id": by_batch[destination_id]["id"],
            "branch_id": branch_id,
            "course_id": course_id,
            "batch_id": batch_id,
            "on": "2027-03-01",
        },
    )
    assert denied.status_code == 403

    _login(client, "admin@iam.test")
    before = database.students.count_documents({})
    book = Workbook()
    book.active.append(["Name"])
    buffer = BytesIO()
    book.save(buffer)
    uploaded = client.post(
        "/api/v1/imports",
        files={"file": ("empty.xlsx", buffer.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert uploaded.status_code == 200, uploaded.text
    blocked = client.post(f"/api/v1/imports/{uploaded.json()['id']}/commit")
    assert blocked.status_code == 422
    assert database.students.count_documents({}) == before
    assert database.students.find_one({"_id": student_id})["student_code"] == code


def test_selected_import_context_must_be_confirmed_when_it_differs():
    parsed = {
        "sheets": [
            {
                "id": "sheet-1",
                "position": 1,
                "name": "Accounting",
                "included": True,
                "branch_name": "IAM Tirur",
                "course_name": "CA Foundation",
                "subject_name": "Accounting",
                "paper_number": 1,
                "series": "",
                "title": "Unit",
                "title_key": "unit",
                "suggested_title": "Unit",
                "exam_type": "unit",
                "format": "descriptive",
                "attempt": "original",
                "heading_conflict": False,
                "exam_date": "2027-01-20",
                "recommended_batches": [{"session_key": "2027-01", "label": "January 2027"}],
                "groups": [
                    {
                        "id": "marks",
                        "column": 3,
                        "maximum": 20,
                        "interpretation": "assessment",
                        "confirmed": True,
                        "duplicate_of": None,
                        "students": [
                            {
                                "row": 5,
                                "column": 3,
                                "display_name": "Aisha",
                                "name_key": "aisha",
                                "status": "scored",
                                "score": 18,
                                "maximum": 20,
                                "percentage": 90,
                                "band": None,
                                "source_rank": None,
                            }
                        ],
                    }
                ],
            }
        ]
    }
    selected = {"defaults": {"branch": {"mode": "existing", "value": "Kozhikode"}}}
    blocked = apply_decisions(parsed, selected, {})
    assert any(item["code"] == "import.context_conflict" for item in blocked["blockers"])
    selected["sheets"] = {"sheet-1": {"acknowledge_context": True}}
    confirmed = apply_decisions(parsed, selected, {})
    assert not any(item["code"] == "import.context_conflict" for item in confirmed["blockers"])
    open_workbook = apply_decisions(parsed, {}, {})
    assert not any(item["code"] == "import.context_conflict" for item in open_workbook["blockers"])
