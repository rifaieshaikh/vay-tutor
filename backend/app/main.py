from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import load_settings
from app.db import connect, ensure_schema
from app.errors import AppError, app_error_handler, error_body
from app.http import router
from app.importing.routes import router as import_router
from app.jobs import process_due_jobs

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
    app.include_router(router)
    app.include_router(import_router)

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

    logging.getLogger().addFilter(_RedactFilter())
    return app


app = create_app()
