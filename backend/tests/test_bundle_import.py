from __future__ import annotations

from io import BytesIO
from uuid import uuid4

import pytest
from bson import ObjectId
from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.main import create_app
from app.security import name_key
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


def _workbook(sheets: list[tuple[str, list]]) -> bytes:
    workbook = Workbook()
    first = True
    for title, rows in sheets:
        sheet = workbook.active if first else workbook.create_sheet(title)
        first = False
        sheet.title = title
        sheet.append(["NAME", "MARK"])
        for row in rows:
            sheet.append(list(row))
    buffer = BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def _enroll(database, institute_id: str, batch_id: str, branch_id: str, course_id: str, display_name: str, student_id: str = "") -> str:
    student_id = student_id or str(ObjectId())
    if database.students.find_one({"_id": student_id}) is None:
        database.students.insert_one({
            "_id": student_id,
            "institute_id": institute_id,
            "display_name": display_name,
            "name_key": name_key(display_name),
            "student_code": f"IAM-{student_id[-6:]}",
        })
    database.enrollments.insert_one({
        "_id": str(ObjectId()),
        "institute_id": institute_id,
        "student_id": student_id,
        "branch_id": branch_id,
        "course_id": course_id,
        "batch_id": batch_id,
    })
    database.enrollment_names.insert_one({
        "_id": str(ObjectId()),
        "institute_id": institute_id,
        "batch_id": batch_id,
        "student_id": student_id,
        "name_key": name_key(display_name),
    })
    return student_id


def _upload(client, branch_id: str, course_id: str, batch_ids: list[str], content: bytes, name: str = "marks.xlsx") -> str:
    response = client.post(
        "/api/v1/exams/import",
        data={"branch_id": branch_id, "course_id": course_id, "batch_ids": ",".join(batch_ids)},
        files={"file": (name, content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert response.status_code == 200, response.text
    assert response.json()["duplicate"] is False
    return response.json()["id"]


def _exam(title: str, when: str, subject_id: str, kind: str = "subject", item_ids: list[str] | None = None, maximum: float = 20) -> dict:
    return {
        "title": title,
        "exam_date": when,
        "maximum": maximum,
        "subject_id": subject_id,
        "scope": {"kind": kind, "item_ids": item_ids or []},
    }


def test_bundle_import_creates_updates_and_skips(client):
    bootstrap(client)
    course_id = client.post("/api/v1/courses", json={"name": "CA Foundation"}).json()["id"]
    subject = client.post(f"/api/v1/courses/{course_id}/subjects", json={"name": "Accounting"})
    subject_id = subject.json()["id"]
    paper = client.post(f"/api/v1/subjects/{subject_id}/items", json={"name": "Journal", "kind": "paper"})
    other_paper = client.post(f"/api/v1/subjects/{subject_id}/items", json={"name": "Ledger", "kind": "paper"})
    assert paper.status_code == other_paper.status_code == 200
    branch_id = client.post("/api/v1/branches", json={"name": "North"}).json()["id"]
    assert client.post(f"/api/v1/branches/{branch_id}/courses", json={"course_id": course_id}).status_code == 200
    morning = client.post(f"/api/v1/branches/{branch_id}/batches", json={"course_id": course_id, "name": "Morning"}).json()["id"]
    evening = client.post(f"/api/v1/branches/{branch_id}/batches", json={"course_id": course_id, "name": "Evening"}).json()["id"]
    closed = client.post(f"/api/v1/branches/{branch_id}/batches", json={"course_id": course_id, "name": "Closed"}).json()["id"]
    database = sync_db(client)
    database.batches.update_one({"_id": closed}, {"$set": {"closed": True}})
    institute_id = database.institutes.find_one({})["_id"]
    risha = _enroll(database, institute_id, morning, branch_id, course_id, "Risha Fathima")
    _enroll(database, institute_id, evening, branch_id, course_id, "Risha Fathima", risha)
    students_before = database.students.count_documents({})
    enrollments_before = database.enrollments.count_documents({})
    admissions_before = database.admissions.count_documents({})

    rejected = client.post(
        "/api/v1/exams/import",
        data={"branch_id": branch_id, "course_id": course_id, "batch_ids": closed},
        files={"file": ("marks.xlsx", _workbook([("One", [["Risha Fathima", 10]])]), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert rejected.status_code == 422
    assert rejected.json()["error"]["code"] == "exam.batch"

    content = _workbook([
        ("Chapter one", [["Risha Fathima", 16], ["Unknown Student", 4]]),
        ("Chapter two", [["Risha Fathima", 11]]),
    ])
    import_id = _upload(client, branch_id, course_id, [morning, evening], content)
    listed = next(item for item in client.get("/api/v1/imports").json()["items"] if item["id"] == import_id)
    assert listed["bundle"] is True
    preview = client.get(f"/api/v1/imports/{import_id}")
    assert preview.status_code == 200, preview.text
    assert any(item["code"] == "import.exam_fields" for item in preview.json()["blockers"])
    named = client.patch(f"/api/v1/imports/{import_id}", json={"sheets": {
        "sheet-0": {"exam": _exam("Chapter one", "2026-09-01", subject_id)},
        "sheet-1": {"exam": _exam("Chapter two", "2026-09-02", subject_id)},
    }})
    assert named.status_code == 200, named.text
    preview = client.get(f"/api/v1/imports/{import_id}")
    assert any(item["code"] == "import.batch_unassigned" for item in preview.json()["blockers"]), preview.text
    rows = {
        sheet["id"]: next(student["row"] for group in sheet["groups"] for student in group["students"] if student["display_name"] == "Risha Fathima")
        for sheet in preview.json()["sheets"]
    }
    unknown_row = next(
        student["row"] for group in preview.json()["sheets"][0]["groups"] for student in group["students"]
        if student["display_name"] == "Unknown Student"
    )
    risha_row = rows["sheet-0"]
    decided = client.patch(f"/api/v1/imports/{import_id}", json={"sheets": {
        "sheet-0": {
            "exam": _exam("Chapter one", "2026-09-01", subject_id),
            "row_batch_ids": {str(rows["sheet-0"]): morning, str(unknown_row): morning},
        },
        "sheet-1": {
            "exam": _exam("Chapter two", "2026-09-02", subject_id),
            "row_batch_ids": {str(rows["sheet-1"]): evening},
        },
    }})
    assert decided.status_code == 200, decided.text
    ready = client.get(f"/api/v1/imports/{import_id}")
    assert ready.json()["ready"] is True, ready.text
    assert ready.json()["context"]["subjects"][0]["id"] == subject_id
    assert ready.json()["totals"]["planned"]["students"]["insert"] == 1
    assert ready.json()["totals"]["planned"]["enrollments"]["insert"] == 1
    unknown_plan = next(
        student for group in ready.json()["sheets"][0]["groups"] for student in group["students"]
        if student["display_name"] == "Unknown Student"
    )
    assert unknown_plan["match"] == "enroll"
    assert unknown_plan["create_student"] is True
    group_id = ready.json()["sheets"][0]["groups"][0]["id"]
    edited = client.patch(f"/api/v1/imports/{import_id}", json={"sheets": {
        "sheet-0": {"corrections": {f"{group_id}:{risha_row}": {"score": 14, "status": "scored", "action": "replace"}}},
    }})
    assert edited.status_code == 200, edited.text
    edited_preview = client.get(f"/api/v1/imports/{import_id}")
    edited_row = next(
        student for sheet in edited_preview.json()["sheets"] if sheet["id"] == "sheet-0"
        for group in sheet["groups"] for student in group["students"] if student["row"] == risha_row
    )
    assert edited_row["score"] == 14
    committed = client.post(f"/api/v1/imports/{import_id}/commit", json={"confirm_updates": True})
    assert committed.status_code == 200, committed.text
    exams = list(database.exams.find({"course_id": course_id}))
    assert len(exams) == 2
    assert all(item.get("paper_id") == "" for item in exams)
    assert database.students.count_documents({}) == students_before + 1
    assert database.enrollments.count_documents({}) == enrollments_before + 1
    assert database.admissions.count_documents({}) == admissions_before
    unknown = database.students.find_one({"name_key": name_key("Unknown Student")})
    assert unknown["display_name"] == "Unknown Student"
    assert database.enrollments.find_one({"student_id": unknown["_id"], "batch_id": morning})
    unknown_result = database.results.find_one({"student_id": unknown["_id"], "title": "Chapter one"})
    assert unknown_result["score"] == 4
    assert unknown_result["batch_id"] == morning
    stored = database.results.find_one({"title": "Chapter one", "student_id": risha})
    assert stored["score"] == 14
    assert stored["batch_id"] == morning
    second = database.results.find_one({"title": "Chapter two", "student_id": risha})
    assert second["score"] == 11
    assert second["batch_id"] == evening

    again = _upload(client, branch_id, course_id, [morning, evening], content)
    assert again != import_id
    same = client.patch(f"/api/v1/imports/{again}", json={"sheets": {
        "sheet-0": {"included": False},
        "sheet-1": {
            "exam": _exam("Chapter two", "2026-09-02", subject_id),
            "row_batch_ids": {str(rows["sheet-1"]): evening},
        },
    }})
    assert same.status_code == 200, same.text
    unchanged = client.get(f"/api/v1/imports/{again}")
    chapter_two = next(sheet for sheet in unchanged.json()["sheets"] if sheet["id"] == "sheet-1")
    assert chapter_two["matched_exam"]["id"]
    assert chapter_two["groups"][0]["students"][0]["change"] == "unchanged"
    repeat = client.post(f"/api/v1/imports/{again}/commit", json={"confirm_updates": True})
    assert repeat.status_code == 200, repeat.text
    assert database.results.find_one({"title": "Chapter two", "student_id": risha})["score"] == 11
    assert database.exams.count_documents({"course_id": course_id}) == 2

    blank = _workbook([("Chapter one", [["Risha Fathima", None]])])
    blank_id = _upload(client, branch_id, course_id, [morning, evening], blank, "blank.xlsx")
    client.patch(f"/api/v1/imports/{blank_id}", json={"sheets": {
        "sheet-0": {
            "exam": _exam("Chapter one", "2026-09-01", subject_id),
            "row_batch_ids": {str(risha_row): morning},
        },
    }})
    blank_preview = client.get(f"/api/v1/imports/{blank_id}")
    assert blank_preview.json()["ready"] is True, blank_preview.text
    assert blank_preview.json()["sheets"][0]["groups"][0]["students"][0]["change"] == "skip"
    assert client.post(f"/api/v1/imports/{blank_id}/commit", json={"confirm_updates": True}).status_code == 200
    assert database.results.find_one({"title": "Chapter one", "student_id": risha})["score"] == 14

    high = _workbook([("Chapter one", [["Risha Fathima", 25]])])
    high_id = _upload(client, branch_id, course_id, [morning, evening], high, "high.xlsx")
    client.patch(f"/api/v1/imports/{high_id}", json={"sheets": {
        "sheet-0": {
            "exam": _exam("Chapter one", "2026-09-01", subject_id),
            "row_batch_ids": {str(risha_row): morning},
        },
    }})
    high_preview = client.get(f"/api/v1/imports/{high_id}")
    assert any(item["code"] == "import.invalid_mark" for item in high_preview.json()["blockers"])
    assert client.post(f"/api/v1/imports/{high_id}/commit").status_code == 422

    papers = _workbook([("Papers", [["Risha Fathima", 15]])])
    both = _upload(client, branch_id, course_id, [morning], papers, "papers.xlsx")
    client.patch(f"/api/v1/imports/{both}", json={"sheets": {"sheet-0": {"exam": _exam(
        "Both papers", "2026-09-03", subject_id, "paper", [paper.json()["id"], other_paper.json()["id"]],
    )}}})
    assert client.post(f"/api/v1/imports/{both}/commit", json={"confirm_updates": True}).status_code == 200
    both_exam = database.exams.find_one({"title": "Both papers"})
    assert both_exam["paper_id"] == ""
    single = _upload(client, branch_id, course_id, [morning], papers, "journal.xlsx")
    client.patch(f"/api/v1/imports/{single}", json={"sheets": {"sheet-0": {"exam": _exam(
        "Journal only", "2026-09-04", subject_id, "paper", [paper.json()["id"]],
    )}}})
    assert client.post(f"/api/v1/imports/{single}/commit", json={"confirm_updates": True}).status_code == 200
    assert database.exams.find_one({"title": "Journal only"})["paper_id"] == paper.json()["id"]


def test_bundle_import_matches_existing_exams(client):
    bootstrap(client)
    course_id = client.post("/api/v1/courses", json={"name": "CA Foundation"}).json()["id"]
    subject_id = client.post(f"/api/v1/courses/{course_id}/subjects", json={"name": "Accounting"}).json()["id"]
    branch_id = client.post("/api/v1/branches", json={"name": "North"}).json()["id"]
    client.post(f"/api/v1/branches/{branch_id}/courses", json={"course_id": course_id})
    morning = client.post(f"/api/v1/branches/{branch_id}/batches", json={"course_id": course_id, "name": "Morning"}).json()["id"]
    database = sync_db(client)
    institute_id = database.institutes.find_one({})["_id"]
    risha = _enroll(database, institute_id, morning, branch_id, course_id, "Risha Fathima")
    created = client.post("/api/v1/exams", json={
        "title": "Unit test",
        "exam_date": "2026-08-01",
        "maximum": 20,
        "subject_id": subject_id,
        "scope": {"kind": "subject", "item_ids": []},
        "batch_ids": [morning],
    })
    assert created.status_code == 200, created.text
    exam_id = created.json()["id"]
    marksheet_id = created.json()["marksheet_id"]

    twin = _workbook([
        ("First", [["Risha Fathima", 16]]),
        ("Second", [["Risha Fathima", 15]]),
    ])
    twin_id = _upload(client, branch_id, course_id, [morning], twin, "twin.xlsx")
    client.patch(f"/api/v1/imports/{twin_id}", json={"sheets": {
        "sheet-0": {"exam": _exam("Unit test", "2026-09-01", subject_id)},
        "sheet-1": {"exam": _exam("Unit test", "2026-09-01", subject_id)},
    }})
    duplicate = client.get(f"/api/v1/imports/{twin_id}")
    assert any(item["code"] == "import.exam_duplicate" for item in duplicate.json()["blockers"])
    client.patch(f"/api/v1/imports/{twin_id}", json={"sheets": {"sheet-1": {"included": False}}})
    similar = client.get(f"/api/v1/imports/{twin_id}")
    assert any(item["id"] == exam_id for item in similar.json()["sheets"][0]["similar_exams"])
    adopted = client.patch(f"/api/v1/imports/{twin_id}", json={"sheets": {"sheet-0": {
        "use_exam_id": exam_id,
        "exam": _exam("Unit test", "2026-08-01", subject_id, maximum=30),
    }}})
    assert adopted.status_code == 200, adopted.text
    locked = client.get(f"/api/v1/imports/{twin_id}")
    assert locked.json()["sheets"][0]["matched_exam"]["id"] == exam_id
    seeded = client.post(f"/api/v1/imports/{twin_id}/commit", json={"confirm_updates": True})
    assert seeded.status_code == 200, seeded.text
    assert database.results.find_one({"marksheet_id": marksheet_id, "student_id": risha})["score"] == 16
    assert database.exams.find_one({"_id": exam_id})["maximum"] == 20

    changed = _workbook([("First", [["Risha Fathima", 18]])])
    changed_id = _upload(client, branch_id, course_id, [morning], changed, "changed.xlsx")
    client.patch(f"/api/v1/imports/{changed_id}", json={"sheets": {"sheet-0": {"exam": _exam("Unit test", "2026-08-01", subject_id)}}})
    draft = client.get(f"/api/v1/imports/{changed_id}")
    assert draft.json()["sheets"][0]["matched_exam"]["id"] == exam_id
    assert draft.json()["totals"]["updates"] == 1
    assert client.post(f"/api/v1/imports/{changed_id}/commit").status_code == 422
    assert client.post(f"/api/v1/imports/{changed_id}/commit", json={"confirm_updates": True}).status_code == 200
    assert database.results.find_one({"marksheet_id": marksheet_id, "student_id": risha})["score"] == 18

    database.marksheets.update_one({"_id": marksheet_id}, {"$set": {"status": "submitted"}})
    submitted_id = _upload(client, branch_id, course_id, [morning], changed, "submitted.xlsx")
    client.patch(f"/api/v1/imports/{submitted_id}", json={"sheets": {"sheet-0": {"exam": _exam("Unit test", "2026-08-01", subject_id)}}})
    submitted = client.get(f"/api/v1/imports/{submitted_id}")
    assert any(item["code"] == "import.submitted" for item in submitted.json()["blockers"])
    assert client.post(f"/api/v1/imports/{submitted_id}/commit", json={"confirm_updates": True}).status_code == 422

    database.marksheets.update_one({"_id": marksheet_id}, {"$set": {"status": "published"}})
    published_id = _upload(client, branch_id, course_id, [morning], _workbook([("First", [["Risha Fathima", 12]])]), "published.xlsx")
    client.patch(f"/api/v1/imports/{published_id}", json={"sheets": {"sheet-0": {"exam": _exam("Unit test", "2026-08-01", subject_id)}}})
    published = client.get(f"/api/v1/imports/{published_id}")
    assert any(item["code"] == "import.correction_needed" for item in published.json()["blockers"])
    row = published.json()["sheets"][0]["groups"][0]["students"][0]["row"]
    group_id = published.json()["sheets"][0]["groups"][0]["id"]
    client.patch(f"/api/v1/imports/{published_id}", json={"sheets": {"sheet-0": {"corrections": {
        f"{group_id}:{row}": {"score": 12, "status": "scored", "action": "replace", "reason": "Rechecked total"},
    }}}})
    corrected = client.get(f"/api/v1/imports/{published_id}")
    assert corrected.json()["ready"] is True, corrected.text
    assert client.post(f"/api/v1/imports/{published_id}/commit", json={"confirm_updates": True}).status_code == 200
    corrected_row = database.results.find_one({"marksheet_id": marksheet_id, "student_id": risha, "active": True})
    assert corrected_row["score"] == 12

    higher = _upload(client, branch_id, course_id, [morning], _workbook([("First", [["Risha Fathima", 10]])]), "higher.xlsx")
    client.patch(f"/api/v1/imports/{higher}", json={"sheets": {"sheet-0": {
        "use_exam_id": exam_id,
        "exam": _exam("Unit test", "2026-08-01", subject_id, maximum=40),
    }}})
    held = client.get(f"/api/v1/imports/{higher}")
    assert any(item["code"] == "import.maximum" for item in held.json()["blockers"])
    assert database.exams.find_one({"_id": exam_id})["maximum"] == 20


def test_exam_type_is_separate_from_the_subject_partition(client):
    bootstrap(client)
    listed = client.get("/api/v1/exam-types")
    assert {"test-series", "module-exam"} <= {item["key"] for item in listed.json()["items"]}
    created_type = client.post("/api/v1/exam-types", json={"label": "Class test"})
    assert created_type.status_code == 200, created_type.text
    assert created_type.json()["weight"] == 3
    weighted = client.patch(f"/api/v1/exam-types/{created_type.json()['key']}", json={"weight": 1})
    assert weighted.status_code == 200, weighted.text
    assert weighted.json()["weight"] == 1
    rejected = client.patch(f"/api/v1/exam-types/{created_type.json()['key']}", json={"weight": 0})
    assert rejected.status_code == 422
    duplicate = client.post("/api/v1/exam-types", json={"label": "Class test"})
    assert duplicate.status_code == 409
    course_id = client.post("/api/v1/courses", json={"name": "CA Foundation"}).json()["id"]
    subject_id = client.post(f"/api/v1/courses/{course_id}/subjects", json={"name": "Accounting"}).json()["id"]
    kind = client.post("/api/v1/curriculum-kinds", json={"label": "Quiz"})
    assert kind.status_code == 200, kind.text
    item = client.post(
        f"/api/v1/subjects/{subject_id}/items",
        json={"name": "Opening quiz", "kind": kind.json()["key"]},
    )
    assert item.status_code == 200, item.text
    branch_id = client.post("/api/v1/branches", json={"name": "North"}).json()["id"]
    assert client.post(f"/api/v1/branches/{branch_id}/courses", json={"course_id": course_id}).status_code == 200
    batch_id = client.post(
        f"/api/v1/branches/{branch_id}/batches", json={"course_id": course_id, "name": "Morning"}
    ).json()["id"]
    database = sync_db(client)
    institute_id = database.institutes.find_one({})["_id"]
    _enroll(database, institute_id, batch_id, branch_id, course_id, "Risha Fathima")
    import_id = _upload(
        client, branch_id, course_id, [batch_id], _workbook([("Opening", [["Risha Fathima", 8]])])
    )
    opened = client.get(f"/api/v1/imports/{import_id}")
    assert opened.status_code == 200
    assert database.exams.count_documents({"course_id": course_id}) == 0
    fields = _exam("Opening quiz", "2026-10-01", subject_id, kind.json()["key"], [item.json()["id"]])
    blank = client.patch(f"/api/v1/imports/{import_id}", json={"sheets": {"sheet-0": {"exam": {**fields, "exam_kind": ""}}}})
    assert blank.status_code == 200, blank.text
    blocked = client.get(f"/api/v1/imports/{import_id}")
    assert any("exam type" in item["message"] for item in blocked.json()["blockers"])
    patched = client.patch(f"/api/v1/imports/{import_id}", json={"sheets": {"sheet-0": {
        "exam": {**fields, "exam_kind": created_type.json()["key"]},
    }}})
    assert patched.status_code == 200, patched.text
    ready = client.get(f"/api/v1/imports/{import_id}")
    assert ready.json()["ready"] is True, ready.text
    saved = ready.json()["sheets"][0]["exam"]
    assert saved["exam_kind"] == created_type.json()["key"]
    assert saved["scope"]["kind"] == kind.json()["key"]
    assert item.json()["id"] in saved["scope"]["item_ids"]
    units = next(row["units"] for row in ready.json()["context"]["subjects"] if row["id"] == subject_id)
    assert any(unit["id"] == item.json()["id"] and unit["kind"] == kind.json()["key"] for unit in units)
    assert client.post(f"/api/v1/imports/{import_id}/commit", json={"confirm_updates": True}).status_code == 200
    exam = database.exams.find_one({"course_id": course_id})
    assert exam["exam_kind"] == created_type.json()["key"]
    assert exam["scope"]["kind"] == kind.json()["key"]
    assert exam["exam_type"] == kind.json()["key"]
    switched = client.patch(f"/api/v1/exams/{exam['_id']}", json={"exam_kind": "module-exam"})
    assert switched.status_code == 200, switched.text
    assert switched.json()["exam_kind"] == "module-exam"
    assert database.marksheets.find_one({"_id": exam["marksheet_id"]})["exam_kind"] == "module-exam"
    assert database.assessments.find_one({"_id": exam["assessment_id"]})["exam_kind"] == "module-exam"
    rejected = client.patch(f"/api/v1/exams/{exam['_id']}", json={"exam_kind": "not-a-type"})
    assert rejected.status_code == 422
    again = _upload(client, branch_id, course_id, [batch_id], _workbook([("Opening", [["Risha Fathima", 8]])]))
    replaced = client.patch(f"/api/v1/imports/{again}", json={"sheets": {"sheet-0": {
        "exam": {**fields, "exam_kind": "test-series"},
    }}})
    assert replaced.status_code == 200, replaced.text
    assert client.post(f"/api/v1/imports/{again}/commit", json={"confirm_updates": True}).status_code == 200
    assert database.exams.find_one({"_id": exam["_id"]})["exam_kind"] == "test-series"


def test_bundle_import_enrolls_a_known_student_who_is_not_in_the_batch(client):
    bootstrap(client)
    course_id = client.post("/api/v1/courses", json={"name": "CA Foundation"}).json()["id"]
    subject_id = client.post(f"/api/v1/courses/{course_id}/subjects", json={"name": "Accounting"}).json()["id"]
    branch_id = client.post("/api/v1/branches", json={"name": "North"}).json()["id"]
    assert client.post(f"/api/v1/branches/{branch_id}/courses", json={"course_id": course_id}).status_code == 200
    batch_id = client.post(
        f"/api/v1/branches/{branch_id}/batches", json={"course_id": course_id, "name": "Morning"}
    ).json()["id"]
    database = sync_db(client)
    institute_id = database.institutes.find_one({})["_id"]
    student_id = str(ObjectId())
    database.students.insert_one({
        "_id": student_id,
        "institute_id": institute_id,
        "display_name": "Neha Rahman",
        "name_key": name_key("Neha Rahman"),
        "student_code": "IAM-NEHA",
    })
    admissions_before = database.admissions.count_documents({})
    import_id = _upload(
        client, branch_id, course_id, [batch_id], _workbook([("Opening", [["Neha Rahman", 9]])])
    )
    patched = client.patch(f"/api/v1/imports/{import_id}", json={"sheets": {"sheet-0": {
        "exam": _exam("Opening", "2026-10-02", subject_id),
    }}})
    assert patched.status_code == 200, patched.text
    ready = client.get(f"/api/v1/imports/{import_id}")
    assert ready.json()["ready"] is True, ready.text
    row = ready.json()["sheets"][0]["groups"][0]["students"][0]
    assert row["match"] == "enroll"
    assert row["create_student"] is False
    assert row["student_id"] == student_id
    assert ready.json()["totals"]["planned"]["students"]["insert"] == 0
    assert ready.json()["totals"]["planned"]["enrollments"]["insert"] == 1
    assert client.post(f"/api/v1/imports/{import_id}/commit", json={"confirm_updates": True}).status_code == 200
    assert database.students.count_documents({"name_key": name_key("Neha Rahman")}) == 1
    enrollment = database.enrollments.find_one({"student_id": student_id, "batch_id": batch_id})
    assert enrollment["course_id"] == course_id
    assert database.results.find_one({"student_id": student_id})["score"] == 9
    assert database.admissions.count_documents({}) == admissions_before


def test_sheet_batches_mark_students_missing_from_the_sheet_absent(client):
    bootstrap(client)
    course_id = client.post("/api/v1/courses", json={"name": "CA Foundation"}).json()["id"]
    subject_id = client.post(f"/api/v1/courses/{course_id}/subjects", json={"name": "Accounting"}).json()["id"]
    branch_id = client.post("/api/v1/branches", json={"name": "North"}).json()["id"]
    assert client.post(f"/api/v1/branches/{branch_id}/courses", json={"course_id": course_id}).status_code == 200
    morning = client.post(f"/api/v1/branches/{branch_id}/batches", json={"course_id": course_id, "name": "Morning"}).json()["id"]
    evening = client.post(f"/api/v1/branches/{branch_id}/batches", json={"course_id": course_id, "name": "Evening"}).json()["id"]
    database = sync_db(client)
    institute_id = database.institutes.find_one({})["_id"]
    risha = _enroll(database, institute_id, morning, branch_id, course_id, "Risha Fathima")
    meera = _enroll(database, institute_id, morning, branch_id, course_id, "Meera Nair")
    nila = _enroll(database, institute_id, morning, branch_id, course_id, "Nila Thomas")
    database.enrollments.update_one({"student_id": nila, "batch_id": morning}, {"$set": {"ended_on": "2026-01-01"}})
    _enroll(database, institute_id, evening, branch_id, course_id, "Evening Only")

    uploaded = client.post(
        "/api/v1/exams/import",
        data={"branch_id": branch_id, "course_id": course_id},
        files={"file": ("marks.xlsx", _workbook([("Chapter", [["Risha Fathima", 16]])]), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert uploaded.status_code == 200, uploaded.text
    import_id = uploaded.json()["id"]
    missing_batch = client.get(f"/api/v1/imports/{import_id}")
    assert any(item["code"] == "import.batch" for item in missing_batch.json()["blockers"])
    patched = client.patch(f"/api/v1/imports/{import_id}", json={"sheets": {"sheet-0": {
        "exam": _exam("Chapter", "2026-10-01", subject_id),
        "batch_ids": [morning],
        "cover_roster": True,
    }}})
    assert patched.status_code == 200, patched.text
    ready = client.get(f"/api/v1/imports/{import_id}")
    assert ready.json()["ready"] is True, ready.text
    students = ready.json()["sheets"][0]["groups"][0]["students"]
    assert ready.json()["sheets"][0]["selected_batch_ids"] == [morning]
    meera_plan = next(item for item in students if item["display_name"] == "Meera Nair")
    assert meera_plan["roster"] is True
    assert meera_plan["status"] == "absent"
    assert meera_plan["change"] == "insert"
    assert all(item["display_name"] != "Nila Thomas" for item in students)
    assert all(item["display_name"] != "Evening Only" for item in students)
    assert client.post(f"/api/v1/imports/{import_id}/commit", json={"confirm_updates": True}).status_code == 200
    exam = database.exams.find_one({"title": "Chapter"})
    assert exam["batch_ids"] == [morning]
    assert database.results.find_one({"student_id": risha, "marksheet_id": exam["marksheet_id"]})["score"] == 16
    absent = database.results.find_one({"student_id": meera, "marksheet_id": exam["marksheet_id"]})
    assert absent["status"] == "absent"
    assert absent["score"] is None
    assert absent["batch_id"] == morning
    assert database.results.find_one({"student_id": nila}) is None
    listed = client.get(f"/api/v1/exams?batch_id={morning}")
    row = next(item for item in listed.json()["items"] if item["id"] == exam["_id"])
    assert row["attended"] == 1
    assert row["roster_total"] == 2

    blank_id = client.post(
        "/api/v1/exams/import",
        data={"branch_id": branch_id, "course_id": course_id},
        files={"file": ("blank.xlsx", _workbook([("Chapter", [["Risha Fathima", None]])]), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    ).json()["id"]
    client.patch(f"/api/v1/imports/{blank_id}", json={"sheets": {"sheet-0": {
        "exam": _exam("Chapter", "2026-10-01", subject_id),
        "batch_ids": [morning],
        "cover_roster": True,
    }}})
    blank = client.get(f"/api/v1/imports/{blank_id}")
    blank_rows = blank.json()["sheets"][0]["groups"][0]["students"]
    assert next(item for item in blank_rows if item["display_name"] == "Risha Fathima")["change"] == "skip"
    assert next(item for item in blank_rows if item["display_name"] == "Meera Nair")["change"] == "unchanged"
    assert client.post(f"/api/v1/imports/{blank_id}/commit", json={"confirm_updates": True}).status_code == 200
    assert database.results.find_one({"student_id": risha, "title": "Chapter"})["score"] == 16

    replaced_id = client.post(
        "/api/v1/exams/import",
        data={"branch_id": branch_id, "course_id": course_id},
        files={"file": ("replaced.xlsx", _workbook([("Chapter", [["Meera Nair", 15]])]), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    ).json()["id"]
    client.patch(f"/api/v1/imports/{replaced_id}", json={"sheets": {"sheet-0": {
        "exam": _exam("Chapter", "2026-10-01", subject_id),
        "batch_ids": [morning],
        "cover_roster": True,
    }}})
    replaced = client.get(f"/api/v1/imports/{replaced_id}")
    assert replaced.json()["ready"] is True, replaced.text
    replaced_rows = replaced.json()["sheets"][0]["groups"][0]["students"]
    assert next(item for item in replaced_rows if item["display_name"] == "Risha Fathima")["change"] == "update"
    assert replaced.json()["totals"]["updates"] >= 1
    assert client.post(f"/api/v1/imports/{replaced_id}/commit").status_code == 422
    assert client.post(f"/api/v1/imports/{replaced_id}/commit", json={"confirm_updates": True}).status_code == 200
    assert database.results.find_one({"student_id": risha, "marksheet_id": exam["marksheet_id"]})["status"] == "absent"
    assert database.results.find_one({"student_id": meera, "marksheet_id": exam["marksheet_id"]})["score"] == 15

    database.marksheets.update_one({"_id": exam["marksheet_id"]}, {"$set": {"status": "published", "active_revision": 1}})
    database.results.update_many({"marksheet_id": exam["marksheet_id"]}, {"$set": {"active": True}})
    dev = _enroll(database, institute_id, morning, branch_id, course_id, "Dev Kumar")
    published_id = client.post(
        "/api/v1/exams/import",
        data={"branch_id": branch_id, "course_id": course_id},
        files={"file": ("published.xlsx", _workbook([("Chapter", [["Meera Nair", 15]])]), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    ).json()["id"]
    client.patch(f"/api/v1/imports/{published_id}", json={"sheets": {"sheet-0": {
        "exam": _exam("Chapter", "2026-10-01", subject_id),
        "batch_ids": [morning],
        "cover_roster": True,
    }}})
    blocked = client.get(f"/api/v1/imports/{published_id}")
    assert any(item["code"] == "import.correction_needed" for item in blocked.json()["blockers"]), blocked.text
    client.patch(f"/api/v1/imports/{published_id}", json={"sheets": {"sheet-0": {"roster_reason": "Full roll"}}})
    opened = client.get(f"/api/v1/imports/{published_id}")
    assert opened.json()["ready"] is True, opened.text
    assert client.post(f"/api/v1/imports/{published_id}/commit", json={"confirm_updates": True}).status_code == 200
    dev_result = database.results.find_one({"student_id": dev, "marksheet_id": exam["marksheet_id"], "active": True})
    assert dev_result["status"] == "absent"
    assert dev_result["score"] is None
