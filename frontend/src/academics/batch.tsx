import { FormEvent, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Session, api } from "../api";
import { formatDisplayDate } from "../format";
import { safeBatchWorkspace } from "../students";

type Person = {
  id: string;
  enrollment_id: string;
  student_code: string;
  display_name: string;
  started_on: string | null;
  ended_on: string | null;
};
type Paper = { id: string; name: string };
type Subject = { id: string; name: string; papers: Paper[] };
type Assignment = {
  id: string;
  teacher_id: string;
  teacher_name: string;
  subject_id: string;
  subject_name: string;
  paper_id: string;
  paper_name: string;
  started_on: string | null;
  ended_on: string | null;
  status: string;
};
type Assessment = { id: string; title: string; status: string; subject_id: string; exam_date: string | null };
type Page<T> = { items: T[]; total: number; page: number; pages: number };
type Workspace = {
  id: string;
  name: string;
  branch_id: string;
  branch_name: string;
  course_id: string;
  course_name: string;
  session_key: string;
  started_on: string | null;
  ended_on: string | null;
  timings: string | null;
  closed: boolean;
  students: Page<Person>;
  curriculum: Subject[];
  assignments: Assignment[];
  assessments: Page<Assessment>;
};
type TeacherOption = { id: string; name: string };
type StudentHit = { id: string; display_name: string; student_code: string };

function contextQuery(board: Workspace, extra: Record<string, string> = {}) {
  const next = new URLSearchParams();
  if (board.branch_id) next.set("branch_id", board.branch_id);
  if (board.course_id) next.set("course_id", board.course_id);
  next.set("batch_id", board.id);
  if (board.session_key) next.set("period", board.session_key);
  for (const [key, value] of Object.entries(extra)) {
    if (value) next.set(key, value);
  }
  return next;
}

export function BatchPage({ session }: { session: Session }) {
  const { batchId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const studentPage = Math.max(1, Number(params.get("student_page")) || 1);
  const assessmentPage = Math.max(1, Number(params.get("assessment_page")) || 1);
  const canAssign = session.actions.includes("user.manage");
  const canEnroll = session.actions.includes("student.manage");
  const canImport = session.actions.includes("marksheet.upload");
  const [board, setBoard] = useState<Workspace | null>(null);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [teacherId, setTeacherId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [paperId, setPaperId] = useState("");
  const [startedOn, setStartedOn] = useState("");
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<StudentHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [enrolling, setEnrolling] = useState("");
  const [addingStudent, setAddingStudent] = useState(false);
  const [assigning, setAssigning] = useState(false);

  function loadKey() {
    return `${batchId}|${studentPage}|${assessmentPage}`;
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const search = new URLSearchParams({
      student_page: String(studentPage),
      assessment_page: String(assessmentPage),
      page_size: "8",
    });
    api<Workspace>(`/api/v1/batches/${batchId}?${search.toString()}`)
      .then((result) => {
        if (cancelled) return;
        setBoard(result);
        setError("");
        const next = new URLSearchParams(params);
        if (result.branch_id) next.set("branch_id", result.branch_id);
        if (result.course_id) next.set("course_id", result.course_id);
        next.set("batch_id", result.id);
        if (result.session_key) next.set("period", result.session_key);
        if (next.toString() !== params.toString()) setParams(next, { replace: true });
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
  }, [loadKey()]);

  useEffect(() => {
    if (!canAssign) return;
    api<{ items: { id: string; name: string; active: boolean }[] }>("/api/v1/teachers")
      .then((result) => setTeachers(result.items.filter((item) => item.active)))
      .catch(() => undefined);
  }, [canAssign]);

  function turn(key: "student_page" | "assessment_page", value: number) {
    const next = new URLSearchParams(params);
    if (value <= 1) next.delete(key);
    else next.set(key, String(value));
    setParams(next);
  }

  async function assign(event: FormEvent) {
    event.preventDefault();
    if (!board) return;
    setSaving(true);
    setError("");
    try {
      await api(`/api/v1/batches/${board.id}/assignments`, {
        method: "POST",
        body: JSON.stringify({
          teacher_id: teacherId,
          subject_id: subjectId,
          paper_id: paperId,
          started_on: startedOn,
        }),
      });
      setTeacherId("");
      setSubjectId("");
      setPaperId("");
      setStartedOn("");
      setAssigning(false);
      const search = new URLSearchParams({
        student_page: String(studentPage),
        assessment_page: String(assessmentPage),
        page_size: "8",
      });
      setBoard(await api<Workspace>(`/api/v1/batches/${board.id}?${search.toString()}`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the assignment.");
    } finally {
      setSaving(false);
    }
  }

  async function endAssignment(assignment: Assignment) {
    if (!board) return;
    setError("");
    try {
      await api(`/api/v1/batches/${board.id}/assignments/${assignment.id}/end`, {
        method: "POST",
        body: JSON.stringify({ ended_on: "" }),
      });
      const search = new URLSearchParams({
        student_page: String(studentPage),
        assessment_page: String(assessmentPage),
        page_size: "8",
      });
      setBoard(await api<Workspace>(`/api/v1/batches/${board.id}?${search.toString()}`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not end the assignment.");
    }
  }

  async function findStudents(event: FormEvent) {
    event.preventDefault();
    if (!board || !query.trim()) return;
    setError("");
    const search = new URLSearchParams({ q: query.trim(), page_size: "8" });
    if (board.branch_id) search.set("branch_id", board.branch_id);
    if (board.course_id) search.set("course_id", board.course_id);
    try {
      const result = await api<{ items: StudentHit[] }>(`/api/v1/students?${search.toString()}`);
      setHits(result.items);
      setSearched(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not search students.");
    }
  }

  async function enroll(student: StudentHit) {
    if (!board) return;
    setEnrolling(student.id);
    setError("");
    try {
      await api(`/api/v1/students/${student.id}/enrollments`, {
        method: "POST",
        body: JSON.stringify({ branch_id: board.branch_id, course_id: board.course_id, batch_id: board.id }),
      });
      const search = new URLSearchParams({
        student_page: String(studentPage),
        assessment_page: String(assessmentPage),
        page_size: "8",
      });
      setBoard(await api<Workspace>(`/api/v1/batches/${board.id}?${search.toString()}`));
      setHits([]);
      setQuery("");
      setSearched(false);
      setAddingStudent(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not enroll the student.");
    } finally {
      setEnrolling("");
    }
  }

  if (loading) return <section className="panel"><p>Loading batch…</p></section>;
  if (!board) {
    return <section className="panel">{error ? <p className="error" role="alert">{error}</p> : <p>This batch was not found.</p>}</section>;
  }

  const here = safeBatchWorkspace(`/batches/${board.id}?${contextQuery(board, {
    student_page: studentPage > 1 ? String(studentPage) : "",
    assessment_page: assessmentPage > 1 ? String(assessmentPage) : "",
  }).toString()}`) || `/batches/${board.id}`;
  const papers = board.curriculum.find((item) => item.id === subjectId)?.papers || [];
  const returnTo = encodeURIComponent(here);

  return (
    <section className="panel wide">
      <p className="eyebrow">Batch</p>
      <h1>{board.name}</h1>
      {board.closed ? <p className="page-lead">Closed batch. New enrollments stay out.</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      <dl className="facts">
        <div><dt>Branch</dt><dd>{board.branch_id ? <Link to={`/institute/branches/${board.branch_id}?${contextQuery(board)}`}>{board.branch_name || "Branch"}</Link> : "Not recorded"}</dd></div>
        <div><dt>Course</dt><dd>{board.course_id ? <Link to={`/courses/${board.course_id}?${contextQuery(board)}`}>{board.course_name || "Course"}</Link> : "Not recorded"}</dd></div>
        <div><dt>From</dt><dd>{formatDisplayDate(board.started_on)}</dd></div>
        <div><dt>Until</dt><dd>{formatDisplayDate(board.ended_on)}</dd></div>
        <div><dt>Timings</dt><dd>{board.timings || "Not recorded"}</dd></div>
      </dl>

      <h2>Students</h2>
      {board.students.total === 0 ? <p>No students are enrolled in this batch.</p> : (
        <>
          <div className="table-wrap">
            <table className="people-table">
              <caption className="sr-only">Students in {board.name}.</caption>
              <thead><tr><th>Name</th><th>Code</th><th>From</th><th>Until</th></tr></thead>
              <tbody>
                {board.students.items.map((row) => (
                  <tr key={row.enrollment_id}>
                    <td><Link to={`/students/${row.id}?${contextQuery(board)}&returnTo=${returnTo}`}>{row.display_name}</Link></td>
                    <td>{row.student_code || "Not recorded"}</td>
                    <td>{formatDisplayDate(row.started_on)}</td>
                    <td>{formatDisplayDate(row.ended_on)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="pager">
            <button type="button" className="quiet" disabled={board.students.page <= 1} onClick={() => turn("student_page", board.students.page - 1)}>Previous</button>
            <span>{board.students.page} of {board.students.pages}</span>
            <button type="button" className="quiet" disabled={board.students.page >= board.students.pages} onClick={() => turn("student_page", board.students.page + 1)}>Next</button>
          </p>
        </>
      )}
      {canEnroll && !board.closed && !addingStudent ? <button type="button" onClick={() => setAddingStudent(true)}>Add a student</button> : null}
      {canEnroll && !board.closed && addingStudent ? (
        <form className="form-grid" onSubmit={findStudents}>
          <label className="span-2">Enroll an existing student
            <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Find a student" />
          </label>
          <div className="dialog-actions span-2">
            <button type="button" className="secondary" onClick={() => { setAddingStudent(false); setHits([]); setSearched(false); }}>Cancel</button>
            <button type="submit" disabled={!query.trim()}>Find</button>
            <Link to={`/students/admissions?course_id=${board.course_id}`}>Open admissions</Link>
          </div>
          {searched && hits.length === 0 ? <p className="span-2">No students match. Clear the search or open admissions.</p> : null}
          {hits.length === 0 ? null : (
            <ul className="span-2">
              {hits.map((row) => (
                <li key={row.id}>
                  {row.display_name} {row.student_code ? `(${row.student_code})` : ""}
                  <button type="button" className="quiet" disabled={enrolling === row.id} onClick={() => enroll(row)}>Enroll</button>
                </li>
              ))}
            </ul>
          )}
        </form>
      ) : null}

      <h2>Curriculum</h2>
      <p className="meta">Subjects and papers belong to the course. This batch uses that curriculum.</p>
      {board.curriculum.length === 0 ? <p>This course has no subjects yet.</p> : (
        <ul>
          {board.curriculum.map((subject) => (
            <li key={subject.id}>
              <Link to={`/courses/${board.course_id}?${contextQuery(board)}`}>{subject.name}</Link>
              {subject.papers.length ? ` — ${subject.papers.map((paper) => paper.name).join(", ")}` : ""}
            </li>
          ))}
        </ul>
      )}

      <h2>Teachers</h2>
      <p className="meta">A teaching post is not login access. Ending it keeps the record.</p>
      {board.assignments.length === 0 ? <p>No teacher is assigned to this batch.</p> : (
        <div className="table-wrap">
          <table className="people-table">
            <caption className="sr-only">Teachers for {board.name}.</caption>
            <thead><tr><th>Teacher</th><th>Subject</th><th>Paper</th><th>From</th><th>Until</th><th>Status</th>{canAssign ? <th>Actions</th> : null}</tr></thead>
            <tbody>
              {board.assignments.map((row) => (
                <tr key={row.id}>
                  <td><Link to={`/teachers/${row.teacher_id}?returnTo=${returnTo}`}>{row.teacher_name}</Link></td>
                  <td>{row.subject_name || "Not recorded"}</td>
                  <td>{row.paper_name || "Every paper"}</td>
                  <td>{formatDisplayDate(row.started_on)}</td>
                  <td>{formatDisplayDate(row.ended_on)}</td>
                  <td>{row.status === "ended" ? "Ended" : "Current"}</td>
                  {canAssign ? (
                    <td>{row.status === "current" ? <button type="button" className="quiet" onClick={() => endAssignment(row)}>End</button> : null}</td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canAssign && !board.closed && !assigning ? <button type="button" onClick={() => setAssigning(true)}>Add a teacher</button> : null}
      {canAssign && !board.closed && assigning ? (
        <form className="form-grid" onSubmit={assign}>
          <label>Teacher
            <select value={teacherId} aria-label="Teacher" onChange={(event) => setTeacherId(event.target.value)}>
              <option value="">Choose</option>
              {teachers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>Subject
            <select value={subjectId} aria-label="Subject" onChange={(event) => { setSubjectId(event.target.value); setPaperId(""); }}>
              <option value="">Choose</option>
              {board.curriculum.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>Paper
            <select value={paperId} aria-label="Paper" onChange={(event) => setPaperId(event.target.value)}>
              <option value="">Every paper</option>
              {papers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>From
            <input type="date" value={startedOn} aria-label="Assignment from" onChange={(event) => setStartedOn(event.target.value)} />
          </label>
          <div className="dialog-actions span-2">
            <button type="button" className="secondary" onClick={() => setAssigning(false)}>Cancel</button>
            <button type="submit" disabled={saving || !teacherId || !subjectId}>Assign</button>
          </div>
        </form>
      ) : null}

      <h2>Assessments</h2>
      {board.assessments.total === 0 ? <p>No marksheets include this batch.</p> : (
        <>
          <div className="table-wrap">
            <table className="people-table">
              <caption className="sr-only">Marksheets for {board.name}.</caption>
              <thead><tr><th>Marksheet</th><th>Status</th><th>Exam date</th></tr></thead>
              <tbody>
                {board.assessments.items.map((row) => (
                  <tr key={row.id}>
                    <td><Link to={`/marksheets/${row.id}?${contextQuery(board)}&returnTo=${returnTo}`}>{row.title}</Link></td>
                    <td>{row.status || "Not recorded"}</td>
                    <td>{formatDisplayDate(row.exam_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="pager">
            <button type="button" className="quiet" disabled={board.assessments.page <= 1} onClick={() => turn("assessment_page", board.assessments.page - 1)}>Previous</button>
            <span>{board.assessments.page} of {board.assessments.pages}</span>
            <button type="button" className="quiet" disabled={board.assessments.page >= board.assessments.pages} onClick={() => turn("assessment_page", board.assessments.page + 1)}>Next</button>
          </p>
        </>
      )}
      <p>
        <Link to={`/marksheets?${contextQuery(board)}`}>Open marksheets</Link>
        {" · "}
        <Link to={`/cards?${contextQuery(board)}`}>Open progress cards</Link>
        {" · "}
        <Link to={`/views?${contextQuery(board)}`}>Open academic views</Link>
        {canImport ? <>{" · "}<Link to={`/import?${contextQuery(board)}`}>Import marklist</Link></> : null}
      </p>
    </section>
  );
}
