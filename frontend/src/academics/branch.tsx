import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, Session } from "../api";
import { notify } from "../notify";
import { formatDisplayDate } from "../format";
import { useRecordLabel } from "../orientation";
import { Place, PlaceFacts } from "./catalog";
import { batchState, intakeLabel } from "./lists";
import { moveTab, StudentDialog } from "../ui";

type Batch = { id: string; name: string; started_on: string | null; ended_on: string | null; timings: string | null; session_key?: string | null; archived: boolean; closed?: boolean };
type CourseOffer = { id: string; name: string; batches: Batch[] };
type BranchRecord = Place & { id: string; name: string; archived: boolean; courses: CourseOffer[]; student_count: number; revision?: number };
type CourseOption = { id: string; name: string };

const BRANCH_SECTIONS = ["overview", "courses", "batches", "students"] as const;
type BranchSection = (typeof BRANCH_SECTIONS)[number];

export function BranchPage({ session }: { session: Session }) {
  const { branchId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const [branch, setBranch] = useState<BranchRecord | null>(null);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [editing, setEditing] = useState(false);
  const [offering, setOffering] = useState(false);
  const [addingFor, setAddingFor] = useState<CourseOffer | null>(null);
  const [error, setError] = useState("");
  const canCorrect = session.actions.includes("catalog.correct") || session.actions.includes("catalog.manage");
  const section: BranchSection = BRANCH_SECTIONS.includes(params.get("section") as BranchSection) ? params.get("section") as BranchSection : "overview";
  useRecordLabel(branch?.name || "");

  async function load() {
    const [record, catalog] = await Promise.all([
      api<BranchRecord>(`/api/v1/branches/${branchId}`),
      api<{ courses: CourseOption[] }>("/api/v1/catalog"),
    ]);
    setBranch(record);
    setCourses(catalog.courses);
  }

  useEffect(() => {
    setBranch(null);
    load().catch((reason: Error) => setError(reason.message));
  }, [branchId]);

  useEffect(() => {
    if (params.get("offer") !== "1" || !canCorrect || !branch) return;
    setOffering(true);
    const next = new URLSearchParams(params);
    next.delete("offer");
    setParams(next, { replace: true });
  }, [params, canCorrect, branch, setParams]);

  if (!branch) {
    return <section className="panel">{error ? <p className="error" role="alert">{error}</p> : <p>Loading branch…</p>}</section>;
  }
  const offered = new Set(branch.courses.map((course) => course.id));
  const available = courses.filter((course) => !offered.has(course.id)).sort((left, right) => left.name.localeCompare(right.name));
  const batches = branch.courses.flatMap((course) => course.batches.map((row) => ({ ...row, course })));

  function chooseSection(next: BranchSection) {
    const query = new URLSearchParams(params);
    if (next === "overview") query.delete("section");
    else query.set("section", next);
    setParams(query);
  }

  return (
    <section className="panel wide">
      <p className="meta"><Link to="/institute">Institute</Link></p>
      <div className="title-row">
        <div>
          <p className="eyebrow">Branch</p>
          <h1>{branch.name}</h1>
          <p className="meta">{branch.archived ? "Archived" : "Active"}</p>
        </div>
        <div className="row-actions">
          {canCorrect ? <button type="button" onClick={() => setEditing(true)}>Edit branch</button> : null}
          <Link to={`/views?level=branch&branch_id=${branch.id}`}>View performance</Link>
        </div>
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <div className="page-tabs" role="tablist" aria-label="Branch" onKeyDown={(event) => moveTab(event, BRANCH_SECTIONS, section, chooseSection)}>
        <button type="button" role="tab" aria-selected={section === "overview"} onClick={() => chooseSection("overview")}>Overview</button>
        <button type="button" role="tab" aria-selected={section === "courses"} onClick={() => chooseSection("courses")}>Courses</button>
        <button type="button" role="tab" aria-selected={section === "batches"} onClick={() => chooseSection("batches")}>Batches</button>
        <button type="button" role="tab" aria-selected={section === "students"} onClick={() => chooseSection("students")}>Students</button>
      </div>
      {section === "overview" ? <PlaceFacts values={branch} /> : null}
      {section === "courses" ? (
        <>
          {canCorrect ? <button type="button" onClick={() => setOffering(true)}>Offer a course</button> : null}
          {branch.courses.length === 0 ? <p>This branch does not offer a course yet.</p> : (
            <ul>
              {branch.courses.map((course) => (
                <li key={course.id}>
                  <Link to={`/courses/${course.id}`}>{course.name}</Link>
                  {canCorrect ? <button type="button" className="quiet" onClick={() => setAddingFor(course)}>Add batch</button> : null}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
      {section === "batches" ? <BranchBatchList branchId={branch.id} branchName={branch.name} batches={batches} /> : null}
      {section === "students" ? (
        <p>
          {branch.student_count} authorized {branch.student_count === 1 ? "student has" : "students have"} an enrollment at this branch. Archived students are not included.
          {" "}
          <Link to={`/students?branch_id=${branch.id}`}>Open the student list</Link>
        </p>
      ) : null}
      {editing ? (
        <BranchEditor branch={branch} onClose={() => setEditing(false)} onSaved={async () => { notify(`Saved ${branch.name}.`); setEditing(false); await load(); }} />
      ) : null}
      {offering ? (
        <OfferCourse
          branchName={branch.name}
          branchId={branch.id}
          available={available}
          onClose={() => setOffering(false)}
          onSaved={async (courseId) => {
            await api(`/api/v1/branches/${branch.id}/courses`, { method: "POST", body: JSON.stringify({ course_id: courseId }) });
            notify("This branch now offers that course.");
            setOffering(false);
            await load();
          }}
        />
      ) : null}
      {addingFor ? (
        <BranchBatchForm branchId={branch.id} course={addingFor} onClose={() => setAddingFor(null)} onSaved={async () => { notify(`Added a batch to ${addingFor.name}.`); setAddingFor(null); await load(); }} />
      ) : null}
    </section>
  );
}

function BranchBatchList({ branchId, branchName, batches }: {
  branchId: string;
  branchName: string;
  batches: Array<Batch & { course: CourseOffer }>;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [intake, setIntake] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = batches.filter((row) => {
    if (needle && !`${row.name} ${row.course.name}`.toLowerCase().includes(needle)) return false;
    if (status === "archived" && !row.archived) return false;
    if (status === "closed" && !row.closed) return false;
    if (status === "current" && (row.archived || row.closed)) return false;
    if (intake && intakeLabel(row.session_key).toLowerCase() !== intake.toLowerCase()) return false;
    return true;
  });
  const intakes = [...new Set(batches.map((row) => intakeLabel(row.session_key)).filter((label) => label && label !== "Not recorded"))].sort();
  return (
    <>
      <form className="toolbar" onSubmit={(event) => event.preventDefault()}>
        <label>Search
          <input value={query} aria-label="Search batches" placeholder="Batch or course" onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label>State
          <select aria-label="Batch state" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Any state</option>
            <option value="current">Current</option>
            <option value="closed">Closed</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label>Intake
          <select aria-label="Intake" value={intake} onChange={(event) => setIntake(event.target.value)}>
            <option value="">Any intake</option>
            {intakes.map((label) => <option key={label} value={label}>{label}</option>)}
          </select>
        </label>
      </form>
      {batches.length === 0 ? <p>No batches yet.</p> : shown.length === 0 ? <p>No batches match.</p> : (
        <div className="table-wrap">
          <table className="people-table">
            <caption className="sr-only">Batches at {branchName}.</caption>
            <thead>
              <tr>
                <th>Batch</th>
                <th>Course</th>
                <th>Intake</th>
                <th>Start</th>
                <th>End</th>
                <th>Schedule</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.id}>
                  <td><Link to={`/batches/${row.id}?returnTo=${encodeURIComponent(`/institute/branches/${branchId}?section=batches`)}`}>{row.name}</Link></td>
                  <td><Link to={`/courses/${row.course.id}`}>{row.course.name}</Link></td>
                  <td>{intakeLabel(row.session_key)}</td>
                  <td>{formatDisplayDate(row.started_on)}</td>
                  <td>{formatDisplayDate(row.ended_on)}</td>
                  <td>{row.timings || "Not recorded"}</td>
                  <td>{batchState(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function BranchEditor({ branch, onClose, onSaved }: { branch: BranchRecord; onClose: () => void; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState({
    name: branch.name,
    archived: branch.archived,
    street: branch.street || "",
    place: branch.place || "",
    district: branch.district || "",
    state: branch.state || "",
    pin: branch.pin || "",
    phone: branch.phone || "",
    email: branch.email || "",
    notes: branch.notes || "",
  });
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
      await api(`/api/v1/catalog/branch/${branch.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...draft, expected_revision: branch.revision || 0 }),
      });
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save.");
      setSaving(false);
    }
  }
  function change(key: "name" | "street" | "place" | "district" | "state" | "pin" | "phone" | "email" | "notes") {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft((current) => ({ ...current, [key]: event.target.value }));
  }
  return (
    <StudentDialog title="Edit branch" onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <label className="span-2">Name
          <input value={draft.name} aria-label="Branch name" onChange={change("name")} />
        </label>
        <label className="span-2">Status
          <select value={draft.archived ? "archived" : "active"} aria-label="Status" onChange={(event) => setDraft((current) => ({ ...current, archived: event.target.value === "archived" }))}>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        {draft.archived !== branch.archived ? (
          <p className="meta span-2">
            {draft.archived
              ? "Archiving keeps courses, batches, enrollments, and results. New offerings and batches stay out until this branch is restored."
              : "Restoring allows new offerings and batches. Records that were already archived stay archived."}
          </p>
        ) : null}
        <label className="span-2">House and street
          <textarea value={draft.street} rows={2} aria-label="House and street" onChange={change("street")} />
        </label>
        <label>Place<input value={draft.place} aria-label="Place" onChange={change("place")} /></label>
        <label>District<input value={draft.district} aria-label="District" onChange={change("district")} /></label>
        <label>State<input value={draft.state} aria-label="State" onChange={change("state")} /></label>
        <label>PIN<input value={draft.pin} inputMode="numeric" maxLength={6} aria-label="PIN" onChange={change("pin")} /></label>
        <label>Phone<input value={draft.phone} aria-label="Phone" onChange={change("phone")} /></label>
        <label>Email<input value={draft.email} aria-label="Email" onChange={change("email")} /></label>
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

function OfferCourse({
  branchName,
  branchId,
  available,
  onClose,
  onSaved,
}: {
  branchName: string;
  branchId: string;
  available: CourseOption[];
  onClose: () => void;
  onSaved: (courseId: string) => Promise<void>;
}) {
  const [courseId, setCourseId] = useState(available[0]?.id || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!courseId) {
      setError("Choose an existing course, or create one first.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSaved(courseId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not offer the course.");
      setSaving(false);
    }
  }
  return (
    <StudentDialog title="Offer a course" onClose={onClose} dirty={Boolean(courseId)}>
      <form onSubmit={save}>
        <p>Offer an existing course at {branchName}. This does not create another course.</p>
        {available.length === 0 ? (
          <p>No other course is available. <Link to={`/courses?return_branch=${branchId}`}>Create course</Link>, then return here to offer it.</p>
        ) : (
          <label>Course
            <select value={courseId} aria-label="Course" onChange={(event) => setCourseId(event.target.value)}>
              {available.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label>
        )}
        {error ? <p className="error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="quiet" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={saving || !courseId}>{saving ? "Saving…" : "Offer a course"}</button>
        </div>
      </form>
    </StudentDialog>
  );
}

function BranchBatchForm({ branchId, course, onClose, onSaved }: { branchId: string; course: CourseOffer; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [startedOn, setStartedOn] = useState("");
  const [endedOn, setEndedOn] = useState("");
  const [timings, setTimings] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(`/api/v1/branches/${branchId}/batches`, {
        method: "POST",
        body: JSON.stringify({ course_id: course.id, name, started_on: startedOn, ended_on: endedOn, timings }),
      });
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add the batch.");
      setSaving(false);
    }
  }
  return (
    <StudentDialog title={`Add batch to ${course.name}`} onClose={onClose}>
      <form onSubmit={save}>
        <label>Cohort name
          <input value={name} aria-label="Batch name" onChange={(event) => setName(event.target.value)} />
        </label>
        <p className="meta">A month and year in the name records the intake. Start date, end date, and schedule are separate.</p>
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
          <button type="submit" disabled={saving || !name.trim()}>{saving ? "Saving…" : "Add batch"}</button>
        </div>
      </form>
    </StudentDialog>
  );
}
