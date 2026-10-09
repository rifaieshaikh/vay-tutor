import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, Session } from "../api";
import { Icon, Place, PlaceFacts, StudentDialog } from "./Catalog";

type Batch = { id: string; name: string; started_on: string | null; ended_on: string | null; timings: string | null; archived: boolean };
type CourseOffer = { id: string; name: string; batches: Batch[] };
type BranchRecord = Place & { id: string; name: string; archived: boolean; courses: CourseOffer[]; student_count: number };
type CourseOption = { id: string; name: string };

export function BranchPage({ session }: { session: Session }) {
  const { branchId = "" } = useParams();
  const [branch, setBranch] = useState<BranchRecord | null>(null);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [tab, setTab] = useState<"details" | "courses" | "students">("details");
  const [editing, setEditing] = useState(false);
  const [offering, setOffering] = useState(false);
  const [addingFor, setAddingFor] = useState<CourseOffer | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const canCorrect = session.actions.includes("catalog.correct") || session.actions.includes("catalog.manage");

  async function load() {
    const [record, catalog] = await Promise.all([
      api<BranchRecord>(`/api/v1/branches/${branchId}`),
      api<{ courses: CourseOption[] }>("/api/v1/catalog"),
    ]);
    setBranch(record);
    setCourses(catalog.courses);
  }

  useEffect(() => {
    load().catch((reason: Error) => setError(reason.message));
  }, [branchId]);

  if (!branch) {
    return <section className="panel">{error ? <p className="error" role="alert">{error}</p> : <p>Loading branch…</p>}</section>;
  }
  const offered = new Set(branch.courses.map((course) => course.id));
  const available = courses.filter((course) => !offered.has(course.id)).sort((left, right) => left.name.localeCompare(right.name));

  return (
    <section className="panel wide">
      <p className="meta"><Link to="/institute">Institute</Link></p>
      <div className="title-row">
        <div>
          <p className="eyebrow">Branch</p>
          <h1>{branch.name}</h1>
          <p className="meta">{branch.archived ? "Archived" : "Active"}</p>
        </div>
        <div className="icon-actions">
          {canCorrect ? <button type="button" onClick={() => setEditing(true)} aria-label={`Edit ${branch.name}`} title="Edit"><Icon name="edit" /></button> : null}
          <Link to={`/views?level=branch&branch_id=${branch.id}`} aria-label={`View ${branch.name}`} title="View branch"><Icon name="view" /></Link>
        </div>
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {message ? <p className="ok" role="status">{message}</p> : null}
      <div className="page-tabs" role="tablist" aria-label="Branch">
        <button type="button" role="tab" aria-selected={tab === "details"} onClick={() => setTab("details")}>Details</button>
        <button type="button" role="tab" aria-selected={tab === "courses"} onClick={() => setTab("courses")}>Courses</button>
        <button type="button" role="tab" aria-selected={tab === "students"} onClick={() => setTab("students")}>Students</button>
      </div>
      {tab === "details" ? <PlaceFacts values={branch} /> : null}
      {tab === "courses" ? (
        <>
          {canCorrect ? (
            <div className="icon-actions">
              <button type="button" onClick={() => setOffering(true)} aria-label="Offer a course" title="Offer a course"><Icon name="add" /></button>
            </div>
          ) : null}
          {branch.courses.length === 0 ? <p>This branch does not offer a course yet.</p> : branch.courses.map((course) => (
            <section key={course.id}>
              <div className="title-row">
                <h2><Link to={`/courses/${course.id}`}>{course.name}</Link></h2>
                {canCorrect ? (
                  <div className="icon-actions">
                    <button type="button" onClick={() => setAddingFor(course)} aria-label={`Add batch to ${course.name}`} title="Add batch"><Icon name="add" /></button>
                  </div>
                ) : null}
              </div>
              {course.batches.length === 0 ? <p>No batches yet.</p> : (
                <div className="table-wrap">
                  <table className="people-table">
                    <caption className="sr-only">Batches for {course.name} at {branch.name}.</caption>
                    <thead>
                      <tr>
                        <th>Batch</th>
                        <th>From</th>
                        <th>Until</th>
                        <th>Timings</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {course.batches.map((row) => (
                        <tr key={row.id}>
                          <td>{row.name}</td>
                          <td>{row.started_on || "Not recorded"}</td>
                          <td>{row.ended_on || "Not recorded"}</td>
                          <td>{row.timings || "Not recorded"}</td>
                          <td>{row.archived ? "Archived" : "Active"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </>
      ) : null}
      {tab === "students" ? (
        <p>{branch.student_count} {branch.student_count === 1 ? "student" : "students"}. <Link to={`/students?branch_id=${branch.id}`}>Open the student list</Link></p>
      ) : null}
      {editing ? (
        <BranchEditor branch={branch} onClose={() => setEditing(false)} onSaved={async () => { setMessage(`Saved ${branch.name}.`); setEditing(false); await load(); }} />
      ) : null}
      {offering ? (
        <OfferCourse available={available} onClose={() => setOffering(false)} onSaved={async (courseId) => {
          await api(`/api/v1/branches/${branch.id}/courses`, { method: "POST", body: JSON.stringify({ course_id: courseId }) });
          setMessage("This branch now offers that course.");
          setOffering(false);
          await load();
        }} />
      ) : null}
      {addingFor ? (
        <BranchBatchForm branchId={branch.id} course={addingFor} onClose={() => setAddingFor(null)} onSaved={async () => { setMessage(`Added a batch to ${addingFor.name}.`); setAddingFor(null); await load(); }} />
      ) : null}
    </section>
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
      await api(`/api/v1/catalog/branch/${branch.id}`, { method: "PATCH", body: JSON.stringify(draft) });
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

function OfferCourse({ available, onClose, onSaved }: { available: CourseOption[]; onClose: () => void; onSaved: (courseId: string) => Promise<void> }) {
  const [courseId, setCourseId] = useState(available[0]?.id || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!courseId) {
      setError("There is no other course to offer.");
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
    <StudentDialog title="Offer a course" onClose={onClose}>
      <form onSubmit={save}>
        {available.length === 0 ? <p>Every course is already offered at this branch.</p> : (
          <label>Course
            <select value={courseId} aria-label="Course" onChange={(event) => setCourseId(event.target.value)}>
              {available.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label>
        )}
        {error ? <p className="error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="quiet" onClick={onClose}>Cancel</button>
          <div className="icon-actions">
            <button type="submit" disabled={saving || !courseId} aria-label="Offer a course" title="Offer a course"><Icon name="add" /></button>
          </div>
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
