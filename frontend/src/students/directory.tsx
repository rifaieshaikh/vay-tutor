import { FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { api, Session } from "../api";
import { notify } from "../notify";
import { StudentDialog } from "../ui";
import { StudentEnrollment, StudentFilters, recordedName, studentRecordHref } from "./links";

type Row = { id: string; name: string; archived?: boolean; student_code?: string };
type Catalog = { students: Row[] };
type Preview = {
  source: string;
  target: string;
  source_code?: string;
  target_code?: string;
  move: string[];
  kept_separate: string[];
  moves?: StudentEnrollment[];
  kept?: StudentEnrollment[];
  alias: string;
};

function Notes({ error }: { error: string }) {
  if (!error) return null;
  return <p className="error" role="alert">{error}</p>;
}

type StudentActions = { edit: boolean; card: boolean };
type StudentRow = { id: string; student_code: string; display_name: string; enrollments: StudentEnrollment[]; actions: StudentActions };

function readStudentFilters(params: URLSearchParams): StudentFilters {
  return {
    q: params.get("q") || "",
    branch_id: params.get("branch_id") || "",
    course_id: params.get("course_id") || "",
    batch_id: params.get("batch_id") || "",
  };
}

const SORT_FIELDS = ["name", "code", "branch", "course", "batch", "started", "ended", "status"] as const;
type SortField = (typeof SORT_FIELDS)[number];
const SORT_LABELS: Record<SortField, string> = {
  name: "Name",
  code: "Student ID",
  branch: "Branch",
  course: "Course",
  batch: "Batch",
  started: "From",
  ended: "Until",
  status: "Status",
};

function enrollmentSummary(rows: StudentEnrollment[]) {
  const current = rows.filter((item) => !item.ended_on && item.status !== "historical");
  const shown = current.length ? current : rows;
  if (!shown.length) return "No enrollment";
  if (shown.length === 1) {
    return [shown[0].branch_name, shown[0].course_name, shown[0].batch_name].filter(Boolean).join(" · ") || "Enrollment recorded";
  }
  return `${shown.length} current enrollments`;
}

function personStatus(rows: StudentEnrollment[]) {
  if (!rows.length) return "No enrollment";
  if (rows.some((item) => !item.ended_on && item.status !== "historical")) return "Active";
  return "Ended";
}

function readSort(value: string | null): SortField {
  return SORT_FIELDS.includes(value as SortField) ? value as SortField : "name";
}

function writeSort(next: URLSearchParams, field: SortField, direction: "asc" | "desc") {
  if (field === "name") next.delete("sort");
  else next.set("sort", field);
  if (direction === "desc") next.set("direction", "desc");
  else next.delete("direction");
}

function personMatches(row: Row, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;
  return `${row.student_code || ""} ${row.name}`.toLowerCase().includes(needle);
}

function MergeDialog({ catalog, onClose, onMerged }: { catalog: Catalog; onClose: () => void; onMerged: () => void }) {
  const people = catalog.students.filter((row) => !row.archived);
  const [sourceQuery, setSourceQuery] = useState("");
  const [targetQuery, setTargetQuery] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewFor, setPreviewFor] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pair = `${sourceId}|${targetId}`;
  const source = people.find((row) => row.id === sourceId);
  const target = people.find((row) => row.id === targetId);

  function chooseSource(id: string) {
    setSourceId(id);
    setPreview(null);
    setAcknowledged(false);
  }

  function chooseTarget(id: string) {
    setTargetId(id);
    setPreview(null);
    setAcknowledged(false);
  }

  async function previewMerge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sourceId || !targetId || sourceId === targetId || busy) return;
    setError("");
    setBusy(true);
    try {
      const result = await api<Preview>("/api/v1/students/merge-preview", {
        method: "POST",
        body: JSON.stringify({ source_id: sourceId, target_id: targetId }),
      });
      setPreview(result);
      setPreviewFor(pair);
      setAcknowledged(false);
    } catch (reason) {
      setPreview(null);
      setError(reason instanceof Error ? reason.message : "Could not preview the merge.");
    } finally {
      setBusy(false);
    }
  }

  async function merge() {
    if (!preview || previewFor !== pair || !acknowledged || busy) return;
    setError("");
    setBusy(true);
    try {
      await api("/api/v1/students/merge", {
        method: "POST",
        body: JSON.stringify({ source_id: sourceId, target_id: targetId, acknowledge: true }),
      });
      onMerged();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not merge.");
    } finally {
      setBusy(false);
    }
  }

  function picker(query: string, selected: string, onChoose: (id: string) => void, label: string) {
    const matches = people.filter((row) => personMatches(row, query)).slice(0, 8);
    return (
      <div className="picker" role="listbox" aria-label={label}>
        {query.trim() && matches.length === 0 ? <p>No students match.</p> : null}
        {matches.map((row) => (
          <button key={row.id} type="button" aria-pressed={row.id === selected} onClick={() => onChoose(row.id)}>
            {row.student_code || "No id"} · {row.name}
          </button>
        ))}
      </div>
    );
  }

  return (
    <StudentDialog title="Merge students" onClose={onClose}>
      <form onSubmit={previewMerge} className="stack">
        <p className="meta">The student you choose as the source is archived. The student you keep stays, and the source name is stored as a previous name. This does not run from the student list itself.</p>
        <label>Source student
          <input value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} placeholder="Name or student id" aria-label="Search source student" />
        </label>
        {source ? <p>Source: {source.student_code} · {source.name}</p> : <p>Type to find the source student.</p>}
        {picker(sourceQuery, sourceId, chooseSource, "Source students")}
        <label>Keep this student
          <input value={targetQuery} onChange={(event) => setTargetQuery(event.target.value)} placeholder="Name or student id" aria-label="Search student to keep" />
        </label>
        {target ? <p>Keep: {target.student_code} · {target.name}</p> : <p>Type to find the student who remains.</p>}
        {picker(targetQuery, targetId, chooseTarget, "Students to keep")}
        {error ? <p className="error" role="alert">{error}</p> : null}
        <button type="submit" disabled={busy || !sourceId || !targetId || sourceId === targetId}>{busy ? "Working…" : "Preview impact"}</button>
      </form>
      {preview && previewFor === pair ? (
        <section>
          <p>{preview.source_code || "Source"} {preview.source} will be archived into {preview.target_code || "the remaining student"} {preview.target}.</p>
          <p>Enrollments that move: {(preview.moves || []).length === 0 ? "none." : (preview.moves || []).map((item) => [item.branch_name, item.course_name, item.batch_name].filter(Boolean).join(" · ")).join("; ")}</p>
          <p>Enrollments that stay separate because that batch is already on the remaining student: {(preview.kept || []).length === 0 ? "none." : (preview.kept || []).map((item) => [item.branch_name, item.course_name, item.batch_name].filter(Boolean).join(" · ")).join("; ")}</p>
          <p>The source name is kept as a previous name.</p>
          <label><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /> I have reviewed this impact.</label>
          <div className="dialog-actions">
            <button type="button" className="destructive" onClick={merge} disabled={!acknowledged || busy}>Confirm merge</button>
          </div>
        </section>
      ) : null}
    </StudentDialog>
  );
}

export function StudentsPage({ session }: { session: Session }) {
  const [params, setParams] = useSearchParams();
  const applied = readStudentFilters(params);
  const legacyId = params.get("student") || "";
  const sort = readSort(params.get("sort"));
  const direction = params.get("direction") === "desc" ? "desc" : "asc";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const canMerge = session.actions.includes("catalog.manage");
  const [query, setQuery] = useState(applied.q);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const [sortDraft, setSortDraft] = useState<SortField>(sort);
  const [directionDraft, setDirectionDraft] = useState<"asc" | "desc">(direction);
  const [merging, setMerging] = useState(false);
  const [listNonce, setListNonce] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const period = params.get("period") || "";
  const listKey = [applied.q, applied.branch_id, applied.course_id, applied.batch_id, period, sort, direction, page, listNonce].join("|");

  useEffect(() => {
    setQuery(applied.q);
  }, [applied.q]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const trimmed = query.trim();
      if (trimmed === applied.q) return;
      const next = new URLSearchParams(params);
      next.delete("student");
      next.delete("page");
      if (trimmed) next.set("q", trimmed);
      else next.delete("q");
      setParams(next);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [query, applied.q, params, setParams]);

  useEffect(() => {
    if (!canMerge) return;
    api<Catalog>("/api/v1/catalog").then(setCatalog).catch((reason: Error) => setError(reason.message));
  }, [canMerge, listNonce]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setStudents([]);
    const search = new URLSearchParams();
    if (applied.q) search.set("q", applied.q);
    if (applied.branch_id) search.set("branch_id", applied.branch_id);
    if (applied.course_id) search.set("course_id", applied.course_id);
    if (applied.batch_id) search.set("batch_id", applied.batch_id);
    if (period) search.set("period", period);
    if (sort !== "name") search.set("sort", sort);
    if (direction === "desc") search.set("direction", "desc");
    search.set("page", String(page));
    search.set("page_size", "8");
    api<{ items: StudentRow[]; total: number; pages: number }>(`/api/v1/students?${search.toString()}`)
      .then((result) => {
        if (cancelled) return;
        setStudents(result.items);
        setTotal(result.total);
        setPages(result.pages);
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
  }, [listKey]);

  function write(next: URLSearchParams) {
    setParams(next);
  }

  function clearSearch() {
    setQuery("");
    const next = new URLSearchParams(params);
    next.delete("q");
    next.delete("page");
    next.delete("student");
    write(next);
  }

  function commitSearch() {
    const trimmed = query.trim();
    if (trimmed === applied.q) return;
    const next = new URLSearchParams(params);
    next.delete("student");
    next.delete("page");
    if (trimmed) next.set("q", trimmed);
    else next.delete("q");
    write(next);
  }

  function chooseSort(value: SortField, nextDirection: "asc" | "desc" = sort === value && direction === "asc" ? "desc" : "asc") {
    const next = new URLSearchParams(params);
    next.delete("student");
    next.delete("page");
    writeSort(next, value, nextDirection);
    write(next);
  }

  function openSort() {
    setSortDraft(sort);
    setDirectionDraft(direction);
    setSortOpen(true);
  }

  function applySort(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSortOpen(false);
    chooseSort(sortDraft, directionDraft);
  }

  function setPage(value: number) {
    const next = new URLSearchParams(params);
    next.delete("student");
    if (value <= 1) next.delete("page");
    else next.set("page", String(value));
    write(next);
  }

  function listPath() {
    const next = new URLSearchParams(params);
    next.delete("student");
    const search = next.toString();
    return search ? `/students?${search}` : "/students";
  }

  function cardHref(id: string) {
    const next = new URLSearchParams();
    next.set("student", id);
    if (applied.branch_id) next.set("branch_id", applied.branch_id);
    if (applied.course_id) next.set("course_id", applied.course_id);
    if (applied.batch_id) next.set("batch_id", applied.batch_id);
    if (period) next.set("period", period);
    next.set("returnTo", listPath());
    return `/cards?${next.toString()}`;
  }

  if (legacyId) {
    const back = new URLSearchParams(params);
    back.delete("student");
    const search = back.toString();
    const target = new URLSearchParams();
    target.set("returnTo", search ? `/students?${search}` : "/students");
    return <Navigate to={`/students/${legacyId}?${target.toString()}`} replace />;
  }

  const rangeFrom = total === 0 ? 0 : (page - 1) * 8 + 1;
  const rangeTo = Math.min(total, (page - 1) * 8 + students.length);
  const path = listPath();

  return (
    <section className="panel wide">
      <div className="page-title">
        <div>
          <p className="eyebrow">People</p>
          <h1>Students</h1>
        </div>
        <button type="button" className="quiet" onClick={openSort} aria-label={`Sort by ${SORT_LABELS[sort]}, ${direction === "desc" ? "descending" : "ascending"}`}>Sort</button>
      </div>
      <Notes error={error} />
      {error ? <button type="button" className="secondary" onClick={() => setListNonce((value) => value + 1)}>Try again</button> : null}
      <div className="toolbar common">
        <label>Search
          <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitSearch(); } }} placeholder="Name or student id" />
        </label>
      </div>
      <p className="filter-row">
        {applied.q ? <button type="button" className="chip-button" onClick={clearSearch}>Search: {applied.q}</button> : null}
        {applied.q ? <button type="button" className="quiet" onClick={clearSearch}>Clear</button> : null}
        <span>{loading ? "Loading students…" : `${total} student${total === 1 ? "" : "s"}`}</span>
      </p>
      {sortOpen ? (
        <StudentDialog title="Sort" onClose={() => setSortOpen(false)}>
          <form className="form-grid" onSubmit={applySort}>
            <label className="span-2">Sort by
              <select value={sortDraft} onChange={(event) => setSortDraft(readSort(event.target.value))}>
                {SORT_FIELDS.map((field) => <option key={field} value={field}>{SORT_LABELS[field]}</option>)}
              </select>
            </label>
            <label className="span-2">Order
              <select value={directionDraft} onChange={(event) => setDirectionDraft(event.target.value === "desc" ? "desc" : "asc")}>
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </label>
            <div className="dialog-actions span-2">
              <button type="button" className="quiet" onClick={() => setSortOpen(false)}>Cancel</button>
              <button type="submit">Apply</button>
            </div>
          </form>
        </StudentDialog>
      ) : null}
      {!loading && !error && total === 0 ? <p>{applied.q ? "No students match this search. Clear it to see the full list." : "No students match this context."}</p> : null}
      {students.length > 0 ? (
        <div className="table-wrap">
          <table className="people-table directory">
            <caption className="sr-only">{total} student{total === 1 ? "" : "s"}. Page {page} of {pages}. Sorted by {SORT_LABELS[sort]}, {direction === "desc" ? "descending" : "ascending"}.</caption>
            <thead>
              <tr>
                <th aria-sort={sort === "name" ? (direction === "desc" ? "descending" : "ascending") : "none"}>
                  <button type="button" className="sort" onClick={() => chooseSort("name")}>Name</button>
                </th>
                <th aria-sort={sort === "code" ? (direction === "desc" ? "descending" : "ascending") : "none"}>
                  <button type="button" className="sort" onClick={() => chooseSort("code")}>Student ID</button>
                </th>
                <th>Enrollment</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {students.map((row) => (
                <tr key={row.id}>
                  <td><Link to={studentRecordHref(row.id, path, applied)}>{recordedName(row.display_name)}</Link></td>
                  <td className="nowrap">{row.student_code}</td>
                  <td>{enrollmentSummary(row.enrollments)}</td>
                  <td>{personStatus(row.enrollments)}</td>
                  <td>
                    <div className="actions">
                      {row.actions?.edit ? <Link to={studentRecordHref(row.id, path, applied, true)}>Edit</Link> : null}
                      {row.actions?.card ? <Link to={cardHref(row.id)}>Progress card</Link> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="pager">
        <button type="button" className="quiet" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
        <span>{rangeFrom}–{rangeTo} of {total}</span>
        <button type="button" className="quiet" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
      </p>
      {canMerge ? (
        <p className="advanced-action">
          <button type="button" className="quiet" onClick={() => setMerging(true)}>Merge students</button>
        </p>
      ) : null}
      {merging && catalog ? (
        <MergeDialog
          catalog={catalog}
          onClose={() => setMerging(false)}
          onMerged={() => {
            notify("Merged. The source student is archived and the remaining student keeps both names.");
            setListNonce((value) => value + 1);
          }}
        />
      ) : null}
      {merging && !catalog ? <p role="status">Loading students for merge…</p> : null}
    </section>
  );
}

