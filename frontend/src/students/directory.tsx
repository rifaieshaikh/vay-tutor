import { FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { api, Session } from "../api";
import { periodLabel } from "../context";
import { Option, optionFits } from "../filters";
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
  recovery?: string;
};

function Notes({ error }: { error: string }) {
  if (!error) return null;
  return <p className="error" role="alert">{error}</p>;
}

type StudentActions = { edit: boolean; card: boolean };
type StudentRow = {
  id: string;
  student_code: string;
  display_name: string;
  archived?: boolean;
  contact?: string | null;
  enrollments: StudentEnrollment[];
  actions: StudentActions;
};
type FilterOptions = { branches: Option[]; courses: Option[]; batches: Option[] };
type FilterDraft = {
  branchId: string;
  courseId: string;
  batchId: string;
  period: string;
  enrollment: string;
  includeArchived: boolean;
};

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

function currentEnrollments(rows: StudentEnrollment[]) {
  return rows.filter((item) => !item.ended_on && item.status !== "historical");
}

function enrollmentSummary(rows: StudentEnrollment[]) {
  const current = currentEnrollments(rows);
  const shown = current.length ? current : rows;
  if (!shown.length) return "No enrollment in this view";
  if (shown.length === 1) {
    return [shown[0].branch_name, shown[0].course_name, shown[0].batch_name].filter(Boolean).join(" · ") || "Enrollment recorded";
  }
  return `${shown.length} ${current.length ? "current" : "matching"} enrollments in this view`;
}

function personStatus(archived?: boolean) {
  return archived ? "Archived" : "Active";
}

const SORT_OPTIONS = [
  ["name:asc", "Name, A to Z"],
  ["name:desc", "Name, Z to A"],
  ["code:asc", "Student ID, A to Z"],
  ["code:desc", "Student ID, Z to A"],
  ["branch:asc", "Branch, A to Z"],
  ["branch:desc", "Branch, Z to A"],
  ["course:asc", "Course, A to Z"],
  ["course:desc", "Course, Z to A"],
  ["batch:asc", "Batch, A to Z"],
  ["batch:desc", "Batch, Z to A"],
  ["started:asc", "From, earliest"],
  ["started:desc", "From, latest"],
  ["ended:asc", "Until, earliest"],
  ["ended:desc", "Until, latest"],
  ["status:asc", "Enrollment status, A to Z"],
  ["status:desc", "Enrollment status, Z to A"],
] as const;

function sortToken(field: SortField, direction: "asc" | "desc") {
  return `${field}:${direction}`;
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
          <p>{preview.recovery || "This merge cannot be undone. The source student is archived and linked to the student you keep."}</p>
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
  const canAdmit = session.actions.includes("student.manage");
  const [query, setQuery] = useState(applied.q);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [options, setOptions] = useState<FilterOptions>({ branches: [], courses: [], batches: [] });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [merging, setMerging] = useState(false);
  const [listNonce, setListNonce] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const period = params.get("period") || "";
  const enrollment = ["current", "historical", "none"].includes(params.get("enrollment") || "") ? params.get("enrollment") || "" : "";
  const includeArchived = params.get("include_archived") === "1";
  const appliedDraft = (): FilterDraft => ({
    branchId: applied.branch_id,
    courseId: applied.course_id,
    batchId: applied.batch_id,
    period,
    enrollment,
    includeArchived,
  });
  const [filterDraft, setFilterDraft] = useState<FilterDraft>(appliedDraft);
  const listKey = [applied.q, applied.branch_id, applied.course_id, applied.batch_id, period, enrollment, includeArchived, sort, direction, page, listNonce].join("|");

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
    if (enrollment) search.set("enrollment", enrollment);
    if (includeArchived) search.set("include_archived", "1");
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
        setError("");
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

  useEffect(() => {
    let cancelled = false;
    api<FilterOptions>("/api/v1/students/options")
      .then((result) => { if (!cancelled) setOptions(result); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  function write(next: URLSearchParams) {
    setParams(next);
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

  function applySort(value: string) {
    const [field, nextDirection] = value.split(":");
    const next = new URLSearchParams(params);
    next.delete("student");
    next.delete("page");
    writeSort(next, readSort(field), nextDirection === "desc" ? "desc" : "asc");
    write(next);
  }

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    const next = new URLSearchParams(params);
    next.delete("page");
    next.delete("student");
    const writeField = (key: string, value: string) => { if (value) next.set(key, value); else next.delete(key); };
    writeField("branch_id", filterDraft.branchId);
    writeField("course_id", filterDraft.courseId);
    writeField("batch_id", filterDraft.batchId);
    writeField("period", filterDraft.period);
    writeField("enrollment", ["current", "historical", "none"].includes(filterDraft.enrollment) ? filterDraft.enrollment : "");
    if (filterDraft.includeArchived) next.set("include_archived", "1");
    else next.delete("include_archived");
    write(next);
    setFiltersOpen(false);
  }

  function removeChip(key: string) {
    const next = new URLSearchParams(params);
    next.delete("page");
    next.delete("student");
    if (key === "q") {
      next.delete("q");
      setQuery("");
    } else if (key === "branch_id") {
      next.delete("branch_id");
      next.delete("course_id");
      next.delete("batch_id");
    } else if (key === "course_id" || key === "period") {
      next.delete(key);
      next.delete("batch_id");
    } else next.delete(key);
    write(next);
  }

  function clearFilters() {
    setQuery("");
    const next = new URLSearchParams();
    if (sort !== "name") next.set("sort", sort);
    if (direction === "desc") next.set("direction", "desc");
    write(next);
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
  const filtered = Boolean(applied.q || applied.branch_id || applied.course_id || applied.batch_id || period || enrollment || includeArchived);
  const enrollmentLabel = enrollment === "current" ? "Currently enrolled" : enrollment === "historical" ? "Historical enrollment" : enrollment === "none" ? "No matching enrollment" : "";
  const labelFor = (items: Option[], id: string) => items.find((item) => item.id === id)?.label || "Selected";
  const chips: { key: string; label: string }[] = [];
  if (applied.q) chips.push({ key: "q", label: `Search: ${applied.q}` });
  if (applied.branch_id) chips.push({ key: "branch_id", label: labelFor(options.branches, applied.branch_id) });
  if (applied.course_id) chips.push({ key: "course_id", label: labelFor(options.courses, applied.course_id) });
  if (period) chips.push({ key: "period", label: periodLabel(period) });
  if (applied.batch_id) chips.push({ key: "batch_id", label: labelFor(options.batches, applied.batch_id) });
  if (enrollmentLabel) chips.push({ key: "enrollment", label: enrollmentLabel });
  if (includeArchived) chips.push({ key: "include_archived", label: "Include archived" });
  const draftCourses = options.courses.filter((item) => optionFits(item, { branch_id: filterDraft.branchId }));
  const draftPeriods = Array.from(new Set(
    options.batches
      .filter((item) => optionFits(item, { branch_id: filterDraft.branchId, course_id: filterDraft.courseId }) && item.parents?.session_key)
      .map((item) => item.parents?.session_key || ""),
  )).filter(Boolean).sort();
  const draftBatches = options.batches.filter((item) => {
    if (!optionFits(item, { branch_id: filterDraft.branchId, course_id: filterDraft.courseId })) return false;
    return !filterDraft.period || item.parents?.session_key === filterDraft.period;
  });
  const token = sortToken(sort, direction);

  return (
    <section className="panel wide">
      <div className="page-title">
        <div>
          <p className="eyebrow">People</p>
          <h1>Students</h1>
        </div>
        {canAdmit ? <Link className="button" to="/students/admissions/new">Create admission</Link> : null}
      </div>
      <form className="toolbar" onSubmit={(event) => { event.preventDefault(); commitSearch(); }}>
        <label>Search
          <input value={query} aria-label="Search students" placeholder="Name, student ID, previous name, or contact" onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label>Sort
          <select aria-label="Sort" value={SORT_OPTIONS.some((item) => item[0] === token) ? token : "name:asc"} onChange={(event) => applySort(event.target.value)}>
            {SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <button type="button" className="secondary" onClick={() => { setFilterDraft(appliedDraft()); setFiltersOpen(true); }}>Filters</button>
      </form>
      <p className="filter-row">
        <span role="status">{loading ? "Loading students…" : error ? "Students could not be loaded." : `${rangeFrom}–${rangeTo} of ${total}`}</span>
        {chips.map((chip) => (
          <button key={chip.key} type="button" className="chip-button" onClick={() => removeChip(chip.key)}>{chip.label}</button>
        ))}
        {filtered ? <button type="button" className="quiet" onClick={clearFilters}>Clear filters</button> : null}
      </p>
      <Notes error={error} />
      {error ? <button type="button" className="secondary" onClick={() => setListNonce((value) => value + 1)}>Retry</button> : null}
      {!loading && !error && total === 0 ? <p>{filtered ? "No students match." : "No students yet."}</p> : null}
      {students.length > 0 ? (
        <div className="table-wrap">
          <table className="people-table directory">
            <caption className="sr-only">{total} student{total === 1 ? "" : "s"}. Page {page} of {pages}. Sorted by {SORT_LABELS[sort]}, {direction === "desc" ? "descending" : "ascending"}.</caption>
            <thead>
              <tr>
                <th aria-sort={sort === "name" ? (direction === "desc" ? "descending" : "ascending") : "none"}>Name</th>
                <th aria-sort={sort === "code" ? (direction === "desc" ? "descending" : "ascending") : "none"}>Student ID</th>
                <th>Enrollment</th>
                <th>Person status</th>
              </tr>
            </thead>
            <tbody>
              {students.map((row) => (
                <tr key={row.id}>
                  <td className="person">
                    <div className="person-cell">
                      <Link to={studentRecordHref(row.id, path, applied)}>{recordedName(row.display_name)}</Link>
                      {row.contact ? <span className="meta">{row.contact}</span> : null}
                    </div>
                  </td>
                  <td className="nowrap">{row.student_code}</td>
                  <td>{enrollmentSummary(row.enrollments)}</td>
                  <td>{personStatus(row.archived)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {!error && total > 0 ? (
        <p className="pager">
          <button type="button" className="quiet" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span>{rangeFrom}–{rangeTo} of {total}</span>
          <button type="button" className="quiet" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </p>
      ) : null}
      {filtersOpen ? (
        <StudentDialog title="Filters" onClose={() => setFiltersOpen(false)}>
          <form className="form-grid" onSubmit={applyFilters}>
            <label>Branch
              <select aria-label="Branch" value={filterDraft.branchId} onChange={(event) => setFilterDraft({ ...filterDraft, branchId: event.target.value, courseId: "", batchId: "" })}>
                <option value="">Any branch</option>
                {options.branches.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label>Course
              <select aria-label="Course" value={filterDraft.courseId} onChange={(event) => setFilterDraft({ ...filterDraft, courseId: event.target.value, batchId: "" })}>
                <option value="">Any course</option>
                {draftCourses.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label>Intake period
              <select aria-label="Intake period" value={filterDraft.period} onChange={(event) => {
                const value = event.target.value;
                const batch = options.batches.find((item) => item.id === filterDraft.batchId);
                const batchStillFits = !value || batch?.parents?.session_key === value;
                setFilterDraft({ ...filterDraft, period: value, batchId: batchStillFits ? filterDraft.batchId : "" });
              }}>
                <option value="">Any period</option>
                {draftPeriods.map((key) => <option key={key} value={key}>{periodLabel(key)}</option>)}
              </select>
            </label>
            <label>Batch
              <select aria-label="Batch" value={filterDraft.batchId} onChange={(event) => setFilterDraft({ ...filterDraft, batchId: event.target.value })}>
                <option value="">Any batch</option>
                {draftBatches.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label>Enrollment
              <select aria-label="Enrollment" value={filterDraft.enrollment} onChange={(event) => setFilterDraft({ ...filterDraft, enrollment: event.target.value })}>
                <option value="">Any enrollment in this view</option>
                <option value="current">Currently enrolled</option>
                <option value="historical">Historical enrollment</option>
                <option value="none">No matching enrollment</option>
              </select>
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={filterDraft.includeArchived} onChange={(event) => setFilterDraft({ ...filterDraft, includeArchived: event.target.checked })} />
              Include archived
            </label>
            <div className="dialog-actions span-2">
              <button type="button" className="quiet" onClick={() => setFilterDraft({ branchId: "", courseId: "", batchId: "", period: "", enrollment: "", includeArchived: false })}>Reset</button>
              <button type="button" className="secondary" onClick={() => setFiltersOpen(false)}>Cancel</button>
              <button type="submit">Apply</button>
            </div>
          </form>
        </StudentDialog>
      ) : null}
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

