import { ChangeEvent, FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, Session } from "../api";
import { Option, optionFits } from "../filters";
import { StudentEnrollment, StudentFilters, recordedDate, recordedName, recordedStatus, studentRecordHref } from "../students";

type Unit = { id: string; name: string; kind: string };
type Row = {
  id: string;
  name: string;
  archived: boolean;
  student_code?: string;
  branch_id?: string;
  course_id?: string;
  subject_id?: string;
  number?: number;
  notes?: string;
  started_on?: string;
  ended_on?: string;
  timings?: string;
  units?: Unit[];
};
type Offering = { id: string; branch_id?: string; course_id?: string };
type Catalog = { branches: Row[]; courses: Row[]; batches: Row[]; subjects: Row[]; papers: Row[]; students: Row[]; offerings: Offering[] };
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

const KIND = { branches: "branch", courses: "course", batches: "batch", subjects: "subject", students: "student", papers: "paper" } as const;
type CatalogKind = "branches" | "courses" | "batches" | "subjects" | "papers";
type CatalogChange = { name?: string; archived?: boolean; notes?: string; started_on?: string; ended_on?: string; timings?: string };

function byName(rows: Row[]) {
  return [...rows].sort((left, right) => left.name.localeCompare(right.name));
}

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

  async function correct(kind: CatalogKind, row: Row, body: CatalogChange) {
    setError("");
    await api(`/api/v1/catalog/${KIND[kind]}/${row.id}`, { method: "PATCH", body: JSON.stringify(body) });
    setMessage(body.name ? `Renamed ${row.name}. The previous name stays on the record.` : body.archived ? `Archived ${row.name}.` : body.archived === false ? `Restored ${row.name}.` : `Saved ${row.name}.`);
    await load();
  }

  return { catalog, error, message, correct, reload: load, setMessage, setError };
}

function CatalogEditor({ kind, row, onClose, onSave }: { kind: CatalogKind; row: Row; onClose: () => void; onSave: (body: CatalogChange) => Promise<void> }) {
  const label = KIND[kind];
  const [name, setName] = useState(row.name);
  const [archived, setArchived] = useState(row.archived);
  const [notes, setNotes] = useState(row.notes || "");
  const [startedOn, setStartedOn] = useState(row.started_on || "");
  const [endedOn, setEndedOn] = useState(row.ended_on || "");
  const [timings, setTimings] = useState(row.timings || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const schedule = kind === "batches";
  const withNotes = kind === "courses";
  const dirty = name.trim() !== row.name || archived !== row.archived || (withNotes && notes !== (row.notes || "")) || (schedule && (startedOn !== (row.started_on || "") || endedOn !== (row.ended_on || "") || timings !== (row.timings || "")));

  function requestClose() {
    if (dirty && !window.confirm("Discard the unsaved changes?")) return;
    onClose();
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a name.");
      return;
    }
    const body: CatalogChange = {};
    if (trimmed !== row.name) body.name = trimmed;
    if (archived !== row.archived) body.archived = archived;
    if (withNotes && notes !== (row.notes || "")) body.notes = notes;
    if (schedule && startedOn !== (row.started_on || "")) body.started_on = startedOn;
    if (schedule && endedOn !== (row.ended_on || "")) body.ended_on = endedOn;
    if (schedule && timings !== (row.timings || "")) body.timings = timings;
    if (!Object.keys(body).length) {
      onClose();
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(body);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save.");
      setSaving(false);
    }
  }

  return (
    <StudentDialog title={`Edit ${label}`} onClose={requestClose}>
      <form onSubmit={save}>
        <label>Name
          <input value={name} aria-label={`${label} name`} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>Status
          <select value={archived ? "archived" : "active"} aria-label="Status" onChange={(event) => setArchived(event.target.value === "archived")}>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        {withNotes ? (
          <label>Notes
            <textarea value={notes} rows={3} aria-label="Notes" onChange={(event) => setNotes(event.target.value)} />
          </label>
        ) : null}
        {schedule ? (
          <>
            <div className="form-grid">
              <label>From
                <input type="date" value={startedOn} aria-label="From" onChange={(event) => setStartedOn(event.target.value)} />
              </label>
              <label>Until
                <input type="date" value={endedOn} aria-label="Until" onChange={(event) => setEndedOn(event.target.value)} />
              </label>
            </div>
            <label>Timings
              <input value={timings} aria-label="Timings" onChange={(event) => setTimings(event.target.value)} />
            </label>
          </>
        ) : null}
        {error ? <p className="error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="quiet" onClick={requestClose}>Cancel</button>
          <button type="submit" disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </StudentDialog>
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

export function StudentDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = panelRef.current;
    const fields = node ? [...node.querySelectorAll<HTMLElement>("button, input, select")].filter((item) => !item.hasAttribute("disabled")) : [];
    (fields.find((item) => item.matches("input")) || fields[0] || node)?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal compact" role="dialog" aria-modal="true" aria-label={title} ref={panelRef} tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head"><h2>{title}</h2><button type="button" className="quiet" onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>
  );
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

export function Icon({ name }: { name: "view" | "edit" | "card" | "filter" | "clear" | "sort" | "add" }) {
  const common = { viewBox: "0 0 24 24", width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "view") {
    return (
      <svg {...common}>
        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
        <circle cx="12" cy="12" r="2.5" />
      </svg>
    );
  }
  if (name === "edit") {
    return (
      <svg {...common}>
        <path d="M4 20h4l10-10-4-4L4 16v4z" />
        <path d="M13 7l4 4" />
      </svg>
    );
  }
  if (name === "filter") {
    return (
      <svg {...common}>
        <path d="M4 5h16l-6 7v6l-4 2v-8L4 5z" />
      </svg>
    );
  }
  if (name === "clear") {
    return (
      <svg {...common}>
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    );
  }
  if (name === "sort") {
    return (
      <svg {...common}>
        <path d="M8 7V19M8 19l-3-3M8 19l3-3M16 17V5M16 5l-3 3M16 5l3 3" />
      </svg>
    );
  }
  if (name === "add") {
    return (
      <svg {...common}>
        <path d="M12 5v14M5 12h14" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  );
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
  const [message, setMessage] = useState("");
  const listKey = [applied.q, applied.branch_id, applied.course_id, applied.batch_id, sort, direction, page, listNonce].join("|");

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
      <Notes error={error} message={message} />
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
            setMessage("Merged. The source student is archived and the remaining student keeps both names.");
            setListNonce((value) => value + 1);
          }}
        />
      ) : null}
      {merging && !catalog ? <p role="status">Loading students for merge…</p> : null}
    </section>
  );
}

export type Place = {
  street: string | null;
  place: string | null;
  district: string | null;
  state: string | null;
  pin: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
};
type InstituteRecord = Place & { id: string; name: string; code: string };
const PLACE_FIELDS = [
  ["street", "House and street"],
  ["place", "Place"],
  ["district", "District"],
  ["state", "State"],
  ["pin", "PIN"],
  ["phone", "Phone"],
  ["email", "Email"],
  ["notes", "Notes"],
] as const;

export function PlaceFacts({ values }: { values: Place }) {
  return (
    <dl className="facts">
      {PLACE_FIELDS.map(([key, label]) => (
        <div key={key} className={key === "street" || key === "notes" ? "span-2" : undefined}>
          <dt>{label}</dt>
          <dd className={values[key] ? undefined : "is-empty"}>{values[key] || "Not recorded"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function InstitutePage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const { catalog, error, message } = useCatalog();
  const [institute, setInstitute] = useState<InstituteRecord | null>(null);
  const [editingInstitute, setEditingInstitute] = useState(false);
  const [adding, setAdding] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [localError, setLocalError] = useState("");
  const canCorrect = session.actions.includes("catalog.correct") || session.actions.includes("catalog.manage");

  useEffect(() => {
    api<InstituteRecord>("/api/v1/institute").then(setInstitute).catch((reason: Error) => setLocalError(reason.message));
  }, [message]);

  if (!catalog || !institute) {
    return <section className="panel">{error || localError ? <p className="error" role="alert">{error || localError}</p> : <p>Loading institute…</p>}</section>;
  }
  const branches = byName(catalog.branches);
  function coursesFor(branchId: string) {
    const ids = new Set(catalog?.offerings.filter((item) => item.branch_id === branchId).map((item) => item.course_id));
    return byName((catalog?.courses || []).filter((item) => ids.has(item.id)));
  }
  async function addBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError("");
    try {
      const created = await api<{ id: string }>("/api/v1/branches", { method: "POST", body: JSON.stringify({ name: branchName.trim() }) });
      setAdding(false);
      setBranchName("");
      navigate(`/institute/branches/${created.id}`);
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : "Could not add the branch.");
    }
  }
  return (
    <section className="panel wide">
      <div className="title-row">
        <div>
          <p className="eyebrow">Institute</p>
          <h1>{institute.name}</h1>
          <p className="meta">Code {institute.code}</p>
        </div>
        {canCorrect ? (
          <div className="icon-actions">
            <button type="button" onClick={() => setEditingInstitute(true)} aria-label="Edit institute" title="Edit"><Icon name="edit" /></button>
          </div>
        ) : null}
      </div>
      <PlaceFacts values={institute} />
      <Notes error={error || localError} message={message} />
      <div className="title-row">
        <h2>Branches</h2>
        {canCorrect ? (
          <div className="icon-actions">
            <button type="button" onClick={() => { setAdding(true); setBranchName(""); setLocalError(""); }} aria-label="Add branch" title="Add branch"><Icon name="add" /></button>
          </div>
        ) : null}
      </div>
      {branches.length === 0 ? <p>No branches yet. Import a marklist to create these records.</p> : (
        <div className="table-wrap">
          <table className="people-table">
            <caption className="sr-only">Branches for {institute.name}.</caption>
            <thead>
              <tr>
                <th>Branch</th>
                <th>Status</th>
                <th>Courses</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {branches.map((row) => {
                const courses = coursesFor(row.id);
                return (
                  <tr key={row.id}>
                    <td><Link to={`/institute/branches/${row.id}`}>{row.name}</Link></td>
                    <td>{row.archived ? "Archived" : "Active"}</td>
                    <td>
                      {courses.length === 0 ? "None yet" : (
                        <span className="cell-links">
                          {courses.map((course) => <Link key={course.id} to={`/courses/${course.id}`}>{course.name}</Link>)}
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="icon-actions">
                        <Link to={`/institute/branches/${row.id}`} aria-label={`Open ${row.name}`} title="Open branch"><Icon name="edit" /></Link>
                        <Link to={`/views?level=branch&branch_id=${row.id}`} aria-label={`View ${row.name}`} title="View branch"><Icon name="view" /></Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editingInstitute ? <InstituteEditor institute={institute} onClose={() => setEditingInstitute(false)} onSaved={setInstitute} /> : null}
      {adding ? (
        <StudentDialog title="Add branch" onClose={() => setAdding(false)}>
          <form onSubmit={addBranch}>
            <label>Name
              <input value={branchName} aria-label="Branch name" onChange={(event) => setBranchName(event.target.value)} />
            </label>
            {localError ? <p className="error" role="alert">{localError}</p> : null}
            <div className="dialog-actions">
              <button type="button" className="quiet" onClick={() => setAdding(false)}>Cancel</button>
              <div className="icon-actions">
                <button type="submit" disabled={!branchName.trim()} aria-label="Add branch" title="Add branch"><Icon name="add" /></button>
              </div>
            </div>
          </form>
        </StudentDialog>
      ) : null}
    </section>
  );
}

function InstituteEditor({ institute, onClose, onSaved }: { institute: InstituteRecord; onClose: () => void; onSaved: (value: InstituteRecord) => void }) {
  const [draft, setDraft] = useState({ name: institute.name, street: institute.street || "", place: institute.place || "", district: institute.district || "", state: institute.state || "", pin: institute.pin || "", phone: institute.phone || "", email: institute.email || "", notes: institute.notes || "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.name.trim()) {
      setError("Enter a name.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api("/api/v1/institute", { method: "PATCH", body: JSON.stringify(draft) });
      onSaved(await api<InstituteRecord>("/api/v1/institute"));
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save.");
      setSaving(false);
    }
  }
  function change(key: keyof typeof draft) {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft((current) => ({ ...current, [key]: event.target.value }));
  }
  return (
    <StudentDialog title="Edit institute" onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <label className="span-2">Name
          <input value={draft.name} aria-label="Institute name" onChange={change("name")} />
        </label>
        <p className="meta span-2">Code {institute.code}</p>
        <label className="span-2">House and street
          <textarea value={draft.street} rows={2} aria-label="House and street" onChange={change("street")} />
        </label>
        <label>Place
          <input value={draft.place} aria-label="Place" onChange={change("place")} />
        </label>
        <label>District
          <input value={draft.district} aria-label="District" onChange={change("district")} />
        </label>
        <label>State
          <input value={draft.state} aria-label="State" onChange={change("state")} />
        </label>
        <label>PIN
          <input value={draft.pin} inputMode="numeric" maxLength={6} aria-label="PIN" onChange={change("pin")} />
        </label>
        <label>Phone
          <input value={draft.phone} aria-label="Phone" onChange={change("phone")} />
        </label>
        <label>Email
          <input value={draft.email} aria-label="Email" onChange={change("email")} />
        </label>
        <label className="span-2">Notes
          <textarea value={draft.notes} rows={3} aria-label="Notes" onChange={change("notes")} />
        </label>
        {error ? <p className="error span-2" role="alert">{error}</p> : null}
        <div className="dialog-actions span-2">
          <button type="button" className="quiet" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={saving || !draft.name.trim()}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </StudentDialog>
  );
}

export function CoursesPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const { catalog, error, message, reload, setMessage, setError } = useCatalog();
  const [params] = useSearchParams();
  const [addingCourse, setAddingCourse] = useState(false);
  const [courseName, setCourseName] = useState("");
  const canCorrect = session.actions.includes("catalog.correct") || session.actions.includes("catalog.manage");
  if (!catalog) {
    return <section className="panel">{error ? <p className="error" role="alert">{error}</p> : <p>Loading courses…</p>}</section>;
  }
  const requested = params.get("course") || "";
  if (catalog.courses.some((row) => row.id === requested)) {
    return <Navigate to={`/courses/${requested}`} replace />;
  }
  const courses = byName(catalog.courses);

  function branchesFor(courseId: string) {
    return byName(catalog!.offerings
      .filter((item) => item.course_id === courseId)
      .map((item) => catalog!.branches.find((branch) => branch.id === item.branch_id))
      .filter((branch): branch is Row => Boolean(branch)));
  }

  async function addCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      const created = await api<{ id: string }>("/api/v1/courses", { method: "POST", body: JSON.stringify({ name: courseName.trim() }) });
      await reload();
      setAddingCourse(false);
      setCourseName("");
      setMessage("Added the course.");
      navigate(`/courses/${created.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add the course.");
    }
  }

  return (
    <section className="panel wide">
      <Notes error={error} message={message} />
      <div className="title-row">
        <div>
          <p className="eyebrow">Courses</p>
          <h1>Courses</h1>
        </div>
        {canCorrect ? (
          <div className="icon-actions">
            <button type="button" onClick={() => { setAddingCourse(true); setCourseName(""); setError(""); }} aria-label="Add course" title="Add course"><Icon name="add" /></button>
          </div>
        ) : null}
      </div>
      {courses.length === 0 ? <p>No courses yet. Import a marklist to create these records.</p> : (
        <div className="table-wrap">
          <table className="people-table">
            <caption className="sr-only">Courses.</caption>
            <thead>
              <tr>
                <th>Course</th>
                <th>Status</th>
                <th>Offered at</th>
                <th>Subjects</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((row) => {
                const branches = branchesFor(row.id);
                const subjects = byName(catalog.subjects.filter((subject) => subject.course_id === row.id));
                return (
                  <tr key={row.id}>
                    <td><Link to={`/courses/${row.id}`}>{row.name}</Link></td>
                    <td>{row.archived ? "Archived" : "Active"}</td>
                    <td>
                      {branches.length === 0 ? "None yet" : (
                        <span className="cell-links">
                          {branches.map((branch) => <Link key={branch.id} to={`/institute/branches/${branch.id}`}>{branch.name}</Link>)}
                        </span>
                      )}
                    </td>
                    <td>{subjects.length === 0 ? "None yet" : subjects.map((subject) => subject.name).join(", ")}</td>
                    <td>
                      <div className="icon-actions">
                        <Link to={`/courses/${row.id}`} aria-label={`Open ${row.name}`} title="Open course"><Icon name="edit" /></Link>
                        <Link to={`/views?level=course&course_id=${row.id}`} aria-label={`View ${row.name}`} title="View course"><Icon name="view" /></Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {addingCourse ? (
        <StudentDialog title="Add course" onClose={() => setAddingCourse(false)}>
          <form onSubmit={addCourse}>
            <label>Name
              <input value={courseName} aria-label="Course name" onChange={(event) => setCourseName(event.target.value)} />
            </label>
            {error ? <p className="error" role="alert">{error}</p> : null}
            <div className="dialog-actions">
              <button type="button" className="quiet" onClick={() => setAddingCourse(false)}>Cancel</button>
              <div className="icon-actions">
                <button type="submit" disabled={!courseName.trim()} aria-label="Add course" title="Add course"><Icon name="add" /></button>
              </div>
            </div>
          </form>
        </StudentDialog>
      ) : null}
    </section>
  );
}

export function CoursePage({ session }: { session: Session }) {
  const { courseId = "" } = useParams();
  const { catalog, error, message, correct, reload, setMessage, setError } = useCatalog();
  const [editing, setEditing] = useState<{ kind: CatalogKind; row: Row } | null>(null);
  const [subjectId, setSubjectId] = useState("");
  const [addingItem, setAddingItem] = useState(false);
  const [addingSubject, setAddingSubject] = useState(false);
  const canCorrect = session.actions.includes("catalog.correct") || session.actions.includes("catalog.manage");
  if (!catalog) {
    return <section className="panel">{error ? <p className="error" role="alert">{error}</p> : <p>Loading course…</p>}</section>;
  }
  const course = catalog.courses.find((row) => row.id === courseId);
  if (!course) {
    return (
      <section className="panel">
        <p className="meta"><Link to="/courses">Courses</Link></p>
        <p>This course is not in the catalog.</p>
      </section>
    );
  }
  const subjects = byName(catalog.subjects.filter((row) => row.course_id === course.id));
  const subject = subjects.find((row) => row.id === subjectId) || subjects[0];
  const papers = catalog.papers.filter((row) => row.subject_id === subject?.id).sort((left, right) => (left.number || 0) - (right.number || 0));
  const offered = byName(catalog.offerings
    .filter((item) => item.course_id === course.id)
    .map((item) => catalog.branches.find((branch) => branch.id === item.branch_id))
    .filter((branch): branch is Row => Boolean(branch)));

  return (
    <section className="panel wide">
      <p className="meta"><Link to="/courses">Courses</Link></p>
      <Notes error={error} message={message} />
      <div className="title-row">
        <div>
          <p className="eyebrow">Course</p>
          <h1>{course.name}</h1>
          <p className="meta">{course.archived ? "Archived" : "Active"}</p>
          <p className={course.notes ? undefined : "meta"}>{course.notes || "Not recorded"}</p>
          <p className="meta">
            Offered at {offered.length === 0 ? "no branch yet" : offered.map((branch, index) => (
              <span key={branch.id}>{index > 0 ? ", " : ""}<Link to={`/institute/branches/${branch.id}`}>{branch.name}</Link></span>
            ))}.
          </p>
          <p className="meta">Marklists use Unit, Part, and Chapter. These names stay the same for every course.</p>
        </div>
        <div className="icon-actions">
          {canCorrect ? <button type="button" onClick={() => setEditing({ kind: "courses", row: course })} aria-label={`Edit ${course.name}`} title="Edit"><Icon name="edit" /></button> : null}
          <Link to={`/views?level=course&course_id=${course.id}`} aria-label={`View ${course.name}`} title="View course"><Icon name="view" /></Link>
        </div>
      </div>
      <div className="title-row">
        <h2>Subjects</h2>
        {canCorrect ? (
          <div className="icon-actions">
            <button type="button" onClick={() => { setAddingSubject(true); setError(""); }} aria-label="Add subject" title="Add subject"><Icon name="add" /></button>
          </div>
        ) : null}
      </div>
      {subjects.length === 0 ? <p>No subjects yet.</p> : (
        <>
          <label>Subject
            <select value={subject?.id || ""} aria-label="Subject" onChange={(event) => setSubjectId(event.target.value)}>
              {subjects.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label>
          <div className="title-row">
            <h2>Papers, chapters, and modules</h2>
            {canCorrect && subject ? (
              <div className="icon-actions">
                <button type="button" onClick={() => setEditing({ kind: "subjects", row: subject })} aria-label={`Edit ${subject.name}`} title="Edit subject"><Icon name="edit" /></button>
                <button type="button" onClick={() => setAddingItem(true)} aria-label="Add paper, chapter, or module" title="Add paper, chapter, or module"><Icon name="add" /></button>
              </div>
            ) : null}
          </div>
          <SubjectItems subject={subject} papers={papers} canCorrect={canCorrect} onEditPaper={(row) => setEditing({ kind: "papers", row })} onChanged={async () => { setMessage(`Saved ${subject?.name || "the subject"}.`); await reload(); }} onError={setError} />
        </>
      )}
      {editing ? (
        <CatalogEditor kind={editing.kind} row={editing.row} onClose={() => setEditing(null)} onSave={(body) => correct(editing.kind, editing.row, body)} />
      ) : null}
      {addingItem && subject ? (
        <ItemForm subject={subject} onClose={() => setAddingItem(false)} onSaved={async (label) => { setMessage(`Added ${label} to ${subject.name}.`); setAddingItem(false); await reload(); }} />
      ) : null}
      {addingSubject ? (
        <SubjectForm
          courseId={course.id}
          onClose={() => setAddingSubject(false)}
          onSaved={async (created) => { setSubjectId(created.id); setMessage(`Added ${created.name}.`); setAddingSubject(false); await reload(); }}
        />
      ) : null}
    </section>
  );
}

export function BatchesPage({ session }: { session: Session }) {
  const { catalog, error, message, correct, reload, setMessage, setError } = useCatalog();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Row | null>(null);
  const [adding, setAdding] = useState(false);
  const canCorrect = session.actions.includes("catalog.correct") || session.actions.includes("catalog.manage");
  if (!catalog) {
    return <section className="panel">{error ? <p className="error" role="alert">{error}</p> : <p>Loading batches…</p>}</section>;
  }
  const requested = params.get("course") || "";
  const courseId = catalog.courses.some((row) => row.id === requested) ? requested : "";
  const batches = byName(catalog.batches.filter((row) => !courseId || row.course_id === courseId));
  const courseName = (id?: string) => catalog.courses.find((row) => row.id === id)?.name || "Not recorded";
  const branchName = (id?: string) => catalog.branches.find((row) => row.id === id)?.name || "Not recorded";

  function chooseCourse(id: string) {
    const next = new URLSearchParams(params);
    if (id) next.set("course", id);
    else next.delete("course");
    setParams(next, { replace: true });
  }

  function branchesFor(id: string) {
    const offered = new Set(catalog?.offerings.filter((item) => item.course_id === id).map((item) => item.branch_id));
    return byName((catalog?.branches || []).filter((row) => offered.has(row.id)));
  }

  return (
    <section className="panel wide">
      <Notes error={error} message={message} />
      <div className="title-row">
        <div>
          <p className="eyebrow">Batches</p>
          <h1>Batches</h1>
          <label>Course
            <select value={courseId} aria-label="Course" onChange={(event) => chooseCourse(event.target.value)}>
              <option value="">All courses</option>
              {byName(catalog.courses).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label>
        </div>
        {canCorrect ? (
          <div className="icon-actions">
            <button type="button" onClick={() => { setAdding(true); setError(""); }} aria-label="Add batch" title="Add batch"><Icon name="add" /></button>
          </div>
        ) : null}
      </div>
      {batches.length === 0 ? <p>No batches yet. Import a marklist to create these records.</p> : (
        <div className="table-wrap">
          <table className="people-table">
            <caption className="sr-only">Batches.</caption>
            <thead>
              <tr>
                <th>Batch</th>
                <th>Course</th>
                <th>Branch</th>
                <th>From</th>
                <th>Until</th>
                <th>Timings</th>
                <th>Status</th>
                {canCorrect ? <th>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {batches.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.course_id ? <Link to={`/courses/${row.course_id}`}>{courseName(row.course_id)}</Link> : "Not recorded"}</td>
                  <td>{row.branch_id ? <Link to={`/institute/branches/${row.branch_id}`}>{branchName(row.branch_id)}</Link> : "Not recorded"}</td>
                  <td>{row.started_on || "Not recorded"}</td>
                  <td>{row.ended_on || "Not recorded"}</td>
                  <td>{row.timings || "Not recorded"}</td>
                  <td>{row.archived ? "Archived" : "Active"}</td>
                  {canCorrect ? (
                    <td>
                      <div className="icon-actions">
                        <button type="button" onClick={() => setEditing(row)} aria-label={`Edit ${row.name}`} title="Edit"><Icon name="edit" /></button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing ? (
        <CatalogEditor kind="batches" row={editing} onClose={() => setEditing(null)} onSave={(body) => correct("batches", editing, body)} />
      ) : null}
      {adding ? (
        <BatchForm
          courses={byName(catalog.courses)}
          courseId={courseId || catalog.courses[0]?.id || ""}
          branchesFor={branchesFor}
          onClose={() => setAdding(false)}
          onSaved={async (name) => { setMessage(`Added ${name}.`); setAdding(false); await reload(); }}
        />
      ) : null}
    </section>
  );
}
function SubjectItems({
  subject,
  papers,
  canCorrect,
  onEditPaper,
  onChanged,
  onError,
}: {
  subject?: Row;
  papers: Row[];
  canCorrect: boolean;
  onEditPaper: (row: Row) => void;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState<Unit | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const units = subject?.units || [];
  if (!subject) return null;
  const rows = [
    ...papers.map((row) => ({ id: row.id, name: row.name, kind: "Paper", detail: row.number != null ? String(row.number) : "Not recorded", paper: row })),
    ...units.map((row) => ({ id: row.id, name: row.name, kind: row.kind === "module" ? "Module" : "Chapter", detail: "Not recorded", paper: null as Row | null })),
  ];
  if (rows.length === 0) return <p>No papers, chapters, or modules yet.</p>;
  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || !subject) return;
    setError("");
    try {
      await api(`/api/v1/subjects/${subject.id}/items/${editing.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
      setEditing(null);
      await onChanged();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Could not save.";
      setError(message);
      onError(message);
    }
  }
  return (
    <>
      <div className="table-wrap">
        <table className="people-table">
          <caption className="sr-only">Items for {subject.name}.</caption>
          <thead>
            <tr>
              <th>Kind</th>
              <th>Name</th>
              <th>Paper</th>
              {canCorrect ? <th>Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.kind}-${row.id}`}>
                <td>{row.kind}</td>
                <td>{row.name}</td>
                <td>{row.detail}</td>
                {canCorrect ? (
                  <td>
                    <div className="icon-actions">
                      <button type="button" aria-label={`Edit ${row.name}`} title="Edit" onClick={() => {
                        if (row.paper) onEditPaper(row.paper);
                        else {
                          const unit = units.find((item) => item.id === row.id);
                          if (unit) {
                            setEditing(unit);
                            setName(unit.name);
                            setError("");
                          }
                        }
                      }}><Icon name="edit" /></button>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing ? (
        <StudentDialog title="Edit item" onClose={() => setEditing(null)}>
          <form onSubmit={saveItem}>
            <label>Name
              <input value={name} aria-label="Item name" onChange={(event) => setName(event.target.value)} />
            </label>
            {error ? <p className="error" role="alert">{error}</p> : null}
            <div className="dialog-actions">
              <button type="button" className="quiet" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" disabled={!name.trim()}>Save</button>
            </div>
          </form>
        </StudentDialog>
      ) : null}
    </>
  );
}

function BatchForm({
  courses,
  courseId,
  branchesFor,
  onClose,
  onSaved,
}: {
  courses: Row[];
  courseId: string;
  branchesFor: (courseId: string) => Row[];
  onClose: () => void;
  onSaved: (name: string) => Promise<void>;
}) {
  const [selectedCourse, setSelectedCourse] = useState(courseId);
  const branches = branchesFor(selectedCourse);
  const [branchId, setBranchId] = useState(branches[0]?.id || "");
  const [name, setName] = useState("");
  const [startedOn, setStartedOn] = useState("");
  const [endedOn, setEndedOn] = useState("");
  const [timings, setTimings] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function chooseCourse(id: string) {
    setSelectedCourse(id);
    setBranchId(branchesFor(id)[0]?.id || "");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCourse) {
      setError("Add a course before adding a batch.");
      return;
    }
    if (!branchId) {
      setError("Offer this course at a branch before adding a batch.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api(`/api/v1/branches/${branchId}/batches`, {
        method: "POST",
        body: JSON.stringify({ course_id: selectedCourse, name, started_on: startedOn, ended_on: endedOn, timings }),
      });
      await onSaved(name.trim());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add the batch.");
      setSaving(false);
    }
  }
  return (
    <StudentDialog title="Add batch" onClose={onClose}>
      <form onSubmit={save}>
        <label>Course
          <select value={selectedCourse} aria-label="Course" onChange={(event) => chooseCourse(event.target.value)}>
            {courses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        <label>Branch
          <select value={branchId} aria-label="Branch" onChange={(event) => setBranchId(event.target.value)}>
            {branches.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        <label>Name
          <input value={name} aria-label="Batch name" onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="form-grid">
          <label>From
            <input type="date" value={startedOn} aria-label="From" onChange={(event) => setStartedOn(event.target.value)} />
          </label>
          <label>Until
            <input type="date" value={endedOn} aria-label="Until" onChange={(event) => setEndedOn(event.target.value)} />
          </label>
        </div>
        <label>Timings
          <input value={timings} aria-label="Timings" onChange={(event) => setTimings(event.target.value)} />
        </label>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="quiet" onClick={onClose}>Cancel</button>
          <div className="icon-actions">
            <button type="submit" disabled={saving || !name.trim()} aria-label="Add batch" title="Add batch"><Icon name="add" /></button>
          </div>
        </div>
      </form>
    </StudentDialog>
  );
}

function SubjectForm({ courseId, onClose, onSaved }: { courseId: string; onClose: () => void; onSaved: (created: { id: string; name: string }) => Promise<void> }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const created = await api<{ id: string }>(`/api/v1/courses/${courseId}/subjects`, { method: "POST", body: JSON.stringify({ name: name.trim() }) });
      await onSaved({ id: created.id, name: name.trim() });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add the subject.");
      setSaving(false);
    }
  }
  return (
    <StudentDialog title="Add subject" onClose={onClose}>
      <form onSubmit={save}>
        <label>Name
          <input value={name} aria-label="Subject name" onChange={(event) => setName(event.target.value)} />
        </label>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="quiet" onClick={onClose}>Cancel</button>
          <div className="icon-actions">
            <button type="submit" disabled={saving || !name.trim()} aria-label="Add subject" title="Add subject"><Icon name="add" /></button>
          </div>
        </div>
      </form>
    </StudentDialog>
  );
}

function ItemForm({ subject, onClose, onSaved }: { subject: Row; onClose: () => void; onSaved: (label: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("paper");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(`/api/v1/subjects/${subject.id}/items`, { method: "POST", body: JSON.stringify({ name, kind }) });
      const label = kind === "module" ? "the module" : kind === "chapter" ? "the chapter" : "the paper";
      await onSaved(`${label} ${name.trim()}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add the item.");
      setSaving(false);
    }
  }
  return (
    <StudentDialog title="Add paper, chapter, or module" onClose={onClose}>
      <form onSubmit={save}>
        <label>Name
          <input value={name} aria-label="Item name" onChange={(event) => setName(event.target.value)} />
        </label>
        <label>Kind
          <select value={kind} aria-label="Kind" onChange={(event) => setKind(event.target.value)}>
            <option value="paper">Paper</option>
            <option value="chapter">Chapter</option>
            <option value="module">Module</option>
          </select>
        </label>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="quiet" onClick={onClose}>Cancel</button>
          <div className="icon-actions">
            <button type="submit" disabled={saving || !name.trim()} aria-label="Add paper, chapter, or module" title="Add paper, chapter, or module"><Icon name="add" /></button>
          </div>
        </div>
      </form>
    </StudentDialog>
  );
}
