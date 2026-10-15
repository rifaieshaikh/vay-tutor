import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { CONTEXT_KEYS } from "../context";

type Queue = { key: string; count: number; label: string; detail: string; href: string };
type Dashboard = { context: Record<string, string>; dropped: string[]; items: Queue[] };

export function OverviewPage() {
  const [params] = useSearchParams();
  const [board, setBoard] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const key = CONTEXT_KEYS.map((name) => params.get(name) || "").join("|");

  useEffect(() => {
    const search = new URLSearchParams();
    for (const name of CONTEXT_KEYS) {
      const value = params.get(name);
      if (value) search.set(name, value);
    }
    let cancelled = false;
    setLoading(true);
    api<Dashboard>(`/api/v1/dashboard?${search.toString()}`)
      .then((result) => {
        if (!cancelled) {
          setBoard(result);
          setError("");
        }
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
  }, [key, params]);

  const items = board?.items || [];
  const waiting = items.reduce((sum, item) => sum + item.count, 0);

  return (
    <section className="panel wide">
      <p className="eyebrow">Dashboard</p>
      <h1>Pending work</h1>
      {loading ? <p>Loading the dashboard…</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {!loading && !error && items.length === 0 ? <p>Nothing on this dashboard is assigned to you.</p> : null}
      {!loading && !error && items.length > 0 && waiting === 0 ? <p>Nothing is waiting on you.</p> : null}
      {!loading && !error && board && board.dropped.length > 0 ? (
        <p>A context choice outside your access was left unused.</p>
      ) : null}
      {!loading && !error && items.length > 0 ? (
        <div className="counts">
          {items.map((item) => (
            <Link key={item.key} className="count-card" to={item.href}>
              <h2>{item.label}</h2>
              <p className="count">{item.count}</p>
              <p>{item.detail}</p>
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}
