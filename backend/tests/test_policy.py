from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.calculating import aggregate, band
from app.main import create_app
from app.reporting import present
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


def test_a_new_institute_starts_with_five_mark_bands(client):
    bootstrap(client)
    bands = client.get("/api/v1/policies/active").json()["bands"]
    assert [(item["name"], item.get("through"), item["color"]) for item in bands] == [
        ("Emerging", 40, "#d6453d"),
        ("Progressing", 60, "#e07a2f"),
        ("Developing", 75, "#e6b325"),
        ("Proficient", 90, "#8fce6a"),
        ("Outstanding", None, "#1b7f4a"),
    ]
    assert [item["phrase"] for item in bands] == [
        "Below 40%",
        "40% through 60%",
        "Above 60% through 75%",
        "Above 75% through 90%",
        "Above 90%",
    ]
    assert band(Decimal("39.99"), None) == "emerging"
    assert band(Decimal("40"), None) == "progressing"
    assert band(Decimal("60"), None) == "progressing"
    assert band(Decimal("72"), None) == "developing"
    assert band(Decimal("90"), None) == "proficient"
    assert band(Decimal("90.01"), None) == "outstanding"
    recolored = client.post(
        "/api/v1/policies",
        json={"bands": [{**item, "color": "#112233"} if item["name"] == "Emerging" else item for item in bands]},
    )
    assert recolored.status_code == 200, recolored.text
    assert recolored.json()["bands"][0]["color"] == "#112233"
    assert recolored.json()["version"] == 2


def test_saving_settings_starts_the_next_policy_version(client):
    started = bootstrap(client)
    database = sync_db(client)
    database.marksheets.insert_one(
        {
            "_id": "published-sheet",
            "institute_id": started["institute"]["id"],
            "status": "published",
            "policy_version": 1,
        }
    )
    saved = client.post(
        "/api/v1/policies",
        json={"danger_below": 35, "safe_above": 70, "passing_threshold": 50, "self_publication": True},
    )
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["version"] == 2
    assert [(item["name"], item.get("through")) for item in body["bands"]] == [
        ("Danger", 35),
        ("Fifty-fifty", 70),
        ("Safe", None),
    ]
    assert body["bands"][0]["phrase"] == "Below 35%"
    assert body["bands"][1]["phrase"] == "35% through 70%"
    assert body["bands"][2]["phrase"] == "Above 70%"
    assert body["passing_threshold"] == 50
    assert body["self_publication"] is True
    assert body["ranking"] == "dense"
    assert body["published_on_earlier_version"] == 1
    active = client.get("/api/v1/policies/active")
    assert active.json()["version"] == 2
    assert active.json()["bands"][0]["through"] == 35
    event = database.audit_events.find_one({"action": "policy.update"})
    assert event["before"]["version"] == 1
    assert event["after"]["bands"][0]["through"] == 35
    unchanged = client.post(
        "/api/v1/policies",
        json={"danger_below": 35, "safe_above": 70, "passing_threshold": 50, "self_publication": True},
    )
    assert unchanged.status_code == 422
    assert unchanged.json()["error"]["code"] == "policy.unchanged"
    inverted = client.post(
        "/api/v1/policies",
        json={"danger_below": 80, "safe_above": 40, "passing_threshold": None, "self_publication": False},
    )
    assert inverted.status_code == 422
    assert inverted.json()["error"]["code"] == "policy.bands"
    cleared = client.post(
        "/api/v1/policies",
        json={"danger_below": 35, "safe_above": 70, "passing_threshold": None, "self_publication": True},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["version"] == 3
    assert cleared.json()["passing_threshold"] is None


def test_a_marksheet_can_keep_its_own_bands(client):
    custom = [
        {"name": "Weak", "through": 30},
        {"name": "Danger", "through": 40},
        {"name": "Fifty-fifty", "through": 60},
        {"name": "Good", "through": 80},
        {"name": "Safe"},
    ]
    policy = {"bands": custom}
    assert band(Decimal("29.99"), policy) == "weak"
    assert band(Decimal("30"), policy) == "danger"
    assert band(Decimal("40"), policy) == "danger"
    assert band(Decimal("40.01"), policy) == "fifty-fifty"
    assert band(Decimal("60"), policy) == "fifty-fifty"
    assert band(Decimal("60.01"), policy) == "good"
    assert band(Decimal("80"), policy) == "good"
    assert band(Decimal("80.01"), policy) == "safe"
    started = bootstrap(client)
    database = sync_db(client)
    database.marksheets.insert_one(
        {"_id": "sheet-bands", "institute_id": started["institute"]["id"], "status": "published", "title": "Bands"}
    )
    saved = client.patch("/api/v1/marksheets/sheet-bands", json={"bands": custom})
    assert saved.status_code == 200, saved.text
    assert [item["key"] for item in saved.json()["bands"]] == ["weak", "danger", "fifty-fifty", "good", "safe"]
    own = {"id": "row", "status": "scored", "score": 25, "maximum": 100, "bands": custom}
    assert present(own, {"bands": {"danger_below": 40, "safe_above": 60}}, None, None)["band"] == "weak"
    shared = {"id": "row", "status": "scored", "score": 25, "maximum": 100}
    assert present(shared, {"bands": {"danger_below": 40, "safe_above": 60}}, None, None)["band"] == "danger"
    mixed = aggregate([
        {"id": "a", "student_id": "s", "status": "scored", "score": 50, "maximum": 100, "bands": custom},
    ])
    assert mixed["band"] == "progressing"
    cleared = client.patch("/api/v1/marksheets/sheet-bands", json={"bands": None})
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["bands"] is None
    assert client.get("/api/v1/marksheets/sheet-bands").json()["bands"] is None


def test_a_viewer_cannot_change_settings(client):
    bootstrap(client)
    created = client.post(
        "/api/v1/users",
        json={
            "name": "Viewer",
            "email": "settings-viewer@iam.test",
            "password": "correct-horse",
            "role": "viewer",
            "scope": {},
            "acknowledge_scope": True,
        },
    )
    assert created.status_code == 200, created.text
    client.post("/api/v1/auth/logout")
    signed_in = client.post(
        "/api/v1/auth/login",
        json={"email": "settings-viewer@iam.test", "password": "correct-horse"},
    )
    assert signed_in.status_code == 200
    denied = client.post(
        "/api/v1/policies",
        json={"danger_below": 30, "safe_above": 70, "passing_threshold": None, "self_publication": False},
    )
    assert denied.status_code == 403
