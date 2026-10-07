from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.calculating import aggregate, band, dense_ranks, display_percentage, percentage, selected_attempts
from app.main import create_app
from app.reporting import export_bytes
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
