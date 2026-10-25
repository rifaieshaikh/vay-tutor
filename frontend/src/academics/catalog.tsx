import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, Session } from "../api";
import { notify } from "../notify";
import { formatDisplayDate } from "../format";
import { useRecordLabel } from "../orientation";
import { StudentDialog, moveTab } from "../ui";
import { CurriculumKind, kindLabel, useCurriculumKinds } from "./kinds";
import {
  FilterActions,
  ListToolbar,
  Pager,
  SortHeader,
  TruncationNote,
  batchState,
  compareOptional,
  compareText,
  intakeLabel,
  pageOf,
  putParam,
  readChoice,
  sortParts,
  toggleSort,
  usePageClamp,
} from "./lists";

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
  kind?: string;
  notes?: string;
  started_on?: string;
  ended_on?: string;
  timings?: string;
  session_key?: string;
  closed?: boolean;
  units?: Unit[];
  revision?: number;
};
type Offering = { id: string; branch_id?: string; course_id?: string };
type Catalog = { branches: Row[]; courses: Row[]; batches: Row[]; subjects: Row[]; papers: Row[]; students: Row[]; offerings: Offering[]; truncated?: boolean };

const KIND = { branches: "branch", courses: "course", batches: "batch", subjects: "subject", students: "student", papers: "paper" } as const;
type CatalogKind = "branches" | "courses" | "batches" | "subjects" | "papers";
type CatalogChange = { name?: string; archived?: boolean; closed?: boolean; notes?: string; started_on?: string; ended_on?: string; timings?: string; expected_revision?: number };

function byName(rows: Row[]) {
  return [...rows].sort((left, right) => left.name.localeCompare(right.name));
}

function useCatalog() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState("");

  async function load() {
    setCatalog(await api<Catalog>("/api/v1/catalog"));
  }

  useEffect(() => {
    load().catch((reason: Error) => setError(reason.message));
  }, []);

  async function correct(kind: CatalogKind, row: Row, body: CatalogChange) {
    setError("");
    await api(`/api/v1/catalog/${KIND[kind]}/${row.id}`, { method: "PATCH", body: JSON.stringify(body) });
    notify(body.name ? `Renamed ${row.name}. The previous name stays on the record.` : body.archived ? `Archived ${row.name}.` : body.archived === false ? `Restored ${row.name}.` : `Saved ${row.name}.`);
    await load();
  }

  return { catalog, error, correct, reload: load, setError };
}

function CatalogEditor({ kind, row, onClose, onSave }: { kind: CatalogKind; row: Row; onClose: () => void; onSave: (body: CatalogChange) => Promise<void> }) {
  const label = KIND[kind];
  const [name, setName] = useState(row.name);
  const [archived, setArchived] = useState(row.archived);
  const [notes, setNotes] = useState(row.notes || "");
  const [startedOn, setStartedOn] = useState(row.started_on || "");
  const [endedOn, setEndedOn] = useState(row.ended_on || "");
  const [timings, setTimings] = useState(row.timings || "");
  const [closed, setClosed] = useState(Boolean(row.closed));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const schedule = kind === "batches";
  const withNotes = kind === "courses";
  const dirty = name.trim() !== row.name || archived !== row.archived || (schedule && closed !== Boolean(row.closed)) || (withNotes && notes !== (row.notes || "")) || (schedule && (startedOn !== (row.started_on || "") || endedOn !== (row.ended_on || "") || timings !== (row.timings || "")));

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
    if (schedule && closed !== Boolean(row.closed)) body.closed = closed;
    if (!Object.keys(body).length) {
      onClose();
      return;
    }
    body.expected_revision = row.revision || 0;
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
        {archived !== row.archived ? (
          <p className="meta">
            {archived
              ? "Archiving keeps existing offerings, batches, enrollments, assignments, and results. New offerings, batches, subjects, and items stay out until this record is restored."
              : "Restoring allows new records under this one again. Children that were already archived stay archived."}
          </p>
        ) : null}
        {withNotes ? (
          <label>Notes
            <textarea value={notes} rows={3} aria-label="Notes" onChange={(event) => setNotes(event.target.value)} />
          </label>
        ) : null}
        {schedule ? (
          <>
            <label>
              <input type="checkbox" checked={closed} aria-label="Closed" onChange={(event) => setClosed(event.target.checked)} /> Closed
            </label>
            <p className="meta">Closing the batch keeps new enrollments out. The end date stays a date on the batch.</p>
            <div className="form-grid">
              <label>Start date
                <input type="date" value={startedOn} aria-label="Start date" onChange={(event) => setStartedOn(event.target.value)} />
              </label>
              <label>End date
                <input type="date" value={endedOn} aria-label="End date" onChange={(event) => setEndedOn(event.target.value)} />
              </label>
            </div>
            <p className="meta">Archiving keeps the batch, its enrollments, assignments, and results. An end date, including a future date, closes new enrollments immediately. Intake stays on the batch name. There is no timetable check.</p>
            <label>Schedule
              <input value={timings} aria-label="Schedule" onChange={(event) => setTimings(event.target.value)} />
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

function Notes({ error }: { error: string }) {
  if (!error) return null;
  return <p className="error" role="alert">{error}</p>;
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
type InstituteRecord = Place & { id: string; name: string; code: string; revision?: number };
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

const BRANCH_SORTS = [["name", "Name A–Z"], ["name_desc", "Name Z–A"]] as const;

export function InstitutePage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { catalog, error } = useCatalog();
  const [institute, setInstitute] = useState<InstituteRecord | null>(null);
  const [editingInstitute, setEditingInstitute] = useState(false);
  const [adding, setAdding] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [localError, setLocalError] = useState("");
  const [query, setQuery] = useState(params.get("q") || "");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const canCorrect = session.actions.includes("catalog.correct") || session.actions.includes("catalog.manage");
  useRecordLabel(institute?.name || "");

  useEffect(() => {
    api<InstituteRecord>("/api/v1/institute").then(setInstitute).catch((reason: Error) => setLocalError(reason.message));
  }, []);
  useEffect(() => { setQuery(params.get("q") || ""); }, [params]);

  const status = readChoice(params, "status", ["active", "archived"]);
  const courseId = catalog?.courses.some((row) => row.id === params.get("course_id")) ? params.get("course_id") || "" : "";
  const sort = readChoice(params, "sort", BRANCH_SORTS.map(([value]) => value)) || "name";
  const requestedPage = Math.max(1, Number(params.get("page")) || 1);
  const [draft, setDraft] = useState({ status, courseId });

  function coursesFor(branchId: string) {
    const ids = new Set(catalog?.offerings.filter((item) => item.branch_id === branchId).map((item) => item.course_id));
    return byName((catalog?.courses || []).filter((item) => ids.has(item.id)));
  }

  const needle = (params.get("q") || "").trim().toLowerCase();
  const direction = sortParts(sort).direction;
  const matched = (catalog?.branches || []).filter((row) => {
    if (needle && !row.name.toLowerCase().includes(needle)) return false;
    if (status === "active" && row.archived) return false;
    if (status === "archived" && !row.archived) return false;
    if (courseId && !coursesFor(row.id).some((course) => course.id === courseId)) return false;
    return true;
  }).sort((left, right) => compareText(left.name, right.name, direction) || left.id.localeCompare(right.id));
  const view = pageOf(matched, requestedPage);
  usePageClamp(catalog ? requestedPage : 1, catalog ? view.page : 1, params, setParams);

  if (!catalog || !institute) {
    return <section className="panel">{error || localError ? <p className="error" role="alert">{error || localError}</p> : <p>Loading institute…</p>}</section>;
  }

  function write(patch: Record<string, string>, resetPage = true) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) putParam(next, key, value);
    if (resetPage) next.delete("page");
    setParams(next);
  }
  function commitSearch() {
    write({ q: query.trim() });
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
  const courseName = catalog.courses.find((row) => row.id === courseId)?.name || "Selected course";
  const filtered = Boolean(needle || status || courseId);
  const chips = [
    needle ? { key: "q", label: `Search: ${params.get("q")}` } : null,
    status ? { key: "status", label: status === "archived" ? "Archived" : "Active" } : null,
    courseId ? { key: "course_id", label: courseName } : null,
  ].filter((item): item is { key: string; label: string } => Boolean(item));
  const summary = error ? "Branches could not be loaded." : view.total === 0 ? "0 branches" : `${view.from}–${view.to} of ${view.total}`;

  return (
    <section className="panel wide">
      <div className="title-row">
        <div>
          <p className="eyebrow">Institute</p>
          <h1>{institute.name}</h1>
          <p className="meta">Code {institute.code}</p>
        </div>
        {canCorrect ? <button type="button" className="secondary" onClick={() => setEditingInstitute(true)}>Edit institute</button> : null}
      </div>
      <PlaceFacts values={institute} />
      <Notes error={error || localError} />
      <div className="title-row">
        <h2>Branches</h2>
        {canCorrect ? (
          <button type="button" onClick={() => { setAdding(true); setBranchName(""); setLocalError(""); }}>Add branch</button>
        ) : null}
      </div>
      <TruncationNote truncated={catalog.truncated} />
      <ListToolbar
        searchLabel="Search branches"
        placeholder="Branch name"
        query={query}
        onQuery={setQuery}
        onSearch={commitSearch}
        sort={sort}
        sortOptions={BRANCH_SORTS}
        onSort={(value) => write({ sort: value === "name" ? "" : value })}
        onOpenFilters={() => { setDraft({ status, courseId }); setFiltersOpen(true); }}
        summary={summary}
        chips={chips}
        onRemove={(key) => write({ [key]: "" })}
        onClear={() => write({ q: "", status: "", course_id: "" })}
        filtered={filtered}
      />
      {view.total === 0 ? <p>{filtered ? "No branches match." : "No branches yet."}</p> : (
        <div className="table-wrap">
          <table className="people-table">
            <caption className="sr-only">{view.total} branches. Page {view.page} of {view.pages}. Sorted by name, {direction === "desc" ? "Z to A" : "A to Z"}.</caption>
            <thead>
              <tr>
                <SortHeader label="Branch" active={sortParts(sort).field === "name"} direction={direction} onClick={() => write({ sort: toggleSort(sort, "name") === "name" ? "" : toggleSort(sort, "name") })} />
                <th>Status</th>
                <th>Courses offered</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {view.items.map((row) => {
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
                      <div className="row-actions">
                        <Link to={`/views?level=branch&branch_id=${row.id}`}>View performance</Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager from={view.from} to={view.to} total={view.total} page={view.page} pages={view.pages} onPage={(page) => write({ page: page <= 1 ? "" : String(page) }, false)} />
      {editingInstitute ? <InstituteEditor institute={institute} onClose={() => setEditingInstitute(false)} onSaved={setInstitute} /> : null}
      {adding ? (
        <StudentDialog title="Add branch" onClose={() => setAdding(false)} dirty={Boolean(branchName.trim())}>
          <form onSubmit={addBranch}>
            <label>Name
              <input value={branchName} aria-label="Branch name" onChange={(event) => setBranchName(event.target.value)} />
            </label>
            {localError ? <p className="error" role="alert">{localError}</p> : null}
            <div className="dialog-actions">
              <button type="button" className="quiet" onClick={() => setAdding(false)}>Cancel</button>
              <button type="submit" disabled={!branchName.trim()}>Add branch</button>
            </div>
          </form>
        </StudentDialog>
      ) : null}
      {filtersOpen ? (
        <StudentDialog title="Filters" onClose={() => setFiltersOpen(false)}>
          <form className="form-grid" onSubmit={(event) => { event.preventDefault(); write({ status: draft.status, course_id: draft.courseId }); setFiltersOpen(false); }}>
            <label>Status
              <select aria-label="Status" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
                <option value="">Any status</option>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </label>
            <label>Course offered
              <select aria-label="Course offered" value={draft.courseId} onChange={(event) => setDraft({ ...draft, courseId: event.target.value })}>
                <option value="">Any course</option>
                {byName(catalog.courses).map((course) => <option key={course.id} value={course.id}>{course.name}{course.archived ? " (Archived)" : ""}</option>)}
              </select>
            </label>
            <FilterActions onReset={() => setDraft({ status: "", courseId: "" })} onClose={() => setFiltersOpen(false)} />
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
      await api("/api/v1/institute", { method: "PATCH", body: JSON.stringify({ ...draft, expected_revision: institute.revision || 0 }) });
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

const COURSE_SORTS = [["name", "Name A–Z"], ["name_desc", "Name Z–A"]] as const;

export function CoursesPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const { catalog, error, reload, setError } = useCatalog();
  const [params, setParams] = useSearchParams();
  const [addingCourse, setAddingCourse] = useState(false);
  const [courseName, setCourseName] = useState("");
  const [query, setQuery] = useState(params.get("q") || "");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const canCorrect = session.actions.includes("catalog.correct") || session.actions.includes("catalog.manage");
  const requested = params.get("course") || "";
  const returnBranch = params.get("return_branch") || "";
  useEffect(() => { setQuery(params.get("q") || ""); }, [params]);

  const status = readChoice(params, "status", ["active", "archived"]);
  const branchId = catalog?.branches.some((row) => row.id === params.get("branch_id")) ? params.get("branch_id") || "" : "";
  const sort = readChoice(params, "sort", COURSE_SORTS.map(([value]) => value)) || "name";
  const requestedPage = Math.max(1, Number(params.get("page")) || 1);
  const [draft, setDraft] = useState({ status, branchId });
  const needle = (params.get("q") || "").trim().toLowerCase();
  const direction = sortParts(sort).direction;

  function branchesFor(courseId: string) {
    return byName((catalog?.offerings || [])
      .filter((item) => item.course_id === courseId)
      .map((item) => catalog?.branches.find((branch) => branch.id === item.branch_id))
      .filter((branch): branch is Row => Boolean(branch)));
  }

  const matched = (catalog?.courses || []).filter((row) => {
    if (needle && !row.name.toLowerCase().includes(needle)) return false;
    if (status === "active" && row.archived) return false;
    if (status === "archived" && !row.archived) return false;
    if (branchId && !branchesFor(row.id).some((branch) => branch.id === branchId)) return false;
    return true;
  }).sort((left, right) => compareText(left.name, right.name, direction) || left.id.localeCompare(right.id));
  const view = pageOf(matched, requestedPage);
  usePageClamp(catalog ? requestedPage : 1, catalog ? view.page : 1, params, setParams);

  if (!catalog) {
    return <section className="panel">{error ? <p className="error" role="alert">{error}</p> : <p>Loading courses…</p>}</section>;
  }
  if (catalog.courses.some((row) => row.id === requested)) {
    return <Navigate to={`/courses/${requested}`} replace />;
  }

  function write(patch: Record<string, string>, resetPage = true) {
    const next = new URLSearchParams(params);
    next.delete("course");
    for (const [key, value] of Object.entries(patch)) putParam(next, key, value);
    if (resetPage) next.delete("page");
    setParams(next);
  }

  async function addCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      const created = await api<{ id: string }>("/api/v1/courses", { method: "POST", body: JSON.stringify({ name: courseName.trim() }) });
      await reload();
      setAddingCourse(false);
      setCourseName("");
      notify("Added the course.");
      if (returnBranch && catalog?.branches.some((row) => row.id === returnBranch)) {
        navigate(`/institute/branches/${returnBranch}?section=courses&offer=1`);
      } else {
        navigate(`/courses/${created.id}`);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add the course.");
    }
  }

  const branchName = catalog.branches.find((row) => row.id === branchId)?.name || "Selected branch";
  const filtered = Boolean(needle || status || branchId);
  const chips = [
    needle ? { key: "q", label: `Search: ${params.get("q")}` } : null,
    status ? { key: "status", label: status === "archived" ? "Archived" : "Active" } : null,
    branchId ? { key: "branch_id", label: branchName } : null,
  ].filter((item): item is { key: string; label: string } => Boolean(item));
  const summary = error ? "Courses could not be loaded." : view.total === 0 ? "0 courses" : `${view.from}–${view.to} of ${view.total}`;

  return (
    <section className="panel wide">
      <Notes error={error} />
      <div className="title-row">
        <div>
          <p className="eyebrow">Courses</p>
          <h1>Courses</h1>
        </div>
        {canCorrect ? (
          <button type="button" onClick={() => { setAddingCourse(true); setCourseName(""); setError(""); }}>Add course</button>
        ) : null}
      </div>
      {returnBranch ? <p className="meta">After this course is added, you return to the branch to offer it.</p> : null}
      <TruncationNote truncated={catalog.truncated} />
      <ListToolbar
        searchLabel="Search courses"
        placeholder="Course name"
        query={query}
        onQuery={setQuery}
        onSearch={() => write({ q: query.trim() })}
        sort={sort}
        sortOptions={COURSE_SORTS}
        onSort={(value) => write({ sort: value === "name" ? "" : value })}
        onOpenFilters={() => { setDraft({ status, branchId }); setFiltersOpen(true); }}
        summary={summary}
        chips={chips}
        onRemove={(key) => write({ [key]: "" })}
        onClear={() => write({ q: "", status: "", branch_id: "" })}
        filtered={filtered}
      />
      {view.total === 0 ? <p>{filtered ? "No courses match." : "No courses yet."}</p> : (
        <div className="table-wrap">
          <table className="people-table">
            <caption className="sr-only">{view.total} courses. Page {view.page} of {view.pages}. Sorted by name, {direction === "desc" ? "Z to A" : "A to Z"}.</caption>
            <thead>
              <tr>
                <SortHeader label="Course" active direction={direction} onClick={() => write({ sort: toggleSort(sort, "name") === "name" ? "" : toggleSort(sort, "name") })} />
                <th>Status</th>
                <th>Offered at</th>
                <th>Curriculum</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {view.items.map((row) => {
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
                    <td>{subjects.length === 0 ? "No subjects yet" : subjects.map((subject) => subject.name).join(", ")}</td>
                    <td>
                      <div className="row-actions">
                        <Link to={`/views?level=course&course_id=${row.id}`}>View performance</Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager from={view.from} to={view.to} total={view.total} page={view.page} pages={view.pages} onPage={(page) => write({ page: page <= 1 ? "" : String(page) }, false)} />
      {addingCourse ? (
        <StudentDialog title="Add course" onClose={() => setAddingCourse(false)} dirty={Boolean(courseName.trim())}>
          <form onSubmit={addCourse}>
            <label>Name
              <input value={courseName} aria-label="Course name" onChange={(event) => setCourseName(event.target.value)} />
            </label>
            {error ? <p className="error" role="alert">{error}</p> : null}
            <div className="dialog-actions">
              <button type="button" className="quiet" onClick={() => setAddingCourse(false)}>Cancel</button>
              <button type="submit" disabled={!courseName.trim()}>Add course</button>
            </div>
          </form>
        </StudentDialog>
      ) : null}
      {filtersOpen ? (
        <StudentDialog title="Filters" onClose={() => setFiltersOpen(false)}>
          <form className="form-grid" onSubmit={(event) => { event.preventDefault(); write({ status: draft.status, branch_id: draft.branchId }); setFiltersOpen(false); }}>
            <label>Status
              <select aria-label="Status" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
                <option value="">Any status</option>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </label>
            <label>Offered at
              <select aria-label="Offered at" value={draft.branchId} onChange={(event) => setDraft({ ...draft, branchId: event.target.value })}>
                <option value="">Any branch</option>
                {byName(catalog.branches).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}{branch.archived ? " (Archived)" : ""}</option>)}
              </select>
            </label>
            <FilterActions onReset={() => setDraft({ status: "", branchId: "" })} onClose={() => setFiltersOpen(false)} />
          </form>
        </StudentDialog>
      ) : null}
    </section>
  );
}

export function CoursePage({ session }: { session: Session }) {
  const { courseId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const { catalog, error, correct, reload, setError } = useCatalog();
  const [editing, setEditing] = useState<{ kind: CatalogKind; row: Row } | null>(null);
  const [addingItemFor, setAddingItemFor] = useState<Row | null>(null);
  const [addingSubject, setAddingSubject] = useState(false);
  const [itemQuery, setItemQuery] = useState("");
  const canCorrect = session.actions.includes("catalog.correct") || session.actions.includes("catalog.manage");
  const kinds = useCurriculumKinds();
  const course = catalog?.courses.find((row) => row.id === courseId);
  useRecordLabel(course?.name || "");
  const section = (readChoice(params, "section", ["curriculum", "offered"]) || "overview") as "overview" | "curriculum" | "offered";

  if (!catalog) {
    return <section className="panel">{error ? <p className="error" role="alert">{error}</p> : <p>Loading course…</p>}</section>;
  }
  if (!course) {
    return (
      <section className="panel">
        <p className="meta"><Link to="/courses">Courses</Link></p>
        <p>This course is not in the catalog.</p>
      </section>
    );
  }
  const subjects = byName(catalog.subjects.filter((row) => row.course_id === course.id));
  const offered = byName(catalog.offerings
    .filter((item) => item.course_id === course.id)
    .map((item) => catalog.branches.find((branch) => branch.id === item.branch_id))
    .filter((branch): branch is Row => Boolean(branch)));
  const relatedBatches = catalog.batches.filter((row) => row.course_id === course.id).sort((left, right) => compareText(left.name, right.name, "asc"));
  const needle = itemQuery.trim().toLowerCase();

  function papersFor(subject: Row) {
    return catalog!.papers.filter((row) => row.subject_id === subject.id).sort((left, right) => (left.number || 0) - (right.number || 0) || compareText(left.name, right.name, "asc"));
  }
  function chooseSection(next: "overview" | "curriculum" | "offered") {
    const query = new URLSearchParams(params);
    putParam(query, "section", next === "overview" ? "" : next);
    setParams(query);
  }
  const visibleSubjects = subjects.filter((subject) => {
    if (!needle) return true;
    if (subject.name.toLowerCase().includes(needle)) return true;
    return papersFor(subject).some((row) => row.name.toLowerCase().includes(needle)) || (subject.units || []).some((unit) => unit.name.toLowerCase().includes(needle));
  });

  return (
    <section className="panel wide">
      <p className="meta"><Link to="/courses">Courses</Link></p>
      <Notes error={error} />
      <div className="title-row">
        <div>
          <p className="eyebrow">Course</p>
          <h1>{course.name}</h1>
          <p className="meta">{course.archived ? "Archived" : "Active"} · {subjects.length} {subjects.length === 1 ? "subject" : "subjects"} · offered at {offered.length === 0 ? "no branch yet" : `${offered.length} ${offered.length === 1 ? "branch" : "branches"}`}</p>
        </div>
        <div className="row-actions">
          {canCorrect ? <button type="button" onClick={() => setEditing({ kind: "courses", row: course })}>Edit course</button> : null}
          <Link to={`/views?level=course&course_id=${course.id}`}>View performance</Link>
        </div>
      </div>
      <div className="page-tabs" role="tablist" aria-label="Course" onKeyDown={(event) => moveTab(event, ["overview", "curriculum", "offered"] as const, section, chooseSection)}>
        <button type="button" role="tab" aria-selected={section === "overview"} onClick={() => chooseSection("overview")}>Overview</button>
        <button type="button" role="tab" aria-selected={section === "curriculum"} onClick={() => chooseSection("curriculum")}>Curriculum</button>
        <button type="button" role="tab" aria-selected={section === "offered"} onClick={() => chooseSection("offered")}>Where offered</button>
      </div>
      {section === "overview" ? (
        <>
          <p className={course.notes ? undefined : "meta"}>{course.notes || "No notes recorded."}</p>
          <p>{canCorrect ? <Link to={`/forms?course_id=${course.id}`}>Manage application questions</Link> : "Application questions are managed in Forms."}</p>
        </>
      ) : null}
      {section === "curriculum" ? (
        <>
          <div className="title-row">
            <h2>Subjects</h2>
            {canCorrect ? <button type="button" onClick={() => { setAddingSubject(true); setError(""); }}>Add subject</button> : null}
          </div>
          <p className="meta">Papers are numbered on the subject. Part, chapter, module, and other items belong to the subject, not to a paper. The same name can be used on another subject. Reordering and moving items is not available.</p>
          {subjects.length === 0 ? <p>No subjects yet. {canCorrect ? "Add a subject to start the curriculum." : ""}</p> : (
            <>
              <form className="toolbar" onSubmit={(event) => event.preventDefault()}>
                <label>Search
                  <input value={itemQuery} aria-label="Search curriculum" placeholder="Subject, paper, chapter, or module" onChange={(event) => setItemQuery(event.target.value)} />
                </label>
              </form>
              {visibleSubjects.length === 0 ? <p>No curriculum items match.</p> : visibleSubjects.map((subject) => {
                const subjectMatches = !needle || subject.name.toLowerCase().includes(needle);
                const papers = subjectMatches ? papersFor(subject) : papersFor(subject).filter((row) => row.name.toLowerCase().includes(needle));
                const shown = subjectMatches ? subject : { ...subject, units: (subject.units || []).filter((unit) => unit.name.toLowerCase().includes(needle)) };
                return (
                  <section key={subject.id}>
                    <div className="title-row">
                      <h3>{subject.name}</h3>
                      {canCorrect ? (
                        <div className="row-actions">
                          <button type="button" onClick={() => setEditing({ kind: "subjects", row: subject })}>Edit subject</button>
                          <button type="button" onClick={() => setAddingItemFor(subject)}>Add item</button>
                        </div>
                      ) : null}
                    </div>
                    <SubjectItems subject={shown} papers={papers} kinds={kinds} canCorrect={canCorrect} onChanged={async () => { notify(`Saved ${subject.name}.`); await reload(); }} onError={setError} />
                  </section>
                );
              })}
            </>
          )}
        </>
      ) : null}
      {section === "offered" ? (
        <>
          {offered.length === 0 ? <p>This course is not offered at a branch yet.</p> : (
            <ul>
              {offered.map((branch) => <li key={branch.id}><Link to={`/institute/branches/${branch.id}?section=courses`}>{branch.name}</Link></li>)}
            </ul>
          )}
          <h2>Related batches</h2>
          {relatedBatches.length === 0 ? <p>No batches use this course yet.</p> : (
            <ul>
              {relatedBatches.map((row) => <li key={row.id}><Link to={`/batches/${row.id}`}>{row.name}</Link> · {catalog.branches.find((branch) => branch.id === row.branch_id)?.name || "Branch not recorded"} · {batchState(row)}</li>)}
            </ul>
          )}
        </>
      ) : null}
      {editing ? (
        <CatalogEditor kind={editing.kind} row={editing.row} onClose={() => setEditing(null)} onSave={(body) => correct(editing.kind, editing.row, body)} />
      ) : null}
      {addingItemFor ? (
        <ItemForm subject={addingItemFor} kinds={kinds} onClose={() => setAddingItemFor(null)} onSaved={async (label) => { notify(`Added ${label} to ${addingItemFor.name}.`); setAddingItemFor(null); await reload(); }} />
      ) : null}
      {addingSubject ? (
        <SubjectForm
          courseId={course.id}
          onClose={() => setAddingSubject(false)}
          onSaved={async (created) => { notify(`Added ${created.name}.`); setAddingSubject(false); await reload(); }}
        />
      ) : null}
    </section>
  );
}

const BATCH_SORTS = [
  ["name", "Name A–Z"],
  ["name_desc", "Name Z–A"],
  ["started", "Start date, oldest"],
  ["started_desc", "Start date, newest"],
  ["intake", "Intake, oldest"],
  ["intake_desc", "Intake, newest"],
] as const;

export function BatchesPage({ session }: { session: Session }) {
  const { catalog, error, correct, reload, setError } = useCatalog();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Row | null>(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState(params.get("q") || "");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const canCorrect = session.actions.includes("catalog.correct") || session.actions.includes("catalog.manage");
  useEffect(() => { setQuery(params.get("q") || ""); }, [params]);

  const branchId = catalog?.branches.some((row) => row.id === params.get("branch_id")) ? params.get("branch_id") || "" : "";
  const courseId = catalog?.courses.some((row) => row.id === (params.get("course_id") || params.get("course"))) ? (params.get("course_id") || params.get("course") || "") : "";
  const period = /^\d{4}-\d{2}$/.test(params.get("period") || "") ? params.get("period") || "" : "";
  const batchId = catalog?.batches.some((row) => row.id === params.get("batch_id")) ? params.get("batch_id") || "" : "";
  const status = readChoice(params, "status", ["active", "archived"]);
  const lifecycle = readChoice(params, "lifecycle", ["open", "closed"]);
  const activeOnly = !lifecycle && params.get("active") === "1";
  const sort = readChoice(params, "sort", BATCH_SORTS.map(([value]) => value)) || "name";
  const requestedPage = Math.max(1, Number(params.get("page")) || 1);
  const [draft, setDraft] = useState({ branchId, courseId, period, status, lifecycle: lifecycle || (activeOnly ? "open" : "") });
  const needle = (params.get("q") || "").trim().toLowerCase();
  const parsed = sortParts(sort);

  function periodsFor(nextBranch: string, nextCourse: string) {
    return Array.from(new Set((catalog?.batches || []).filter((row) => {
      if (nextBranch && row.branch_id !== nextBranch) return false;
      if (nextCourse && row.course_id !== nextCourse) return false;
      return Boolean(row.session_key && /^\d{4}-\d{2}$/.test(row.session_key));
    }).map((row) => row.session_key || ""))).filter(Boolean).sort();
  }
  function coursesForBranch(nextBranch: string) {
    if (!catalog) return [];
    if (!nextBranch) return byName(catalog.courses);
    const ids = new Set(catalog.offerings.filter((item) => item.branch_id === nextBranch).map((item) => item.course_id));
    return byName(catalog.courses.filter((row) => ids.has(row.id)));
  }
  function branchesForCourse(nextCourse: string) {
    if (!catalog) return [];
    if (!nextCourse) return byName(catalog.branches);
    const ids = new Set(catalog.offerings.filter((item) => item.course_id === nextCourse).map((item) => item.branch_id));
    return byName(catalog.branches.filter((row) => ids.has(row.id)));
  }

  const matched = (catalog?.batches || []).filter((row) => {
    if (needle && !row.name.toLowerCase().includes(needle)) return false;
    if (branchId && row.branch_id !== branchId) return false;
    if (courseId && row.course_id !== courseId) return false;
    if (period && row.session_key !== period) return false;
    if (batchId && row.id !== batchId) return false;
    if (status === "active" && row.archived) return false;
    if (status === "archived" && !row.archived) return false;
    if ((lifecycle === "open" || activeOnly) && row.closed) return false;
    if (lifecycle === "closed" && !row.closed) return false;
    return true;
  }).sort((left, right) => {
    const value = parsed.field === "started"
      ? compareOptional(left.started_on, right.started_on, parsed.direction)
      : parsed.field === "intake"
        ? compareOptional(/^\d{4}-\d{2}$/.test(left.session_key || "") ? left.session_key : "", /^\d{4}-\d{2}$/.test(right.session_key || "") ? right.session_key : "", parsed.direction)
        : compareText(left.name, right.name, parsed.direction);
    return value || compareText(left.name, right.name, "asc") || left.id.localeCompare(right.id);
  });
  const view = pageOf(matched, requestedPage);
  usePageClamp(catalog ? requestedPage : 1, catalog ? view.page : 1, params, setParams);

  if (!catalog) {
    return <section className="panel">{error ? <p className="error" role="alert">{error}</p> : <p>Loading batches…</p>}</section>;
  }

  function write(patch: Record<string, string>, resetPage = true) {
    const next = new URLSearchParams(params);
    next.delete("course");
    for (const [key, value] of Object.entries(patch)) putParam(next, key, value);
    if (resetPage) next.delete("page");
    setParams(next);
  }
  function listPath() {
    const search = params.toString();
    return search ? `/batches?${search}` : "/batches";
  }
  function batchHref(row: Row) {
    const next = new URLSearchParams();
    next.set("returnTo", listPath());
    return `/batches/${row.id}?${next.toString()}`;
  }
  function branchesFor(id: string) {
    const offered = new Set(catalog?.offerings.filter((item) => item.course_id === id).map((item) => item.branch_id));
    return byName((catalog?.branches || []).filter((row) => offered.has(row.id)));
  }
  function chooseDraftBranch(value: string) {
    const courseStill = !draft.courseId || coursesForBranch(value).some((row) => row.id === draft.courseId);
    const nextCourse = courseStill ? draft.courseId : "";
    const periods = periodsFor(value, nextCourse);
    setDraft({ ...draft, branchId: value, courseId: nextCourse, period: periods.includes(draft.period) ? draft.period : "" });
  }
  function chooseDraftCourse(value: string) {
    const branchStill = !draft.branchId || branchesForCourse(value).some((row) => row.id === draft.branchId);
    const nextBranch = branchStill ? draft.branchId : "";
    const periods = periodsFor(nextBranch, value);
    setDraft({ ...draft, courseId: value, branchId: nextBranch, period: periods.includes(draft.period) ? draft.period : "" });
  }
  function applyFilters(event: FormEvent) {
    event.preventDefault();
    const nextLifecycle = draft.lifecycle;
    const batch = catalog?.batches.find((row) => row.id === batchId);
    const batchFits = !batch || (
      (!draft.branchId || batch.branch_id === draft.branchId)
      && (!draft.courseId || batch.course_id === draft.courseId)
      && (!draft.period || batch.session_key === draft.period)
    );
    write({
      branch_id: draft.branchId,
      course_id: draft.courseId,
      period: draft.period,
      status: draft.status,
      lifecycle: nextLifecycle,
      active: "",
      batch_id: batchFits ? batchId : "",
    });
    setFiltersOpen(false);
  }

  const courseName = (id?: string) => catalog.courses.find((row) => row.id === id)?.name || "Not recorded";
  const branchName = (id?: string) => catalog.branches.find((row) => row.id === id)?.name || "Not recorded";
  const filtered = Boolean(needle || branchId || courseId || period || batchId || status || lifecycle || activeOnly);
  const chips = [
    needle ? { key: "q", label: `Search: ${params.get("q")}` } : null,
    branchId ? { key: "branch_id", label: branchName(branchId) } : null,
    courseId ? { key: "course_id", label: courseName(courseId) } : null,
    period ? { key: "period", label: intakeLabel(period) } : null,
    batchId ? { key: "batch_id", label: catalog.batches.find((row) => row.id === batchId)?.name || "Selected batch" } : null,
    status ? { key: "status", label: status === "archived" ? "Archived" : "Active catalog" } : null,
    lifecycle ? { key: "lifecycle", label: lifecycle === "closed" ? "Closed" : "Open" } : null,
    activeOnly ? { key: "active", label: "Active batches" } : null,
  ].filter((item): item is { key: string; label: string } => Boolean(item));
  const summary = error ? "Batches could not be loaded." : view.total === 0 ? "0 batches" : `${view.from}–${view.to} of ${view.total}`;
  const draftCourses = coursesForBranch(draft.branchId);
  const draftBranches = branchesForCourse(draft.courseId);
  const draftPeriods = periodsFor(draft.branchId, draft.courseId);

  return (
    <section className="panel wide">
      <Notes error={error} />
      <div className="title-row">
        <div>
          <p className="eyebrow">Batches</p>
          <h1>Batches</h1>
        </div>
        {canCorrect ? <button type="button" onClick={() => { setAdding(true); setError(""); }}>Add batch</button> : null}
      </div>
      <TruncationNote truncated={catalog.truncated} />
      <ListToolbar
        searchLabel="Search batches"
        placeholder="Batch name"
        query={query}
        onQuery={setQuery}
        onSearch={() => write({ q: query.trim() })}
        sort={sort}
        sortOptions={BATCH_SORTS}
        onSort={(value) => write({ sort: value === "name" ? "" : value })}
        onOpenFilters={() => { setDraft({ branchId, courseId, period, status, lifecycle: lifecycle || (activeOnly ? "open" : "") }); setFiltersOpen(true); }}
        summary={summary}
        chips={chips}
        onRemove={(key) => write(key === "active" ? { active: "" } : { [key]: "" })}
        onClear={() => write({ q: "", branch_id: "", course_id: "", period: "", batch_id: "", status: "", lifecycle: "", active: "" })}
        filtered={filtered}
      />
      {view.total === 0 ? <p>{filtered ? "No batches match." : "No batches yet."}</p> : (
        <div className="table-wrap">
          <table className="people-table">
            <caption className="sr-only">{view.total} batches. Page {view.page} of {view.pages}. Sorted by {parsed.field}, {parsed.direction === "desc" ? "descending" : "ascending"}. Missing dates and intakes stay last.</caption>
            <thead>
              <tr>
                <SortHeader label="Batch" active={parsed.field === "name"} direction={parsed.direction} onClick={() => { const next = toggleSort(sort, "name"); write({ sort: next === "name" ? "" : next }); }} />
                <th>Branch</th>
                <th>Course</th>
                <SortHeader label="Intake" active={parsed.field === "intake"} direction={parsed.direction} onClick={() => write({ sort: toggleSort(sort, "intake") })} />
                <SortHeader label="Start" active={parsed.field === "started"} direction={parsed.direction} onClick={() => write({ sort: toggleSort(sort, "started") })} />
                <th>End</th>
                <th>Schedule</th>
                <th>State</th>
                {canCorrect ? <th>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {view.items.map((row) => (
                <tr key={row.id}>
                  <td><Link to={batchHref(row)}>{row.name}</Link></td>
                  <td>{row.branch_id ? <Link to={`/institute/branches/${row.branch_id}`}>{branchName(row.branch_id)}</Link> : "Not recorded"}</td>
                  <td>{row.course_id ? <Link to={`/courses/${row.course_id}`}>{courseName(row.course_id)}</Link> : "Not recorded"}</td>
                  <td>{intakeLabel(row.session_key)}</td>
                  <td>{formatDisplayDate(row.started_on)}</td>
                  <td>{formatDisplayDate(row.ended_on)}</td>
                  <td>{row.timings || "Not recorded"}</td>
                  <td>{batchState(row)}</td>
                  {canCorrect ? (
                    <td><button type="button" className="quiet" onClick={() => setEditing(row)}>Edit</button></td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager from={view.from} to={view.to} total={view.total} page={view.page} pages={view.pages} onPage={(page) => write({ page: page <= 1 ? "" : String(page) }, false)} />
      {editing ? (
        <CatalogEditor kind="batches" row={editing} onClose={() => setEditing(null)} onSave={(body) => correct("batches", editing, body)} />
      ) : null}
      {adding ? (
        <BatchForm
          courses={byName(catalog.courses)}
          courseId={courseId || catalog.courses[0]?.id || ""}
          branchesFor={branchesFor}
          onClose={() => setAdding(false)}
          onSaved={async (name) => { notify(`Added ${name}.`); setAdding(false); await reload(); }}
        />
      ) : null}
      {filtersOpen ? (
        <StudentDialog title="Filters" onClose={() => setFiltersOpen(false)}>
          <form className="form-grid" onSubmit={applyFilters}>
            <label>Branch
              <select aria-label="Branch" value={draft.branchId} onChange={(event) => chooseDraftBranch(event.target.value)}>
                <option value="">Any branch</option>
                {draftBranches.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </label>
            <label>Course
              <select aria-label="Course" value={draft.courseId} onChange={(event) => chooseDraftCourse(event.target.value)}>
                <option value="">Any course</option>
                {draftCourses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </label>
            <label>Intake period
              <select aria-label="Intake period" value={draft.period} onChange={(event) => setDraft({ ...draft, period: event.target.value })}>
                <option value="">Any intake</option>
                {draftPeriods.map((key) => <option key={key} value={key}>{intakeLabel(key)}</option>)}
              </select>
            </label>
            <label>Catalog status
              <select aria-label="Catalog status" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
                <option value="">Any catalog status</option>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </label>
            <label className="span-2">Batch lifecycle
              <select aria-label="Batch lifecycle" value={draft.lifecycle} onChange={(event) => setDraft({ ...draft, lifecycle: event.target.value })}>
                <option value="">Any lifecycle</option>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </select>
            </label>
            <p className="meta span-2">Open means the batch has no end date. Closed means an end date is recorded. Archived is separate and does not close a batch.</p>
            <FilterActions onReset={() => setDraft({ branchId: "", courseId: "", period: "", status: "", lifecycle: "" })} onClose={() => setFiltersOpen(false)} />
          </form>
        </StudentDialog>
      ) : null}
    </section>
  );
}

function SubjectItems({
  subject,
  papers,
  kinds,
  canCorrect,
  onChanged,
  onError,
}: {
  subject?: Row;
  papers: Row[];
  kinds: CurriculumKind[];
  canCorrect: boolean;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState<{ id: string; kind: string; paper: Row | null } | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("paper");
  const [archived, setArchived] = useState(false);
  const [error, setError] = useState("");
  const units = subject?.units || [];
  if (!subject) return null;
  const rows = [
    ...papers.map((row) => ({ id: row.id, name: row.name, kindKey: row.kind || "paper", kind: kindLabel(kinds, row.kind || "paper"), detail: row.number != null ? String(row.number) : "Not recorded", paper: row })),
    ...units.map((row) => ({ id: row.id, name: row.name, kindKey: row.kind, kind: kindLabel(kinds, row.kind), detail: "Not recorded", paper: null as Row | null })),
  ];
  const activeKinds = kinds.filter((item) => !item.archived || item.key === kind);
  const chosen = kinds.find((item) => item.key === kind);
  if (rows.length === 0) return <p>No curriculum items yet.</p>;
  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || !subject) return;
    setError("");
    try {
      const staysPaper = Boolean(editing.paper) && (chosen?.storage === "paper" || kind === "paper");
      if (staysPaper && editing.paper) {
        const body: { name?: string; archived?: boolean; expected_revision: number } = { expected_revision: editing.paper.revision || 0 };
        if (name.trim() !== editing.paper.name) body.name = name.trim();
        if (archived !== editing.paper.archived) body.archived = archived;
        if (body.name !== undefined || body.archived !== undefined) {
          await api(`/api/v1/catalog/papers/${editing.paper.id}`, { method: "PATCH", body: JSON.stringify(body) });
        }
      } else {
        await api(`/api/v1/subjects/${subject.id}/items/${editing.id}`, { method: "PATCH", body: JSON.stringify({ name, kind }) });
      }
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
              <th>Subject partition</th>
              <th>Name</th>
              <th>Paper</th>
              {canCorrect ? <th>Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.kindKey}-${row.id}`}>
                <td>{row.kind}</td>
                <td>{row.name}</td>
                <td>{row.detail}</td>
                {canCorrect ? (
                  <td>
                    <button type="button" className="quiet" onClick={() => {
                      setEditing({ id: row.id, kind: row.kindKey, paper: row.paper });
                      setName(row.name);
                      setKind(row.kindKey);
                      setArchived(Boolean(row.paper?.archived));
                      setError("");
                    }}>Edit</button>
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
            <label>Subject partition
              <select value={kind} aria-label="Subject partition" onChange={(event) => setKind(event.target.value)}>
                {activeKinds.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
              </select>
            </label>
            {editing.paper && (chosen?.storage === "paper" || kind === "paper") ? (
              <label>Status
                <select value={archived ? "archived" : "active"} aria-label="Status" onChange={(event) => setArchived(event.target.value === "archived")}>
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                </select>
              </label>
            ) : null}
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
        <label>Cohort name
          <input value={name} aria-label="Batch name" onChange={(event) => setName(event.target.value)} />
        </label>
        <p className="meta">A month and year in the name records the intake. Start date, end date, and schedule are separate. This does not check timetable conflicts.</p>
        <div className="form-grid">
          <label>Start date
            <input type="date" value={startedOn} aria-label="Start date" onChange={(event) => setStartedOn(event.target.value)} />
          </label>
          <label>End date
            <input type="date" value={endedOn} aria-label="End date" onChange={(event) => setEndedOn(event.target.value)} />
          </label>
        </div>
        <label>Schedule
          <input value={timings} aria-label="Schedule" onChange={(event) => setTimings(event.target.value)} />
        </label>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="quiet" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={saving || !name.trim()}>Add batch</button>
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
          <button type="submit" disabled={saving || !name.trim()}>Add subject</button>
        </div>
      </form>
    </StudentDialog>
  );
}

function ItemForm({ subject, kinds, onClose, onSaved }: { subject: Row; kinds: CurriculumKind[]; onClose: () => void; onSaved: (label: string) => Promise<void> }) {
  const active = kinds.filter((item) => !item.archived);
  const [name, setName] = useState("");
  const [kind, setKind] = useState(active[0]?.key || "paper");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const chosen = active.find((item) => item.key === kind) || active[0];
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(`/api/v1/subjects/${subject.id}/items`, { method: "POST", body: JSON.stringify({ name, kind }) });
      await onSaved(`the ${(chosen?.label || "item").toLowerCase()} ${name.trim()}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add the item.");
      setSaving(false);
    }
  }
  const submitLabel = chosen ? `Add ${chosen.label.toLowerCase()}` : "Add item";
  return (
    <StudentDialog title="Add item" onClose={onClose} dirty={Boolean(name.trim())}>
      <form onSubmit={save}>
        <label>Name
          <input value={name} aria-label="Item name" onChange={(event) => setName(event.target.value)} />
        </label>
        <label>Subject partition
          <select value={kind} aria-label="Subject partition" onChange={(event) => setKind(event.target.value)}>
            {active.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </label>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="quiet" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={saving || !name.trim()}>{submitLabel}</button>
        </div>
      </form>
    </StudentDialog>
  );
}

