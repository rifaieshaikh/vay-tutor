"""In-memory pages for academic lists. A requested page is at least 1 and at most 50 rows."""

from __future__ import annotations


def page_of(rows: list, page: int, page_size: int) -> tuple[list, int, int, int]:
    size = min(max(page_size, 1), 50)
    number = max(page, 1)
    total = len(rows)
    start = (number - 1) * size
    pages = max(1, (total + size - 1) // size)
    return rows[start : start + size], total, number, pages
