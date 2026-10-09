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


def _shown(value) -> str:
    number = Decimal(str(value))
    if number == number.to_integral_value():
        return str(int(number))
    return format(number.normalize(), "f")


def _band_key(name: str, index: int, total: int, used: set[str]) -> str:
    folded = " ".join(name.casefold().split())
    if index == 0 and folded == "danger":
        candidate = "danger"
    elif index == total - 1 and folded == "safe":
        candidate = "safe"
    elif folded in {"fifty-fifty", "fifty fifty"} and 0 < index < total - 1:
        candidate = "fifty-fifty"
    else:
        candidate = "-".join(
            part for part in "".join(character if character.isalnum() else " " for character in folded).split()
        ) or f"band-{index + 1}"
    base = candidate
    suffix = 2
    while candidate in used:
        candidate = f"{base}-{suffix}"
        suffix += 1
    used.add(candidate)
    return candidate


def _default_band_rows() -> list[dict]:
    return [
        {"name": "Danger", "through": 40},
        {"name": "Fifty-fifty", "through": 60},
        {"name": "Safe"},
    ]


def normalize_bands(raw) -> list[dict]:
    rows = raw
    if isinstance(raw, dict):
        rows = [
            {"name": "Danger", "through": raw.get("danger_below", 40)},
            {"name": "Fifty-fifty", "through": raw.get("safe_above", 60)},
            {"name": "Safe"},
        ]
    if not isinstance(rows, list) or len(rows) < 2:
        rows = _default_band_rows()
    cleaned = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        name = " ".join(str(item.get("name") or "").split())
        if not name:
            continue
        entry = {"name": name}
        if item.get("through") is not None:
            entry["through"] = item.get("through")
        cleaned.append(entry)
    if len(cleaned) < 2 or any("through" not in item for item in cleaned[:-1]):
        cleaned = _default_band_rows()
    cleaned[-1].pop("through", None)
    used: set[str] = set()
    for index, item in enumerate(cleaned):
        item["key"] = _band_key(item["name"], index, len(cleaned), used)
    return cleaned


def band_phrase(bands: list[dict], index: int) -> str:
    if index == 0:
        return f"Below {_shown(bands[0]['through'])}%"
    previous = bands[index - 1]["through"]
    if index == len(bands) - 1:
        if len(bands) == 2:
            return f"{_shown(previous)}% and above"
        return f"Above {_shown(previous)}%"
    end = bands[index]["through"]
    if index == 1:
        return f"{_shown(previous)}% through {_shown(end)}%"
    return f"Above {_shown(previous)}% through {_shown(end)}%"


def public_bands(raw) -> list[dict]:
    bands = normalize_bands(raw)
    items = []
    for index, item in enumerate(bands):
        shown = {"key": item["key"], "name": item["name"], "phrase": band_phrase(bands, index)}
        if index < len(bands) - 1:
            shown["through"] = item["through"]
        items.append(shown)
    return items


def prepare_bands(rows: list[dict]) -> list[dict]:
    if len(rows) < 2:
        raise ValueError("Add at least two bands.")
    stored = []
    seen = set()
    previous = None
    for index, item in enumerate(rows):
        name = " ".join(str(item.get("name") or "").split())
        if not name:
            raise ValueError("Name each band.")
        if len(name) > 40:
            raise ValueError("A band name can be at most 40 characters.")
        folded = name.casefold()
        if folded in seen:
            raise ValueError("Each band needs its own name.")
        seen.add(folded)
        last = index == len(rows) - 1
        if last:
            stored.append({"name": name})
            continue
        if item.get("through") is None:
            raise ValueError(f"Choose the line for {name}.")
        number = float(item["through"])
        if number != number or number < 0 or number > 100:
            raise ValueError(f"The line for {name} must be from 0 through 100.")
        hundredths = round(number, 2)
        whole = round(hundredths)
        through = int(whole) if abs(hundredths - whole) < 1e-9 else hundredths
        if previous is not None and through <= previous:
            raise ValueError("Each line must be higher than the one before it.")
        previous = through
        stored.append({"name": name, "through": through})
    return stored


def band(value: Decimal | None, policy: dict | None = None) -> str | None:
    if value is None:
        return None
    raw = policy.get("bands") if isinstance(policy, dict) else None
    bands = normalize_bands(raw)
    number = value if isinstance(value, Decimal) else Decimal(str(value))
    if number < Decimal(str(bands[0]["through"])):
        return bands[0]["key"]
    for index in range(1, len(bands) - 1):
        if number <= Decimal(str(bands[index]["through"])):
            return bands[index]["key"]
    return bands[-1]["key"]


def band_detail(value: Decimal | None, policy: dict | None = None) -> dict:
    key = band(value, policy)
    raw = policy.get("bands") if isinstance(policy, dict) else None
    bands = normalize_bands(raw)
    if key is None:
        return {"band": None, "band_name": None, "band_place": None}
    index = next(position for position, item in enumerate(bands) if item["key"] == key)
    place = "low" if index == 0 else "high" if index == len(bands) - 1 else "middle"
    return {"band": key, "band_name": bands[index]["name"], "band_place": place}


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
    detail = band_detail(exact, policy)
    return {
        "label": (policy or {}).get("aggregate") or "maximum-marks-weighted",
        "obtained": float(obtained),
        "maximum": float(maximum),
        "percentage": display_percentage(exact),
        "band": detail["band"],
        "band_name": detail["band_name"],
        "band_place": detail["band_place"],
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
