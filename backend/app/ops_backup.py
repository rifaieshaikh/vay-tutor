"""Local encrypted institute backup and restore."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pymongo import MongoClient

BACKUP_FILENAME = "vay-tutor-backup.zip"
MANIFEST_NAME = "manifest.json"
SERVER_VERSION = "1.0.0"


class BackupError(Exception):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


def backup_dir(data_dir: Path) -> Path:
    path = Path(data_dir) / "backups"
    path.mkdir(parents=True, exist_ok=True)
    return path


def default_backup_path(data_dir: Path) -> Path:
    return backup_dir(data_dir) / BACKUP_FILENAME


def backup_status(data_dir: Path) -> dict[str, Any]:
    path = default_backup_path(data_dir)
    if not path.is_file():
        return {"exists": False, "path": str(path), "size": 0, "modified_at": None}
    stat = path.stat()
    return {
        "exists": True,
        "path": str(path),
        "size": stat.st_size,
        "modified_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
    }


def _tool(name: str) -> str:
    tools = os.environ.get("MONGO_TOOLS_DIR", "").strip()
    suffix = ".exe" if os.name == "nt" and not name.endswith(".exe") else ""
    binary = f"{name}{suffix}"
    if tools:
        candidate = Path(tools) / binary
        if candidate.is_file():
            return str(candidate)
    found = shutil.which(binary) or shutil.which(name)
    if found:
        return found
    raise BackupError(
        "backup.tools",
        f"{name} was not found. Install MongoDB Database Tools or set MONGO_TOOLS_DIR.",
    )


def _run(command: list[str], *, label: str) -> None:
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise BackupError("backup.tool_failed", f"{label} failed{' — ' + detail if detail else '.'}")


def _mongo_settings() -> tuple[str, str]:
    return (
        os.environ.get("MONGO_URL", "mongodb://127.0.0.1:27017/?directConnection=true"),
        os.environ.get("DB_NAME", "vay_tutor"),
    )


def _collection_counts(mongo_url: str, db_name: str) -> dict[str, int]:
    client = MongoClient(mongo_url, serverSelectionTimeoutMS=5000)
    try:
        database = client[db_name]
        counts: dict[str, int] = {}
        for name in sorted(database.list_collection_names()):
            if name.startswith("system."):
                continue
            counts[name] = database[name].estimated_document_count()
        return counts
    finally:
        client.close()


def _clear_sessions(mongo_url: str, db_name: str) -> None:
    client = MongoClient(mongo_url, serverSelectionTimeoutMS=5000)
    try:
        client[db_name].sessions.delete_many({})
    finally:
        client.close()


def leased_writer_jobs(mongo_url: str, db_name: str) -> bool:
    client = MongoClient(mongo_url, serverSelectionTimeoutMS=5000)
    try:
        now = datetime.now(timezone.utc)
        found = client[db_name].jobs.find_one(
            {
                "state": "leased",
                "kind": {"$in": ["import_discover", "import_commit", "report_pdf", "report_xlsx", "backup", "restore"]},
                "lease_until": {"$gt": now},
            }
        )
        return found is not None
    finally:
        client.close()


def _copy_tree(source: Path, destination: Path) -> None:
    if destination.exists():
        shutil.rmtree(destination)
    if not source.exists():
        destination.mkdir(parents=True, exist_ok=True)
        return
    shutil.copytree(source, destination)


def _write_encrypted_zip(source_dir: Path, destination: Path, passphrase: str) -> None:
    import pyzipper

    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix="vay-backup-", suffix=".zip", dir=str(destination.parent))
    os.close(fd)
    temp_path = Path(temp_name)
    try:
        with pyzipper.AESZipFile(
            temp_path,
            "w",
            compression=pyzipper.ZIP_DEFLATED,
            encryption=pyzipper.WZ_AES,
        ) as archive:
            archive.setpassword(passphrase.encode("utf-8"))
            for path in sorted(source_dir.rglob("*")):
                if path.is_file():
                    archive.write(path, path.relative_to(source_dir).as_posix())
        temp_path.replace(destination)
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise


def _extract_encrypted_zip(archive_path: Path, destination: Path, passphrase: str) -> None:
    import pyzipper

    destination.mkdir(parents=True, exist_ok=True)
    try:
        with pyzipper.AESZipFile(archive_path, "r") as archive:
            archive.setpassword(passphrase.encode("utf-8"))
            archive.extractall(destination)
    except RuntimeError as exc:
        raise BackupError("backup.passphrase", "The backup key is not correct.") from exc
    except Exception as exc:
        message = str(exc).lower()
        if "password" in message or "bad decrypt" in message or "file is encrypted" in message:
            raise BackupError("backup.passphrase", "The backup key is not correct.") from exc
        raise BackupError("backup.corrupt", "That backup file could not be opened.") from exc


def create_backup(
    *,
    data_dir: Path,
    passphrase: str,
    mongo_url: str | None = None,
    db_name: str | None = None,
    destination: Path | None = None,
) -> dict[str, Any]:
    if len(passphrase) < 8:
        raise BackupError("backup.passphrase", "Use at least 8 characters for the backup key.")
    url, name = mongo_url or _mongo_settings()[0], db_name or _mongo_settings()[1]
    data_dir = Path(data_dir)
    target = Path(destination) if destination else default_backup_path(data_dir)
    dump_bin = _tool("mongodump")
    with tempfile.TemporaryDirectory(prefix="vay-backup-stage-") as raw:
        stage = Path(raw)
        mongo_out = stage / "mongo"
        mongo_out.mkdir(parents=True, exist_ok=True)
        _run(
            [dump_bin, f"--uri={url}", f"--db={name}", f"--out={mongo_out}"],
            label="mongodump",
        )
        dumped = mongo_out / name
        if not dumped.exists():
            raise BackupError("backup.empty", "mongodump did not produce database files.")
        _copy_tree(data_dir / "files", stage / "files")
        counts = _collection_counts(url, name)
        manifest = {
            "version": 1,
            "server_version": SERVER_VERSION,
            "db_name": name,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "counts": counts,
        }
        (stage / MANIFEST_NAME).write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        # Repack so mongo/ holds the database folder contents expected by mongorestore.
        pack = stage / "pack"
        pack.mkdir()
        shutil.move(str(dumped), str(pack / "mongo"))
        shutil.move(str(stage / "files"), str(pack / "files"))
        shutil.move(str(stage / MANIFEST_NAME), str(pack / MANIFEST_NAME))
        _write_encrypted_zip(pack, target, passphrase)
    status = backup_status(data_dir) if target == default_backup_path(data_dir) else {
        "exists": True,
        "path": str(target),
        "size": target.stat().st_size,
        "modified_at": datetime.now(timezone.utc).isoformat(),
    }
    status["counts"] = counts
    return status


def restore_backup(
    *,
    data_dir: Path,
    passphrase: str,
    archive: Path | None = None,
    mongo_url: str | None = None,
    db_name: str | None = None,
    clear_sessions: bool = True,
) -> dict[str, Any]:
    if not passphrase:
        raise BackupError("backup.passphrase", "Enter the backup key.")
    url, name = mongo_url or _mongo_settings()[0], db_name or _mongo_settings()[1]
    data_dir = Path(data_dir)
    archive_path = Path(archive) if archive else default_backup_path(data_dir)
    if not archive_path.is_file():
        raise BackupError("backup.missing", "That backup file was not found.")
    if leased_writer_jobs(url, name):
        raise BackupError(
            "backup.busy",
            "A write job is still running. Wait for imports and exports to finish, then restore.",
        )
    restore_bin = _tool("mongorestore")
    with tempfile.TemporaryDirectory(prefix="vay-restore-stage-") as raw:
        stage = Path(raw)
        _extract_encrypted_zip(archive_path, stage, passphrase)
        manifest_path = stage / MANIFEST_NAME
        mongo_path = stage / "mongo"
        files_path = stage / "files"
        if not manifest_path.is_file() or not mongo_path.is_dir():
            raise BackupError("backup.corrupt", "That backup file is missing required contents.")
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise BackupError("backup.corrupt", "That backup file has a damaged manifest.") from exc
        expected = manifest.get("counts") or {}
        dump_root = mongo_path / name if (mongo_path / name).is_dir() else mongo_path
        if not any(dump_root.glob("*.bson")):
            raise BackupError("backup.corrupt", "That backup file has no database dump.")
        _run(
            [
                restore_bin,
                f"--uri={url}",
                f"--db={name}",
                "--drop",
                str(dump_root),
            ],
            label="mongorestore",
        )
        files_target = data_dir / "files"
        if files_path.is_dir():
            _copy_tree(files_path, files_target)
        else:
            if files_target.exists():
                shutil.rmtree(files_target)
            files_target.mkdir(parents=True, exist_ok=True)
        actual = _collection_counts(url, name)
        for collection, count in expected.items():
            if actual.get(collection, 0) != count:
                found = actual.get(collection, 0)
                raise BackupError(
                    "backup.verify",
                    f"Restore counts did not match for {collection} (expected {count}, found {found}).",
                )
        if clear_sessions:
            _clear_sessions(url, name)
        return {"ok": True, "counts": actual, "manifest": manifest}


def cli(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Vay Tutor local encrypted backup")
    parser.add_argument("action", choices=["create", "restore"])
    parser.add_argument("--data-dir", default=os.environ.get("DATA_DIR", ""))
    parser.add_argument("--passphrase-file", required=True)
    parser.add_argument("--archive", default="")
    args = parser.parse_args(argv)
    if not args.data_dir:
        raise SystemExit("DATA_DIR or --data-dir is required.")
    passphrase = Path(args.passphrase_file).read_text(encoding="utf-8").rstrip("\n")
    try:
        if args.action == "create":
            result = create_backup(data_dir=Path(args.data_dir), passphrase=passphrase)
        else:
            archive = Path(args.archive) if args.archive else None
            result = restore_backup(data_dir=Path(args.data_dir), passphrase=passphrase, archive=archive)
        print(json.dumps(result))
        return 0
    except BackupError as exc:
        print(json.dumps({"error": {"code": exc.code, "message": exc.message}}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(cli())
