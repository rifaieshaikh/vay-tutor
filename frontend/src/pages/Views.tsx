import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

type Option = { id: string; label: string };
type Section = { id: string; label: string; students: number; results: number; percentage: number | null; band: string | null; coverage: string };
type View = {
  level: string;
  students: number;
  enrollments: number;
  roster_confirmed: boolean;
  membership_label: string;
  policy_version: number;
  policy_label: string;
  pending_recalculation: boolean;
  sample_size: number;
  empty: boolean;
  performance: { percentage: number | null; participation: number | null; missing: number; absent: number };
  sections: Section[];
  attention: { id: string; title: string | null; percentage: number | null; band: string }[];
  ranks: { page: number; pages: number; items: { id: string; title: string | null; score: number | null; maximum: number | null; rank: number }[] };
};

const LEVELS = ["institute", "branch", "course", "batch", "subject", "paper"];
const FILTERS = [
  ["branch_id", "Branch", "branch"],
  ["course_id", "Course", "course"],
  ["batch_id", "Batch", "batch"],
  ["subject_id", "Subject", "subject"],
  ["paper_id", "Paper", "paper"],
  ["exam_type", "Exam type", "exam_type"],
] as const;

export function ViewsPage() {
  const [level, setLevel] = useState("institute");
  const [filters, setFilters] = useState<Record<string, string>>({ exam_date: "" });
  const [options, setOptions] = useState<Record<string, Option[]>>({});
  const [view, setView] = useState<View | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(nextLevel = level, nextFilters = filters, nextPage = page) {
    setLoading(true);
    const query = new URLSearchParams({ page: String(nextPage) });
    Object.entries(nextFilters).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    try {
      setView(await api<View>(`/api/v1/views/${nextLevel}?${query.toString()}`));
      setError("");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch((reason: Error) => setError(reason.message));
    Promise.all(
      ["branch", "course", "batch", "subject", "paper", "exam_type"].map(async (dimension) => {
        const page = await api<{ items: Option[] }>(`/api/v1/context/options?dimension=${dimension}`);
        return [dimension, page.items] as const;
      }),
    ).then((pairs) => setOptions(Object.fromEntries(pairs))).catch(() => undefined);
  }, []);

  async function confirmRoster() {
    if (!filters.batch_id) return;
    setError("");
    try {
      await api("/api/v1/rosters/confirm", { method: "POST", body: JSON.stringify({ batch_id: filters.batch_id }) });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not confirm the roster.");
    }
  }

  return (
    <section className="panel">
      <p className="eyebrow">Reporting</p>
      <h1>Academic views</h1>
      <p>Filters stay in place while you move between views. Counts are distinct students, not a sum of batches.</p>
      <div className="stack">
        {LEVELS.map((item) => (
          <button key={item} type="button" onClick={() => { setLevel(item); setPage(1); load(item, filters, 1); }}>{item}</button>
        ))}
        {FILTERS.map(([key, label, dimension]) => (
          <label key={key}>
            {label}
            <select value={filters[key] || ""} onChange={(event) => {
              const next = { ...filters, [key]: event.target.value };
              setFilters(next);
              setPage(1);
              load(level, next, 1);
            }}>
              <option value="">All</option>
              {(options[dimension] || []).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
        ))}
        <label>
          Exam date
          <input type="date" value={filters.exam_date} onChange={(event) => {
            const next = { ...filters, exam_date: event.target.value };
            setFilters(next);
            setPage(1);
            load(level, next, 1);
          }} />
        </label>
      </div>
      {loading ? <p role="status">Loading this view…</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {view ? (
        <article>
          <h2>{view.level}</h2>
          <p>{view.membership_label}: {view.students}. Enrollments: {view.enrollments}. Sample size: {view.sample_size}.</p>
          <p>Policy {view.policy_version}, {view.policy_label}. Performance {view.performance.percentage ?? "—"}%.</p>
          <p>{view.roster_confirmed ? `Participation ${view.performance.participation}.` : "Full-batch participation stays hidden until this roster is confirmed."}</p>
          {view.pending_recalculation ? <p>Recalculation is pending for a published revision.</p> : null}
          <p>Missing {view.performance.missing}. Absent {view.performance.absent}. A name left off a sheet is not absent.</p>
          {level === "batch" && filters.batch_id ? <button type="button" onClick={confirmRoster}>Confirm listed roster</button> : null}
          {view.attention.length ? (
            <p>Needs attention: {view.attention.map((item) => `${item.title} ${item.percentage}% ${item.band}`).join("; ")}.</p>
          ) : null}
          <div className="table-wrap">
            <table>
              <caption>Sections in this {view.level} view</caption>
              <thead><tr><th>Section</th><th>Students</th><th>Results</th><th>%</th><th>Band</th><th>Coverage</th></tr></thead>
              <tbody>
                {view.sections.map((section) => (
                  <tr key={section.id || section.label}>
                    <td>{section.id ? <Link to={`/cards`}>{section.label}</Link> : section.label}</td>
                    <td>{section.students}</td>
                    <td>{section.results}</td>
                    <td>{section.percentage ?? "—"}</td>
                    <td>{section.band || "—"}</td>
                    <td>{section.coverage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {view.empty ? <p role="status">No published results in this scope.</p> : null}
          <h3>Rank list</h3>
          <div className="table-wrap">
            <table>
              <caption>Dense rank for published scores in this scope, page {view.ranks.page} of {view.ranks.pages}</caption>
              <thead><tr><th>Rank</th><th>Assessment</th><th>Score</th></tr></thead>
              <tbody>
                {view.ranks.items.map((item) => (
                  <tr key={item.id}><td>{item.rank}</td><td>{item.title}</td><td>{item.score}/{item.maximum}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {view.ranks.pages > 1 ? (
            <p>
              <button type="button" disabled={view.ranks.page <= 1} onClick={() => { setPage(view.ranks.page - 1); load(level, filters, view.ranks.page - 1); }}>Previous page</button>
              <button type="button" disabled={view.ranks.page >= view.ranks.pages} onClick={() => { setPage(view.ranks.page + 1); load(level, filters, view.ranks.page + 1); }}>Next page</button>
            </p>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}
