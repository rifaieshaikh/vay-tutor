from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import mount_frontend


def test_the_full_installation_serves_the_frontend_beside_the_api(tmp_path):
    (tmp_path / "index.html").write_text("home", encoding="utf-8")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("bundle", encoding="utf-8")
    app = FastAPI()

    @app.get("/api/v1/health")
    def health():
        return {"api": "ok"}

    mount_frontend(app, tmp_path)
    client = TestClient(app)
    assert client.get("/").text == "home"
    assert client.get("/cards").text == "home"
    assert client.get("/assets/app.js").text == "bundle"
    assert client.get("/assets/missing.js").status_code == 404
    assert client.get("/api/v1/health").json()["api"] == "ok"
    assert client.get("/api/v1/missing").status_code == 404
    assert client.get("/api/v1/missing").json()["error"]["code"] == "not_found"
