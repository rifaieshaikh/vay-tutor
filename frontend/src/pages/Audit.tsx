import { useEffect, useState } from "react";
import { api } from "../api";

type Event = { id: string; action: string; at: string };

export function AuditPage() {
  const [items, setItems] = useState<Event[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ items: Event[] }>("/api/v1/audit")
      .then((page) => setItems(page.items))
      .catch((reason: Error) => setError(reason.message));
  }, []);

  return (
    <section className="panel">
      <p className="eyebrow">Administration</p>
      <h1>Audit</h1>
      <p>Events stay in the order they were recorded. Import, publication, correction, and export actions are listed here.</p>
      {error ? <p className="error">{error}</p> : null}
      {items.length === 0 ? <p>No audit events are visible.</p> : null}
      <ul className="people">
        {items.map((item) => (
          <li key={item.id}>
            <span>
              {item.action} · {new Date(item.at).toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
