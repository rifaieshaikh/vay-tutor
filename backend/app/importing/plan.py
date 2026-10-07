from __future__ import annotations

from app.importing.parse import parse_batches


def apply_decisions(parsed: dict, decisions: dict, known: dict[str, list[str]]) -> dict:
    """Return a preview. `known` maps name_key to session keys already enrolled."""
    defaults = decisions.get("defaults") or {}
    sheets = []
    blockers = []
    for source in parsed["sheets"]:
        choice = (decisions.get("sheets") or {}).get(source["id"], {})
        sheet = _apply_sheet(source, choice, known, defaults)
        sheets.append(sheet)
        blockers.extend(sheet["blockers"])
    totals = _totals(sheets)
    return {"sheets": sheets, "blockers": blockers, "totals": totals, "ready": not blockers}


def _apply_sheet(source: dict, choice: dict, known: dict[str, list[str]], defaults: dict | None = None) -> dict:
    included = choice.get("included", source["included"])
    batches = source["recommended_batches"]
    if choice.get("batches"):
        batches = parse_batches(" ".join(choice["batches"])) or [
            {"session_key": item, "label": item} for item in choice["batches"]
        ]
    batches = _batch_override(choice, defaults or {}, batches)
    acknowledged = bool(choice.get("acknowledge_heading"))
    groups = []
    blockers = []
    if source["heading_conflict"] and included and not acknowledged:
        blockers.append(
            {
                "code": "import.heading_conflict",
                "sheet_id": source["id"],
                "message": f"{source['name']} heading does not match the sheet name. Acknowledge {batches[0]['label'] if batches else 'the sheet batch'}.",
            }
        )
    for group in source["groups"]:
        applied = _apply_group(
            source,
            group,
            choice.get("groups", {}).get(group["id"], {}),
            batches,
            known,
            choice.get("row_batches") or {},
            set(choice.get("drop_rows") or []),
        )
        groups.append(applied)
        if included:
            blockers.extend(applied["blockers"])
    if included and not groups:
        blockers.append({"code": "import.no_table", "sheet_id": source["id"], "message": f"{source['name']} has no mark table."})
    return {
        **{key: source[key] for key in (
            "id", "name", "position", "branch_name", "course_name", "subject_name", "paper_number",
            "series", "title", "title_key", "suggested_title", "exam_type", "format", "attempt",
            "heading_conflict", "exam_date",
        )},
        "included": included,
        "skip_reason": choice.get("skip_reason"),
        "batches": batches,
        "heading_acknowledged": acknowledged,
        "groups": groups,
        "blockers": blockers if included else [],
        "branch_name": _level(choice, defaults or {}, "branch", source["branch_name"]),
        "course_name": _level(choice, defaults or {}, "course", source["course_name"]),
        "subject_name": _level(choice, defaults or {}, "subject", source["subject_name"]),
        "paper_number": _paper_override(choice, defaults or {}, source["paper_number"]),
        "exam_type": _level(choice, defaults or {}, "exam_type", source["exam_type"]),
    }


def _level(choice: dict, defaults: dict, field: str, detected: str) -> str:
    selected = (choice.get("levels") or {}).get(field) or defaults.get(field) or {}
    if selected.get("mode") in {"new", "existing"} and selected.get("value"):
        return str(selected["value"])
    return detected


def _paper_override(choice: dict, defaults: dict, detected: int | None) -> int | None:
    value = _level(choice, defaults, "paper", "" if detected is None else str(detected))
    digits = "".join(character for character in value if character.isdigit())
    return int(digits) if digits else detected


def _batch_override(choice: dict, defaults: dict, detected: list[dict]) -> list[dict]:
    value = _level(choice, defaults, "batch", "")
    if not value or value == _batch_label(detected):
        return detected
    parsed = parse_batches(value)
    if parsed:
        return parsed
    if len(value) == 7 and value[4] == "-":
        return [{"session_key": value, "label": value}]
    return [{"session_key": value, "label": value}]


def _batch_label(batches: list[dict]) -> str:
    return ", ".join(item["label"] for item in batches)


def _apply_group(
    sheet: dict,
    group: dict,
    choice: dict,
    batches: list[dict],
    known: dict[str, list[str]],
    row_batches: dict,
    drop_rows: set,
) -> dict:
    interpretation = choice.get("interpretation", group["interpretation"])
    confirmed = bool(choice.get("confirmed", group["confirmed"]))
    if interpretation in {"skip_duplicate", "separate_assessment", "retest", "component"} and choice.get("confirmed"):
        confirmed = True
    blockers = []
    needs_confirm = group["duplicate_of"] or len(sheet["groups"]) > 1
    if needs_confirm and not confirmed:
        blockers.append(
            {
                "code": "import.score_group",
                "sheet_id": sheet["id"],
                "group_id": group["id"],
                "message": _group_message(sheet, group),
            }
        )
    sessions = [item["session_key"] for item in batches]
    students = []
    seen: dict[str, int] = {}
    for student in group["students"]:
        if student["row"] in drop_rows:
            continue
        item = dict(student)
        item["batch_session"] = _row_batch(item, sessions, known, row_batches)
        if item["name_key"] in seen and interpretation != "skip_duplicate":
            blockers.append(
                {
                    "code": "import.duplicate_row",
                    "sheet_id": sheet["id"],
                    "row": item["row"],
                    "message": f"{item['display_name']} is listed twice on {sheet['name']}.",
                }
            )
        seen[item["name_key"]] = item["row"]
        if item["status"] == "invalid":
            blockers.append(
                {
                    "code": "import.invalid_mark",
                    "sheet_id": sheet["id"],
                    "row": item["row"],
                    "column": item["column"],
                    "message": f"{item['display_name']} on {sheet['name']} row {item['row']} is outside 0 to {group['maximum']}.",
                }
            )
        if interpretation != "skip_duplicate" and len(sessions) > 1 and not item["batch_session"]:
            blockers.append(
                {
                    "code": "import.batch_unassigned",
                    "sheet_id": sheet["id"],
                    "row": item["row"],
                    "name_key": item["name_key"],
                    "message": f"Choose September 2026 or January 2027 for {item['display_name']} on {sheet['name']}.",
                }
            )
        students.append(item)
    _dense_rank(students)
    return {
        "id": group["id"],
        "column": group["column"],
        "maximum": group["maximum"],
        "interpretation": interpretation,
        "confirmed": confirmed,
        "duplicate_of": group["duplicate_of"],
        "students": students,
        "blockers": blockers,
    }


def _group_message(sheet: dict, group: dict) -> str:
    if group["duplicate_of"]:
        return (
            f"{sheet['name']} {group['maximum']}-mark group matches {group['duplicate_of']}. "
            "Skip it, or keep it as a revision if a score differs."
        )
    return f"Confirm how the extra {group['maximum']}-mark group on {sheet['name']} should be saved."


def _row_batch(student: dict, sessions: list[str], known: dict[str, list[str]], row_batches: dict) -> str | None:
    override = row_batches.get(str(student["row"])) or row_batches.get(student["row"])
    if override:
        return override
    if len(sessions) == 1:
        return sessions[0]
    if len(sessions) > 1:
        matches = [key for key in known.get(student["name_key"], []) if key in sessions]
        if len(matches) == 1:
            return matches[0]
    return None


def _dense_rank(students: list[dict]) -> None:
    scores = sorted({item["score"] for item in students if item["status"] == "scored"}, reverse=True)
    rank_of = {score: index + 1 for index, score in enumerate(scores)}
    for item in students:
        item["rank"] = rank_of.get(item["score"]) if item["status"] == "scored" else None


def _totals(sheets: list[dict]) -> dict:
    included = [sheet for sheet in sheets if sheet["included"]]
    skipped = [sheet for sheet in sheets if not sheet["included"]]
    students = 0
    for sheet in included:
        for group in sheet["groups"]:
            if group["interpretation"] == "skip_duplicate":
                continue
            students += len(group["students"])
    return {"sheets": len(sheets), "included": len(included), "skipped": len(skipped), "result_rows": students}


def variant_suggestions(parsed: dict) -> list[dict]:
    names = sorted({student["name_key"] for sheet in parsed["sheets"] for group in sheet["groups"] for student in group["students"]})
    suggestions = []
    for left in names:
        for right in names:
            if left != right and (right.startswith(left + " ") or left.startswith(right + " ")):
                pair = tuple(sorted((left, right)))
                if pair not in {(item["left"], item["right"]) for item in suggestions}:
                    suggestions.append({"left": pair[0], "right": pair[1], "action": "keep_distinct"})
    return suggestions

