import { FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, Session } from "../api";

type Row = { id: string; name: string; archived: boolean; student_code?: string; branch_id?: string; course_id?: string; subject_id?: string; number?: number };
type Offering = { id: string; branch_id?: string; course_id?: string };
type Catalog = { branches: Row[]; courses: Row[]; batches: Row[]; subjects: Row[]; papers: Row[]; students: Row[]; offerings: Offering[] };
type History = { student_code?: string; display_name: string; archived: boolean; enrollments: { id: string; batch_name: string }[]; aliases: string[] };
type Preview = { source: string; target: string; move: string[]; kept_separate: string[]; alias: string };

const KIND = { branches: "branch", courses: "course", batches: "batch", subjects: "subject", students: "student", papers: "paper" } as const;

function useCatalog() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setCatalog(await api<Catalog>("/api/v1/catalog"));
  }

  useEffect(() => {
    load().catch((reason: Error) => setError(reason.message));
  }, []);

  async function rename(kind: keyof typeof KIND, row: Row, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") || "");
    setError("");
    try {
      await api(`/api/v1/catalog/${KIND[kind]}/${row.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
      setMessage(`Renamed ${row.name}. The previous name stays on the record.`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not rename.");
    }
  }

  async function archive(kind: keyof typeof KIND, row: Row) {
    setError("");
    try {
      await api(`/api/v1/catalog/${KIND[kind]}/${row.id}`, { method: "PATCH", body: JSON.stringify({ archived: !row.archived }) });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not archive.");
    }
  }

  return { catalog, error, message, rename, archive };
}

function RecordList({ kind, rows, rename, archive }: { kind: keyof typeof KIND; rows: Row[]; rename: (kind: keyof typeof KIND, row: Row, event: FormEvent<HTMLFormElement>) => void; archive: (kind: keyof typeof KIND, row: Row) => void }) {
  if (rows.length === 0) return <p>None yet. Import a marklist to create these records.</p>;
  return (
    <ul className="people">
      {rows.map((row) => (
        <li key={row.id}>
          <span>{row.student_code ? `${row.student_code} · ` : ""}{row.name}{row.number != null ? ` · paper ${row.number}` : ""}{row.archived ? " · Archived" : ""}</span>
          <form onSubmit={(event) => rename(kind, row, event)}>
            <input name="name" defaultValue={row.name} aria-label={`New name for ${row.name}`} />
            <button type="submit">Rename</button>
          </form>
          <button type="button" onClick={() => archive(kind, row)}>{row.archived ? "Restore" : "Archive"}</button>
        </li>
      ))}
    </ul>
  );
}

function Notes({ error, message }: { error: string; message: string }) {
  return (
    <>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {message ? <p className="ok" role="status">{message}</p> : null}
    </>
  );
}

export function StudentsPage() {
  const [params] = useSearchParams();
  const selectedId = params.get("student") || "";
  const { catalog, error, message, rename, archive } = useCatalog();
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<History | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [localError, setLocalError] = useState("");
  const students = (catalog?.students || []).filter((row) => `${row.student_code || ""} ${row.name}`.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    if (!selectedId) return;
    api<History>(`/api/v1/students/${selectedId}/enrollments`).then(setHistory).catch((reason: Error) => setLocalError(reason.message));
  }, [selectedId]);

  async function openHistory(row: Row) {
    setHistory(await api<History>(`/api/v1/students/${row.id}/enrollments`));
  }

  async function previewMerge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLocalError("");
    try {
      setPreview(await api<Preview>("/api/v1/students/merge-preview", {
        method: "POST",
        body: JSON.stringify({ source_id: form.get("source_id"), target_id: form.get("target_id") }),
      }));
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : "Could not preview the merge.");
    }
  }

  async function merge() {
    if (!preview) return;
    const form = document.getElementById("merge-form") as HTMLFormElement;
    const data = new FormData(form);
    setLocalError("");
    try {
      await api("/api/v1/students/merge", {
        method: "POST",
        body: JSON.stringify({ source_id: data.get("source_id"), target_id: data.get("target_id"), acknowledge: true }),
      });
      setPreview(null);
      window.location.reload();
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : "Could not merge.");
    }
  }

  return (
    <section className="panel wide">
      <p className="eyebrow">People</p>
      <h1>Students</h1>
      <p>Students are created when a marklist is imported. This list is their identity, enrollments, and progress cards.</p>
      <Notes error={error || localError} message={message} />
      {selectedId && history ? (
        <section>
          <h2>{history.display_name}</h2>
          <p>{history.student_code}{history.archived ? " · Archived" : ""}</p>
          <p>Enrollments: {history.enrollments.map((item) => item.batch_name).join(", ") || "None yet."}</p>
          {history.aliases.length ? <p>Previous names: {history.aliases.join(", ")}</p> : null}
          <p><Link to={`/cards?student=${selectedId}`}>Progress card</Link></p>
        </section>
      ) : null}
      <label>Search<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or student id" /></label>
      <p>{students.length} student{students.length === 1 ? "" : "s"}</p>
      <ul className="people">
        {students.map((row) => (
          <li key={row.id}>
            <span>{row.student_code} · {row.name}{row.archived ? " · Archived" : ""}</span>
            <Link to={`/cards?student=${row.id}`}>Progress card</Link>
            <button type="button" onClick={() => openHistory(row)}>Enrollment history</button>
            <form onSubmit={(event) => rename("students", row, event)}>
              <input name="name" defaultValue={row.name} aria-label={`New name for ${row.name}`} />
              <button type="submit">Rename</button>
            </form>
            <button type="button" onClick={() => archive("students", row)}>{row.archived ? "Restore" : "Archive"}</button>
          </li>
        ))}
      </ul>
      {history && !selectedId ? (
        <section>
          <h2>{history.display_name}</h2>
          <p>Enrollments: {history.enrollments.map((item) => item.batch_name).join(", ") || "None yet."}</p>
          {history.aliases.length ? <p>Previous names: {history.aliases.join(", ")}</p> : null}
        </section>
      ) : null}
      <h2>Merge students</h2>
      <form id="merge-form" onSubmit={previewMerge} className="stack">
        <label>Source student<select name="source_id" required><option value="">Choose</option>{(catalog?.students || []).map((row) => <option key={row.id} value={row.id}>{row.student_code} · {row.name}</option>)}</select></label>
        <label>Keep this student<select name="target_id" required><option value="">Choose</option>{(catalog?.students || []).map((row) => <option key={row.id} value={row.id}>{row.student_code} · {row.name}</option>)}</select></label>
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

export function InstitutePage({ session }: { session: Session }) {
  const { catalog, error, message, rename, archive } = useCatalog();
  if (!catalog) return <section className="panel"><p>Loading institute…</p></section>;
  const courseName = (id?: string) => catalog.courses.find((row) => row.id === id)?.name || "Course";
  return (
    <section className="panel wide">
      <p className="eyebrow">Institute</p>
      <h1>{session.institute.name}</h1>
      <p>Code {session.institute.code}. Branches and the courses each branch offers are listed here. Import still creates these records. Nothing here has to be set up first.</p>
      <Notes error={error} message={message} />
      <h2>Branches</h2>
      <RecordList kind="branches" rows={catalog.branches} rename={rename} archive={archive} />
      <h2>Offerings</h2>
      {catalog.offerings.length === 0 ? <p>No branch has a course offering yet.</p> : (
        <ul className="people">
          {catalog.offerings.map((offering) => (
            <li key={offering.id}>
              <span>{catalog.branches.find((row) => row.id === offering.branch_id)?.name || "Branch"} offers {courseName(offering.course_id)}</span>
              <Link to={`/views?level=branch&branch_id=${offering.branch_id || ""}`}>Branch view</Link>
              <Link to={`/courses?course=${offering.course_id || ""}`}>Course</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function CoursesPage() {
  const { catalog, error, message, rename, archive } = useCatalog();
  const [courseId, setCourseId] = useState("");
  if (!catalog) return <section className="panel"><p>Loading courses…</p></section>;
  const selected = courseId || catalog.courses[0]?.id || "";
  const course = catalog.courses.find((row) => row.id === selected);
  const batches = catalog.batches.filter((row) => !selected || row.course_id === selected);
  const subjects = catalog.subjects.filter((row) => !selected || row.course_id === selected);
  const papers = catalog.papers.filter((row) => subjects.some((subject) => subject.id === row.subject_id));
  return (
    <section className="panel wide">
      <p className="eyebrow">Courses</p>
      <h1>Courses</h1>
      <p>A course owns its batches, subjects, and papers. Renames keep the earlier name on the record.</p>
      <Notes error={error} message={message} />
      <label>
        Course
        <select value={selected} onChange={(event) => setCourseId(event.target.value)}>
          {catalog.courses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
      </label>
      {course ? (
        <>
          <h2>{course.name}</h2>
          <p>Offered at {catalog.offerings.filter((item) => item.course_id === course.id).map((item) => catalog.branches.find((branch) => branch.id === item.branch_id)?.name).filter(Boolean).join(", ") || "no branch yet"}.</p>
          <Link to={`/views?level=course&course_id=${course.id}`}>Course view</Link>
        </>
      ) : <p>No courses yet.</p>}
      <h2>Batches</h2>
      <RecordList kind="batches" rows={batches} rename={rename} archive={archive} />
      <h2>Subjects</h2>
      <RecordList kind="subjects" rows={subjects} rename={rename} archive={archive} />
      <h2>Papers</h2>
      <RecordList kind="papers" rows={papers} rename={rename} archive={archive} />
      <h2>Exam types</h2>
      <p>Marklists use Unit, Part, and Chapter. A new exam type is chosen on the marksheet, and these names stay the same for every course.</p>
    </section>
  );
}
