import { FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { api, Session } from "../api";
import { notify } from "../notify";
import { Option, optionFits } from "../filters";
import { IntakeTabs } from "../peopleTabs";
import { Icon, StudentDialog } from "../ui";
import { StudentEnrollment, StudentFilters, recordedDate, recordedName, recordedStatus, studentRecordHref } from "./links";

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
type StudentOptions = { branches: Option[]; courses: Option[]; batches: Option[] };

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
            <button type="button" onClick={merge} disabled={!acknowledged || busy}>Confirm merge</button>
          </div>
        </section>
      ) : null}
    </StudentDialog>
  );
}

export function StudentsPage({ session }: { session: Session }) {
  const [params, setParams] = useSearchParams();
  const applied = readStudentFilters(params);
  const appliedKey = params.toString();
  const legacyId = params.get("student") || "";
  const sort = readSort(params.get("sort"));
  const direction = params.get("direction") === "desc" ? "desc" : "asc";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const canMerge = session.actions.includes("catalog.manage");
  const [draft, setDraft] = useState<StudentFilters>(applied);
  const [options, setOptions] = useState<StudentOptions>({ branches: [], courses: [], batches: [] });
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
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
    setDraft(readStudentFilters(params));
  }, [appliedKey]);

  useEffect(() => {
    api<StudentOptions>("/api/v1/students/options").then(setOptions).catch((reason: Error) => setError(reason.message));
  }, []);

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

  function openFilters() {
    setDraft(applied);
    setFiltersOpen(true);
  }

  function closeFilters() {
    setDraft(applied);
    setFiltersOpen(false);
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = new URLSearchParams();
    if (draft.q.trim()) next.set("q", draft.q.trim());
    if (draft.branch_id) next.set("branch_id", draft.branch_id);
    if (draft.course_id) next.set("course_id", draft.course_id);
    if (draft.batch_id) next.set("batch_id", draft.batch_id);
    if (period) next.set("period", period);
    writeSort(next, sort, direction);
    setError("");
    setFiltersOpen(false);
    write(next);
  }

  function resetFilters() {
    const next = new URLSearchParams();
    writeSort(next, sort, direction);
    setDraft({ q: "", branch_id: "", course_id: "", batch_id: "" });
    setError("");
    setFiltersOpen(false);
    write(next);
  }

  function removeFilter(key: keyof StudentFilters) {
    const nextFilters = { ...applied, [key]: "" };
    if (key === "branch_id") {
      nextFilters.course_id = "";
      nextFilters.batch_id = "";
    }
    if (key === "course_id") nextFilters.batch_id = "";
    const next = new URLSearchParams();
    if (nextFilters.q) next.set("q", nextFilters.q);
    if (nextFilters.branch_id) next.set("branch_id", nextFilters.branch_id);
    if (nextFilters.course_id) next.set("course_id", nextFilters.course_id);
    if (nextFilters.batch_id) next.set("batch_id", nextFilters.batch_id);
    if (period) next.set("period", period);
    writeSort(next, sort, direction);
    write(next);
  }

  function chooseDraft(key: keyof StudentFilters, value: string) {
    const next = { ...draft, [key]: value };
    if (key === "branch_id" || key === "course_id") {
      const course = options.courses.find((item) => item.id === next.course_id);
      if (course && !optionFits(course, next)) {
        next.course_id = "";
        next.batch_id = "";
      }
      const batch = options.batches.find((item) => item.id === next.batch_id);
      if (batch && !optionFits(batch, next)) next.batch_id = "";
    }
    setDraft(next);
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
    const query = next.toString();
    return query ? `/students?${query}` : "/students";
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
    const query = back.toString();
    const target = new URLSearchParams();
    target.set("returnTo", query ? `/students?${query}` : "/students");
    return <Navigate to={`/students/${legacyId}?${target.toString()}`} replace />;
  }

  const courses = options.courses.filter((item) => optionFits(item, draft));
  const batches = options.batches.filter((item) => optionFits(item, draft));
  const active = (["q", "branch_id", "course_id", "batch_id"] as const).filter((key) => applied[key]);
  const labels: Record<string, string> = { q: "Search", branch_id: "Branch", course_id: "Course", batch_id: "Batch" };
  function chipLabel(key: keyof StudentFilters) {
    if (key === "q") return applied.q;
    const group = key === "branch_id" ? options.branches : key === "course_id" ? options.courses : options.batches;
    return group.find((item) => item.id === applied[key])?.label || applied[key];
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
        <div className="actions">
          {active.map((key) => (
            <button key={key} type="button" className="chip-button" onClick={() => removeFilter(key)}>{labels[key]}: {chipLabel(key)}</button>
          ))}
          <div className="icon-actions">
            {active.length ? <button type="button" onClick={resetFilters} aria-label="Clear filters" title="Clear filters"><Icon name="clear" /></button> : null}
            <button type="button" onClick={openSort} aria-label={`Sort by ${SORT_LABELS[sort]}, ${direction === "desc" ? "descending" : "ascending"}`} title="Sort"><Icon name="sort" /></button>
            <button type="button" onClick={openFilters} aria-label={active.length ? `Filters, ${active.length} applied` : "Filters"} title="Filters"><Icon name="filter" /></button>
          </div>
        </div>
      </div>
      <IntakeTabs current="students" />
      <Notes error={error} />
      <p className="filter-row"><span>{loading ? "Loading students…" : `${total} student${total === 1 ? "" : "s"}`}</span></p>
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
      {filtersOpen ? (
        <StudentDialog title="Filters" onClose={closeFilters}>
          <form className="form-grid" onSubmit={applyFilters}>
            <label>Branch
              <select value={draft.branch_id} onChange={(event) => chooseDraft("branch_id", event.target.value)}>
                <option value="">All</option>
                {options.branches.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label>Course
              <select value={draft.course_id} onChange={(event) => chooseDraft("course_id", event.target.value)}>
                <option value="">All</option>
                {courses.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label>Batch
              <select value={draft.batch_id} onChange={(event) => chooseDraft("batch_id", event.target.value)}>
                <option value="">All</option>
                {batches.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label className="span-2">Search
              <input value={draft.q} onChange={(event) => chooseDraft("q", event.target.value)} placeholder="Name or student id" />
            </label>
            <div className="dialog-actions span-2">
              <button type="button" className="quiet" onClick={resetFilters}>Reset</button>
              <button type="submit">Apply</button>
            </div>
          </form>
        </StudentDialog>
      ) : null}
      {!loading && total === 0 ? <p>No students match these filters.</p> : null}
      {students.length > 0 ? (
        <div className="table-wrap">
          <table className="people-table directory">
            <caption className="sr-only">{total} student{total === 1 ? "" : "s"}. Page {page} of {pages}. Sorted by {SORT_LABELS[sort]}, {direction === "desc" ? "descending" : "ascending"}.</caption>
            <thead>
              <tr>
                {SORT_FIELDS.map((field) => (
                  <th key={field} aria-sort={sort === field ? (direction === "desc" ? "descending" : "ascending") : "none"}>
                    <button type="button" className="sort" onClick={() => chooseSort(field)}>{SORT_LABELS[field]}</button>
                  </th>
                ))}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {students.map((row) => {
                const enrollments: Array<StudentEnrollment | null> = row.enrollments.length ? row.enrollments : [null];
                return enrollments.map((item, index) => (
                  <tr key={`${row.id}-${item?.id || index}`}>
                    {index === 0 ? <td rowSpan={enrollments.length}>{recordedName(row.display_name)}</td> : null}
                    {index === 0 ? <td className="nowrap" rowSpan={enrollments.length}>{row.student_code}</td> : null}
                    <td>{recordedName(item?.branch_name)}</td>
                    <td>{recordedName(item?.course_name)}</td>
                    <td>{recordedName(item?.batch_name)}</td>
                    <td>{recordedDate(item?.started_on)}</td>
                    <td>{recordedDate(item?.ended_on)}</td>
                    <td>{recordedStatus(item?.status)}</td>
                    {index === 0 ? (
                      <td rowSpan={enrollments.length}>
                        <div className="icon-actions">
                          <Link to={studentRecordHref(row.id, path, applied)} aria-label={`View ${row.display_name}`} title="View student"><Icon name="view" /></Link>
                          {row.actions?.edit ? <Link to={studentRecordHref(row.id, path, applied, true)} aria-label={`Edit ${row.display_name}`} title="Edit"><Icon name="edit" /></Link> : null}
                          {row.actions?.card ? <Link to={cardHref(row.id)} aria-label={`View progress card for ${row.display_name}`} title="View progress card"><Icon name="card" /></Link> : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ));
              })}
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

