import { FormEvent, useEffect } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import { periodLabel } from "../context";

export const PAGE_SIZE = 8;

export function intakeLabel(sessionKey?: string | null) {
  if (!sessionKey || !/^\d{4}-\d{2}$/.test(sessionKey)) return "Not recorded";
  return periodLabel(sessionKey);
}

export function batchState(row: { archived?: boolean; closed?: boolean }) {
  if (row.archived && row.closed) return "Archived, closed";
  if (row.archived) return "Archived";
  if (row.closed) return "Closed";
  return "Current";
}

export function pageOf<T>(rows: T[], page: number, size = PAGE_SIZE) {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size) || 1);
  const current = total === 0 ? 1 : Math.min(Math.max(1, page), pages);
  const start = (current - 1) * size;
  const items = rows.slice(start, start + size);
  return {
    items,
    total,
    page: current,
    pages,
    from: total ? start + 1 : 0,
    to: Math.min(total, start + items.length),
  };
}

export function compareText(left: string, right: string, direction: "asc" | "desc") {
  const value = left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
  return direction === "desc" ? -value : value;
}

export function compareOptional(left?: string | null, right?: string | null, direction: "asc" | "desc" = "asc") {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  const value = left < right ? -1 : left > right ? 1 : 0;
  return direction === "desc" ? -value : value;
}

export function sortParts(token: string) {
  if (token.endsWith("_desc")) return { field: token.slice(0, -5), direction: "desc" as const };
  return { field: token, direction: "asc" as const };
}

export function toggleSort(current: string, field: string) {
  const parsed = sortParts(current);
  if (parsed.field === field && parsed.direction === "asc") return `${field}_desc`;
  return field;
}

export function usePageClamp(requested: number, current: number, params: URLSearchParams, setParams: SetURLSearchParams) {
  useEffect(() => {
    if (requested === current) return;
    const next = new URLSearchParams(params);
    putParam(next, "page", current <= 1 ? "" : String(current));
    setParams(next, { replace: true });
  }, [requested, current, params, setParams]);
}

export function readChoice(params: URLSearchParams, key: string, allowed: readonly string[]) {
  const value = params.get(key) || "";
  return allowed.includes(value) ? value : "";
}

export function putParam(params: URLSearchParams, key: string, value: string) {
  if (value) params.set(key, value);
  else params.delete(key);
}

export function ListToolbar({
  searchLabel,
  placeholder,
  query,
  onQuery,
  onSearch,
  sort,
  sortOptions,
  onSort,
  onOpenFilters,
  summary,
  chips,
  onRemove,
  onClear,
  filtered,
}: {
  searchLabel: string;
  placeholder?: string;
  query: string;
  onQuery: (value: string) => void;
  onSearch: () => void;
  sort: string;
  sortOptions: readonly (readonly [string, string])[];
  onSort: (value: string) => void;
  onOpenFilters: () => void;
  summary: string;
  chips: { key: string; label: string }[];
  onRemove: (key: string) => void;
  onClear: () => void;
  filtered: boolean;
}) {
  function submit(event: FormEvent) {
    event.preventDefault();
    onSearch();
  }
  const selected = sortOptions.some(([value]) => value === sort) ? sort : sortOptions[0][0];
  return (
    <>
      <form className="toolbar" onSubmit={submit}>
        <label>Search
          <input value={query} aria-label={searchLabel} placeholder={placeholder} onChange={(event) => onQuery(event.target.value)} />
        </label>
        <label>Sort
          <select aria-label="Sort" value={selected} onChange={(event) => onSort(event.target.value)}>
            {sortOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <button type="button" className="secondary" onClick={onOpenFilters}>Filters</button>
      </form>
      <p className="filter-row">
        <span role="status">{summary}</span>
        {chips.map((chip) => (
          <button key={chip.key} type="button" className="chip-button" onClick={() => onRemove(chip.key)}>{chip.label}</button>
        ))}
        {filtered ? <button type="button" className="quiet" onClick={onClear}>Clear filters</button> : null}
      </p>
    </>
  );
}

export function FilterActions({ onReset, onClose }: { onReset: () => void; onClose: () => void }) {
  return (
    <div className="dialog-actions span-2">
      <button type="button" className="quiet" onClick={onReset}>Reset</button>
      <button type="button" className="secondary" onClick={onClose}>Cancel</button>
      <button type="submit">Apply</button>
    </div>
  );
}

export function Pager({
  from,
  to,
  total,
  page,
  pages,
  onPage,
}: {
  from: number;
  to: number;
  total: number;
  page: number;
  pages: number;
  onPage: (page: number) => void;
}) {
  if (total === 0) return null;
  return (
    <p className="pager">
      <button type="button" className="quiet" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <span>{from}–{to} of {total}</span>
      <button type="button" className="quiet" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </p>
  );
}

export function SortHeader({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <th aria-sort={active ? (direction === "desc" ? "descending" : "ascending") : "none"}>
      <button type="button" className="sort" onClick={onClick}>{label}</button>
    </th>
  );
}

export function TruncationNote({ truncated }: { truncated?: boolean }) {
  if (!truncated) return null;
  return <p role="status">This directory is showing the first 5,000 records in a list. Narrow the search if a record is missing.</p>;
}
