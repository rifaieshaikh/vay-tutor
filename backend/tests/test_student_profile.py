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


def test_student_photo_enrollment_dates_and_new_enrollment(client):
    bootstrap(client)
    database = sync_db(client)
    institute_id = database.institutes.find_one()["_id"]
    branch_a, branch_b, course_a = (str(ObjectId()) for _ in range(3))
    batch_a, batch_b, batch_c = (str(ObjectId()) for _ in range(3))
    student, other = str(ObjectId()), str(ObjectId())
    database.branches.insert_many([
        {"_id": branch_a, "institute_id": institute_id, "name": "Tirur", "name_key": "tirur"},
        {"_id": branch_b, "institute_id": institute_id, "name": "Calicut", "name_key": "calicut"},
    ])
    database.courses.insert_one({"_id": course_a, "institute_id": institute_id, "name": "Foundation", "name_key": "foundation"})
    database.offerings.insert_many([
        {"_id": str(ObjectId()), "institute_id": institute_id, "branch_id": branch_a, "course_id": course_a},
        {"_id": str(ObjectId()), "institute_id": institute_id, "branch_id": branch_b, "course_id": course_a},
    ])
    database.batches.insert_many([
        {"_id": batch_a, "institute_id": institute_id, "branch_id": branch_a, "course_id": course_a, "name": "January 2027", "name_key": "january 2027", "session_key": "2027-01", "offering_id": "off-a"},
        {"_id": batch_b, "institute_id": institute_id, "branch_id": branch_b, "course_id": course_a, "name": "May 2027", "name_key": "may 2027", "session_key": "2027-05", "offering_id": "off-b"},
        {"_id": batch_c, "institute_id": institute_id, "branch_id": branch_a, "course_id": course_a, "name": "September 2027", "name_key": "september 2027", "session_key": "2027-09", "offering_id": "off-a"},
    ])
    database.students.insert_many([
        {"_id": student, "institute_id": institute_id, "display_name": "SHARED STUDENT", "student_code": "IAM-000501", "name_key": "shared student", "edit_version": 0},
        {"_id": other, "institute_id": institute_id, "display_name": "OTHER STUDENT", "student_code": "IAM-000502", "name_key": "other student", "edit_version": 0},
    ])
    enrollment_a = str(ObjectId())
    database.enrollments.insert_many([
        {"_id": enrollment_a, "institute_id": institute_id, "student_id": student, "branch_id": branch_a, "course_id": course_a, "batch_id": batch_a},
        {"_id": str(ObjectId()), "institute_id": institute_id, "student_id": student, "branch_id": branch_b, "course_id": course_a, "batch_id": batch_b},
        {"_id": str(ObjectId()), "institute_id": institute_id, "student_id": other, "branch_id": branch_a, "course_id": course_a, "batch_id": batch_c},
    ])
    database.enrollment_names.insert_one({
        "_id": str(ObjectId()), "institute_id": institute_id, "batch_id": batch_c, "student_id": other, "name_key": "shared student",
    })
    manager = client.post("/api/v1/users", json={
        "name": "Tirur admin", "email": "profile-admin@iam.test", "password": "correct-horse",
        "role": "branch_admin", "scope": {"branch_id": branch_a}, "acknowledge_scope": True,
    })
    assert manager.status_code == 200, manager.text
    viewer = client.post("/api/v1/users", json={
        "name": "Viewer", "email": "profile-viewer@iam.test", "password": "correct-horse",
        "role": "viewer", "scope": {"branch_id": branch_a, "course_id": course_a}, "acknowledge_scope": True,
    })
    assert viewer.status_code == 200, viewer.text

    detail = client.get(f"/api/v1/students/{student}/enrollments")
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["photo_id"] is None
    assert body["actions"]["edit"] is True
    assert body["actions"]["enroll"] is True
    assert body["aliases"] == []

    _login(client, "profile-admin@iam.test")
    denied_photo = client.post(
        f"/api/v1/students/{student}/photo",
        files={"photo": ("face.jpg", b"\xff\xd8\xff\xd9", "image/jpeg")},
    )
    assert denied_photo.status_code == 403
    local = client.get(f"/api/v1/students/{student}/enrollments").json()
    assert [item["batch_id"] for item in local["enrollments"]] == [batch_a]
    assert local["enrollments"][0]["manage"] is True
    assert local["actions"]["edit"] is False
    dated = client.patch(
        f"/api/v1/students/{student}/enrollments/{enrollment_a}",
        json={"started_on": "2026-09-01", "ended_on": "2027-01-15"},
    )
    assert dated.status_code == 200, dated.text
    stored = database.enrollments.find_one({"_id": enrollment_a})
    assert stored["started_on"] == "2026-09-01"
    assert stored["ended_on"] == "2027-01-15"
    assert stored["status"] == "historical"
    assert stored["batch_id"] == batch_a
    blocked = client.post("/api/v1/students/{}/enrollments".format(student), json={
        "branch_id": branch_b, "course_id": course_a, "batch_id": batch_b,
    })
    assert blocked.status_code == 403

    _login(client, "admin@iam.test")
    wrong_type = client.post(
        f"/api/v1/students/{student}/photo",
        files={"photo": ("face.gif", b"GIF89a", "image/gif")},
    )
    assert wrong_type.status_code == 422
    too_big = client.post(
        f"/api/v1/students/{student}/photo",
        files={"photo": ("face.jpg", b"\xff\xd8\xff" + b"x" * (2 * 1024 * 1024), "image/jpeg")},
    )
    assert too_big.status_code == 422
    assert database.students.find_one({"_id": student}).get("photo_file_id") is None
    uploaded = client.post(
        f"/api/v1/students/{student}/photo",
        files={"photo": ("face.jpg", b"\xff\xd8\xff\xd9", "image/jpeg")},
    )
    assert uploaded.status_code == 200, uploaded.text
    photo_id = uploaded.json()["photo_id"]
    image = client.get(f"/api/v1/students/{student}/photo")
    assert image.status_code == 200
    assert image.content.startswith(b"\xff\xd8\xff")
    hidden = client.get(f"/api/v1/files/{photo_id}")
    assert hidden.status_code == 404
    card = client.get(f"/api/v1/students/{student}/card")
    assert card.status_code == 200, card.text
    assert card.json()["photo_id"] == photo_id
    alias = client.post(f"/api/v1/students/{student}/aliases", json={"display_name": "Shared Earlier"})
    assert alias.status_code == 200, alias.text
    removed = client.delete(f"/api/v1/students/{student}/aliases/{alias.json()['id']}")
    assert removed.status_code == 200, removed.text
    future = client.patch(f"/api/v1/students/{student}", json={
        "display_name": "SHARED STUDENT", "edit_version": 0, "date_of_birth": "2099-01-01",
    })
    assert future.status_code == 422
    assert future.json()["error"]["code"] == "student.profile"
    unknown = client.patch(f"/api/v1/students/{student}", json={
        "display_name": "SHARED STUDENT", "edit_version": 0, "blood_group": "X",
    })
    assert unknown.status_code == 422
    assert unknown.json()["error"]["code"] == "student.profile"
    bad_pin = client.patch(f"/api/v1/students/{student}", json={
        "display_name": "SHARED STUDENT", "edit_version": 0, "pin": "12",
    })
    assert bad_pin.status_code == 422
    assert bad_pin.json()["error"]["code"] == "student.profile"
    future_year = client.patch(f"/api/v1/students/{student}", json={
        "display_name": "SHARED STUDENT", "edit_version": 0, "passing_year": "2099",
    })
    assert future_year.status_code == 422
    assert future_year.json()["error"]["code"] == "student.profile"
    assert database.students.find_one({"_id": student}).get("edit_version", 0) == 0
    profile = {
        "display_name": "SHARED STUDENT",
        "street": "Near the bridge",
        "place": "Tirur",
        "district": "Malappuram",
        "state": "Kerala",
        "pin": "676101",
        "date_of_birth": "2010-04-02",
        "blood_group": "O+",
        "phone": "9847000111",
        "guardian_name": "Parent Name",
        "guardian_phone": "9847000222",
        "notes": "Bring the ID card",
        "qualification": "Plus Two",
        "institution": "GHSS Tirur",
        "board": "Kerala",
        "passing_year": "2024",
    }
    saved_profile = client.patch(f"/api/v1/students/{student}", json={**profile, "edit_version": 0})
    assert saved_profile.status_code == 200, saved_profile.text
    stored_profile = database.students.find_one({"_id": student})
    assert stored_profile["street"] == "Near the bridge"
    assert stored_profile["pin"] == "676101"
    assert stored_profile["qualification"] == "Plus Two"
    assert stored_profile["blood_group"] == "O+"
    assert stored_profile["student_code"] == "IAM-000501"
    assert database.enrollments.find_one({"_id": enrollment_a})["batch_id"] == batch_a
    shown_profile = client.get(f"/api/v1/students/{student}/enrollments").json()
    assert shown_profile["guardian_name"] == "Parent Name"
    assert shown_profile["date_of_birth"] == "2010-04-02"
    assert shown_profile["institution"] == "GHSS Tirur"
    academic_only = client.patch(f"/api/v1/students/{student}", json={
        "display_name": "SHARED STUDENT", "edit_version": 1, "qualification": "Degree",
    })
    assert academic_only.status_code == 200, academic_only.text
    assert database.students.find_one({"_id": student})["street"] == "Near the bridge"
    name_only = client.patch(f"/api/v1/students/{student}", json={"display_name": "SHARED STUDENT", "edit_version": 2})
    assert name_only.status_code == 200, name_only.text
    kept = database.students.find_one({"_id": student})
    assert kept["street"] == "Near the bridge"
    assert kept["qualification"] == "Degree"
    conflict = client.patch(f"/api/v1/students/{student}", json={
        "display_name": "Proposed Name", "edit_version": 1, "street": "Other road",
    })
    assert conflict.status_code == 409
    conflict_details = conflict.json()["error"]["details"]
    assert conflict_details["current_display_name"] == "SHARED STUDENT"
    assert conflict_details["current_street"] == "Near the bridge"
    assert conflict_details["current_qualification"] == "Degree"
    assert conflict_details["edit_version"] == 3
    assert database.students.find_one({"_id": student})["street"] == "Near the bridge"
    cleared_profile = client.patch(f"/api/v1/students/{student}", json={
        "display_name": "SHARED STUDENT", "edit_version": 3, "street": "",
    })
    assert cleared_profile.status_code == 200, cleared_profile.text
    cleared = database.students.find_one({"_id": student})
    assert cleared.get("street") in {None, ""}
    assert cleared["qualification"] == "Degree"
    _login(client, "profile-admin@iam.test")
    denied_profile = client.patch(f"/api/v1/students/{student}", json={
        "display_name": "SHARED STUDENT", "edit_version": 3, "phone": "9847000333",
    })
    assert denied_profile.status_code == 403
    _login(client, "admin@iam.test")
    clash = client.post(f"/api/v1/students/{student}/enrollments", json={
        "branch_id": branch_a, "course_id": course_a, "batch_id": batch_c,
    })
    assert clash.status_code == 409
    assert clash.json()["error"]["code"] == "student.identity"
    database.enrollment_names.delete_many({"batch_id": batch_c, "name_key": "shared student"})
    created = client.post(f"/api/v1/students/{student}/enrollments", json={
        "branch_id": branch_a, "course_id": course_a, "batch_id": batch_c, "started_on": "2027-09-01",
    })
    assert created.status_code == 200, created.text
    added = database.enrollments.find_one({"_id": created.json()["id"]})
    assert added["student_id"] == student
    assert added["batch_id"] == batch_c
    assert added["started_on"] == "2027-09-01"
    assert database.results.count_documents({"student_id": student}) == 0
    duplicate = client.post(f"/api/v1/students/{student}/enrollments", json={
        "branch_id": branch_a, "course_id": course_a, "batch_id": batch_c,
    })
    assert duplicate.status_code == 409
    order = client.patch(
        f"/api/v1/students/{student}/enrollments/{enrollment_a}",
        json={"started_on": "2027-02-01", "ended_on": "2026-01-01", "batch_id": batch_c},
    )
    assert order.status_code == 422
    backwards = client.patch(
        f"/api/v1/students/{student}/enrollments/{enrollment_a}",
        json={"started_on": "2027-02-01", "ended_on": "2026-01-01"},
    )
    assert backwards.status_code == 422
    cleared = client.patch(
        f"/api/v1/students/{student}/enrollments/{enrollment_a}",
        json={"started_on": "", "ended_on": ""},
    )
    assert cleared.status_code == 200, cleared.text
    cleared_row = database.enrollments.find_one({"_id": enrollment_a})
    assert "started_on" not in cleared_row
    assert "ended_on" not in cleared_row
    assert "status" not in cleared_row
    _login(client, "profile-viewer@iam.test")
    seen = client.get(f"/api/v1/students/{student}/photo")
    assert seen.status_code == 200
    assert seen.content.startswith(b"\xff\xd8\xff")
    _login(client, "admin@iam.test")
    client.delete(f"/api/v1/students/{student}/photo")
    assert client.get(f"/api/v1/students/{student}/photo").status_code == 404
    assert database.students.find_one({"_id": student})["display_name"] == "SHARED STUDENT"

    _login(client, "profile-viewer@iam.test")
    client_photo = client.post(
        f"/api/v1/students/{student}/photo",
        files={"photo": ("face.jpg", b"\xff\xd8\xff\xd9", "image/jpeg")},
    )
    assert client_photo.status_code == 403
    missing = client.get("/api/v1/students/missing-student/photo")
    assert missing.status_code == 404
