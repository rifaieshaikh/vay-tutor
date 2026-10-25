"""Walk every staff flow against one institute.

Sign-in, academic setup, forms, enquiries, admissions, enrollment, students,
teaching, access, marks, reports, policy, audit, marklist import, and factory reset.
"""

from io import BytesIO
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.main import create_app
from tests.test_m2 import bootstrap, sync_db
from tests.test_m3 import workbook


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


def must(response, status=200):
    assert response.status_code == status, response.text
    return response.json() if response.content else {}


def login(client, email, password="correct-horse"):
    client.post("/api/v1/auth/logout")
    return must(client.post("/api/v1/auth/login", json={"email": email, "password": password}))


def board_item(body, key):
    found = [item for item in [*body["metrics"], *body["queues"]] if item.get("key") == key]
    assert found, body
    return found[0]


def enroll(client, admission_id, branch_id, batch_id, **extra):
    return must(client.post(
        f"/api/v1/admissions/{admission_id}/convert",
        json={"branch_id": branch_id, "batch_id": batch_id, **extra},
    ))


def test_every_staff_flow(client):
    created = bootstrap(client)
    assert must(client.get("/api/v1/health"))["bootstrapped"] is True
    assert "marksheet.publish" in must(client.get("/api/v1/auth/session"))["actions"]
    client.post("/api/v1/auth/logout")
    assert client.post(
        "/api/v1/auth/login", json={"email": "admin@iam.test", "password": "wrong-password"}
    ).status_code == 401
    must(client.post("/api/v1/auth/recovery/redeem", json={
        "email": "admin@iam.test",
        "recovery_code": created["recovery_codes"][0],
        "new_password": "replacement-horse",
    }))
    must(client.post("/api/v1/auth/password", json={
        "current_password": "replacement-horse",
        "new_password": "correct-horse",
    }))
    login(client, "admin@iam.test")

    assert must(client.patch("/api/v1/institute", json={"name": "IAM Tirur", "expected_revision": 0}))["name"] == "IAM Tirur"
    assert must(client.get("/api/v1/institute"))["name"] == "IAM Tirur"
    north = must(client.post("/api/v1/branches", json={"name": "North"}))["id"]
    south = must(client.post("/api/v1/branches", json={"name": "South"}))["id"]
    course = must(client.post("/api/v1/courses", json={"name": "CA Foundation"}))["id"]
    other_course = must(client.post("/api/v1/courses", json={"name": "Commerce"}))["id"]
    must(client.post(f"/api/v1/branches/{north}/courses", json={"course_id": course}))
    must(client.post(f"/api/v1/branches/{south}/courses", json={"course_id": course}))
    subject = must(client.post(f"/api/v1/courses/{course}/subjects", json={"name": "Accounting"}))["id"]
    paper = must(client.post(f"/api/v1/subjects/{subject}/items", json={"kind": "paper", "name": "Paper 1"}))["id"]
    must(client.post(f"/api/v1/subjects/{subject}/items", json={"kind": "chapter", "name": "Bank reconciliation"}))
    batches = {}
    for name in ("Morning", "Evening", "May", "September", "Closed"):
        batches[name] = must(client.post(
            f"/api/v1/branches/{north}/batches",
            json={"course_id": course, "name": name, "started_on": "2026-06-01"},
        ))["id"]
    branches = must(client.get("/api/v1/context/options", params={"dimension": "branch"}))["items"]
    assert {item["label"] for item in branches} >= {"North", "South"}
    overview = must(client.get("/api/v1/dashboard"))
    assert board_item(overview, "batches")["href"].startswith("/batches")
    assert any(item["key"] == "enquiry" for item in overview["actions"])
    curriculum = must(client.get(f"/api/v1/batches/{batches['Morning']}"))["curriculum"]
    accounting = next(item for item in curriculum if item["name"] == "Accounting")
    assert any(item["name"] == "Paper 1" for item in accounting["papers"])
    assert any(item["name"] == "Bank reconciliation" for item in accounting["units"])

    question = must(client.post("/api/v1/form-questions", json={
        "label": "How did you hear about us",
        "answer_type": "text",
        "place": "enquiry",
        "required": False,
    }))
    assert any(
        item["label"] == "How did you hear about us"
        for item in must(client.get("/api/v1/form-questions", params={"form": "enquiry"}))["items"]
    )
    enquiry = must(client.post("/api/v1/enquiries", json={
        "name": "Aisha",
        "whatsapp": "9000001111",
        "course_id": course,
        "interest": "High",
        "present_institution": "City School",
        "answers": [{"question_id": question["id"], "value": "A friend"}],
    }))
    enquiry_id = enquiry["id"]
    assert must(client.get("/api/v1/enquiries", params={"q": "Aisha"}))["items"][0]["stage"] == "Open"
    today = must(client.get(f"/api/v1/enquiries/{enquiry_id}"))["today"]
    must(client.post(f"/api/v1/enquiries/{enquiry_id}/follow-ups", json={
        "kind": "schedule", "next_on": "2099-01-15", "note": "Call after exams",
    }))
    must(client.post(f"/api/v1/enquiries/{enquiry_id}/follow-ups", json={
        "kind": "record", "at": today, "note": "Spoke with her father", "interest": "High", "next_on": "2099-02-01",
    }))
    detail = must(client.get(f"/api/v1/enquiries/{enquiry_id}"))
    assert detail["follow_ups"][0]["note"] == "Spoke with her father"
    overdue = must(client.get("/api/v1/enquiries", params={"follow_up": "overdue"}))["items"]
    assert enquiry_id not in {item["id"] for item in overdue}
    assert board_item(must(client.get("/api/v1/dashboard")), "follow_ups")["href"].startswith("/students/enquiries")

    admitted = must(client.post(f"/api/v1/enquiries/{enquiry_id}/convert"))
    assert must(client.post(f"/api/v1/enquiries/{enquiry_id}/convert"))["id"] == admitted["id"]
    assert must(client.get(f"/api/v1/enquiries/{enquiry_id}"))["status"] == "converted"
    retired = must(client.delete(f"/api/v1/form-questions/{question['id']}"))
    assert retired["retired"] is True
    visible = must(client.get("/api/v1/form-questions", params={"form": "enquiry"}))["items"]
    assert all(item["id"] != question["id"] for item in visible)
    kept = must(client.get("/api/v1/form-questions", params={"form": "enquiry", "include_retired": True}))["items"]
    assert any(item["id"] == question["id"] for item in kept)
    stored_answer = sync_db(client).enquiries.find_one({"_id": enquiry_id})["answers"]
    assert stored_answer[0]["question_id"] == question["id"]
    assert stored_answer[0]["value"] == "A friend"
    assert client.post(
        f"/api/v1/enquiries/{enquiry_id}/follow-ups",
        json={"kind": "record", "at": today, "note": "Too late"},
    ).status_code == 409
    admission = must(client.get(f"/api/v1/admissions/{admitted['id']}"))
    assert admission["phone"] == "9000001111"
    assert admission["academic_records"][0]["institution"] == "City School"
    enrolled = enroll(client, admitted["id"], north, batches["Morning"], decision="create")
    aisha = enrolled["id"]
    repeated = enroll(client, admitted["id"], north, batches["Morning"])
    assert repeated["id"] == aisha
    assert repeated["existing"] is True
    profile = must(client.get(f"/api/v1/students/{aisha}/enrollments"))
    assert profile["student_code"]
    morning_enrollment = profile["enrollments"][0]["id"]
    assert profile["admissions"][0]["enquiry_id"] == enquiry_id
    assert must(client.get(f"/api/v1/admissions/{admitted['id']}"))["lifecycle"] == "enrolled"
    students = board_item(must(client.get("/api/v1/dashboard")), "students")
    assert students["count"] == 1
    assert "enrollment=current" in students["href"]
    assert must(client.get("/api/v1/students", params={"q": "Aisha"}))["items"][0]["id"] == aisha
    roster = must(client.get(f"/api/v1/batches/{batches['Morning']}", params={"student_q": "Aisha"}))
    assert [item["display_name"] for item in roster["students"]["items"]] == ["Aisha"]
    source = must(client.get(f"/api/v1/admissions/{admitted['id']}"))
    must(client.post(f"/api/v1/admissions/{admitted['id']}/correction", json={
        "name": "Aisha",
        "phone": "9000001111",
        "course_id": course,
        "email": "corrected@example.com",
        "note": "The application email was mistyped.",
        "expected_updated_at": source["updated_at"],
    }))
    assert must(client.get(f"/api/v1/admissions/{admitted['id']}"))["email"] == "corrected@example.com"
    assert must(client.get(f"/api/v1/students/{aisha}/enrollments"))["email"] != "corrected@example.com"

    held = must(client.post("/api/v1/admissions", json={"course_id": course, "name": "Incomplete"}))
    assert client.post(
        f"/api/v1/admissions/{held['id']}/convert",
        json={"branch_id": north, "batch_id": batches["Evening"], "decision": "create"},
    ).status_code == 422
    must(client.post(f"/api/v1/admissions/{held['id']}/close", json={"reason": "Not interested"}))
    assert must(client.get(f"/api/v1/admissions/{held['id']}"))["lifecycle"] == "closed"
    assert client.post(
        f"/api/v1/admissions/{held['id']}/convert",
        json={"branch_id": north, "batch_id": batches["Evening"], "decision": "create"},
    ).status_code == 409
    must(client.post(f"/api/v1/admissions/{held['id']}/reopen", json={"reason": "The family called back"}))
    assert must(client.get(f"/api/v1/admissions/{held['id']}"))["lifecycle"] == "open"

    direct = must(client.post("/api/v1/admissions", json={
        "course_id": course, "name": "Noura", "phone": "9000003333",
    }))
    assert must(client.get(f"/api/v1/admissions/{direct['id']}"))["readiness"] == "needs_identity"
    assert client.post(
        f"/api/v1/admissions/{direct['id']}/selection",
        json={"branch_id": north, "batch_id": batches["Evening"]},
    ).status_code == 409
    must(client.post(f"/api/v1/admissions/{direct['id']}/identity", json={"decision": "create"}))
    assert must(client.get(f"/api/v1/admissions/{direct['id']}"))["readiness"] == "needs_batch"
    must(client.post(
        f"/api/v1/admissions/{direct['id']}/selection",
        json={"branch_id": north, "batch_id": batches["Evening"]},
    ))
    assert must(client.get(f"/api/v1/admissions/{direct['id']}"))["readiness"] == "ready"
    noura = enroll(client, direct["id"], north, batches["Evening"], decision="create")["id"]
    assert noura != aisha

    duplicate = must(client.post("/api/v1/admissions", json={
        "course_id": course, "name": "Aisha", "phone": "9000001111",
    }))
    choice = client.post(
        f"/api/v1/admissions/{duplicate['id']}/convert",
        json={"branch_id": north, "batch_id": batches["September"]},
    )
    assert choice.status_code == 409
    assert choice.json()["error"]["code"] == "admission.match"
    attached = enroll(
        client, duplicate["id"], north, batches["September"], decision="attach", student_id=aisha,
    )
    assert attached["id"] == aisha
    assert enroll(client, duplicate["id"], north, batches["September"])["existing"] is True

    ravi = must(client.post("/api/v1/enquiries", json={
        "name": "Ravi", "whatsapp": "9000004444", "course_id": course,
    }))["id"]
    must(client.post(f"/api/v1/enquiries/{ravi}/close", json={"reason": "Joined elsewhere"}))
    assert client.post(f"/api/v1/enquiries/{ravi}/convert").status_code == 409
    must(client.post(f"/api/v1/enquiries/{ravi}/reopen", json={"reason": "He asked to continue"}))
    ravi_admission = must(client.post(f"/api/v1/enquiries/{ravi}/convert"))["id"]
    assert must(client.get(f"/api/v1/admissions/{ravi_admission}"))["lifecycle"] == "open"
    waiting = board_item(must(client.get("/api/v1/dashboard")), "admissions")
    assert waiting["count"] >= 1
    assert "status=open" in waiting["href"]

    enquiry_file = ("enquiries.csv", b"Student,Mobile,Course,Heat\nLina,09870000021,CA Fdn,Hot\n", "text/csv")
    uploaded = must(client.post(
        "/api/v1/enquiry-imports",
        data={"branch_id": north, "course_id": course},
        files={"file": enquiry_file},
    ))
    mapped = must(client.put(f"/api/v1/enquiry-imports/{uploaded['id']}", json={
        "revision": uploaded["revision"],
        "sources": [{"sheet": "CSV", "header_row": 1}],
        "mappings": [
            {"column_id": "0:0", "target": "name"},
            {"column_id": "0:1", "target": "whatsapp"},
            {"column_id": "0:2", "target": "course"},
            {"column_id": "0:3", "target": "interest"},
        ],
        "courses": {"CA Fdn": course},
        "interests": {"Hot": "High"},
    }))
    assert mapped["rows"][0]["status"] == "valid"
    committed = must(client.post(f"/api/v1/enquiry-imports/{uploaded['id']}/commit", json={
        "revision": mapped["revision"], "idempotency_key": "enquiry-flow",
    }))
    assert committed["result"]["created"][0]["name"] == "Lina"
    again = must(client.post(f"/api/v1/enquiry-imports/{uploaded['id']}/commit", json={
        "revision": mapped["revision"], "idempotency_key": "enquiry-flow",
    }))
    assert again["result"]["created"][0]["id"] == committed["result"]["created"][0]["id"]
    assert must(client.get("/api/v1/enquiries", params={"q": "Lina"}))["items"][0]["stage"] == "Open"

    admission_file = ("applications.csv", b"Applicant,Mobile,Course\nAnu,09870000031,CA Fdn\n", "text/csv")
    uploaded = must(client.post(
        "/api/v1/admission-imports",
        data={"branch_id": north, "course_id": course, "batch_id": batches["Morning"]},
        files={"file": admission_file},
    ))
    mapped = must(client.put(f"/api/v1/admission-imports/{uploaded['id']}", json={
        "revision": uploaded["revision"],
        "sources": [{"sheet": "CSV", "header_row": 1}],
        "mappings": [
            {"column_id": "0:0", "target": "name"},
            {"column_id": "0:1", "target": "phone"},
            {"column_id": "0:2", "target": "course"},
        ],
        "courses": {"CA Fdn": course},
    }))
    assert mapped["rows"][0]["status"] == "valid"
    committed = must(client.post(f"/api/v1/admission-imports/{uploaded['id']}/commit", json={
        "revision": mapped["revision"], "idempotency_key": "admission-flow",
    }))
    imported_admission = committed["result"]["created"][0]["id"]
    imported = must(client.get(f"/api/v1/admissions/{imported_admission}"))
    assert imported["status"] == "open"
    assert imported["student_id"] in {None, ""}
    assert imported["branch_id"] == north
    assert imported["batch_id"] == batches["Morning"]
    assert must(client.get("/api/v1/students", params={"q": "Anu"}))["items"] == []

    edited = must(client.patch(f"/api/v1/students/{aisha}", json={
        "display_name": "Aisha Rahman",
        "phone": "9000001111",
        "street": "Temple Road",
        "edit_version": profile["edit_version"],
    }))
    assert edited["display_name"] == "Aisha Rahman"
    assert must(client.get("/api/v1/students", params={"q": "Rahman"}))["items"][0]["id"] == aisha
    assert must(client.get(f"/api/v1/students/{aisha}/history"))["permitted"] is True
    must(client.post(f"/api/v1/students/{aisha}/enrollments", json={
        "branch_id": north, "course_id": course, "batch_id": batches["Evening"],
    }))
    duplicate_batch = client.post(f"/api/v1/students/{aisha}/enrollments", json={
        "branch_id": north, "course_id": course, "batch_id": batches["Morning"],
    })
    assert duplicate_batch.status_code == 409
    assert duplicate_batch.json()["error"]["code"] == "enrollment.exists"

    sheet = must(client.post("/api/v1/marksheets", json={
        "title": "Unit test",
        "branch_id": north,
        "course_id": course,
        "batch_id": batches["Morning"],
        "subject_id": subject,
        "paper_id": paper,
        "exam_type": "unit",
        "maximum": 20,
        "exam_date": "2026-07-01",
        "attempt": "original",
    }))
    must(client.post(f"/api/v1/marksheets/{sheet['id']}/results", json={
        "student_id": aisha, "status": "scored", "score": 18,
    }))
    draft_card = must(client.get(f"/api/v1/students/{aisha}/card"))
    assert draft_card["empty_reason"] == "unpublished"
    assert draft_card["performance"]["scored"] == 0
    must(client.post(f"/api/v1/marksheets/{sheet['id']}/submit"))
    assert board_item(must(client.get("/api/v1/dashboard")), "marksheets")["count"] == 1
    must(client.post(f"/api/v1/marksheets/{sheet['id']}/reject"))
    assert must(client.get(f"/api/v1/marksheets/{sheet['id']}"))["status"] == "draft"
    assert board_item(must(client.get("/api/v1/dashboard")), "marksheets")["count"] == 0
    must(client.post(f"/api/v1/marksheets/{sheet['id']}/publish"))
    published = must(client.get(f"/api/v1/students/{aisha}/card"))
    assert published["performance"]["percentage"] == 90
    assert published["performance"]["scored"] == 1
    assert must(client.get("/api/v1/views/institute", params={"batch_id": batches["Morning"]}))["performance"]["scored"] == 1
    assert must(client.post("/api/v1/reports/cards", json={"format": "pdf", "scope": {"student_id": aisha}}))["id"]
    detail = must(client.get(f"/api/v1/marksheets/{sheet['id']}"))
    scored = next(item for item in detail["results"] if item["student_id"] == aisha)
    must(client.post(f"/api/v1/marksheets/{sheet['id']}/correct", json={
        "reason": "The total was added again",
        "edit_version": detail["edit_version"],
        "changes": [{"result_id": scored["id"], "score": 16}],
    }))
    assert must(client.get(f"/api/v1/students/{aisha}/card"))["performance"]["percentage"] == 80
    refreshed = must(client.get(f"/api/v1/marksheets/{sheet['id']}"))
    must(client.post(f"/api/v1/marksheets/{sheet['id']}/withdraw", json={
        "reason": "The paper was set aside",
        "edit_version": refreshed["edit_version"],
    }))
    withdrawn = must(client.get(f"/api/v1/students/{aisha}/card"))
    assert withdrawn["empty_reason"] == "unpublished"
    assert withdrawn["performance"]["scored"] == 0
    stored = sync_db(client).results.find_one({"marksheet_id": sheet["id"], "student_id": aisha})
    assert stored["enrollment_id"] == morning_enrollment

    preview = must(client.post(f"/api/v1/students/{aisha}/transfers/preview", json={
        "from_enrollment_id": morning_enrollment,
        "branch_id": north,
        "course_id": course,
        "batch_id": batches["May"],
        "on": "2026-08-01",
        "reason": "Next batch",
    }))
    assert preview["source_ends_on"] == "2026-08-01"
    moved = must(client.post(f"/api/v1/students/{aisha}/transfers", json={
        "from_enrollment_id": morning_enrollment,
        "branch_id": north,
        "course_id": course,
        "batch_id": batches["May"],
        "on": "2026-08-01",
        "reason": "Next batch",
    }))
    assert moved["id"] != morning_enrollment
    after = must(client.get(f"/api/v1/students/{aisha}/enrollments"))
    assert after["student_code"] == profile["student_code"]
    by_batch = {item["batch_id"]: item for item in after["enrollments"]}
    assert by_batch[batches["Morning"]]["status"] == "historical"
    assert by_batch[batches["May"]]["status"] == "current"
    assert sync_db(client).results.find_one({"marksheet_id": sheet["id"], "student_id": aisha})["enrollment_id"] == morning_enrollment

    must(client.patch(f"/api/v1/catalog/batch/{batches['Closed']}", json={"closed": True, "expected_revision": 0}))
    assert must(client.get(f"/api/v1/batches/{batches['Closed']}"))["closed"] is True
    closed = client.post(f"/api/v1/students/{noura}/enrollments", json={
        "branch_id": north, "course_id": course, "batch_id": batches["Closed"],
    })
    assert closed.status_code == 422
    assert closed.json()["error"]["code"] == "batch.closed"
    must(client.patch(f"/api/v1/catalog/branch/{south}", json={"archived": True, "expected_revision": 0}))
    catalog = must(client.get("/api/v1/catalog"))
    kept_course = next(item for item in catalog["courses"] if item["id"] == other_course)
    assert kept_course["archived"] is False
    refused = client.post(f"/api/v1/branches/{south}/courses", json={"course_id": other_course})
    assert refused.status_code == 422
    assert refused.json()["error"]["code"] == "catalog.archived"

    source_student = enroll(
        client,
        must(client.post("/api/v1/admissions", json={"course_id": course, "name": "Source Person", "phone": "9000005555"}))["id"],
        north,
        batches["September"],
        decision="create",
    )["id"]
    target_student = enroll(
        client,
        must(client.post("/api/v1/admissions", json={"course_id": course, "name": "Target Person", "phone": "9000006666"}))["id"],
        north,
        batches["May"],
        decision="create",
    )["id"]
    must(client.post(f"/api/v1/students/{target_student}/archive", json={"archived": True, "reason": "Left the institute"}))
    assert target_student not in {item["id"] for item in must(client.get("/api/v1/students"))["items"]}
    must(client.post(f"/api/v1/students/{target_student}/archive", json={"archived": False, "reason": "Returned"}))
    merge = must(client.post("/api/v1/students/merge-preview", json={"source_id": source_student, "target_id": target_student}))
    assert merge["recoverable"] is False
    must(client.post("/api/v1/students/merge", json={
        "source_id": source_student, "target_id": target_student, "acknowledge": True,
    }))
    assert sync_db(client).students.find_one({"_id": source_student})["merged_into"] == target_student

    before_users = len(must(client.get("/api/v1/users"))["items"])
    teacher = must(client.post("/api/v1/teachers", json={"name": "Desk teacher"}))
    assert teacher["app_user"] is False
    assert len(must(client.get("/api/v1/users"))["items"]) == before_users
    assigned = must(client.post(f"/api/v1/batches/{batches['Evening']}/assignments", json={
        "teacher_id": teacher["id"], "subject_id": subject, "paper_id": paper, "started_on": "2026-06-01",
    }))
    current = must(client.get(f"/api/v1/batches/{batches['Evening']}"))["assignments"]
    assert any(item["id"] == assigned["id"] and item["status"] == "current" for item in current)
    ended = must(client.post(
        f"/api/v1/batches/{batches['Evening']}/assignments/{assigned['id']}/end",
        json={"ended_on": "2026-12-01"},
    ))
    assert ended["status"] == "ended"

    viewer = must(client.post("/api/v1/users", json={
        "name": "North viewer",
        "email": "viewer@iam.test",
        "password": "correct-horse",
        "role": "viewer",
        "scope": {"branch_id": north},
        "acknowledge_scope": True,
    }))
    role = must(client.post("/api/v1/roles", json={"name": "Registrar", "actions": ["student.lookup"]}))
    grant = must(client.post("/api/v1/grants", json={
        "user_id": viewer["user"]["id"],
        "role": "Registrar",
        "scope": {"branch_id": north},
        "acknowledge_scope": True,
    }))
    access = must(client.get(f"/api/v1/users/{viewer['user']['id']}/effective-access"))
    assert any(item["id"] == grant["id"] for item in access["grants"])
    must(client.delete(f"/api/v1/grants/{grant['id']}"))
    remaining = must(client.get(f"/api/v1/users/{viewer['user']['id']}/effective-access"))["grants"]
    assert all(item["id"] != grant["id"] for item in remaining)
    assert role["id"]
    admin_id = must(client.get("/api/v1/auth/session"))["user"]["id"]
    assert client.patch(f"/api/v1/users/{admin_id}", json={"active": False}).status_code == 422
    login(client, "viewer@iam.test")
    assert client.post("/api/v1/enquiries", json={"name": "Blocked"}).status_code == 403
    assert must(client.get(f"/api/v1/students/{aisha}/enrollments"))["actions"]["contact"] is False
    login(client, "admin@iam.test")

    policy = must(client.post("/api/v1/policies", json={"danger_below": 35, "safe_above": 75, "passing_threshold": 40}))
    active = must(client.get("/api/v1/policies/active"))
    assert active["version"] == policy["version"]
    assert [item.get("through") for item in active["bands"]][:2] == [35, 75]
    audit = must(client.get("/api/v1/audit", params={"action": "enquiry.close"}))
    assert audit["items"]
    assert client.patch("/api/v1/audit", json={"action": "changed"}).status_code == 405

    before = sync_db(client).students.count_documents({})
    book = Workbook()
    book.active.append(["Name"])
    buffer = BytesIO()
    book.save(buffer)
    empty = must(client.post(
        "/api/v1/imports",
        files={"file": ("empty.xlsx", buffer.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    ))
    assert client.post(f"/api/v1/imports/{empty['id']}/commit").status_code == 422
    assert sync_db(client).students.count_documents({}) == before
    marklist = must(client.post(
        "/api/v1/imports",
        files={"file": (
            "ACCOUNTANCY  RANK LIST.xlsx",
            workbook("ACCOUNTANCY  RANK LIST.xlsx"),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )},
    ))
    assert must(client.get(f"/api/v1/imports/{marklist['id']}"))["ready"] is True
    outcomes = must(client.post(f"/api/v1/imports/{marklist['id']}/commit"))
    assert all(item["status"] == "committed" for item in outcomes["outcomes"])
    assert sync_db(client).students.count_documents({}) > before
    replay = must(client.post(f"/api/v1/imports/{marklist['id']}/commit"))
    assert replay["state"] == "committed"
    assert sync_db(client).students.count_documents({}) > before
    same_count = sync_db(client).students.count_documents({})
    assert must(client.post(f"/api/v1/imports/{marklist['id']}/commit"))["state"] == "committed"
    assert sync_db(client).students.count_documents({}) == same_count
    imported_sheets = must(client.get("/api/v1/marksheets"))["items"]
    dated = next(item for item in imported_sheets if item["source_sheet"] == "BRS")
    pupil = must(client.get(f"/api/v1/marksheets/{dated['id']}"))["results"][0]["student_id"]
    assert must(client.get(f"/api/v1/students/{pupil}/card"))["performance"]["scored"] == 0
    must(client.post(f"/api/v1/marksheets/{dated['id']}/publish"))
    assert must(client.get(f"/api/v1/students/{pupil}/card"))["performance"]["scored"] >= 1
    undated = next(item for item in imported_sheets if not item.get("exam_date"))
    assert client.post(f"/api/v1/marksheets/{undated['id']}/publish").status_code == 422

    must(client.post("/api/v1/factory-reset", json={"confirm": "RESET"}))
    assert must(client.get("/api/v1/health"))["bootstrapped"] is False
    assert client.get("/api/v1/auth/session").status_code == 401
    assert bootstrap(client)["institute"]["code"] == "IAM"
