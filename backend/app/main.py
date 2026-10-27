from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from app.academics.catalog import router as catalog_router
from app.academics.curriculum import router as curriculum_router
from app.academics.questions import router as question_router
from app.administration.routes import router as administration_router
from app.admissions.routes import router as admissions_router
from app.assessments.exams import router as exam_router
from app.assessments.review import router as review_router
from app.assessments.routes import router as assessment_router
from app.config import load_settings
from app.dashboard.routes import router as dashboard_router
from app.db import configure_mongo, connect, ensure_schema
from app.errors import AppError, app_error_handler, error_body
from app.jobs import process_due_jobs
from app.reports.routes import router as reports_router
from app.staff.routes import router as staff_router
from app.students.directory_routes import router as student_directory_router
from app.students.routes import router as student_router

log = logging.getLogger("vay")


class _RedactFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        text = record.getMessage().lower()
        if any(word in text for word in ("password", "recovery", "totp", "cookie", "secret")):
            record.msg = "redacted sensitive log"
            record.args = ()
        return True


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = app.state.settings
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    client, database = connect(settings)
    app.state.client = client
    app.state.db = database
    await configure_mongo(client, settings)
    await ensure_schema(database)
    stop = asyncio.Event()
    worker = None
    if settings.worker_enabled:

        async def loop() -> None:
            while not stop.is_set():
                try:
                    count = await process_due_jobs(database, settings.data_dir)
                except Exception:
                    log.exception("job worker failed")
                    count = 0
                if count == 0:
                    try:
                        await asyncio.wait_for(stop.wait(), timeout=1)
                    except asyncio.TimeoutError:
                        pass

        worker = asyncio.create_task(loop())
    yield
    stop.set()
    if worker is not None:
        await worker
    client.close()


def mount_frontend(app: FastAPI, directory: Path) -> None:
    """Serve the built institute UI from the same origin as the API."""
    root = directory.resolve()

    def page(full_path: str):
        if full_path == "api" or full_path.startswith("api/"):
            return JSONResponse(
                status_code=404,
                content={"error": {"code": "not_found", "message": "That record was not found."}},
            )
        candidate = (root / full_path).resolve() if full_path else root / "index.html"
        inside = candidate == root or root in candidate.parents
        if inside and candidate.is_file():
            return FileResponse(candidate)
        if full_path and Path(full_path).suffix:
            return JSONResponse(
                status_code=404,
                content={"error": {"code": "not_found", "message": "That record was not found."}},
            )
        index = root / "index.html"
        if index.is_file():
            return FileResponse(index)
        return JSONResponse(
            status_code=404,
            content={"error": {"code": "not_found", "message": "That record was not found."}},
        )

    @app.get("/", include_in_schema=False)
    async def frontend_index():
        return page("")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def frontend_page(full_path: str):
        return page(full_path)


def create_app() -> FastAPI:
    settings = load_settings()
    app = FastAPI(title="Vay Tutor", version=settings.server_version, lifespan=lifespan)
    app.state.settings = settings
    app.add_exception_handler(AppError, app_error_handler)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(administration_router)
    app.include_router(staff_router)
    app.include_router(dashboard_router)
    app.include_router(catalog_router)
    app.include_router(curriculum_router)
    app.include_router(question_router)
    app.include_router(admissions_router)
    app.include_router(student_directory_router)
    app.include_router(student_router)
    app.include_router(assessment_router)
    app.include_router(exam_router)
    app.include_router(review_router)
    app.include_router(reports_router)

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request.state.request_id = uuid4().hex
        client_version = request.headers.get("x-client-version")
        if (
            client_version
            and not client_version.startswith("1.")
            and request.url.path not in {"/api/v1/health", "/api/v1/compatibility"}
        ):
            response = JSONResponse(
                status_code=426,
                content=error_body(
                    request,
                    "client.upgrade_required",
                    "This client cannot use this server. Install a compatible version.",
                ),
            )
        else:
            response = await call_next(request)
        response.headers["X-Api-Version"] = settings.api_version
        response.headers["X-Server-Version"] = settings.server_version
        response.headers["X-Request-Id"] = request.state.request_id
        return response

    static_dir = os.environ.get("STATIC_DIR")
    if static_dir:
        mount_frontend(app, Path(static_dir))
    logging.getLogger().addFilter(_RedactFilter())
    return app


app = create_app()
