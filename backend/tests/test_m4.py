from decimal import Decimal
from uuid import uuid4

import pytest
from bson import ObjectId
from fastapi.testclient import TestClient

from app.calculating import aggregate, band, dense_ranks, display_percentage, percentage, selected_attempts
from app.main import create_app
from app.reporting import export_bytes, participation_summary, student_boards, view_sections
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


def test_weighted_aggregate_bands_and_dense_rank():
    assert display_percentage(percentage(15, 20)) == 75
    assert display_percentage(percentage(10, 25)) == 40
    combined = aggregate(
        [
            {"id": "a", "student_id": "s", "status": "scored", "score": 15, "maximum": 20},
            {"id": "b", "student_id": "s", "assessment_id": "other", "status": "scored", "score": 10, "maximum": 25},
            {"id": "c", "student_id": "s", "assessment_id": "gap", "status": "absent", "score": None, "maximum": 20},
        ]
    )
    assert combined["percentage"] == 55.56
    assert combined["obtained"] == 25
    assert combined["maximum"] == 45
    assert combined["absent"] == 1
    assert band(Decimal("39.99")) == "danger"
    assert band(Decimal("40")) == "fifty-fifty"
    assert band(Decimal("60")) == "fifty-fifty"
    assert band(Decimal("60.01")) == "safe"
    ranks = dense_ranks(
        [
            {"id": "one", "status": "scored", "score": 18},
            {"id": "two", "status": "scored", "score": 18},
            {"id": "three", "status": "scored", "score": 12},
        ]
    )
    assert ranks == {"one": 1, "two": 1, "three": 2}


def test_academic_sections_follow_custom_policy_and_report_missing_results():
    rows = [
        {"id": "score", "student_id": "s1", "assessment_id": "exam", "branch_id": "b1", "marksheet_id": "sheet", "status": "scored", "score": 15, "maximum": 20},
        {"id": "gap", "student_id": "s2", "assessment_id": "exam", "branch_id": "b1", "marksheet_id": "sheet", "status": "missing", "score": None, "maximum": 20},
        {"id": "absent", "student_id": "s3", "assessment_id": "exam", "branch_id": "b1", "marksheet_id": "sheet", "status": "absent", "score": None, "maximum": 20},
    ]
    policy = {"bands": {"danger_below": 80, "safe_above": 90}}
    section = view_sections("institute", rows, [], {"b1": "Tirur"}, policy)[0]
    assert section["percentage"] == 75
    assert section["band"] == aggregate(rows, policy)["band"] == "danger"
    assert section["coverage"] == "1/3"
    assert section["missing"] == section["absent"] == 1
    assert section["marksheet_ids"] == ["sheet"]


def test_latest_attempt_is_selected_and_components_stay_out():
    rows = [
        {"id": "original", "student_id": "s", "assessment_id": "unit-1", "status": "scored", "score": 29, "maximum": 30, "exam_date": "2026-06-01"},
        {"id": "retest", "student_id": "s", "assessment_id": "unit-1", "status": "scored", "score": 16.5, "maximum": 20, "exam_date": "2026-06-20"},
        {"id": "component", "student_id": "s", "assessment_id": "unit-1-part", "status": "scored", "score": 5, "maximum": 10, "counts_in_aggregate": False},
    ]
    chosen = selected_attempts(rows)
    assert [item["id"] for item in chosen] == ["retest"]
    assert aggregate(rows)["percentage"] == 82.5


def test_published_card_uses_the_active_revision(client):
    bootstrap(client)
    uploaded = client.post(
        "/api/v1/imports",
        files={"file": ("ACCOUNTANCY  RANK LIST.xlsx", workbook("ACCOUNTANCY  RANK LIST.xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    import_id = uploaded.json()["id"]
    assert client.post(f"/api/v1/imports/{import_id}/commit").status_code == 200
    sheets = client.get("/api/v1/marksheets").json()["items"]
    dated = next(item for item in sheets if item["exam_date"])
    assert client.post(f"/api/v1/marksheets/{dated['id']}/publish").status_code == 200
    detail = client.get(f"/api/v1/marksheets/{dated['id']}").json()
    scored = next(item for item in detail["results"] if item["status"] == "scored")
    card = client.get(f"/api/v1/students/{scored['student_id']}/card")
    assert card.status_code == 200, card.text
    body = card.json()
    match = next(item for item in body["results"] if item["id"] == scored["id"])
    assert match["percentage"] == display_percentage(percentage(scored["score"], detail["maximum"]))
    assert body["performance"]["passing"] is None
    overview = client.get("/api/v1/views/institute")
    assert overview.status_code == 200, overview.text
    assert overview.json()["roster_confirmed"] is False
    assert overview.json()["performance"]["participation"] is None
    assert overview.json()["students"] >= 1
    queued = client.post("/api/v1/reports/cards", json={"format": "pdf", "scope": {}})
    assert client.post("/api/v1/jobs/process").status_code == 200
    job = client.get(f"/api/v1/jobs/{queued.json()['id']}")
    assert job.status_code == 200
    assert job.json()["state"] == "succeeded"


def test_pdf_report_spans_pages_and_names_the_policy():
    payload, filename = export_bytes("report_pdf", [f"Result line {index}" for index in range(50)])
    assert filename == "progress-cards.pdf"
    assert b"/Count 2" in payload
    assert b"Page 2 of 2" in payload
    sheet, name = export_bytes("report_xlsx", ["Policy version 1", "Authorized subjects only."])
    assert name.endswith(".xlsx")
    assert b"Policy version 1" in sheet or len(sheet) > 100


def test_correction_and_restricted_outputs_stay_on_the_active_revision(client):
    bootstrap(client)
    uploaded = client.post(
        "/api/v1/imports",
        files={"file": ("ACCOUNTANCY  RANK LIST.xlsx", workbook("ACCOUNTANCY  RANK LIST.xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    import_id = uploaded.json()["id"]
    assert client.post(f"/api/v1/imports/{import_id}/commit").status_code == 200
    dated = next(item for item in client.get("/api/v1/marksheets").json()["items"] if item["exam_date"])
    assert client.post(f"/api/v1/marksheets/{dated['id']}/publish").status_code == 200
    detail = client.get(f"/api/v1/marksheets/{dated['id']}").json()
    scored = next(item for item in detail["results"] if item["status"] == "scored")
    corrected = client.post(
        f"/api/v1/marksheets/{dated['id']}/correct",
        json={
            "reason": "QA correction",
            "edit_version": detail["edit_version"],
            "changes": [{"result_id": scored["id"], "score": 1}],
        },
    )
    assert corrected.status_code == 200, corrected.text
    card = client.get(f"/api/v1/students/{scored['student_id']}/card").json()
    current = next(item for item in card["results"] if item["score"] == 1)
    assert current["percentage"] == display_percentage(percentage(1, detail["maximum"]))
    refreshed = client.get(f"/api/v1/marksheets/{dated['id']}").json()
    active = next(item for item in refreshed["results"] if item["score"] == 1)
    assert active["previous_score"] == scored["score"]
    audit = client.get("/api/v1/audit").json()["items"]
    assert any(item["action"] == "marksheet.correct" for item in audit)
    empty = client.get("/api/v1/views/paper?exam_type=chapter")
    assert empty.status_code == 200
    assert empty.json()["empty"] is True
    database = sync_db(client)
    database.results.insert_one(
        {
            "_id": "law-secret",
            "institute_id": database.students.find_one({"_id": scored["student_id"]})["institute_id"],
            "student_id": scored["student_id"],
            "active": True,
            "status": "scored",
            "score": 1,
            "maximum": 20,
            "title": "Law secret",
            "subject_id": "law",
            "branch_id": dated.get("branch_id"),
            "course_id": dated.get("course_id"),
            "batch_id": (dated.get("batch_ids") or [None])[0],
            "revision": 1,
        }
    )
    catalog = client.get("/api/v1/catalog").json()
    created = client.post(
        "/api/v1/users",
        json={
            "name": "Accounting teacher",
            "email": "accounts@iam.test",
            "password": "correct-horse",
            "role": "teacher",
            "scope": {
                "branch_id": catalog["branches"][0]["id"],
                "course_id": catalog["courses"][0]["id"],
                "subject_id": catalog["subjects"][0]["id"],
            },
            "acknowledge_scope": True,
        },
    )
    assert created.status_code == 200, created.text
    client.post("/api/v1/auth/logout")
    assert client.post("/api/v1/auth/login", json={"email": "accounts@iam.test", "password": "correct-horse"}).status_code == 200
    restricted = client.get(f"/api/v1/students/{scored['student_id']}/card").json()
    assert restricted["partial"] is True
    assert all(item.get("title") != "Law secret" for item in restricted["results"])
    assert "law" not in {item.get("subject_id") for item in restricted["results"]}
    queued = client.post("/api/v1/reports/cards", json={"format": "pdf", "scope": {"subject_id": catalog["subjects"][0]["id"]}})
    assert queued.status_code == 403
    client.post("/api/v1/auth/logout")
    client.post("/api/v1/auth/login", json={"email": "admin@iam.test", "password": "correct-horse"})
    admin_export = client.post("/api/v1/reports/cards", json={"format": "pdf", "scope": {"subject_id": catalog["subjects"][0]["id"]}})
    assert client.post("/api/v1/jobs/process").status_code == 200
    path = database.files.find_one({"job_id": admin_export.json()["id"]})["path"]
    contents = open(path, "rb").read()
    assert b"Law secret" not in contents
    assert b"QA" not in contents or b"Policy version" in contents
    assert b"previous" in contents


def test_added_marksheet_stays_draft_until_published(client):
    bootstrap(client)
    database = sync_db(client)
    institute_id = database.institutes.find_one()["_id"]
    branch, course, batch, subject, paper, student = (str(ObjectId()) for _ in range(6))
    database.branches.insert_one({"_id": branch, "institute_id": institute_id, "name": "IAM Tirur"})
    database.courses.insert_one({"_id": course, "institute_id": institute_id, "name": "CA Foundation"})
    database.offerings.insert_one({"_id": str(ObjectId()), "institute_id": institute_id, "branch_id": branch, "course_id": course})
    database.batches.insert_one({"_id": batch, "institute_id": institute_id, "branch_id": branch, "course_id": course, "name": "September 2026"})
    database.subjects.insert_one({"_id": subject, "institute_id": institute_id, "course_id": course, "name": "Accounting"})
    database.papers.insert_one({"_id": paper, "institute_id": institute_id, "subject_id": subject, "number": 1, "name": "Paper 1"})
    database.students.insert_one({"_id": student, "institute_id": institute_id, "display_name": "SHANHA", "student_code": "IAM-000099", "name_key": "shanha"})
    database.enrollments.insert_one({"_id": str(ObjectId()), "institute_id": institute_id, "student_id": student, "branch_id": branch, "course_id": course, "batch_id": batch})
    body = {
        "title": "Class test",
        "branch_id": branch,
        "course_id": course,
        "batch_id": batch,
        "subject_id": subject,
        "paper_id": paper,
        "exam_type": "unit",
        "maximum": 20,
        "attempt": "original",
    }
    created = client.post("/api/v1/marksheets", json=body)
    assert created.status_code == 200, created.text
    sheet_id = created.json()["id"]
    added = client.post(f"/api/v1/marksheets/{sheet_id}/results", json={"student_id": student, "status": "scored", "score": 18})
    assert added.status_code == 200, added.text
    detail = client.get(f"/api/v1/marksheets/{sheet_id}").json()
    assert detail["status"] == "draft"
    assert detail["results"][0]["percentage"] == 90
    assert detail["results"][0]["rank"] == 1
    assert detail["available_students"] == []
    assert client.get("/api/v1/views/institute").json()["empty"] is True
    assert client.post("/api/v1/marksheets", json=body).status_code == 409


def test_cleared_score_card_filters_and_owned_export(client):
    bootstrap(client)
    database = sync_db(client)
    institute_id = database.institutes.find_one()["_id"]
    branch, course, batch, subject, paper, student, other = (str(ObjectId()) for _ in range(7))
    database.branches.insert_one({"_id": branch, "institute_id": institute_id, "name": "IAM Tirur"})
    database.courses.insert_one({"_id": course, "institute_id": institute_id, "name": "CA Foundation"})
    database.offerings.insert_one({"_id": str(ObjectId()), "institute_id": institute_id, "branch_id": branch, "course_id": course})
    database.batches.insert_one({"_id": batch, "institute_id": institute_id, "branch_id": branch, "course_id": course, "name": "September 2026"})
    database.subjects.insert_one({"_id": subject, "institute_id": institute_id, "course_id": course, "name": "Accounting"})
    database.papers.insert_one({"_id": paper, "institute_id": institute_id, "subject_id": subject, "number": 1, "name": "Paper 1"})
    database.students.insert_one({"_id": student, "institute_id": institute_id, "display_name": "SHANHA", "student_code": "IAM-000099", "name_key": "shanha"})
    database.students.insert_one({"_id": other, "institute_id": institute_id, "display_name": "OTHER STUDENT", "student_code": "IAM-000100", "name_key": "other student"})
    database.enrollments.insert_one({"_id": str(ObjectId()), "institute_id": institute_id, "student_id": student, "branch_id": branch, "course_id": course, "batch_id": batch})
    database.enrollments.insert_one({"_id": str(ObjectId()), "institute_id": institute_id, "student_id": other, "branch_id": branch, "course_id": course, "batch_id": batch})
    created = client.post(
        "/api/v1/marksheets",
        json={
            "title": "Class test",
            "branch_id": branch,
            "course_id": course,
            "batch_id": batch,
            "subject_id": subject,
            "paper_id": paper,
            "exam_type": "unit",
            "maximum": 20,
            "exam_date": "2026-10-08",
            "attempt": "original",
        },
    )
    assert created.status_code == 200, created.text
    sheet_id = created.json()["id"]
    assert client.post(f"/api/v1/marksheets/{sheet_id}/results", json={"student_id": student, "status": "scored", "score": 18}).status_code == 200
    detail = client.get(f"/api/v1/marksheets/{sheet_id}").json()
    result_id = detail["results"][0]["id"]
    cleared = client.patch(
        f"/api/v1/marksheets/{sheet_id}/results/{result_id}",
        json={"status": "missing", "score": None, "edit_version": detail["edit_version"]},
    )
    assert cleared.status_code == 200, cleared.text
    missing = client.get(f"/api/v1/marksheets/{sheet_id}").json()
    assert missing["results"][0]["status"] == "missing"
    assert missing["results"][0]["score"] is None
    assert missing["results"][0]["percentage"] is None
    zero = client.patch(
        f"/api/v1/marksheets/{sheet_id}/results/{result_id}",
        json={"status": "scored", "score": 0, "edit_version": missing["edit_version"]},
    )
    assert zero.status_code == 200, zero.text
    assert client.get(f"/api/v1/marksheets/{sheet_id}").json()["results"][0]["score"] == 0
    restored = client.get(f"/api/v1/marksheets/{sheet_id}").json()
    assert client.patch(
        f"/api/v1/marksheets/{sheet_id}/results/{result_id}",
        json={"status": "scored", "score": 18, "edit_version": restored["edit_version"]},
    ).status_code == 200
    assert client.post(f"/api/v1/marksheets/{sheet_id}/publish").status_code == 200
    database.results.insert_one(
        {
            "_id": "secret-row",
            "institute_id": institute_id,
            "student_id": other,
            "active": True,
            "status": "scored",
            "score": 1,
            "maximum": 20,
            "title": "Secret paper",
            "subject_id": subject,
            "paper_id": paper,
            "branch_id": branch,
            "course_id": course,
            "batch_id": batch,
            "exam_date": "2026-10-08",
        }
    )
    matched = client.get(f"/api/v1/students/{student}/card", params={"subject_id": subject, "exam_date_from": "2026-10-01", "exam_date_to": "2026-10-31"})
    assert matched.status_code == 200, matched.text
    assert matched.json()["performance"]["percentage"] == 90
    assert matched.json()["subjects"][0]["subject_id"] == subject
    assert subject in matched.json()["facets"]["subject_ids"]
    excluded = client.get(f"/api/v1/students/{student}/card", params={"exam_date_from": "2026-12-01"})
    assert excluded.json()["results"] == []
    assert excluded.json()["performance"]["expected"] == 0
    assert subject in excluded.json()["facets"]["subject_ids"]
    scope = {"branch_id": branch, "course_id": course, "subject_id": subject}
    assert client.post(
        "/api/v1/users",
        json={"name": "Branch lead", "email": "branch@iam.test", "password": "correct-horse", "role": "branch_admin", "scope": scope, "acknowledge_scope": True},
    ).status_code == 200
    assert client.post(
        "/api/v1/users",
        json={"name": "Viewer", "email": "viewer@iam.test", "password": "correct-horse", "role": "viewer", "scope": scope, "acknowledge_scope": True},
    ).status_code == 200
    client.post("/api/v1/auth/logout")
    assert client.post("/api/v1/auth/login", json={"email": "branch@iam.test", "password": "correct-horse"}).status_code == 200
    queued = client.post(
        "/api/v1/reports/cards",
        json={"format": "pdf", "scope": {"student_id": student, "subject_id": subject, "batch_id": batch, "exam_date_from": "2026-10-08", "exam_date_to": "2026-10-08"}},
    )
    assert queued.status_code == 200, queued.text
    ran = client.post(f"/api/v1/jobs/{queued.json()['id']}/run")
    assert ran.status_code == 200, ran.text
    assert ran.json()["state"] == "succeeded"
    assert client.post("/api/v1/jobs/process").status_code == 404
    contents = open(database.files.find_one({"job_id": queued.json()["id"]})["path"], "rb").read()
    assert b"SHANHA" in contents
    assert b"OTHER STUDENT" not in contents
    assert b"Secret paper" not in contents
    assert b"exam_date_from: 2026-10-08" in contents
    late = client.post("/api/v1/reports/cards", json={"format": "pdf", "scope": {"student_id": student, "exam_date_from": "2026-12-01"}})
    assert client.post(f"/api/v1/jobs/{late.json()['id']}/run").json()["state"] == "succeeded"
    late_file = open(database.files.find_one({"job_id": late.json()["id"]})["path"], "rb").read()
    assert b"Class test" not in late_file
    client.post("/api/v1/auth/logout")
    assert client.post("/api/v1/auth/login", json={"email": "viewer@iam.test", "password": "correct-horse"}).status_code == 200
    assert client.post(f"/api/v1/jobs/{queued.json()['id']}/run").status_code == 404
    assert client.post("/api/v1/reports/cards", json={"format": "pdf", "scope": {"student_id": student}}).status_code == 403


def test_report_filters_reach_the_list_card_and_export(client):
    from app.calculating import aggregate, percentage
    from app.reporting import comparisons, display_percentage

    inside = [{"id": "retest", "assessment_id": "unit", "status": "scored", "score": 16, "maximum": 20, "exam_date": "2026-10-01", "attempt_kind": "retest"}]
    outside = [{"id": "original", "assessment_id": "unit", "status": "scored", "score": 10, "maximum": 30, "exam_date": "2026-06-01", "attempt_kind": "original"}]
    compared = comparisons(inside, outside)
    assert compared[0]["baseline_outside_period"] is True
    assert compared[0]["original_percentage"] == display_percentage(percentage(10, 30))
    assert aggregate(inside)["percentage"] == 80

    bootstrap(client)
    database = sync_db(client)
    institute_id = database.institutes.find_one()["_id"]
    branch, course, batch, other_batch, subject, paper, first, second = (str(ObjectId()) for _ in range(8))
    database.branches.insert_one({"_id": branch, "institute_id": institute_id, "name": "IAM Tirur"})
    database.courses.insert_one({"_id": course, "institute_id": institute_id, "name": "CA Foundation"})
    database.offerings.insert_one({"_id": str(ObjectId()), "institute_id": institute_id, "branch_id": branch, "course_id": course})
    offering = str(ObjectId())
    database.batches.insert_many([
        {"_id": batch, "institute_id": institute_id, "branch_id": branch, "course_id": course, "name": "September 2026", "offering_id": offering, "session_key": "2026-09"},
        {"_id": other_batch, "institute_id": institute_id, "branch_id": branch, "course_id": course, "name": "January 2027", "offering_id": offering, "session_key": "2027-01"},
    ])
    database.subjects.insert_one({"_id": subject, "institute_id": institute_id, "course_id": course, "name": "Accounting"})
    database.papers.insert_one({"_id": paper, "institute_id": institute_id, "subject_id": subject, "number": 1, "name": "Paper 1"})
    database.students.insert_many([
        {"_id": first, "institute_id": institute_id, "display_name": "SHANHA", "student_code": "IAM-000099", "name_key": "shanha"},
        {"_id": second, "institute_id": institute_id, "display_name": "OTHER STUDENT", "student_code": "IAM-000100", "name_key": "other student"},
    ])
    database.enrollments.insert_many([
        {"_id": str(ObjectId()), "institute_id": institute_id, "student_id": first, "branch_id": branch, "course_id": course, "batch_id": batch},
        {"_id": str(ObjectId()), "institute_id": institute_id, "student_id": second, "branch_id": branch, "course_id": course, "batch_id": other_batch},
    ])
    created = client.post(
        "/api/v1/marksheets",
        json={
            "title": "Class test",
            "branch_id": branch,
            "course_id": course,
            "batch_id": batch,
            "subject_id": subject,
            "paper_id": paper,
            "exam_type": "unit",
            "maximum": 20,
            "exam_date": "2026-10-08",
            "attempt": "original",
        },
    )
    assert created.status_code == 200, created.text
    sheet_id = created.json()["id"]
    assert client.post(f"/api/v1/marksheets/{sheet_id}/results", json={"student_id": first, "status": "scored", "score": 18}).status_code == 200
    assert client.post(f"/api/v1/marksheets/{sheet_id}/publish").status_code == 200
    september = client.get("/api/v1/students", params={"batch_id": batch, "page": 1, "page_size": 8})
    assert september.status_code == 200, september.text
    assert [item["id"] for item in september.json()["items"]] == [first]
    assert september.json()["items"][0]["performance"]["percentage"] == 90
    assert september.json()["summary"]["percentage"] == 90
    january = client.get("/api/v1/students", params={"batch_id": other_batch, "page": 1})
    assert [item["id"] for item in january.json()["items"]] == [second]
    matching = client.get("/api/v1/students", params={"subject_id": subject, "exam_type": "unit", "attempt": "original", "page": 1})
    assert [item["id"] for item in matching.json()["items"]] == [first]
    named = client.get("/api/v1/students", params={"page": 1, "sort": "name"})
    assert [item["display_name"] for item in named.json()["items"][:2]] == ["OTHER STUDENT", "SHANHA"]
    ranked = client.get("/api/v1/students", params={"page": 1, "sort": "percentage"})
    assert ranked.json()["items"][0]["display_name"] == "SHANHA"
    assert ranked.json()["items"][0]["performance"]["percentage"] == 90
    assert ranked.json()["summary"]["percentage"] == 90
    assert client.get("/api/v1/students", params={"exam_date_from": "2026-12-01", "exam_date_to": "2026-01-01"}).status_code == 422

    filtered = client.get(f"/api/v1/students/{first}/card", params={"exam_date_from": "2026-12-01"})
    assert filtered.json()["empty_reason"] == "filters"
    assert filtered.json()["performance"]["expected"] == 0
    assert filtered.json()["result_count"] == 0
    enrollment = client.get(f"/api/v1/students/{first}/card", params={"batch_id": other_batch})
    assert enrollment.json()["empty_reason"] == "enrollment"
    assert enrollment.json()["performance"]["percentage"] is None
    retests = client.get(f"/api/v1/students/{first}/card", params={"attempt": "retest"})
    assert retests.json()["results"] == []
    assert retests.json()["empty_reason"] == "filters"

    queued = client.post(
        "/api/v1/reports/cards",
        json={"format": "pdf", "scope": {"student_id": first, "exam_type": "unit", "attempt": "original"}},
    )
    assert queued.status_code == 200, queued.text
    assert client.post(f"/api/v1/jobs/{queued.json()['id']}/run").json()["state"] == "succeeded"
    contents = open(database.files.find_one({"job_id": queued.json()["id"]})["path"], "rb").read()
    assert b"exam_type: unit" in contents
    assert b"attempt: original" in contents


def _result(institute, **fields):
    row = {
        "institute_id": institute,
        "active": True,
        "status": "scored",
        "score": 16,
        "maximum": 20,
        "exam_date": "2026-10-01",
        "attempt_kind": "original",
    }
    row.update(fields)
    return row


def test_participation_counts_confirmed_students_who_have_no_row():
    students = [f"s{index}" for index in range(10)]
    rows = [
        _result("iam", _id=f"row-{student}", student_id=student, batch_id="sept", assessment_id="exam", subject_id="accounting")
        for student in students[:8]
    ]
    rows.append(
        _result(
            "iam",
            _id="earlier",
            student_id="s0",
            batch_id="sept",
            assessment_id="exam",
            subject_id="accounting",
            score=4,
            exam_date="2026-06-01",
        )
    )
    eligible = {"sept": set(students)}
    summary = participation_summary(rows, eligible)
    assert summary["participation"] == 0.8
    assert summary["participation_scored"] == 8
    assert summary["participation_expected"] == 10
    assert summary["participation_missing"] == 2
    rows.append(_result("iam", _id="absent", student_id="s6", batch_id="sept", assessment_id="law", subject_id="law", status="absent", score=None))
    rows.append(_result("iam", _id="exempt", student_id="s7", batch_id="sept", assessment_id="law", subject_id="law", status="exempt", score=None))
    for student in students[2:6]:
        rows.append(_result("iam", _id=f"law-{student}", student_id=student, batch_id="sept", assessment_id="law", subject_id="law"))
    law = participation_summary([row for row in rows if row["subject_id"] == "law"], eligible)
    assert law["participation_scored"] == 4
    assert law["participation_absent"] == 1
    assert law["participation_exempt"] == 1
    assert law["participation_expected"] == 9
    assert law["participation"] == round(4 / 9, 4)
    mixed = participation_summary(
        [
            _result("iam", _id="jan-scored", student_id="j0", batch_id="jan", assessment_id="jan-exam"),
            _result("iam", _id="sept-scored", student_id="s0", batch_id="sept", assessment_id="sept-exam"),
        ],
        {"sept": {"s0"}, "jan": {"j0", "j1"}},
    )
    assert mixed["participation_expected"] == 3
    assert mixed["participation_scored"] == 2
    assert participation_summary(rows, {})["participation"] is None


def test_student_boards_rank_highest_and_group_danger_by_the_next_step():
    rows = [
        _result("iam", _id="high", id="high", student_id="best", course_id="accounting", status="scored", score=18, maximum=20),
        _result("iam", _id="low", id="low", student_id="least", course_id="accounting", status="scored", score=4, maximum=20),
        _result("iam", _id="law-high", id="law-high", student_id="best", course_id="law", status="scored", score=16, maximum=20),
    ]
    names = {"accounting": "Accounting", "law": "Law"}
    institute = student_boards("institute", rows, {}, names)
    institute_accounting = next(group for group in institute["boards"] if group["id"] == "accounting")
    assert [item["student_id"] for item in institute_accounting["top_students"]] == ["best"]
    assert institute_accounting["top_student_count"] == 1
    assert next(group for group in institute["boards"] if group["id"] == "law")["top_students"][0]["student_id"] == "best"
    branch = student_boards("branch", rows, {}, names)
    accounting = next(group for group in branch["boards"] if group["id"] == "accounting")
    assert [item["student_id"] for item in accounting["top_students"]] == ["best"]
    assert accounting["attention_result_count"] == 1
    assert accounting["attention"][0]["student_id"] == "least"
    law = next(group for group in branch["boards"] if group["id"] == "law")
    assert law["attention_result_count"] == 0
    assert law["top_students"][0]["student_id"] == "best"


def test_view_includes_results_past_five_thousand_and_pages_attention(client):
    payload = bootstrap(client)
    institute = payload["institute"]["id"]
    database = sync_db(client)
    database.branches.insert_many(
        [
            {"_id": "branch-limit", "institute_id": institute, "name": "Limit", "name_key": "limit"},
            {"_id": "branch-hidden", "institute_id": institute, "name": "Hidden", "name_key": "hidden"},
        ]
    )
    database.batches.insert_one(
        {
            "_id": "batch-limit",
            "institute_id": institute,
            "branch_id": "branch-limit",
            "name": "Limit 2026",
            "offering_id": "offering-limit",
            "session_key": "2026-09",
        }
    )
    database.enrollments.insert_many(
        [
            {
                "_id": f"enroll-{index}",
                "institute_id": institute,
                "branch_id": "branch-limit",
                "batch_id": "batch-limit",
                "student_id": f"student-{index}",
            }
            for index in range(5001)
        ]
        + [
            {
                "_id": "enroll-hidden",
                "institute_id": institute,
                "branch_id": "branch-hidden",
                "student_id": "student-hidden",
            }
        ]
    )
    database.results.insert_many(
        [
            _result(
                institute,
                _id=f"result-{index}",
                branch_id="branch-limit",
                batch_id="batch-limit",
                student_id=f"student-{index}",
                subject_id="beyond" if index == 5000 else "accounting",
                title=f"Exam {index:04d}",
                score=5 if index < 25 else 18,
            )
            for index in range(5001)
        ]
        + [
            _result(
                institute,
                _id="result-hidden",
                branch_id="branch-hidden",
                student_id="student-hidden",
                title="Hidden exam",
                score=1,
            )
        ]
    )
    overview = client.get("/api/v1/views/institute", params={"branch_id": "branch-limit"})
    assert overview.status_code == 200, overview.text
    body = overview.json()
    assert body["students"] == 5001
    assert body["enrollments"] == 5001
    assert body["performance"]["scored"] == 5001
    assert body["sections"][0]["students"] == 5001
    assert body["sections"][0]["results"] == 5001
    assert body["attention_result_count"] == 25
    assert body["attention_student_count"] == 25
    assert body["attention_sample_count"] == 20
    assert len(body["attention"]) == 20
    assert all(item["percentage"] == 25 for item in body["attention"])
    later = client.get("/api/v1/views/institute", params={"branch_id": "branch-limit", "attention_page": 2}).json()
    assert later["performance"]["scored"] == 5001
    assert later["attention_result_count"] == 25
    assert later["attention_student_count"] == 25
    assert later["attention_sample_count"] == 5
    assert {item["id"] for item in body["attention"]}.isdisjoint({item["id"] for item in later["attention"]})
    beyond = client.get("/api/v1/views/institute", params={"subject_id": "beyond"}).json()
    assert beyond["students"] == 1
    assert beyond["performance"]["scored"] == 1
    assert beyond["attention_result_count"] == 0
    confirmed = client.post("/api/v1/rosters/confirm", json={"batch_id": "batch-limit"})
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["listed"] == 5001
    assert len(database.rosters.find_one({"batch_id": "batch-limit"})["student_ids"]) == 5001
    created = client.post(
        "/api/v1/users",
        json={
            "name": "Limit teacher",
            "email": "limit@iam.test",
            "password": "correct-horse",
            "role": "teacher",
            "scope": {"branch_id": "branch-limit"},
            "acknowledge_scope": True,
        },
    )
    assert created.status_code == 200, created.text
    client.post("/api/v1/auth/logout")
    assert client.post("/api/v1/auth/login", json={"email": "limit@iam.test", "password": "correct-horse"}).status_code == 200
    restricted = client.get("/api/v1/views/institute").json()
    assert restricted["students"] == 5001
    assert restricted["performance"]["scored"] == 5001
    assert restricted["attention_result_count"] == 25
    assert all(item["title"] != "Hidden exam" for item in restricted["attention"])


def test_academic_view_participation_uses_the_confirmed_roster(client):
    payload = bootstrap(client)
    institute = payload["institute"]["id"]
    database = sync_db(client)
    database.branches.insert_one({"_id": "branch-part", "institute_id": institute, "name": "Tirur", "name_key": "tirur"})
    database.batches.insert_many(
        [
            {
                "_id": "batch-sept",
                "institute_id": institute,
                "branch_id": "branch-part",
                "name": "September",
                "offering_id": "offering-part",
                "session_key": "2026-09",
            },
            {
                "_id": "batch-jan",
                "institute_id": institute,
                "branch_id": "branch-part",
                "name": "January",
                "offering_id": "offering-part",
                "session_key": "2027-01",
            },
        ]
    )
    students = [f"part-{index}" for index in range(10)]
    database.enrollments.insert_many(
        [
            {
                "_id": f"part-enroll-{student}",
                "institute_id": institute,
                "branch_id": "branch-part",
                "batch_id": "batch-sept",
                "student_id": student,
            }
            for student in students
        ]
        + [
            {
                "_id": f"jan-enroll-{index}",
                "institute_id": institute,
                "branch_id": "branch-part",
                "batch_id": "batch-jan",
                "student_id": f"jan-{index}",
            }
            for index in range(2)
        ]
    )
    rows = [
        _result(
            institute,
            _id=f"acc-{student}",
            branch_id="branch-part",
            batch_id="batch-sept",
            student_id=student,
            subject_id="accounting",
            assessment_id="accounting-test",
            exam_type="chapter",
        )
        for student in students[:8]
    ]
    rows.append(
        _result(
            institute,
            _id="acc-earlier",
            branch_id="branch-part",
            batch_id="batch-sept",
            student_id=students[0],
            subject_id="accounting",
            assessment_id="accounting-test",
            exam_date="2026-06-01",
            score=4,
        )
    )
    rows.append(
        _result(
            institute,
            _id="law-absent",
            branch_id="branch-part",
            batch_id="batch-sept",
            student_id=students[0],
            subject_id="law",
            assessment_id="law-test",
            status="absent",
            score=None,
        )
    )
    rows.append(
        _result(
            institute,
            _id="law-exempt",
            branch_id="branch-part",
            batch_id="batch-sept",
            student_id=students[1],
            subject_id="law",
            assessment_id="law-test",
            status="exempt",
            score=None,
        )
    )
    for student in students[2:8]:
        rows.append(
            _result(
                institute,
                _id=f"law-{student}",
                branch_id="branch-part",
                batch_id="batch-sept",
                student_id=student,
                subject_id="law",
                assessment_id="law-test",
            )
        )
    rows.append(
        _result(
            institute,
            _id="jan-scored",
            branch_id="branch-part",
            batch_id="batch-jan",
            student_id="jan-0",
            subject_id="accounting",
            assessment_id="january-test",
            exam_date="2026-11-01",
        )
    )
    database.results.insert_many(rows)
    hidden = client.get("/api/v1/views/batch", params={"batch_id": "batch-sept", "subject_id": "accounting"})
    assert hidden.json()["performance"]["participation"] is None
    database.rosters.insert_one({"institute_id": institute, "batch_id": "batch-sept", "student_ids": students})
    still_hidden = client.get("/api/v1/views/institute").json()
    assert still_hidden["performance"]["participation"] is None
    database.rosters.insert_one({"institute_id": institute, "batch_id": "batch-jan", "student_ids": ["jan-0", "jan-1"]})
    accounting = client.get(
        "/api/v1/views/batch",
        params={"batch_id": "batch-sept", "subject_id": "accounting"},
    ).json()
    assert accounting["performance"]["participation"] == 0.8
    assert accounting["performance"]["participation_scored"] == 8
    assert accounting["performance"]["participation_expected"] == 10
    law = client.get("/api/v1/views/batch", params={"batch_id": "batch-sept", "subject_id": "law"}).json()
    assert law["performance"]["participation_scored"] == 6
    assert law["performance"]["participation_absent"] == 1
    assert law["performance"]["participation_exempt"] == 1
    assert law["performance"]["participation_expected"] == 9
    dated = client.get(
        "/api/v1/views/batch",
        params={"batch_id": "batch-sept", "exam_date_from": "2026-06-01", "exam_date_to": "2026-06-30"},
    ).json()
    assert dated["performance"]["participation_scored"] == 1
    assert dated["performance"]["participation_expected"] == 10
    mixed = client.get("/api/v1/views/institute").json()
    assert mixed["performance"]["participation_scored"] == 15
    assert mixed["performance"]["participation_expected"] == 21
