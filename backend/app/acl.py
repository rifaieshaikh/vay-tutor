from __future__ import annotations

from typing import Any

SCOPE_FIELDS = (
    "institute_id",
    "branch_id",
    "course_id",
    "batch_id",
    "subject_id",
    "paper_id",
)

ACTIONS = (
    "dashboard.view",
    "student.lookup",
    "student.manage",
    "marksheet.view",
    "marksheet.upload",
    "marksheet.edit_draft",
    "marksheet.submit",
    "marksheet.publish",
    "marksheet.correct",
    "marksheet.withdraw",
    "import.create_scope",
    "progress_card.view",
    "export.pdf",
    "export.xlsx",
    "catalog.correct",
    "catalog.manage",
    "user.manage",
    "grant.manage",
    "audit.view",
    "backup.admin",
)

ROLE_TEMPLATES: dict[str, tuple[str, ...]] = {
    "institute_admin": ACTIONS,
    "branch_admin": (
        "dashboard.view",
        "student.lookup",
        "student.manage",
        "marksheet.view",
        "marksheet.upload",
        "marksheet.edit_draft",
        "marksheet.submit",
        "marksheet.publish",
        "marksheet.correct",
        "marksheet.withdraw",
        "import.create_scope",
        "progress_card.view",
        "export.pdf",
        "export.xlsx",
        "catalog.correct",
        "catalog.manage",
        "audit.view",
    ),
    "academic_coordinator": (
        "dashboard.view",
        "student.lookup",
        "marksheet.view",
        "marksheet.upload",
        "marksheet.edit_draft",
        "marksheet.submit",
        "marksheet.publish",
        "marksheet.correct",
        "marksheet.withdraw",
        "progress_card.view",
        "catalog.correct",
    ),
    "teacher": (
        "dashboard.view",
        "student.lookup",
        "marksheet.view",
        "marksheet.upload",
        "marksheet.edit_draft",
        "marksheet.submit",
        "progress_card.view",
    ),
    "viewer": (
        "dashboard.view",
        "student.lookup",
        "marksheet.view",
        "progress_card.view",
    ),
}

CREATE_ACTION = {
    "branch": "import.create_scope",
    "course": "import.create_scope",
    "subject": "import.create_scope",
    "batch": "marksheet.upload",
    "paper": "marksheet.upload",
    "assessment": "marksheet.upload",
    "attempt": "marksheet.upload",
    "student": "marksheet.upload",
    "enrollment": "marksheet.upload",
}


def clean_scope(raw: dict[str, Any] | None, institute_id: str) -> dict[str, str | None]:
    raw = raw or {}
    scope: dict[str, str | None] = {"institute_id": institute_id}
    for field in SCOPE_FIELDS:
        if field == "institute_id":
            continue
        value = raw.get(field)
        scope[field] = str(value) if value else None
    return scope


def describe_scope(scope: dict[str, str | None]) -> str:
    labels = {
        "branch_id": "branches",
        "course_id": "courses",
        "batch_id": "batches",
        "subject_id": "subjects",
        "paper_id": "papers",
    }
    open_dims = [label for field, label in labels.items() if not scope.get(field)]
    if not open_dims:
        return "Applies only to the selected branch, course, batch, subject, and paper."
    return "Also includes all " + ", ".join(open_dims) + " inside the selected parents."


def scope_covers(actor_scope: dict, target_scope: dict, resource_fields_only: bool = False) -> bool:
    for field in SCOPE_FIELDS:
        actor_value = actor_scope.get(field)
        target_value = target_scope.get(field)
        if not actor_value:
            continue
        if not target_value:
            if resource_fields_only:
                continue
            return False
        if actor_value != target_value:
            return False
    return True


def grant_matches(
    grant: dict, action: str, resource: dict, resource_fields_only: bool = False
) -> bool:
    if action not in grant.get("actions", []):
        return False
    return scope_covers(grant.get("scope", {}), resource, resource_fields_only)


def allows(
    grants: list[dict], action: str, resource: dict, resource_fields_only: bool = False
) -> bool:
    return any(grant_matches(grant, action, resource, resource_fields_only) for grant in grants)


def actions_for(grants: list[dict]) -> list[str]:
    found = {action for grant in grants for action in grant.get("actions", [])}
    return [action for action in ACTIONS if action in found]


def mongo_clause(grants: list[dict], action: str, field_map: dict[str, str]) -> dict:
    clauses = []
    for grant in grants:
        if action not in grant.get("actions", []):
            continue
        clause = {}
        scope = grant.get("scope", {})
        for scope_field, document_field in field_map.items():
            if scope.get(scope_field):
                clause[document_field] = scope[scope_field]
        clauses.append(clause)
    if not clauses:
        return {"_id": {"$exists": False}}
    return {"$or": clauses}


def contained_actions(grants: list[dict], scope: dict) -> set[str]:
    found: set[str] = set()
    for grant in grants:
        if scope_covers(grant.get("scope", {}), scope):
            found.update(grant.get("actions", []))
    return found
