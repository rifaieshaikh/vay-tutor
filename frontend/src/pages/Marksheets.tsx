import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";

type Marksheet = {
  id: string;
  title: string;
  status: string;
  exam_date: string | null;
  exam_type: string | null;
  source_file: string | null;
  source_sheet: string | null;
  file_id: string | null;
  maximum: number | null;
  revision: number | null;
  edit_version: number;
  uploader_name?: string;
  reviewer_name?: string;
};
type Result = {
  id: string;
  status: string;
  score: number | null;
  rank: number | null;
  percentage: number | null;
  previous_score: number | null;
  source?: { row?: number };
};
type Detail = Marksheet & { results: Result[] };
type Option = { id: string; label: string };
const STATUS_OPTIONS = [
  { id: "draft", label: "Draft" },
  { id: "submitted", label: "Submitted" },
  { id: "published", label: "Published" },
  { id: "withdrawn", label: "Withdrawn" },
];
const FILTERS: { key: string; label: string; dimension?: string }[] = [
  { key: "status", label: "Status" },
  { key: "exam_type", label: "Exam type", dimension: "exam_type" },
  { key: "branch_id", label: "Branch", dimension: "branch" },
  { key: "course_id", label: "Course", dimension: "course" },
  { key: "batch_id", label: "Batch", dimension: "batch" },
  { key: "subject_id", label: "Subject", dimension: "subject" },
  { key: "paper_id", label: "Paper", dimension: "paper" },
];

export function MarksheetsPage() {
  const [items, setItems] = useState<Marksheet[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({ exam_date: "" });
  const [options, setOptions] = useState<Record<string, Option[]>>({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load(next = filters) {
    const query = new URLSearchParams();
    Object.entries(next).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    const page = await api<{ items: Marksheet[] }>(`/api/v1/marksheets?${query.toString()}`);
    setItems(page.items);
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

  async function open(sheet: Marksheet) {
    setDetail(await api<Detail>(`/api/v1/marksheets/${sheet.id}`));
  }

  async function publish(sheet: Marksheet) {
    setError("");
    try {
      await api(`/api/v1/marksheets/${sheet.id}/publish`, { method: "POST" });
      setMessage(`${sheet.title} is published.`);
      await load();
      if (detail?.id === sheet.id) setDetail(await api<Detail>(`/api/v1/marksheets/${sheet.id}`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not publish.");
    }
  }

  async function saveDate(event: FormEvent<HTMLFormElement>, sheet: Detail) {
    event.preventDefault();
    setError("");
    try {
      await api(`/api/v1/marksheets/${sheet.id}`, {
        method: "PATCH",
        body: JSON.stringify({ exam_date: new FormData(event.currentTarget).get("exam_date") }),
      });
      setDetail(await api<Detail>(`/api/v1/marksheets/${sheet.id}`));
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the date.");
    }
  }

  async function correctDraft(event: FormEvent<HTMLFormElement>, sheet: Detail, result: Result) {
    event.preventDefault();
    setError("");
    try {
      await api(`/api/v1/marksheets/${sheet.id}/results/${result.id}`, {
        method: "PATCH",
        body: JSON.stringify({ score: Number(new FormData(event.currentTarget).get("score")), edit_version: sheet.edit_version }),
      });
      setDetail(await api<Detail>(`/api/v1/marksheets/${sheet.id}`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the score.");
    }
  }

  async function correctPublished(event: FormEvent<HTMLFormElement>, sheet: Detail) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    try {
      await api(`/api/v1/marksheets/${sheet.id}/correct`, {
        method: "POST",
        body: JSON.stringify({
          reason: form.get("reason"),
          edit_version: sheet.edit_version,
          changes: [{ result_id: form.get("result_id"), score: Number(form.get("score")) }],
        }),
      });
      setMessage("A new revision is active. The previous score is kept.");
      setDetail(await api<Detail>(`/api/v1/marksheets/${sheet.id}`));
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not correct.");
    }
  }

  async function withdraw(event: FormEvent<HTMLFormElement>, sheet: Detail) {
    event.preventDefault();
    setError("");
    try {
      await api(`/api/v1/marksheets/${sheet.id}/withdraw`, {
        method: "POST",
        body: JSON.stringify({ reason: new FormData(event.currentTarget).get("reason"), edit_version: sheet.edit_version }),
      });
      setMessage("The published revision was withdrawn.");
      setDetail(await api<Detail>(`/api/v1/marksheets/${sheet.id}`));
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not withdraw.");
    }
  }

  return (
    <section className="panel">
      <h1>Marksheets</h1>
      <p>There is no separate way to create a marksheet. Drafts stay out of progress cards until they are published.</p>
      <form className="stack" onSubmit={(event) => { event.preventDefault(); load(); }}>
        {FILTERS.map((filter) => (
          <label key={filter.key}>
            {filter.label}
            <select
              value={filters[filter.key] || ""}
              onChange={(event) => {
                const next = { ...filters, [filter.key]: event.target.value };
                setFilters(next);
                load(next);
              }}
            >
              <option value="">All</option>
              {(filter.dimension ? options[filter.dimension] || [] : STATUS_OPTIONS).map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>
        ))}
        <label>
          Exam date
          <input type="date" value={filters.exam_date} onChange={(event) => {
            const next = { ...filters, exam_date: event.target.value };
            setFilters(next);
            load(next);
          }} />
        </label>
      </form>
      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="ok">{message}</p> : null}
      {items.length === 0 ? <p>No marksheets match these filters.</p> : null}
      <ul className="people">
        {items.map((sheet) => (
          <li key={sheet.id}>
            <button type="button" className="text-button" onClick={() => open(sheet)}>{sheet.title}</button>
            <span>
              {sheet.source_sheet} · {sheet.status}
              {sheet.uploader_name ? ` · uploaded by ${sheet.uploader_name}` : ""}
              {sheet.reviewer_name ? ` · reviewed by ${sheet.reviewer_name}` : ""}
            </span>
          </li>
        ))}
      </ul>
      {detail ? (
        <article>
          <h2>{detail.title}</h2>
          <p>Revision {detail.revision} · version {detail.edit_version}</p>
          {detail.file_id ? <p><a href={`/api/v1/files/${detail.file_id}`}>Open source workbook</a></p> : null}
          {detail.status === "draft" && !detail.exam_date ? (
            <form onSubmit={(event) => saveDate(event, detail)}>
              <input name="exam_date" type="date" required />
              <button type="submit">Save exam date</button>
            </form>
          ) : null}
          <div className="table-wrap">
            <table>
              <thead><tr><th>Row</th><th>Status</th><th>Score</th><th>Previous</th><th>%</th><th>Rank</th></tr></thead>
              <tbody>
                {detail.results.map((result) => (
                  <tr key={result.id}>
                    <td>{result.source?.row}</td>
                    <td>{result.status}</td>
                    <td>
                      {detail.status === "draft" ? (
                        <form onSubmit={(event) => correctDraft(event, detail, result)}>
                          <input name="score" type="number" step="0.25" defaultValue={result.score ?? ""} />
                          <button type="submit">Save</button>
                        </form>
                      ) : result.score ?? "—"}
                    </td>
                    <td>{result.previous_score ?? "—"}</td>
                    <td>{result.percentage == null ? "—" : result.percentage.toFixed(2)}</td>
                    <td>{result.rank ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {detail.status !== "published" && detail.status !== "withdrawn" ? <button type="button" onClick={() => publish(detail)}>Publish</button> : null}
          {detail.status === "published" ? (
            <>
              <form onSubmit={(event) => correctPublished(event, detail)} className="stack">
                <h3>Correct a published score</h3>
                <label>
                  Result
                  <select name="result_id" required>
                    {detail.results.map((result) => (
                      <option key={result.id} value={result.id}>Row {result.source?.row} · {result.score ?? "missing"}</option>
                    ))}
                  </select>
                </label>
                <label>New score<input name="score" type="number" step="0.25" required /></label>
                <label>Reason<input name="reason" required /></label>
                <button type="submit">Save revision</button>
              </form>
              <form onSubmit={(event) => withdraw(event, detail)}>
                <label>Withdrawal reason<input name="reason" required /></label>
                <button type="submit">Withdraw</button>
              </form>
            </>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}
