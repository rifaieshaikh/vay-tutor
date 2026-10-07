from __future__ import annotations

from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse


class AppError(Exception):
    def __init__(self, status: int, code: str, message: str, **details: Any) -> None:
        self.status = status
        self.code = code
        self.message = message
        self.details = {key: value for key, value in details.items() if value is not None}
        super().__init__(message)


def error_body(request: Request, code: str, message: str, details: dict | None = None) -> dict:
    return {
        "error": {
            "code": code,
            "message": message,
            "details": details or {},
            "request_id": getattr(request.state, "request_id", ""),
        }
    }


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status,
        content=error_body(request, exc.code, exc.message, exc.details),
    )
