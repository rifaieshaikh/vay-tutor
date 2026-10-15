"""Compatibility imports. Domain routers own the HTTP routes."""

from app.context import _restrict_batches, resolve_academic
from app.deps import current_user, db, institute_resource, new_id, require, write_audit

__all__ = [
    "_restrict_batches",
    "current_user",
    "db",
    "institute_resource",
    "new_id",
    "require",
    "resolve_academic",
    "write_audit",
]
