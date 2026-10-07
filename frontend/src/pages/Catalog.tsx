import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";

type Row = { id: string; name: string; archived: boolean; student_code?: string };
type Catalog = { branches: Row[]; courses: Row[]; batches: Row[]; subjects: Row[]; students: Row[] };
type History = { display_name: string; archived: boolean; enrollments: { id: string; batch_name: string }[]; aliases: string[] };
type Preview = { source: string; target: string; move: string[]; kept_separate: string[]; alias: string };

const KIND = { branches: "branch", courses: "course", batches: "batch", subjects: "subject", students: "student" } as const;
const SECTIONS = [
  ["branches", "Branches"],
  ["courses", "Courses"],
  ["batches", "Batches"],
  ["subjects", "Subjects"],
  ["students", "Students"],
] as const;

export function CatalogPage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setCatalog(await api<Catalog>("/api/v1/catalog"));
  }

  useEffect(() => {
    load().catch((reason: Error) => setError(reason.message));
  }, []);

  async function rename(kind: string, row: Row, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") || "");
    setError("");
    try {
      await api(`/api/v1/catalog/${KIND[kind as keyof typeof KIND]}/${row.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
      setMessage(`Renamed ${row.name}. The previous name stays on the record.`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not rename.");
    }
  }

  async function archive(kind: string, row: Row) {
    setError("");
    try {
      await api(`/api/v1/catalog/${KIND[kind as keyof typeof KIND]}/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ archived: !row.archived }),
      });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not archive.");
    }
  }

  async function openHistory(row: Row) {
    setHistory(await api<History>(`/api/v1/students/${row.id}/enrollments`));
  }

  async function previewMerge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    try {
      setPreview(await api<Preview>("/api/v1/students/merge-preview", {
        method: "POST",
        body: JSON.stringify({ source_id: form.get("source_id"), target_id: form.get("target_id") }),
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not preview the merge.");
    }
  }

  async function merge() {
    if (!preview) return;
    const form = document.getElementById("merge-form") as HTMLFormElement;
    const data = new FormData(form);
    setError("");
    try {
      await api("/api/v1/students/merge", {
        method: "POST",
        body: JSON.stringify({ source_id: data.get("source_id"), target_id: data.get("target_id"), acknowledge: true }),
      });
      setMessage(`Merged ${preview.source} into ${preview.target}. The source record is archived, not deleted.`);
      setPreview(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not merge.");
    }
  }

  return (
    <section className="panel">
      <h1>Catalog</h1>
      <p>Imported records can be renamed or archived. Nothing here is deleted.</p>
      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="ok">{message}</p> : null}
      {catalog ? SECTIONS.map(([kind, label]) => (
        <section key={kind}>
          <h2>{label}</h2>
          {catalog[kind].length === 0 ? <p>None yet.</p> : null}
          <ul className="people">
            {catalog[kind].map((row) => (
              <li key={row.id}>
                <span>{row.student_code ? `${row.student_code} · ` : ""}{row.name}{row.archived ? " · Archived" : ""}</span>
                <form onSubmit={(event) => rename(kind, row, event)}>
                  <input name="name" defaultValue={row.name} aria-label={`New name for ${row.name}`} />
                  <button type="submit">Rename</button>
                </form>
                <button type="button" onClick={() => archive(kind, row)}>{row.archived ? "Restore" : "Archive"}</button>
                {kind === "students" ? <button type="button" onClick={() => openHistory(row)}>History</button> : null}
              </li>
            ))}
          </ul>
        </section>
      )) : <p>Loading catalog…</p>}
      {history ? (
        <section>
          <h2>{history.display_name}</h2>
          <p>{history.enrollments.map((item) => item.batch_name).join(", ") || "No enrollments."}</p>
          {history.aliases.length ? <p>Aliases: {history.aliases.join(", ")}</p> : null}
        </section>
      ) : null}
      <h2>Merge students</h2>
      <form id="merge-form" onSubmit={previewMerge} className="stack">
        <label>Source id<input name="source_id" required /></label>
        <label>Target id<input name="target_id" required /></label>
        <button type="submit">Preview impact</button>
      </form>
      {preview ? (
        <section>
          <p>{preview.source} into {preview.target}. Move {preview.move.length} enrollment(s). Keep {preview.kept_separate.length} separate because that batch is already on the target. Alias: {preview.alias}.</p>
          <button type="button" onClick={merge}>Confirm merge</button>
        </section>
      ) : null}
    </section>
  );
}
