"""Local encrypted backup and restore."""

from __future__ import annotations

import os
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.ops_backup import BackupError, _extract_encrypted_zip, _write_encrypted_zip, backup_status
from tests.test_m2 import bootstrap

TOOLS = Path("/tmp/vay-mongo-tools/mongodb-database-tools-macos-arm64-100.10.0/bin")
HAS_TOOLS = (TOOLS / "mongodump").is_file() and (TOOLS / "mongorestore").is_file()


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_NAME", f"vay_test_{uuid4().hex}")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("WORKER_ENABLED", "0")
    monkeypatch.setenv("DEPLOYMENT_MODE", "local")
    monkeypatch.setenv("COOKIE_SECURE", "0")
    monkeypatch.setenv("MONGO_URL", "mongodb://127.0.0.1:27017/?directConnection=true")
    if HAS_TOOLS:
        monkeypatch.setenv("MONGO_TOOLS_DIR", str(TOOLS))
    app = create_app()
    with TestClient(app) as test_client:
        yield test_client


def must(response, status=200):
    assert response.status_code == status, response.text
    return response.json() if response.content else {}


def test_encrypted_zip_rejects_wrong_passphrase(tmp_path):
    stage = tmp_path / "pack"
    stage.mkdir()
    (stage / "manifest.json").write_text('{"version": 1, "counts": {}}\n', encoding="utf-8")
    archive = tmp_path / "vay-tutor-backup.zip"
    _write_encrypted_zip(stage, archive, "correct-horse")
    with pytest.raises(BackupError) as raised:
        _extract_encrypted_zip(archive, tmp_path / "out", "wrong-horse")
    assert raised.value.code == "backup.passphrase"


def test_backup_status_empty(tmp_path):
    status = backup_status(tmp_path)
    assert status["exists"] is False
    assert status["path"] is None
    assert "folder" in (status.get("hint") or "").lower()


def test_ops_backup_requires_admin(client):
    bootstrap(client)
    must(client.post("/api/v1/users", json={
        "name": "Viewer",
        "email": "viewer@backup.test",
        "password": "correct-horse",
        "role": "viewer",
        "scope": {},
        "acknowledge_scope": True,
    }))
    client.post("/api/v1/auth/logout")
    must(client.post("/api/v1/auth/login", json={"email": "viewer@backup.test", "password": "correct-horse"}))
    assert client.get("/api/v1/ops/backup").status_code in {403, 404}
    assert client.post("/api/v1/ops/backups", json={
        "passphrase": "correct-horse",
        "passphrase_confirm": "correct-horse",
    }).status_code in {403, 404}


def test_ops_backup_passphrase_mismatch(client):
    bootstrap(client)
    response = client.post("/api/v1/ops/backups", json={
        "passphrase": "correct-horse",
        "passphrase_confirm": "other-horse",
    })
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "backup.passphrase"


def test_ops_restore_requires_confirm(client):
    bootstrap(client)
    response = client.post(
        "/api/v1/ops/restores",
        data={"passphrase": "correct-horse", "confirm": "NO"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "backup.confirm"


@pytest.mark.skipif(not HAS_TOOLS, reason="MongoDB Database Tools are not available")
def test_backup_restore_round_trip(client, tmp_path, monkeypatch):
    monkeypatch.setenv("MONGO_TOOLS_DIR", str(TOOLS))
    created = bootstrap(client)
    data_dir = Path(os.environ["DATA_DIR"])
    (data_dir / "files").mkdir(parents=True, exist_ok=True)
    sample = data_dir / "files" / "note.txt"
    sample.write_text("keep-me", encoding="utf-8")

    status = must(client.get("/api/v1/ops/backup"))
    assert status["exists"] is False

    created_backup = client.post("/api/v1/ops/backups", json={
        "passphrase": "correct-horse",
        "passphrase_confirm": "correct-horse",
    })
    assert created_backup.status_code == 200, created_backup.text
    assert created_backup.headers.get("content-type", "").startswith("application/zip")
    archive_bytes = created_backup.content
    assert len(archive_bytes) > 100

    must(client.post("/api/v1/users", json={
        "name": "After Backup",
        "email": "after@backup.test",
        "password": "correct-horse",
        "role": "viewer",
        "scope": {},
        "acknowledge_scope": True,
    }))
    assert any(item["email"] == "after@backup.test" for item in must(client.get("/api/v1/users"))["items"])

    restored = client.post(
        "/api/v1/ops/restores",
        data={"passphrase": "correct-horse", "confirm": "RESTORE"},
        files={"archive": ("vay-tutor-backup.zip", archive_bytes, "application/zip")},
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["ok"] is True

    # Sessions were cleared; sign in again with the pre-backup admin.
    login = client.post("/api/v1/auth/login", json={"email": "admin@iam.test", "password": "correct-horse"})
    assert login.status_code == 200, login.text
    users = must(client.get("/api/v1/users"))["items"]
    assert all(item["email"] != "after@backup.test" for item in users)
    assert sample.read_text(encoding="utf-8") == "keep-me"
    assert created["recovery_codes"]
