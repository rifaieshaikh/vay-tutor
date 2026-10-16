import { FormEvent, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { notify } from "../notify";
import { safeBatchWorkspace } from "../students";
import { Icon, StudentDialog } from "../ui";

type UserGrant = { role: string; scope: Record<string, string | null>; unit_ids?: string[] };
type Grant = { id: string; role: string; actions: string[]; scope: Record<string, string | null>; unit_ids?: string[]; consequence: string };
type TeachingUnit = { id: string; name: string; kind: string };
type TeachingRow = { id: string; name: string; archived?: boolean; course_id?: string; subject_id?: string; units?: TeachingUnit[] };
type TeachingCatalog = { courses: TeachingRow[]; subjects: TeachingRow[]; papers: TeachingRow[] };
type PartPick = { papers: string[]; units: string[] };

function courseLabel(catalog: TeachingCatalog, courseId: string | null | undefined) {
  if (!courseId) return "Every course";
  return catalog.courses.find((course) => course.id === courseId)?.name || "Course";
}

function teacherCourses(grants: { role: string; scope: Record<string, string | null> }[], catalog: TeachingCatalog) {
  const ids = grants.filter((grant) => grant.role === "teacher" && grant.scope.course_id).map((grant) => grant.scope.course_id as string);
  return [...new Set(ids)].sort((left, right) => courseLabel(catalog, left).localeCompare(courseLabel(catalog, right)));
}

function subjectParts(grants: UserGrant[], catalog: TeachingCatalog, courseId: string) {
  const rows = grants.filter((grant) => grant.role === "teacher" && grant.scope.course_id === courseId);
  const bySubject = new Map<string, UserGrant[]>();
  for (const grant of rows) {
    const subjectId = grant.scope.subject_id;
    if (!subjectId) continue;
    bySubject.set(subjectId, [...(bySubject.get(subjectId) || []), grant]);
  }
  if (bySubject.size === 0) return ["Every subject"];
  return [...bySubject.entries()].map(([subjectId, items]) => {
    const subject = catalog.subjects.find((item) => item.id === subjectId);
    const papers = items.map((item) => item.scope.paper_id).filter((id): id is string => Boolean(id));
    const units = [...new Set(items.flatMap((item) => item.unit_ids || []))];
    const names = [
      ...papers.map((id) => catalog.papers.find((paper) => paper.id === id)?.name || "Paper"),
      ...units.map((id) => subject?.units?.find((unit) => unit.id === id)?.name || "Part"),
    ];
    const title = subject?.name || "Subject";
    return names.length ? `${title}: ${names.join(", ")}` : `${title}: every part`;
  });
}

function picksFrom(grants: Grant[], courseId: string) {
  const picks: Record<string, PartPick> = {};
  grants.filter((grant) => grant.role === "teacher" && grant.scope.course_id === courseId && grant.scope.subject_id).forEach((grant) => {
    const subjectId = grant.scope.subject_id as string;
    const current = picks[subjectId] || { papers: [], units: [] };
    if (grant.scope.paper_id && !current.papers.includes(grant.scope.paper_id)) current.papers.push(grant.scope.paper_id);
    (grant.unit_ids || []).forEach((unitId) => {
      if (!current.units.includes(unitId)) current.units.push(unitId);
    });
    picks[subjectId] = current;
  });
  return picks;
}

type TeacherRecord = {
  id: string;
  name: string;
  active: boolean;
  app_user: boolean;
  user_id?: string | null;
  email?: string | null;
  grants: Grant[];
};

export function TeachersPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") || "";
  const [teachers, setTeachers] = useState<TeacherRecord[]>([]);
  const [catalog, setCatalog] = useState<TeachingCatalog>({ courses: [], subjects: [], papers: [] });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftQuery, setDraftQuery] = useState(query);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    const [teacherPage, nextCatalog] = await Promise.all([
      api<{ items: TeacherRecord[] }>("/api/v1/teachers"),
      api<TeachingCatalog>("/api/v1/catalog"),
    ]);
    setTeachers(teacherPage.items);
    setCatalog(nextCatalog);
  }

  useEffect(() => {
    load().catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false));
  }, []);

  const shown = teachers
    .filter((teacher) => `${teacher.name} ${teacher.email || ""}`.toLowerCase().includes(query.toLowerCase()))
    .sort((left, right) => left.name.localeCompare(right.name));

  return (
    <section className="panel wide">
      <div className="page-title">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Teachers</h1>
        </div>
        <div className="actions">
          {query ? <button type="button" className="chip-button" onClick={() => setParams({})}>Search: {query}</button> : null}
          <div className="icon-actions">
            {query ? <button type="button" onClick={() => setParams({})} aria-label="Clear filters" title="Clear filters"><Icon name="clear" /></button> : null}
            <button type="button" onClick={() => { setDraftQuery(query); setFiltersOpen(true); }} aria-label={query ? "Filters, 1 applied" : "Filters"} title="Filters"><Icon name="filter" /></button>
            </div>
          <button type="button" onClick={() => { setAdding(true); setError(""); }}>Add teacher</button>
        </div>
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <p className="filter-row"><span>{loading ? "Loading teachers…" : `${shown.length} teacher${shown.length === 1 ? "" : "s"}`}</span></p>
      {!loading && shown.length === 0 ? <p>{teachers.length === 0 ? "No teachers yet." : "No teachers match these filters."}</p> : null}
      {shown.length > 0 ? (
        <div className="table-wrap">
          <table className="people-table">
            <caption className="sr-only">Teachers.</caption>
            <thead>
              <tr>
                <th>Name</th>
                <th>Account</th>
                <th>Email</th>
                <th>Courses</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((teacher) => {
                const courses = teacherCourses(teacher.grants || [], catalog);
                const wide = (teacher.grants || []).some((grant) => grant.role === "teacher" && !grant.scope.course_id);
                const labels = [...(wide ? ["Every course"] : []), ...courses.map((id) => courseLabel(catalog, id))];
                return (
                  <tr key={teacher.id}>
                    <td><Link to={`/teachers/${teacher.id}`}>{teacher.name}</Link></td>
                    <td>{teacher.app_user ? "App user" : "Teacher only"}</td>
                    <td>{teacher.email || "—"}</td>
                    <td>{labels.length ? labels.join(", ") : "—"}</td>
                    <td>{teacher.active ? "Active" : "Inactive"}</td>
                    <td>
                      <div className="icon-actions">
                        <Link to={`/teachers/${teacher.id}`} aria-label={`Open ${teacher.name}`} title="Open teacher"><Icon name="edit" /></Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {filtersOpen ? (
        <StudentDialog title="Filters" onClose={() => setFiltersOpen(false)}>
          <form className="form-grid" onSubmit={(event) => { event.preventDefault(); const next = new URLSearchParams(); if (draftQuery.trim()) next.set("q", draftQuery.trim()); setParams(next); setFiltersOpen(false); }}>
            <label className="span-2">Search
              <input value={draftQuery} aria-label="Search" placeholder="Name or email" onChange={(event) => setDraftQuery(event.target.value)} />
            </label>
            <div className="dialog-actions span-2">
              <button type="button" className="quiet" onClick={() => setDraftQuery("")}>Reset</button>
              <button type="submit">Apply</button>
            </div>
            </form>
        </StudentDialog>
      ) : null}
      {adding ? (
        <TeacherForm
          onClose={() => setAdding(false)}
          onSaved={async (teacher) => {
            setAdding(false);
            notify(`Added ${teacher.name}.`);
            await load();
          }}
        />
      ) : null}
    </section>
  );
}

export function TeacherPage() {
  const { teacherId = "" } = useParams();
  const [params] = useSearchParams();
  const batchBack = safeBatchWorkspace(params.get("returnTo"));
  const [preview, setPreview] = useState<TeacherRecord | null>(null);
  const [catalog, setCatalog] = useState<TeachingCatalog>({ courses: [], subjects: [], papers: [] });
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    const [access, nextCatalog] = await Promise.all([
      api<TeacherRecord>(`/api/v1/teachers/${teacherId}`),
      api<TeachingCatalog>("/api/v1/catalog"),
    ]);
    setPreview(access);
    setCatalog(nextCatalog);
  }

  useEffect(() => {
    setLoading(true);
    setPreview(null);
    load().catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false));
  }, [teacherId]);

  async function clearCourse() {
    if (!removing || !preview) return;
    setError("");
    try {
      await api(`/api/v1/teachers/${preview.id}/teaching`, { method: "PUT", body: JSON.stringify({ course_id: removing, subjects: [] }) });
      notify(`Removed ${courseLabel(catalog, removing)}.`);
      setRemoving(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not remove the course.");
      setRemoving(null);
    }
  }

  if (loading) return <section className="panel"><p>Loading teacher…</p></section>;
  if (!preview) {
    return (
      <section className="panel">
        <p className="meta"><Link to="/teachers">Teachers</Link></p>
        {error ? <p className="error" role="alert">{error}</p> : <p>This teacher was not found.</p>}
      </section>
    );
  }

  const teacherGrants = preview.grants.filter((grant) => grant.role === "teacher");
  const courses = teacherCourses(teacherGrants, catalog);
  const wide = teacherGrants.some((grant) => !grant.scope.course_id);

  return (
    <section className="panel wide">
      {batchBack ? <Link className="quiet back-link" to={batchBack}>← Batch</Link> : <p className="meta"><Link to="/teachers">Teachers</Link></p>}
      <div className="title-row">
        <div>
          <p className="eyebrow">Teacher</p>
          <h1>{preview.name}</h1>
          <p className="meta">{preview.app_user ? preview.email : "Teacher only"}</p>
          <p className="meta">{preview.active ? "Active" : "Inactive"}</p>
        </div>
        {preview.user_id ? <Link to={`/access/${preview.user_id}`}>Users and access</Link> : (
          <button type="button" className="quiet" onClick={async () => {
            setError("");
            try {
              await api(`/api/v1/teachers/${preview.id}`, { method: "PATCH", body: JSON.stringify({ active: !preview.active }) });
              notify(`${preview.name} is now ${preview.active ? "inactive" : "active"}.`);
              await load();
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : "Could not update the teacher.");
            }
          }}>{preview.active ? "Deactivate" : "Activate"}</button>
        )}
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {preview.app_user && wide ? <p className="meta">A Teacher grant also covers every course. Remove it from Users and access when this teacher should stay inside the courses below.</p> : null}
      <div className="title-row">
        <h2>Courses</h2>
        <button type="button" onClick={() => { setAdding(true); setError(""); }}>Add course</button>
      </div>
      {courses.length === 0 ? <p>No course is assigned yet.</p> : (
        <div className="table-wrap">
          <table className="people-table">
            <caption className="sr-only">Courses for {preview.name}.</caption>
            <thead>
              <tr>
                <th>Course</th>
                <th>Subjects and parts</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((courseId) => (
                <tr key={courseId}>
                  <td>{courseLabel(catalog, courseId)}</td>
                  <td>{subjectParts(teacherGrants, catalog, courseId).join("; ")}</td>
                  <td>
                    <div className="icon-actions">
                      <button type="button" onClick={() => setEditing(courseId)} aria-label={`Edit ${courseLabel(catalog, courseId)}`} title="Edit"><Icon name="edit" /></button>
                      <button type="button" onClick={() => setRemoving(courseId)} aria-label={`Remove ${courseLabel(catalog, courseId)}`} title="Remove course"><Icon name="clear" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding || editing ? (
        <CourseAssignment
          teacherId={preview.id}
          courseId={editing || ""}
          grants={preview.grants}
          catalog={catalog}
          taken={courses}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={async (name) => {
            setAdding(false);
            setEditing(null);
            notify(`Saved ${name}.`);
            await load();
          }}
        />
      ) : null}
      {removing ? (
        <StudentDialog title="Remove course" onClose={() => setRemoving(null)}>
          <p>Remove {courseLabel(catalog, removing)} from {preview.name}? Assignments for other courses stay.</p>
          {error ? <p className="error" role="alert">{error}</p> : null}
          <div className="dialog-actions">
            <button type="button" className="quiet" onClick={() => setRemoving(null)}>Cancel</button>
            <button type="button" onClick={clearCourse}>Remove</button>
          </div>
        </StudentDialog>
      ) : null}
    </section>
  );
}

function CourseAssignment({
  teacherId,
  courseId,
  grants,
  catalog,
  taken,
  onClose,
  onSaved,
}: {
  teacherId: string;
  courseId: string;
  grants: Grant[];
  catalog: TeachingCatalog;
  taken: string[];
  onClose: () => void;
  onSaved: (name: string) => Promise<void>;
}) {
  const [course, setCourse] = useState(courseId);
  const [included, setIncluded] = useState<Record<string, PartPick>>(() => (courseId ? picksFrom(grants, courseId) : {}));
  const [acknowledge, setAcknowledge] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const choices = catalog.courses.filter((item) => !item.archived && (item.id === courseId || !taken.includes(item.id)));
  const subjects = catalog.subjects.filter((item) => item.course_id === course && !item.archived).sort((left, right) => left.name.localeCompare(right.name));
  const ready = Boolean(course && Object.keys(included).length);

  function chooseCourse(next: string) {
    setCourse(next);
    setIncluded({});
    setAcknowledge(false);
  }

  function toggleSubject(subjectId: string) {
    setAcknowledge(false);
    setIncluded((current) => {
      const next = { ...current };
      if (next[subjectId]) delete next[subjectId];
      else next[subjectId] = { papers: [], units: [] };
      return next;
    });
  }

  function togglePart(subjectId: string, kind: "papers" | "units", partId: string) {
    setAcknowledge(false);
    setIncluded((current) => {
      const pick = current[subjectId] || { papers: [], units: [] };
      const values = pick[kind].includes(partId) ? pick[kind].filter((id) => id !== partId) : [...pick[kind], partId];
      return { ...current, [subjectId]: { ...pick, [kind]: values } };
    });
  }

  function subjectsPayload() {
    return Object.entries(included).map(([subjectId, pick]) => {
      const papers = catalog.papers.filter((paper) => paper.subject_id === subjectId && !paper.archived);
      const units = catalog.subjects.find((item) => item.id === subjectId)?.units || [];
      const everyPaper = papers.length > 0 && pick.papers.length === papers.length;
      const everyUnit = units.length > 0 && pick.units.length === units.length;
      return {
        subject_id: subjectId,
        paper_ids: pick.papers.length > 0 && !everyPaper ? pick.papers : [],
        unit_ids: pick.units.length > 0 && !everyUnit ? pick.units : [],
      };
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(`/api/v1/teachers/${teacherId}/teaching`, {
        method: "PUT",
        body: JSON.stringify({ course_id: course, subjects: subjectsPayload(), acknowledge_scope: acknowledge }),
      });
      await onSaved(courseLabel(catalog, course));
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "grant.acknowledge_scope") {
        setAcknowledge(true);
        setError(`${reason.message} Confirm to save this assignment.`);
      } else {
        setError(reason instanceof Error ? reason.message : "Could not save the assignment.");
      }
      setSaving(false);
    }
  }

  return (
    <StudentDialog title={courseId ? `Edit ${courseLabel(catalog, courseId)}` : "Add course"} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <p className="meta span-2">Choose a subject to include it. Choose a paper, chapter, or module only when this teacher should cover some of them. For an app user, a paper limit controls which marksheets they can open. A chapter or module is what they teach. A teacher only cannot sign in.</p>
        <label className="span-2">Course
          <select value={course} aria-label="Course" disabled={Boolean(courseId)} onChange={(event) => chooseCourse(event.target.value)}>
            <option value="">Choose</option>
            {choices.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <div className="span-2">
          {course && subjects.length === 0 ? <p>This course has no subjects yet.</p> : null}
          <div className="permission-picks">
            {subjects.map((subject) => (
              <button key={subject.id} type="button" className={included[subject.id] ? "permission is-selected" : "permission"} aria-pressed={Boolean(included[subject.id])} onClick={() => toggleSubject(subject.id)}>
                {subject.name}
              </button>
            ))}
          </div>
          {subjects.map((subject) => {
            const pick = included[subject.id];
            if (!pick) return null;
            const papers = catalog.papers.filter((paper) => paper.subject_id === subject.id && !paper.archived);
            const units = subject.units || [];
            if (papers.length === 0 && units.length === 0) return null;
            return (
              <div key={subject.id} className="part-list">
                <p className="meta">{subject.name}</p>
                <div className="permission-picks">
                  {papers.map((paper) => (
                    <button key={paper.id} type="button" className={pick.papers.includes(paper.id) ? "permission is-selected" : "permission"} aria-pressed={pick.papers.includes(paper.id)} onClick={() => togglePart(subject.id, "papers", paper.id)}>
                      {paper.name}
                    </button>
                  ))}
                  {units.map((unit) => (
                    <button key={unit.id} type="button" className={pick.units.includes(unit.id) ? "permission is-selected" : "permission"} aria-pressed={pick.units.includes(unit.id)} onClick={() => togglePart(subject.id, "units", unit.id)}>
                      {unit.name} · {unit.kind === "module" ? "Module" : "Chapter"}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {error ? <p className="error span-2" role="alert">{error}</p> : null}
        <div className="dialog-actions span-2">
          <button type="button" className="quiet" onClick={onClose}>Cancel</button>
          {acknowledge ? <button type="submit" disabled={saving || !ready}>Confirm this grant</button> : <button type="submit" disabled={saving || !ready}>Save</button>}
        </div>
      </form>
    </StudentDialog>
  );
}

function TeacherForm({ onClose, onSaved }: { onClose: () => void; onSaved: (teacher: TeacherRecord) => Promise<void> }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("teacher");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const account = kind === "app";
  const ready = Boolean(name.trim() && (!account || (email.trim() && password.length >= 10)));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const created = await api<TeacherRecord>("/api/v1/teachers", {
        method: "POST",
        body: JSON.stringify({ name, app_user: account, email, password }),
      });
      await onSaved(created);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add the teacher.");
      setSaving(false);
    }
  }

  return (
    <StudentDialog title="Add teacher" onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <p className="meta span-2">An app user can sign in. A teacher only stays on this list and cannot sign in. Assign a course afterwards.</p>
        <label className="span-2">Name
          <input value={name} aria-label="Name" onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="span-2">Account
          <select value={kind} aria-label="Account" onChange={(event) => setKind(event.target.value)}>
            <option value="teacher">Teacher only</option>
            <option value="app">App user</option>
          </select>
        </label>
        {account ? (
          <>
            <label>Email
              <input type="email" value={email} aria-label="Email" onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label>Password
              <input type="password" value={password} minLength={10} aria-label="Password" onChange={(event) => setPassword(event.target.value)} />
            </label>
          </>
        ) : null}
        {error ? <p className="error span-2" role="alert">{error}</p> : null}
        <div className="dialog-actions span-2">
          <button type="button" className="quiet" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={saving || !ready}>{saving ? "Saving…" : "Add teacher"}</button>
        </div>
      </form>
    </StudentDialog>
  );
}

