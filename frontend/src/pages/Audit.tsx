import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Icon, StudentDialog } from "./Catalog";

type Event = {
  id: string;
  action: string;
  at: string;
  actor_name?: string;
  before?: unknown;
  after?: unknown;
  context?: unknown;
  scope?: Record<string, string | null> | null;
};

const AUDIT_LABELS: Record<string, string> = {
  "catalog.correct": "Catalog change",
  "role.create": "Role added",
  "role.update": "Role changed",
  "user.create": "User added",
  "user.activate": "User activated",
  "user.deactivate": "User deactivated",
  "grant.create": "Grant added",
  "grant.delete": "Grant removed",
  "export.queue": "Export queued",
  "import.upload": "Marklist uploaded",
  "import.commit": "Marklist imported",
  "marksheet.create": "Marksheet added",
  "marksheet.publish": "Marksheet published",
  "marksheet.withdraw": "Publication withdrawn",
  "student.merge": "Students merged",
  "student.update": "Student updated",
  "policy.update": "Policy changed",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function actionLabel(action: string) {
  return AUDIT_LABELS[action] || action.replaceAll("_", " ").replaceAll(".", " ");
}

function when(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const month = MONTHS[date.getMonth()];
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const clock = `${hours % 12 || 12}:${minutes} ${hours < 12 ? "am" : "pm"}`;
  return `${date.getDate()} ${month} ${date.getFullYear()}, ${clock}`;
}

function readable(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(readable).filter(Boolean).join(", ");
  return Object.entries(value as Record<string, unknown>)
    .filter(([key, item]) => item != null && item !== "" && !key.endsWith("_id"))
    .map(([key, item]) => `${key.replaceAll("_", " ")}: ${readable(item)}`)
    .filter((item) => !item.endsWith(": "))
    .join(", ");
}

function scopeText(scope: Event["scope"]) {
  if (!scope) return "";
  const labels: [string, string][] = [
    ["branch_id", "a branch"],
    ["course_id", "a course"],
    ["batch_id", "a batch"],
    ["subject_id", "a subject"],
    ["paper_id", "a paper"],
  ];
  const parts = labels.filter(([key]) => scope[key]).map(([, label]) => label);
  return parts.length ? `Applies to ${parts.join(", ")}.` : "";
}

function changeText(item: Event) {
  const before = readable(item.before);
  const after = readable(item.after);
  const detail = [readable(item.context), scopeText(item.scope)].filter(Boolean).join(" ");
  let change = "";
  if (before && after) change = `${before} → ${after}`;
  else change = after || before;
  return { change: change || "Not recorded", detail };
}

export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") || "";
  const action = params.get("action") || "";
  const on = params.get("on") || "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [items, setItems] = useState<Event[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftQuery, setDraftQuery] = useState(query);
  const [draftAction, setDraftAction] = useState(action);
  const [draftOn, setDraftOn] = useState(on);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const active = [query ? "q" : "", action ? "action" : "", on ? "on" : ""].filter(Boolean);

  function write(next: { q?: string; action?: string; on?: string; page?: number }) {
    const paramsNext = new URLSearchParams();
    const q = next.q ?? query;
    const nextAction = next.action ?? action;
    const nextOn = next.on ?? on;
    const nextPage = next.page ?? 1;
    if (q.trim()) paramsNext.set("q", q.trim());
    if (nextAction.trim()) paramsNext.set("action", nextAction.trim());
    if (nextOn) paramsNext.set("on", nextOn);
    if (nextPage > 1) paramsNext.set("page", String(nextPage));
    setParams(paramsNext);
  }

  useEffect(() => {
    const search = new URLSearchParams({ page: String(page) });
    if (query) search.set("q", query);
    if (action) search.set("action", action);
    if (on) search.set("on", on);
    let cancelled = false;
    setLoading(true);
    api<{ items: Event[]; total: number; pages: number }>(`/api/v1/audit?${search.toString()}`)
      .then((loaded) => {
        if (cancelled) return;
        setItems(loaded.items);
        setTotal(loaded.total);
        setPages(loaded.pages);
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, action, on, page]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    write({ q: draftQuery, action: draftAction, on: draftOn, page: 1 });
    setFiltersOpen(false);
  }

  return (
    <section className="panel wide">
      <div className="page-title">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Audit</h1>
        </div>
        <div className="actions">
          {query ? <button type="button" className="chip-button" onClick={() => write({ q: "", page: 1 })}>Search: {query}</button> : null}
          {action ? <button type="button" className="chip-button" onClick={() => write({ action: "", page: 1 })}>Action: {actionLabel(action)}</button> : null}
          {on ? <button type="button" className="chip-button" onClick={() => write({ on: "", page: 1 })}>Date: {on}</button> : null}
          <div className="icon-actions">
            {active.length ? <button type="button" onClick={() => write({ q: "", action: "", on: "", page: 1 })} aria-label="Clear filters" title="Clear filters"><Icon name="clear" /></button> : null}
            <button type="button" onClick={() => { setDraftQuery(query); setDraftAction(action); setDraftOn(on); setFiltersOpen(true); }} aria-label={active.length ? `Filters, ${active.length} applied` : "Filters"} title="Filters"><Icon name="filter" /></button>
          </div>
        </div>
      </div>
      <p className="meta">These events stay as they were written.</p>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <p className="filter-row"><span>{loading ? "Loading audit…" : `${total} event${total === 1 ? "" : "s"}`}</span></p>
      {!loading && items.length === 0 ? <p>{active.length ? "No audit events match these filters." : "No audit events yet."}</p> : null}
      {items.length > 0 ? (
        <div className="table-wrap">
          <table className="people-table">
            <caption className="sr-only">Audit events.</caption>
            <thead>
              <tr>
                <th>When</th>
                <th>Person</th>
                <th>Action</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const change = changeText(item);
                return (
                  <tr key={item.id}>
                    <td className="nowrap">{when(item.at)}</td>
                    <td>{item.actor_name || "Unknown"}</td>
                    <td>{actionLabel(item.action)}</td>
                    <td>
                      {change.change}
                      {change.detail ? <p className="meta">{change.detail}</p> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {pages > 1 ? (
        <p className="pager">
          <button type="button" className="quiet" disabled={page <= 1} onClick={() => write({ page: page - 1 })}>Previous</button>
          <span>Page {page} of {pages}</span>
          <button type="button" className="quiet" disabled={page >= pages} onClick={() => write({ page: page + 1 })}>Next</button>
        </p>
      ) : null}
      {filtersOpen ? (
        <StudentDialog title="Filters" onClose={() => setFiltersOpen(false)}>
          <form className="form-grid" onSubmit={applyFilters}>
            <label className="span-2">Search
              <input value={draftQuery} aria-label="Search" placeholder="Action or person" onChange={(event) => setDraftQuery(event.target.value)} />
            </label>
            <label>Action
              <input value={draftAction} aria-label="Action" placeholder="Exact action" onChange={(event) => setDraftAction(event.target.value)} />
            </label>
            <label>Date
              <input type="date" value={draftOn} aria-label="Date" onChange={(event) => setDraftOn(event.target.value)} />
            </label>
            <div className="dialog-actions span-2">
              <button type="button" className="quiet" onClick={() => { setDraftQuery(""); setDraftAction(""); setDraftOn(""); write({ q: "", action: "", on: "", page: 1 }); setFiltersOpen(false); }}>Reset</button>
              <button type="submit">Apply</button>
            </div>
          </form>
        </StudentDialog>
      ) : null}
    </section>
  );
}
