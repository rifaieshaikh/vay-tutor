import { useEffect, useState } from "react";
import { api } from "../api";

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

function readable(value: unknown) {
  if (value == null) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${key}: ${item ?? "—"}`).join(", ");
}

export function AuditPage() {
  const [items, setItems] = useState<Event[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [query, setQuery] = useState("");
  const [action, setAction] = useState("");
  const [on, setOn] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page) });
    if (query) params.set("q", query);
    if (action) params.set("action", action);
    if (on) params.set("on", on);
    api<{ items: Event[]; total: number; pages: number }>(`/api/v1/audit?${params.toString()}`)
      .then((loaded) => {
        setItems(loaded.items);
        setTotal(loaded.total);
        setPages(loaded.pages);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [query, action, on, page]);

  const actions = [...new Set(items.map((item) => item.action))];

  return (
    <section className="panel wide">
      <p className="eyebrow">Administration</p>
      <h1>Audit</h1>
      <p>These events are the record of what changed. They stay as they were written.</p>
      <div className="filter-grid">
        <label>Search<input value={query} onChange={(event) => { setPage(1); setQuery(event.target.value); }} placeholder="Action or person" /></label>
        <label>Action<input value={action} onChange={(event) => { setPage(1); setAction(event.target.value); }} placeholder="Exact action" list="audit-actions" /></label>
        <datalist id="audit-actions">{actions.map((item) => <option key={item} value={item} />)}</datalist>
        <label>Date<input type="date" value={on} onChange={(event) => { setPage(1); setOn(event.target.value); }} /></label>
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <p>{total} event{total === 1 ? "" : "s"}</p>
      {items.length === 0 ? <p>No audit events match these filters.</p> : null}
      <ul className="people">
        {items.map((item) => (
          <li key={item.id}>
            <span>{item.action} · {item.actor_name || "Unknown"} · {new Date(item.at).toLocaleString()}</span>
            <span>Before: {readable(item.before)}. After: {readable(item.after)}.</span>
            {item.context ? <span>Detail: {readable(item.context)}.</span> : null}
            {item.scope ? <span>Scope: {readable(item.scope)}.</span> : null}
          </li>
        ))}
      </ul>
      <p>
        <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button>
        <button type="button" disabled={page >= pages} onClick={() => setPage((current) => current + 1)}>Next</button>
        <span> Page {page} of {pages}</span>
      </p>
    </section>
  );
}
