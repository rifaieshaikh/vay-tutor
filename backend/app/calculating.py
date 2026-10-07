from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal


def percentage(score, maximum) -> Decimal | None:
    if score is None or maximum in (None, 0):
        return None
    return (Decimal(str(score)) / Decimal(str(maximum))) * Decimal(100)


def display_percentage(value: Decimal | None) -> float | None:
    if value is None:
        return None
    return float(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def band(value: Decimal | None, policy: dict | None = None) -> str | None:
    if value is None:
        return None
    bounds = (policy or {}).get("bands") or {}
    danger_below = Decimal(str(bounds.get("danger_below", 40)))
    safe_above = Decimal(str(bounds.get("safe_above", 60)))
    if value < danger_below:
        return "danger"
    if value > safe_above:
        return "safe"
    return "fifty-fifty"


def dense_ranks(rows: list[dict]) -> dict[str, int]:
    scores = sorted(
        {Decimal(str(row["score"])) for row in rows if row.get("status") == "scored" and row.get("score") is not None},
        reverse=True,
    )
    place = {score: index + 1 for index, score in enumerate(scores)}
    ranks = {}
    for row in rows:
        if row.get("status") == "scored" and row.get("score") is not None:
            ranks[row["id"]] = place[Decimal(str(row["score"]))]
    return ranks


def selected_attempts(rows: list[dict]) -> list[dict]:
    grouped: dict[tuple, list[dict]] = {}
    for row in rows:
        if row.get("counts_in_aggregate") is False:
            continue
        key = (row.get("student_id"), row.get("assessment_id") or row.get("marksheet_id") or row.get("id"))
        grouped.setdefault(key, []).append(row)
    chosen = []
    for items in grouped.values():
        dated = [item for item in items if item.get("exam_date")]
        pool = dated or items
        pool.sort(key=lambda item: (str(item.get("exam_date") or ""), item.get("revision") or 0))
        chosen.append(pool[-1])
    return chosen


def aggregate(rows: list[dict], policy: dict | None = None) -> dict:
    chosen = selected_attempts(rows)
    scored = [
        row for row in chosen
        if row.get("status") == "scored" and row.get("score") is not None and row.get("maximum")
    ]
    missing = [row for row in chosen if row.get("status") == "missing"]
    absent = [row for row in chosen if row.get("status") == "absent"]
    exempt = [row for row in chosen if row.get("status") == "exempt"]
    obtained = sum((Decimal(str(row["score"])) for row in scored), Decimal(0))
    maximum = sum((Decimal(str(row["maximum"])) for row in scored), Decimal(0))
    exact = (obtained / maximum) * Decimal(100) if maximum else None
    expected = len(scored) + len(missing) + len(absent)
    threshold = (policy or {}).get("passing_threshold")
    passing = None
    if threshold is not None and scored:
        passing = sum(1 for row in scored if (percentage(row["score"], row["maximum"]) or Decimal(0)) >= Decimal(str(threshold)))
    return {
        "label": (policy or {}).get("aggregate") or "maximum-marks-weighted",
        "obtained": float(obtained),
        "maximum": float(maximum),
        "percentage": display_percentage(exact),
        "band": band(exact, policy),
        "scored": len(scored),
        "missing": len(missing),
        "absent": len(absent),
        "exempt": len(exempt),
        "expected": expected,
        "participation": None,
        "passing": passing,
        "passing_threshold": threshold,
    }


def percentage_change(earlier, later) -> float | None:
    left = percentage(earlier.get("score"), earlier.get("maximum"))
    right = percentage(later.get("score"), later.get("maximum"))
    if left is None or right is None:
        return None
    return display_percentage(right - left)
