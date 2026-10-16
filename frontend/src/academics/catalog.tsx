import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, Session } from "../api";
import { notify } from "../notify";
import { formatDisplayDate } from "../format";
import { Icon, StudentDialog } from "../ui";

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
  session_key?: string;
  units?: Unit[];
};
type Offering = { id: string; branch_id?: string; course_id?: string };
type Catalog = { branches: Row[]; courses: Row[]; batches: Row[]; subjects: Row[]; papers: Row[]; students: Row[]; offerings: Offering[] };

const KIND = { branches: "branch", courses: "course", batches: "batch", subjects: "subject", students: "student", papers: "paper" } as const;
type CatalogKind = "branches" | "courses" | "batches" | "subjects" | "papers";
type CatalogChange = { name?: string; archived?: boolean; notes?: string; started_on?: string; ended_on?: string; timings?: string };

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
  const { catalog, error } = useCatalog();
  const [institute, setInstitute] = useState<InstituteRecord | null>(null);
  const [editingInstitute, setEditingInstitute] = useState(false);
  const [adding, setAdding] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [localError, setLocalError] = useState("");
  const canCorrect = session.actions.includes("catalog.correct") || session.actions.includes("catalog.manage");

  useEffect(() => {
    api<InstituteRecord>("/api/v1/institute").then(setInstitute).catch((reason: Error) => setLocalError(reason.message));
  }, []);

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
      <Notes error={error || localError} />
      <div className="title-row">
        <h2>Branches</h2>
        {canCorrect ? (
          <button type="button" onClick={() => { setAdding(true); setBranchName(""); setLocalError(""); }}>Add branch</button>
        ) : null}
      </div>
      {branches.length === 0 ? <p>No branches yet.</p> : (
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
              <button type="submit" disabled={!branchName.trim()}>Add branch</button>
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
  const { catalog, error, reload, setError } = useCatalog();
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
      notify("Added the course.");
      navigate(`/courses/${created.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add the course.");
    }
  }

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
      {courses.length === 0 ? <p>No courses yet.</p> : (
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
              <button type="submit" disabled={!courseName.trim()}>Add course</button>
            </div>
          </form>
        </StudentDialog>
      ) : null}
    </section>
  );
}

export function CoursePage({ session }: { session: Session }) {
  const { courseId = "" } = useParams();
  const { catalog, error, correct, reload, setError } = useCatalog();
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
      <Notes error={error} />
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
        </div>
        <div className="icon-actions">
          {canCorrect ? <button type="button" onClick={() => setEditing({ kind: "courses", row: course })} aria-label={`Edit ${course.name}`} title="Edit"><Icon name="edit" /></button> : null}
          <Link to={`/views?level=course&course_id=${course.id}`} aria-label={`View ${course.name}`} title="View course"><Icon name="view" /></Link>
        </div>
      </div>
      <p>{canCorrect ? <Link to={`/forms?course_id=${course.id}`}>Edit this course’s questions in Forms</Link> : "Course questions are managed in Forms."}</p>
      <div className="title-row">
        <h2>Subjects</h2>
        {canCorrect ? (
          <button type="button" onClick={() => { setAddingSubject(true); setError(""); }}>Add subject</button>
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
              <>
                <div className="icon-actions">
                  <button type="button" onClick={() => setEditing({ kind: "subjects", row: subject })} aria-label={`Edit ${subject.name}`} title="Edit subject"><Icon name="edit" /></button>
                </div>
                <button type="button" onClick={() => setAddingItem(true)}>Add paper</button>
              </>
            ) : null}
          </div>
          <SubjectItems subject={subject} papers={papers} canCorrect={canCorrect} onEditPaper={(row) => setEditing({ kind: "papers", row })} onChanged={async () => { notify(`Saved ${subject?.name || "the subject"}.`); await reload(); }} onError={setError} />
        </>
      )}
      {editing ? (
        <CatalogEditor kind={editing.kind} row={editing.row} onClose={() => setEditing(null)} onSave={(body) => correct(editing.kind, editing.row, body)} />
      ) : null}
      {addingItem && subject ? (
        <ItemForm subject={subject} onClose={() => setAddingItem(false)} onSaved={async (label) => { notify(`Added ${label} to ${subject.name}.`); setAddingItem(false); await reload(); }} />
      ) : null}
      {addingSubject ? (
        <SubjectForm
          courseId={course.id}
          onClose={() => setAddingSubject(false)}
          onSaved={async (created) => { setSubjectId(created.id); notify(`Added ${created.name}.`); setAddingSubject(false); await reload(); }}
        />
      ) : null}
    </section>
  );
}

export function BatchesPage({ session }: { session: Session }) {
  const { catalog, error, correct, reload, setError } = useCatalog();
  const [params] = useSearchParams();
  const [editing, setEditing] = useState<Row | null>(null);
  const [adding, setAdding] = useState(false);
  const canCorrect = session.actions.includes("catalog.correct") || session.actions.includes("catalog.manage");
  if (!catalog) {
    return <section className="panel">{error ? <p className="error" role="alert">{error}</p> : <p>Loading batches…</p>}</section>;
  }
  const requested = params.get("course_id") || params.get("course") || "";
  const courseId = catalog.courses.some((row) => row.id === requested) ? requested : "";
  const branchId = params.get("branch_id") || "";
  const batchId = params.get("batch_id") || "";
  const period = params.get("period") || "";
  const batches = byName(catalog.batches.filter((row) => {
    if (courseId && row.course_id !== courseId) return false;
    if (branchId && row.branch_id !== branchId) return false;
    if (batchId && row.id !== batchId) return false;
    if (period && row.session_key !== period) return false;
    return true;
  }));
  const courseName = (id?: string) => catalog.courses.find((row) => row.id === id)?.name || "Not recorded";
  const branchName = (id?: string) => catalog.branches.find((row) => row.id === id)?.name || "Not recorded";
  function batchHref(row: Row) {
    const next = new URLSearchParams();
    if (row.branch_id) next.set("branch_id", row.branch_id);
    if (row.course_id) next.set("course_id", row.course_id);
    next.set("batch_id", row.id);
    if (row.session_key) next.set("period", row.session_key);
    return `/batches/${row.id}?${next.toString()}`;
  }

  function branchesFor(id: string) {
    const offered = new Set(catalog?.offerings.filter((item) => item.course_id === id).map((item) => item.branch_id));
    return byName((catalog?.branches || []).filter((row) => offered.has(row.id)));
  }

  return (
    <section className="panel wide">
      <Notes error={error} />
      <div className="title-row">
        <div>
          <p className="eyebrow">Batches</p>
          <h1>Batches</h1>
        </div>
        {canCorrect ? (
          <button type="button" onClick={() => { setAdding(true); setError(""); }}>Add batch</button>
        ) : null}
      </div>
      {batches.length === 0 ? <p>{courseId || branchId || batchId || period ? "No batches match this context." : "No batches yet."}</p> : (
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
                  <td><Link to={batchHref(row)}>{row.name}</Link></td>
                  <td>{row.course_id ? <Link to={`/courses/${row.course_id}`}>{courseName(row.course_id)}</Link> : "Not recorded"}</td>
                  <td>{row.branch_id ? <Link to={`/institute/branches/${row.branch_id}`}>{branchName(row.branch_id)}</Link> : "Not recorded"}</td>
                  <td>{formatDisplayDate(row.started_on)}</td>
                  <td>{formatDisplayDate(row.ended_on)}</td>
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
          onSaved={async (name) => { notify(`Added ${name}.`); setAdding(false); await reload(); }}
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
          <button type="submit" disabled={saving || !name.trim()}>Add paper</button>
        </div>
      </form>
    </StudentDialog>
  );
}

