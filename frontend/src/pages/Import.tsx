import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

type Student = {
  row: number;
  display_name: string;
  status: string;
  score: number | null;
  percentage: number | null;
  rank: number | null;
  source_rank: number | null;
  batch_session: string | null;
};
type Group = {
  id: string;
  maximum: number;
  interpretation: string;
  confirmed: boolean;
  duplicate_of: string | null;
  students: Student[];
};
type Sheet = {
  id: string;
  name: string;
  title: string;
  included: boolean;
  heading_conflict: boolean;
  heading_acknowledged: boolean;
  branch_name: string;
  course_name: string;
  subject_name: string;
  exam_date: string | null;
  batches: { session_key: string; label: string }[];
  groups: Group[];
};
type Preview = {
  id: string;
  state: string;
  ready: boolean;
  filename: string;
  sheets: Sheet[];
  blockers: { code: string; message: string; sheet_id?: string; row?: number; group_id?: string }[];
  totals: { result_rows: number; students_to_create: number; students_to_reuse: number };
  outcomes: { name: string; status: string; reason?: string }[];
};
type HistoryItem = { id: string; filename: string; state: string; outcomes: { name: string; status: string; reason?: string }[] };

const LEVELS = [
  ["branch", "Branch"],
  ["course", "Course"],
  ["batch", "Batch"],
  ["subject", "Subject"],
  ["paper", "Paper"],
  ["exam_type", "Exam type"],
] as const;

export function ImportPage() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [defaults, setDefaults] = useState<Record<string, { mode: string; value: string }>>({});

  async function loadHistory() {
    const page = await api<{ items: HistoryItem[] }>("/api/v1/imports");
    setHistory(page.items);
  }

  useEffect(() => {
    loadHistory().catch((reason: Error) => setError(reason.message));
  }, []);

  function levelChange(field: string, key: "mode" | "value", value: string) {
    setDefaults((current) => {
      const existing = current[field] || { mode: "detect", value: "" };
      return { ...current, [field]: { ...existing, [key]: value } };
    });
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    const input = event.currentTarget.elements.namedItem("file") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setPending(true);
    const body = new FormData();
    body.append("file", file);
    try {
      const created = await api<{ id: string }>("/api/v1/imports", { method: "POST", body });
      if (Object.keys(defaults).length) {
        await api(`/api/v1/imports/${created.id}`, { method: "PATCH", body: JSON.stringify({ defaults }) });
      }
      setPreview(await api<Preview>(`/api/v1/imports/${created.id}`));
      await loadHistory();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Upload failed.");
    } finally {
      setPending(false);
    }
  }

  async function save(sheets: Record<string, unknown>) {
    if (!preview) return;
    setError("");
    await api(`/api/v1/imports/${preview.id}`, { method: "PATCH", body: JSON.stringify({ sheets }) });
    setPreview(await api<Preview>(`/api/v1/imports/${preview.id}`));
  }

  async function patchSheet(sheetId: string, choice: Record<string, unknown>) {
    try {
      await save({ [sheetId]: choice });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save that decision.");
    }
  }

  async function commit() {
    if (!preview) return;
    setError("");
    try {
      const result = await api<{ outcomes: { status: string }[] }>(`/api/v1/imports/${preview.id}/commit`, { method: "POST" });
      setMessage(`Committed ${result.outcomes.filter((item) => item.status === "committed").length} sheets as drafts.`);
      setPreview(await api<Preview>(`/api/v1/imports/${preview.id}`));
      await loadHistory();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Commit failed.");
    }
  }

  return (
    <section className="panel">
      <p className="eyebrow">Import Marklist</p>
      <h1>Upload a workbook</h1>
      <p>Each level can stay on detect, use an existing record, or create a new one. Files must be .xlsx and at most 25 MB.</p>
      <div className="stack">
        {LEVELS.map(([field, label]) => (
          <label key={field}>
            {label}
            <select value={defaults[field]?.mode || "detect"} onChange={(event) => levelChange(field, "mode", event.target.value)}>
              <option value="detect">Detect</option>
              <option value="existing">Existing</option>
              <option value="new">New</option>
            </select>
            {defaults[field]?.mode && defaults[field].mode !== "detect" ? (
              <input value={defaults[field].value} onChange={(event) => levelChange(field, "value", event.target.value)} placeholder={label} />
            ) : null}
          </label>
        ))}
      </div>
      <form onSubmit={upload}>
        <label>
          Workbook
          <input name="file" type="file" accept=".xlsx" required />
        </label>
        <button type="submit" disabled={pending}>{pending ? "Reading…" : "Upload"}</button>
      </form>
      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="ok">{message} <Link to="/marksheets">Review marksheets</Link></p> : null}
      {preview ? (
        <>
          <p>
            {preview.filename}: {preview.totals.result_rows} rows, {preview.totals.students_to_create} students to create, {preview.totals.students_to_reuse} to reuse.
            {" "}{preview.ready ? "Ready to commit." : "Resolve the rows below. Decisions stay on this import."}
          </p>
          <p><a href={`/api/v1/imports/${preview.id}/validation-report`}>Download validation report</a></p>
          {preview.blockers.map((item) => <p className="error" key={`${item.code}-${item.sheet_id}-${item.row}`}>{item.message}</p>)}
          {preview.sheets.map((sheet) => (
            <article key={sheet.id}>
              <h2>{sheet.name}</h2>
              <p>{sheet.branch_name} · {sheet.course_name} · {sheet.subject_name} · {sheet.batches.map((batch) => batch.label).join(", ")}{sheet.exam_date ? ` · ${sheet.exam_date}` : " · no exam date"}</p>
              <label>
                <input type="checkbox" checked={sheet.included} onChange={(event) => patchSheet(sheet.id, { included: event.target.checked, skip_reason: event.target.checked ? "" : "Skipped during review." })} />
                Include this sheet
              </label>
              <div className="stack">
                {LEVELS.map(([field, label]) => (
                  <label key={field}>
                    Override {label.toLowerCase()}
                    <input
                      placeholder={`Leave blank to keep ${label.toLowerCase()}`}
                      onBlur={(event) => {
                        if (event.target.value) patchSheet(sheet.id, { levels: { [field]: { mode: "new", value: event.target.value } } });
                      }}
                    />
                  </label>
                ))}
              </div>
              {sheet.heading_conflict && !sheet.heading_acknowledged ? (
                <button type="button" onClick={() => patchSheet(sheet.id, { acknowledge_heading: true })}>Acknowledge heading and use {sheet.batches[0]?.label}</button>
              ) : null}
              {sheet.groups.map((group) => (
                <div key={group.id}>
                  <p>Maximum {group.maximum}. {group.duplicate_of ? `Same scores as ${group.duplicate_of}.` : ""}</p>
                  {!group.confirmed ? (
                    <label>
                      Interpretation
                      <select defaultValue={group.interpretation} onChange={(event) => patchSheet(sheet.id, { groups: { [group.id]: { interpretation: event.target.value, confirmed: true } } })}>
                        <option value="assessment">Same assessment</option>
                        <option value="separate_assessment">Separate assessment</option>
                        <option value="retest">Retest</option>
                        <option value="component">Component</option>
                        <option value="skip_duplicate">Skip duplicate</option>
                      </select>
                    </label>
                  ) : null}
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr><th>Row</th><th>Name</th><th>Status</th><th>Score</th><th>%</th><th>Rank</th><th>Source rank</th><th>Batch</th></tr>
                      </thead>
                      <tbody>
                        {group.students.map((student) => (
                          <tr key={`${group.id}-${student.row}`}>
                            <td>{student.row}</td>
                            <td>{student.display_name}</td>
                            <td>{student.status}</td>
                            <td>{student.score ?? "—"}</td>
                            <td>{student.percentage == null ? "—" : student.percentage.toFixed(2)}</td>
                            <td>{student.rank ?? "—"}</td>
                            <td>{student.source_rank ?? "—"}</td>
                            <td>
                              {sheet.batches.length > 1 ? (
                                <select value={student.batch_session || ""} onChange={(event) => patchSheet(sheet.id, { row_batches: { [String(student.row)]: event.target.value } })}>
                                  <option value="">Choose</option>
                                  {sheet.batches.map((batch) => <option key={batch.session_key} value={batch.session_key}>{batch.label}</option>)}
                                </select>
                              ) : student.batch_session}
                              {student.status === "absent" ? (
                                <button type="button" onClick={() => patchSheet(sheet.id, { drop_rows: [student.row] })}>Drop duplicate</button>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </article>
          ))}
          <button type="button" onClick={commit} disabled={!preview.ready || preview.state === "committed"}>Commit drafts</button>
          {preview.outcomes.length ? (
            <ul>{preview.outcomes.map((item) => <li key={item.name}>{item.name}: {item.status}{item.reason ? ` — ${item.reason}` : ""}</li>)}</ul>
          ) : null}
        </>
      ) : null}
      <h2>Earlier imports</h2>
      {history.length === 0 ? <p>No imports yet.</p> : null}
      <ul className="people">
        {history.map((item) => (
          <li key={item.id}>
            <button type="button" onClick={() => api<Preview>(`/api/v1/imports/${item.id}`).then(setPreview)}>{item.filename}</button>
            <span>{item.state} · {item.outcomes.filter((outcome) => outcome.status === "skipped").length} skipped</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
