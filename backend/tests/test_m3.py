from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.importing.parse import parse_workbook
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

ROOT = Path(__file__).resolve().parents[2] / "sample-import-files"


def workbook(name: str) -> bytes:
    return (ROOT / name).read_bytes()


def test_parser_covers_every_sample_sheet():
    files = {
        "ACCOUNTANCY  RANK LIST.xlsx": 8,
        "ECONOMICS  RANK LIST -.xlsx": 5,
        "LAW .xlsx": 6,
        "QT.xlsx": 10,
    }
    total = 0
    for filename, count in files.items():
        parsed = parse_workbook(workbook(filename), filename)
        assert len(parsed["sheets"]) == count
        total += count
        for sheet in parsed["sheets"]:
            names = [student["display_name"].casefold() for group in sheet["groups"] for student in group["students"]]
            assert "more than 60%" not in names
            assert not any(name.startswith("learn, grow") for name in names)
    assert total == 29
    accounting = parse_workbook(workbook("ACCOUNTANCY  RANK LIST.xlsx"), "accounting.xlsx")
    brs = next(sheet for sheet in accounting["sheets"] if sheet["name"] == "BRS")
    assert brs["exam_date"] == "2026-06-06"
    assert brs["groups"][0]["maximum"] == 20
    assert any(student["status"] == "absent" for student in brs["groups"][0]["students"])
    retest = next(sheet for sheet in accounting["sheets"] if "Re test" in sheet["title"])
    assert retest["attempt"] == "retest"
    ratio = parse_workbook(workbook("QT.xlsx"), "qt.xlsx")
    sept = next(sheet for sheet in ratio["sheets"] if sheet["name"] == "RATIO- SEPT -26")
    shahada = next(student for student in sept["groups"][0]["students"] if student["name_key"] == "shahada k")
    assert shahada["percentage"] == 90
    january = next(sheet for sheet in ratio["sheets"] if sheet["name"] == "RATIO JAN-27")
    assert january["heading_conflict"] is True
    assert january["recommended_batches"][0]["session_key"] == "2027-01"
    chapter = next(sheet for sheet in ratio["sheets"] if sheet["name"] == "CHAPTER -2 -2")
    assert chapter["groups"][0]["duplicate_of"] == "CHAPTER -2"
    assert chapter["groups"][1]["interpretation"] == "separate_assessment"
    assert any(student["status"] == "missing" and student["display_name"] == "SHIBILIYA" for student in chapter["groups"][0]["students"])


def test_accounting_import_commits_drafts_and_publishes_dated_sheet(client):
    bootstrap(client)
    uploaded = client.post(
        "/api/v1/imports",
        files={"file": ("ACCOUNTANCY  RANK LIST.xlsx", workbook("ACCOUNTANCY  RANK LIST.xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert uploaded.status_code == 200, uploaded.text
    imported = client.get(f"/api/v1/imports/{uploaded.json()['id']}")
    assert imported.json()["ready"] is True
    committed = client.post(f"/api/v1/imports/{uploaded.json()['id']}/commit")
    assert committed.status_code == 200, committed.text
    assert all(item["status"] == "committed" for item in committed.json()["outcomes"])
    again = client.post(
        "/api/v1/imports",
        files={"file": ("ACCOUNTANCY  RANK LIST.xlsx", workbook("ACCOUNTANCY  RANK LIST.xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert again.json()["duplicate"] is True
    marksheets = client.get("/api/v1/marksheets").json()["items"]
    brs = next(item for item in marksheets if item["source_sheet"] == "BRS")
    published = client.post(f"/api/v1/marksheets/{brs['id']}/publish")
    assert published.status_code == 200, published.text
    undated = next(item for item in marksheets if item["source_sheet"] != "BRS")
    blocked = client.post(f"/api/v1/marksheets/{undated['id']}/publish")
    assert blocked.status_code == 422
    students = client.get("/api/v1/students").json()["items"]
    assert any(item["display_name"] == "RISHA FATHIMA" for item in students)
    assert any(item["student_code"] == "IAM-000001" for item in students)


def _resolve(preview: dict) -> dict:
    decisions = {"sheets": {}}
    for sheet in preview["sheets"]:
        choice = {}
        if sheet["heading_conflict"]:
            choice["acknowledge_heading"] = True
        groups = {}
        for group in sheet["groups"]:
            if not group["confirmed"]:
                groups[group["id"]] = {"interpretation": group["interpretation"], "confirmed": True}
        if groups:
            choice["groups"] = groups
        seen = set()
        dropped = []
        for group in sheet["groups"]:
            for student in group["students"]:
                if student["name_key"] in seen and student["status"] == "absent":
                    dropped.append(student["row"])
                seen.add(student["name_key"])
        if dropped:
            choice["drop_rows"] = dropped
        if len(sheet["batches"]) > 1:
            session = sheet["batches"][0]["session_key"]
            choice["row_batches"] = {
                str(student["row"]): session
                for group in sheet["groups"]
                for student in group["students"]
            }
        if choice:
            decisions["sheets"][sheet["id"]] = choice
    return decisions


def test_all_sample_workbooks_commit_from_an_empty_catalog(client):
    bootstrap(client)
    for filename in (
        "ACCOUNTANCY  RANK LIST.xlsx",
        "LAW .xlsx",
        "ECONOMICS  RANK LIST -.xlsx",
        "QT.xlsx",
    ):
        uploaded = client.post(
            "/api/v1/imports",
            files={"file": (filename, workbook(filename), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        assert uploaded.status_code == 200, uploaded.text
        import_id = uploaded.json()["id"]
        preview = client.get(f"/api/v1/imports/{import_id}").json()
        if not preview["ready"]:
            patched = client.patch(f"/api/v1/imports/{import_id}", json=_resolve(preview))
            assert patched.status_code == 200, patched.text
            assert patched.json()["ready"] is True, patched.text
        committed = client.post(f"/api/v1/imports/{import_id}/commit")
        assert committed.status_code == 200, committed.text
    marksheets = client.get("/api/v1/marksheets").json()["items"]
    assert len(marksheets) >= 29


def test_qt_conflicts_commit_once_the_user_confirms_them(client):
    bootstrap(client)
    uploaded = client.post(
        "/api/v1/imports",
        files={"file": ("QT.xlsx", workbook("QT.xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert uploaded.status_code == 200, uploaded.text
    preview = client.get(f"/api/v1/imports/{uploaded.json()['id']}").json()
    assert preview["ready"] is False
    decisions = {"sheets": {}}
    for sheet in preview["sheets"]:
        choice = {}
        if sheet["heading_conflict"]:
            choice["acknowledge_heading"] = True
        groups = {}
        for group in sheet["groups"]:
            if not group["confirmed"]:
                groups[group["id"]] = {"interpretation": group["interpretation"], "confirmed": True}
        if groups:
            choice["groups"] = groups
        if len(sheet["batches"]) > 1:
            choice["row_batches"] = {
                str(student["row"]): sheet["batches"][0]["session_key"]
                for group in sheet["groups"]
                for student in group["students"]
            }
        if choice:
            decisions["sheets"][sheet["id"]] = choice
    patched = client.patch(f"/api/v1/imports/{uploaded.json()['id']}", json=decisions)
    assert patched.status_code == 200, patched.text
    assert patched.json()["ready"] is True
    committed = client.post(f"/api/v1/imports/{uploaded.json()['id']}/commit")
    assert committed.status_code == 200, committed.text
    titles = [item["title"] for item in client.get("/api/v1/marksheets").json()["items"]]
    assert sum("CHAPTER -2" in title and "20" not in title for title in titles) == 1
    assert any("20" in title for title in titles)


def test_selected_level_history_revision_and_catalog(client):
    bootstrap(client)
    uploaded = client.post(
        "/api/v1/imports",
        files={"file": ("ACCOUNTANCY  RANK LIST.xlsx", workbook("ACCOUNTANCY  RANK LIST.xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    import_id = uploaded.json()["id"]
    patched = client.patch(
        f"/api/v1/imports/{import_id}",
        json={"defaults": {"branch": {"mode": "new", "value": "IAM Kochi"}}},
    )
    assert patched.status_code == 200, patched.text
    preview = client.get(f"/api/v1/imports/{import_id}").json()
    assert preview["sheets"][0]["branch_name"] == "IAM Kochi"
    assert preview["totals"]["students_to_create"] > 0
    history = client.get("/api/v1/imports")
    assert history.status_code == 200
    assert history.json()["items"][0]["id"] == import_id
    assert client.post(f"/api/v1/imports/{import_id}/commit").status_code == 200
    marksheet = client.get("/api/v1/marksheets").json()["items"][0]
    detail = client.get(f"/api/v1/marksheets/{marksheet['id']}").json()
    result_id = detail["results"][0]["id"]
    saved = client.patch(
        f"/api/v1/marksheets/{marksheet['id']}/results/{result_id}",
        json={"score": 1, "edit_version": detail["edit_version"]},
    )
    assert saved.status_code == 200, saved.text
    stale = client.patch(
        f"/api/v1/marksheets/{marksheet['id']}/results/{result_id}",
        json={"score": 2, "edit_version": detail["edit_version"]},
    )
    assert stale.status_code == 409
    catalog = client.get("/api/v1/catalog").json()
    branch = next(item for item in catalog["branches"] if item["name"] == "IAM Kochi")
    archived = client.patch(f"/api/v1/catalog/branch/{branch['id']}", json={"archived": True})
    assert archived.status_code == 200
    assert client.get("/api/v1/catalog").json()["branches"]
    students = [item for item in client.get("/api/v1/catalog").json()["students"] if not item["archived"]]
    preview_merge = client.post(
        "/api/v1/students/merge-preview",
        json={"source_id": students[0]["id"], "target_id": students[1]["id"]},
    )
    assert preview_merge.status_code == 200, preview_merge.text
    refused = client.post(
        "/api/v1/students/merge",
        json={"source_id": students[0]["id"], "target_id": students[1]["id"]},
    )
    assert refused.status_code == 422
