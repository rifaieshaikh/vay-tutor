from io import BytesIO
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.main import create_app
from app.security import phone_key
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


def _workbook(headers, rows):
    book = Workbook()
    sheet = book.active
    sheet.append(headers)
    for row in rows:
        sheet.append(row)
    buffer = BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def _context(client):
    branch = client.post("/api/v1/branches", json={"name": "Tirur"})
    assert branch.status_code == 200, branch.text
    course = client.post("/api/v1/courses", json={"name": "CA Foundation"})
    assert course.status_code == 200, course.text
    offered = client.post(f"/api/v1/branches/{branch.json()['id']}/courses", json={"course_id": course.json()["id"]})
    assert offered.status_code == 200, offered.text
    batch = client.post(
        f"/api/v1/branches/{branch.json()['id']}/batches",
        json={"course_id": course.json()["id"], "name": "January 2027"},
    )
    assert batch.status_code == 200, batch.text
    return branch.json()["id"], course.json()["id"], batch.json()["id"]


def test_phone_key_drops_a_leading_country_code():
    assert phone_key("+91 98765 43210") == "9876543210"
    assert phone_key("9876543210") == "9876543210"
    assert phone_key("") == ""


def test_enquiry_becomes_an_admission_and_then_a_student(client):
    bootstrap(client)
    branch_id, course_id, batch_id = _context(client)
    question = client.post(
        f"/api/v1/courses/{course_id}/questions",
        json={"label": "Previous attempt", "answer_type": "choice", "choices": ["Yes", "No"], "required": True},
    )
    assert question.status_code == 200, question.text

    viewer = client.post(
        "/api/v1/users",
        json={
            "name": "Viewer",
            "email": "intake-viewer@iam.test",
            "password": "correct-horse",
            "role": "viewer",
            "scope": {"branch_id": branch_id},
            "acknowledge_scope": True,
        },
    )
    assert viewer.status_code == 200, viewer.text
    _login(client, "intake-viewer@iam.test")
    denied = client.post("/api/v1/enquiries", json={"name": "AFNAS"})
    assert denied.status_code == 403

    _login(client, "admin@iam.test")
    created = client.post(
        "/api/v1/enquiries",
        json={
            "name": "AFNAS",
            "whatsapp": "+91 98765 43210",
            "present_institution": "City College",
            "course_id": course_id,
            "interest": "High",
            "references": "Walk-in",
            "details": "Asked about the January batch",
        },
    )
    assert created.status_code == 200, created.text
    enquiry_id = created.json()["id"]
    follow = client.post(
        f"/api/v1/enquiries/{enquiry_id}/follow-ups",
        json={
            "at": "2026-10-01",
            "note": "Will visit on Saturday",
            "interest": "Medium",
            "next_on": "2026-10-08",
        },
    )
    assert follow.status_code == 200, follow.text
    detail = client.get(f"/api/v1/enquiries/{enquiry_id}").json()
    assert detail["follow_ups"][0]["note"] == "Will visit on Saturday"
    assert detail["interest"] == "High"

    converted = client.post(f"/api/v1/enquiries/{enquiry_id}/convert")
    assert converted.status_code == 200, converted.text
    admission_id = converted.json()["id"]
    again = client.post(f"/api/v1/enquiries/{enquiry_id}/convert")
    assert again.json()["id"] == admission_id
    admission = client.get(f"/api/v1/admissions/{admission_id}").json()
    assert admission["phone"] == "+91 98765 43210"
    assert admission["academic_records"][0]["institution"] == "City College"
    saved = client.patch(
        f"/api/v1/admissions/{admission_id}",
        json={
            "course_id": course_id,
            "name": "AFNAS",
            "phone": "9876543210",
            "gender": "Female",
            "email": "afnas@example.com",
            "street": "12 River Road",
            "place": "Tirur",
            "academic_records": [
                {
                    "qualification": "Plus Two",
                    "stream": "Commerce",
                    "institution": "City College",
                    "mark": "92",
                    "year_of_passing": "2024",
                    "board": "Kerala",
                }
            ],
            "course_answers": [{"question_id": question.json()["id"], "value": "No"}],
        },
    )
    assert saved.status_code == 200, saved.text
    blocked = client.post(
        f"/api/v1/admissions/{admission_id}/convert", json={"branch_id": branch_id, "batch_id": batch_id}
    )
    assert blocked.status_code == 200, blocked.text
    student_id = blocked.json()["id"]
    assert blocked.json()["created"] is True
    student = client.get(f"/api/v1/students/{student_id}/enrollments").json()
    assert student["student_code"].startswith("IAM-")
    assert student["phone"] == "9876543210"
    assert student["gender"] == "Female"
    assert student["email"] == "afnas@example.com"
    assert student["street"] == "12 River Road"
    assert student["place"] == "Tirur"
    assert student["academic_records"][0]["stream"] == "Commerce"
    assert student["course_profiles"][0]["answers"][0]["value"] == "No"
    assert student["enrollments"][0]["batch_id"] == batch_id

    answer = {"question_id": question.json()["id"], "value": "Yes"}
    duplicate = client.post(
        "/api/v1/admissions",
        json={
            "course_id": course_id,
            "name": "afnas",
            "phone": "+91-98765-43210",
            "course_answers": [answer],
        },
    )
    assert duplicate.status_code == 200, duplicate.text
    needs_choice = client.post(
        f"/api/v1/admissions/{duplicate.json()['id']}/convert",
        json={"branch_id": branch_id, "batch_id": batch_id},
    )
    assert needs_choice.status_code == 409
    assert needs_choice.json()["error"]["code"] == "admission.match"
    assert needs_choice.json()["error"]["details"]["matches"][0]["id"] == student_id
    fresh_batch = client.post(
        f"/api/v1/branches/{branch_id}/batches",
        json={"course_id": course_id, "name": "May 2027"},
    )
    assert fresh_batch.status_code == 200, fresh_batch.text
    client.patch(
        f"/api/v1/students/{student_id}", json={"display_name": "AFNAS", "edit_version": 0, "email": "kept@example.com"}
    )
    attached = client.post(
        f"/api/v1/admissions/{duplicate.json()['id']}/convert",
        json={
            "branch_id": branch_id,
            "batch_id": fresh_batch.json()["id"],
            "decision": "attach",
            "student_id": student_id,
        },
    )
    assert attached.status_code == 200, attached.text
    assert attached.json()["created"] is False
    kept = client.get(f"/api/v1/students/{student_id}/enrollments").json()
    assert kept["email"] == "kept@example.com"
    assert {item["batch_id"] for item in kept["enrollments"]} == {batch_id, fresh_batch.json()["id"]}

    separate = client.post(
        "/api/v1/admissions",
        json={
            "course_id": course_id,
            "name": "AFNAS",
            "phone": "9876543210",
            "course_answers": [answer],
        },
    )
    created_new = client.post(
        f"/api/v1/admissions/{separate.json()['id']}/convert",
        json={"branch_id": branch_id, "batch_id": fresh_batch.json()["id"], "decision": "create"},
    )
    assert created_new.status_code == 409
    other_batch = client.post(
        f"/api/v1/branches/{branch_id}/batches",
        json={"course_id": course_id, "name": "September 2027"},
    )
    created_new = client.post(
        f"/api/v1/admissions/{separate.json()['id']}/convert",
        json={"branch_id": branch_id, "batch_id": other_batch.json()["id"], "decision": "create"},
    )
    assert created_new.status_code == 200, created_new.text
    assert created_new.json()["id"] != student_id
    assert created_new.json()["created"] is True


def test_excel_import_previews_matches_and_commits_after_confirmation(client):
    bootstrap(client)
    _branch_id, course_id, _batch_id = _context(client)
    database = sync_db(client)
    institute_id = database.institutes.find_one()["_id"]
    database.students.insert_one(
        {
            "_id": "existing-student",
            "institute_id": institute_id,
            "display_name": "RISHA",
            "student_code": "IAM-000010",
            "name_key": "risha",
            "phone": "9000000001",
            "phone_key": "9000000001",
        }
    )
    enquiry_file = _workbook(
        ["Name", "WhatsApp", "Present institution", "Interested course", "Level of interest", "References", "Details"],
        [["MEERA", "9000000002", "Town School", "CA Foundation", "Low", "Friend", "Asked for a brochure"]],
    )
    preview = client.post(
        "/api/v1/enquiries/import",
        files={
            "file": (
                "enquiries.xlsx",
                enquiry_file,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert preview.status_code == 200, preview.text
    row = preview.json()["rows"][0]
    assert row["errors"] == []
    assert row["values"]["course_id"] == course_id
    committed = client.post(
        "/api/v1/enquiries/import/commit",
        json={
            "rows": [
                {
                    "name": row["values"]["name"],
                    "whatsapp": row["values"]["whatsapp"],
                    "present_institution": row["values"]["present_institution"],
                    "course_id": row["values"]["course_id"],
                    "interest": row["values"]["interest"],
                    "references": row["values"]["references"],
                    "details": row["values"]["details"],
                }
            ]
        },
    )
    assert committed.status_code == 200, committed.text
    assert client.get("/api/v1/enquiries").json()["total"] == 1

    admission_file = _workbook(
        [
            "Course",
            "Name",
            "Contact number",
            "Qualification",
            "Stream/Department",
            "Name of the institution",
            "Mark",
            "Year of passing",
        ],
        [
            ["CA Foundation", "RISHA", "9000000001", "BCom", "Commerce", "Town College", "80", "2023"],
            ["Missing course", "NEHA", "9000000003", "", "", "", "", ""],
            ["CA Foundation", "", "9000000004", "", "", "", "", ""],
        ],
    )
    admission_preview = client.post(
        "/api/v1/admissions/import",
        files={
            "file": (
                "admissions.xlsx",
                admission_file,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert admission_preview.status_code == 200, admission_preview.text
    rows = admission_preview.json()["rows"]
    assert rows[0]["matches"][0]["student_code"] == "IAM-000010"
    assert rows[1]["errors"]
    assert rows[2]["errors"]
    refused = client.post(
        "/api/v1/admissions/import/commit",
        json={
            "rows": [
                {
                    "course_id": course_id,
                    "name": "RISHA",
                    "phone": "9000000001",
                    "decision": "",
                    "student_id": "",
                }
            ]
        },
    )
    assert refused.status_code == 409
    accepted = client.post(
        "/api/v1/admissions/import/commit",
        json={
            "rows": [
                {
                    "course_id": course_id,
                    "name": "RISHA",
                    "phone": "9000000001",
                    "academic_records": [
                        {
                            "qualification": "BCom",
                            "stream": "Commerce",
                            "institution": "Town College",
                            "mark": "80",
                            "year_of_passing": "2023",
                        }
                    ],
                    "decision": "attach",
                    "student_id": "existing-student",
                }
            ]
        },
    )
    assert accepted.status_code == 200, accepted.text
    stored = database.admissions.find_one({"name": "RISHA"})
    assert stored["match_decision"] == "attach"
    assert stored["match_student_id"] == "existing-student"
    assert stored["status"] == "open"


def test_business_questions_follow_the_person_from_enquiry_to_student(client):
    bootstrap(client)
    branch_id, course_id, batch_id = _context(client)
    shared = client.post(
        "/api/v1/form-questions",
        json={
            "label": "How did you hear about us",
            "answer_type": "text",
            "required": True,
            "place": "both",
        },
    )
    enquiry_only = client.post(
        "/api/v1/form-questions",
        json={
            "label": "Campaign",
            "answer_type": "text",
            "place": "enquiry",
        },
    )
    admission_only = client.post(
        "/api/v1/form-questions",
        json={
            "label": "Fee plan",
            "answer_type": "choice",
            "choices": ["Full", "Installment"],
            "required": True,
            "place": "admission",
        },
    )
    assert shared.status_code == 200, shared.text
    assert enquiry_only.status_code == 200, enquiry_only.text
    assert admission_only.status_code == 200, admission_only.text
    enquiry_labels = {item["label"] for item in client.get("/api/v1/form-questions?form=enquiry").json()["items"]}
    admission_labels = {item["label"] for item in client.get("/api/v1/form-questions?form=admission").json()["items"]}
    assert enquiry_labels == {"How did you hear about us", "Campaign"}
    assert admission_labels == {"How did you hear about us", "Fee plan"}

    created = client.post("/api/v1/enquiries", json={"name": "NEHA", "whatsapp": "9123456780", "course_id": course_id})
    assert created.status_code == 200, created.text
    enquiry_id = created.json()["id"]
    blocked = client.post(f"/api/v1/enquiries/{enquiry_id}/convert")
    assert blocked.status_code == 422
    saved = client.patch(
        f"/api/v1/enquiries/{enquiry_id}",
        json={
            "name": "NEHA",
            "whatsapp": "9123456780",
            "course_id": course_id,
            "answers": [
                {"question_id": shared.json()["id"], "value": "Instagram"},
                {"question_id": enquiry_only.json()["id"], "value": "June drive"},
            ],
        },
    )
    assert saved.status_code == 200, saved.text
    converted = client.post(f"/api/v1/enquiries/{enquiry_id}/convert")
    assert converted.status_code == 200, converted.text
    admission = client.get(f"/api/v1/admissions/{converted.json()['id']}").json()
    copied = {item["label"]: item["value"] for item in admission["business_answers"]}
    assert copied == {"How did you hear about us": "Instagram"}

    refused = client.post(
        f"/api/v1/admissions/{converted.json()['id']}/convert",
        json={"branch_id": branch_id, "batch_id": batch_id},
    )
    assert refused.status_code == 422
    updated = client.patch(
        f"/api/v1/admissions/{converted.json()['id']}",
        json={
            "course_id": course_id,
            "name": "NEHA",
            "phone": "9123456780",
            "business_answers": [
                {"question_id": shared.json()["id"], "value": "Instagram"},
                {"question_id": admission_only.json()["id"], "value": "Installment"},
            ],
        },
    )
    assert updated.status_code == 200, updated.text
    enrolled = client.post(
        f"/api/v1/admissions/{converted.json()['id']}/convert",
        json={"branch_id": branch_id, "batch_id": batch_id},
    )
    assert enrolled.status_code == 200, enrolled.text
    student = client.get(f"/api/v1/students/{enrolled.json()['id']}/enrollments").json()
    stored = {item["label"]: item["value"] for item in student["business_answers"]}
    assert stored["How did you hear about us"] == "Instagram"
    assert stored["Fee plan"] == "Installment"

    workbook = _workbook(
        ["Name", "WhatsApp", "How did you hear about us", "Campaign"],
        [["RIYA", "9001112223", "Friend", "Open day"]],
    )
    preview = client.post(
        "/api/v1/enquiries/import",
        files={
            "file": ("enquiries.xlsx", workbook, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        },
    )
    assert preview.status_code == 200, preview.text
    row = preview.json()["rows"][0]
    assert row["errors"] == []
    assert {item["value"] for item in row["answers"]} == {"Friend", "Open day"}
    committed = client.post(
        "/api/v1/enquiries/import/commit",
        json={
            "rows": [
                {
                    "name": row["values"]["name"],
                    "whatsapp": row["values"]["whatsapp"],
                    "answers": row["answers"],
                }
            ]
        },
    )
    assert committed.status_code == 200, committed.text
    detail = client.get(f"/api/v1/enquiries/{committed.json()['ids'][0]}").json()
    assert {item["value"] for item in detail["answers"]} == {"Friend", "Open day"}


def test_checkbox_dropdown_and_text_area_questions(client):
    bootstrap(client)
    branch_id, course_id, batch_id = _context(client)
    checkbox = client.post(
        "/api/v1/form-questions",
        json={"label": "Needs hostel", "answer_type": "boolean", "required": True, "place": "admission"},
    )
    notes = client.post(
        "/api/v1/form-questions",
        json={"label": "Notes", "answer_type": "textarea", "place": "enquiry"},
    )
    shift = client.post(
        f"/api/v1/courses/{course_id}/questions",
        json={"label": "Shift", "answer_type": "choice", "choices": ["Morning", "Evening"]},
    )
    rejected = client.post("/api/v1/form-questions", json={"label": "Age", "answer_type": "number", "place": "enquiry"})
    assert checkbox.status_code == 200, checkbox.text
    assert notes.status_code == 200, notes.text
    assert shift.status_code == 200, shift.text
    assert rejected.status_code == 422

    created = client.post(
        "/api/v1/enquiries",
        json={
            "name": "SANA",
            "whatsapp": "9000000099",
            "course_id": course_id,
            "answers": [{"question_id": notes.json()["id"], "value": "Came in\nAsked about fees"}],
        },
    )
    assert created.status_code == 200, created.text
    detail = client.get(f"/api/v1/enquiries/{created.json()['id']}").json()
    assert detail["answers"][0]["value"] == "Came in\nAsked about fees"
    converted = client.post(f"/api/v1/enquiries/{created.json()['id']}/convert")
    assert converted.status_code == 200, converted.text
    blocked = client.post(
        f"/api/v1/admissions/{converted.json()['id']}/convert",
        json={"branch_id": branch_id, "batch_id": batch_id},
    )
    assert blocked.status_code == 422
    assert "Tick Needs hostel." in blocked.text
    updated = client.patch(
        f"/api/v1/admissions/{converted.json()['id']}",
        json={
            "course_id": course_id,
            "name": "SANA",
            "phone": "9000000099",
            "business_answers": [{"question_id": checkbox.json()["id"], "value": "true"}],
            "course_answers": [{"question_id": shift.json()["id"], "value": "morning"}],
        },
    )
    assert updated.status_code == 200, updated.text
    enrolled = client.post(
        f"/api/v1/admissions/{converted.json()['id']}/convert",
        json={"branch_id": branch_id, "batch_id": batch_id},
    )
    assert enrolled.status_code == 200, enrolled.text
    student = client.get(f"/api/v1/students/{enrolled.json()['id']}/enrollments").json()
    assert student["business_answers"][0]["value"] == "Yes"
    profile = student["course_profiles"][0]["answers"][0]
    assert profile["value"] == "Morning"
    assert profile["answer_type"] == "choice"
    assert profile["choices"] == ["Morning", "Evening"]
