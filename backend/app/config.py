import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    mongo_url: str
    db_name: str
    data_dir: Path
    deployment_mode: str
    cookie_secure: bool
    worker_enabled: bool
    server_version: str = "0.2.0"
    api_version: str = "1"


def load_settings() -> Settings:
    mode = os.environ.get("DEPLOYMENT_MODE", "local")
    if mode not in {"local", "cloud"}:
        raise RuntimeError("DEPLOYMENT_MODE must be local or cloud.")
    root = Path(__file__).resolve().parents[2]
    data_dir = Path(os.environ.get("DATA_DIR", root / "backend" / "data"))
    secure_default = "1" if mode == "cloud" else "0"
    return Settings(
        mongo_url=os.environ.get("MONGO_URL", "mongodb://127.0.0.1:27017/?replicaSet=rs0"),
        db_name=os.environ.get("DB_NAME", "vay_tutor"),
        data_dir=data_dir,
        deployment_mode=mode,
        cookie_secure=os.environ.get("COOKIE_SECURE", secure_default) == "1",
        worker_enabled=os.environ.get("WORKER_ENABLED", "1") == "1",
    )
