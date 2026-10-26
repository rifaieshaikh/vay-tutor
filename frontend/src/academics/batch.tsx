import { FormEvent, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Session, api } from "../api";
import { notify } from "../notify";
import { formatDisplayDate } from "../format";
import { useRecordLabel } from "../orientation";
import { safeAcademicReturn, safeBatchWorkspace } from "../students";
import { StudentDialog, moveTab } from "../ui";
import { kindLabel, useCurriculumKinds } from "./kinds";
import { batchState, intakeLabel } from "./lists";

type Person = {
  id: string;
  enrollment_id: string;
  student_code: string;
  display_name: string;
  started_on: string | null;
  ended_on: string | null;
};
type Paper = { id: string; name: string };
type Unit = { id: string; name: string; kind: string };
type Subject = { id: string; name: string; papers: Paper[]; units?: Unit[] };
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
type ExamRow = {
  id: string;
  title: string;
  exam_date: string;
  subject_id: string;
  subject_name: string;
  scope_label: string;
  marksheet_id: string;
  marksheet_status: string;
  attended: number;
  roster_total: number;
  other_batches: { id: string; name: string; branch_name?: string }[];
};
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
  archived?: boolean;
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

const SECTIONS = ["students", "teachers", "curriculum", "assessments"] as const;
type BatchSection = (typeof SECTIONS)[number];

export function BatchPage({ session }: { session: Session }) {
  const { batchId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const studentPage = Math.max(1, Number(params.get("student_page")) || 1);
  const assessmentPage = Math.max(1, Number(params.get("assessment_page")) || 1);
  const section: BatchSection = SECTIONS.includes(params.get("section") as BatchSection) ? params.get("section") as BatchSection : "students";
  const studentQuery = params.get("student_q") || "";
  const studentState = params.get("student_state") === "current" || params.get("student_state") === "historical" ? params.get("student_state") || "" : "";
  const assessmentQuery = params.get("assessment_q") || "";
  const assessmentStatus = params.get("assessment_status") || "";
  const assessmentSubject = params.get("assessment_subject") || "";
  const canAssign = session.actions.includes("user.manage");
  const canEnroll = session.actions.includes("student.manage");
  const canImport = session.actions.includes("marksheet.upload");
  const canCorrect = session.actions.includes("catalog.correct") || session.actions.includes("catalog.manage");
  const kinds = useCurriculumKinds();
  const [board, setBoard] = useState<Workspace | null>(null);
  const [exams, setExams] = useState<ExamRow[]>([]);
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
  const [teacherQuery, setTeacherQuery] = useState("");
  const [teacherStatus, setTeacherStatus] = useState("");
  const [teacherSubject, setTeacherSubject] = useState("");
  useRecordLabel(board && board.id === batchId ? board.name : "");

  function loadKey() {
    return `${batchId}|${studentPage}|${assessmentPage}|${studentQuery}|${studentState}|${assessmentQuery}|${assessmentStatus}|${assessmentSubject}`;
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const search = new URLSearchParams({
      student_page: String(studentPage),
      assessment_page: String(assessmentPage),
      page_size: "8",
    });
    if (studentQuery) search.set("student_q", studentQuery);
    if (studentState) search.set("student_state", studentState);
    if (assessmentQuery) search.set("assessment_q", assessmentQuery);
    if (assessmentStatus) search.set("assessment_status", assessmentStatus);
    if (assessmentSubject) search.set("assessment_subject", assessmentSubject);
    api<Workspace>(`/api/v1/batches/${batchId}?${search.toString()}`)
      .then((result) => {
        if (cancelled) return;
        setBoard(result);
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
  }, [loadKey()]);

  useEffect(() => {
    let cancelled = false;
    api<{ items: ExamRow[] }>(`/api/v1/exams?batch_id=${batchId}`)
      .then((result) => {
        if (!cancelled) setExams(result.items);
      })
      .catch(() => {
        if (!cancelled) setExams([]);
      });
    return () => {
      cancelled = true;
    };
  }, [batchId, board?.id]);

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

  function chooseSection(nextSection: BatchSection) {
    const next = new URLSearchParams(params);
    if (nextSection === "students") next.delete("section");
    else next.set("section", nextSection);
    setParams(next);
  }

  async function reload() {
    const search = new URLSearchParams({
      student_page: String(studentPage),
      assessment_page: String(assessmentPage),
      page_size: "8",
    });
    if (studentQuery) search.set("student_q", studentQuery);
    if (studentState) search.set("student_state", studentState);
    if (assessmentQuery) search.set("assessment_q", assessmentQuery);
    if (assessmentStatus) search.set("assessment_status", assessmentStatus);
    if (assessmentSubject) search.set("assessment_subject", assessmentSubject);
    setBoard(await api<Workspace>(`/api/v1/batches/${batchId}?${search.toString()}`));
  }

  async function setClosed(closed: boolean) {
    if (!board) return;
    if (closed && !window.confirm("Close this batch? New enrollments stay out.")) return;
    setSaving(true);
    setError("");
    try {
      await api(`/api/v1/catalog/batch/${board.id}`, { method: "PATCH", body: JSON.stringify({ closed }) });
      notify(closed ? "Closed the batch." : "Reopened the batch.");
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The batch was not updated.");
    } finally {
      setSaving(false);
    }
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
      await reload();
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
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not end the assignment.");
    }
  }

  async function findStudents(event: FormEvent) {
    event.preventDefault();
    if (!board || !query.trim()) return;
    setError("");
    const search = new URLSearchParams({ q: query.trim(), page_size: "8" });
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
      await reload();
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

  if (!board || board.id !== batchId) {
    return <section className="panel">{error ? <p className="error" role="alert">{error}</p> : <p>{loading ? "Loading batch…" : "This batch was not found."}</p>}</section>;
  }

  const here = safeBatchWorkspace(`/batches/${board.id}?${contextQuery(board, {
    section: section === "students" ? "" : section,
    student_page: studentPage > 1 ? String(studentPage) : "",
    assessment_page: assessmentPage > 1 ? String(assessmentPage) : "",
  }).toString()}`) || `/batches/${board.id}`;
  const teacherNeedle = teacherQuery.trim().toLowerCase();
  const papers = board.curriculum.find((item) => item.id === subjectId)?.papers || [];
  const visibleAssignments = board.assignments.filter((row) => {
    if (teacherStatus && row.status !== teacherStatus) return false;
    if (teacherSubject && row.subject_id !== teacherSubject) return false;
    if (teacherNeedle && !`${row.teacher_name} ${row.subject_name} ${row.paper_name}`.toLowerCase().includes(teacherNeedle)) return false;
    return true;
  });
  const examNeedle = assessmentQuery.trim().toLowerCase();
  const visibleExams = exams.filter((row) => {
    if (examNeedle && !`${row.title} ${row.scope_label} ${row.subject_name}`.toLowerCase().includes(examNeedle)) return false;
    if (assessmentStatus && row.marksheet_status !== assessmentStatus) return false;
    if (assessmentSubject && row.subject_id !== assessmentSubject) return false;
    return true;
  });
  const returnTo = encodeURIComponent(here);
  const listBack = safeAcademicReturn(params.get("returnTo")) || "/batches";
  const reportQuery = contextQuery(board);

  return (
    <section className="panel wide">
      <p className="meta"><Link to={listBack}>Batches</Link></p>
      <div className="title-row">
        <div>
          <p className="eyebrow">Batch</p>
          <h1>{board.name}</h1>
          <p className="meta">{batchState(board)}{(board.closed || board.archived) ? ". New enrollments and assignments stay out." : ""}</p>
        </div>
        <div className="row-actions">
          {canCorrect ? <button type="button" className="secondary" disabled={saving} onClick={() => void setClosed(!board.closed)}>{board.closed ? "Reopen batch" : "Close batch"}</button> : null}
          <Link to={`/views?level=batch&${reportQuery.toString()}`}>View performance</Link>
        </div>
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <dl className="facts">
        <div><dt>Branch</dt><dd>{board.branch_id ? <Link to={`/institute/branches/${board.branch_id}`}>{board.branch_name || "Branch"}</Link> : "Not recorded"}</dd></div>
        <div><dt>Course</dt><dd>{board.course_id ? <Link to={`/courses/${board.course_id}`}>{board.course_name || "Course"}</Link> : "Not recorded"}</dd></div>
        <div><dt>Intake</dt><dd>{intakeLabel(board.session_key)}</dd></div>
        <div><dt>Start</dt><dd>{formatDisplayDate(board.started_on)}</dd></div>
        <div><dt>End</dt><dd>{formatDisplayDate(board.ended_on)}</dd></div>
        <div><dt>Schedule</dt><dd>{board.timings || "Not recorded"}</dd></div>
      </dl>
      <div className="page-tabs" role="tablist" aria-label="Batch" onKeyDown={(event) => moveTab(event, SECTIONS, section, chooseSection)}>
        <button type="button" role="tab" aria-selected={section === "students"} onClick={() => chooseSection("students")}>Students</button>
        <button type="button" role="tab" aria-selected={section === "teachers"} onClick={() => chooseSection("teachers")}>Teachers</button>
        <button type="button" role="tab" aria-selected={section === "curriculum"} onClick={() => chooseSection("curriculum")}>Curriculum</button>
        <button type="button" role="tab" aria-selected={section === "assessments"} onClick={() => chooseSection("assessments")}>Assessments</button>
      </div>

      {section === "students" ? (
        <>
          <div className="title-row">
            <h2>Students <span className="meta">{board.students.total}</span></h2>
            {canEnroll && !board.closed && !board.archived ? <button type="button" onClick={() => setAddingStudent(true)}>Add enrollment</button> : null}
          </div>
          <form className="toolbar" onSubmit={(event) => {
            event.preventDefault();
            const next = new URLSearchParams(params);
            const field = event.currentTarget.elements.namedItem("student_q");
            const value = field instanceof HTMLInputElement ? field.value.trim() : "";
            if (value) next.set("student_q", value);
            else next.delete("student_q");
            next.delete("student_page");
            setParams(next);
          }}>
            <label>Search
              <input name="student_q" defaultValue={studentQuery} aria-label="Search students in this batch" placeholder="Name or code" />
            </label>
            <label>Enrollment
              <select aria-label="Enrollment status" value={studentState} onChange={(event) => {
                const next = new URLSearchParams(params);
                if (event.target.value) next.set("student_state", event.target.value);
                else next.delete("student_state");
                next.delete("student_page");
                setParams(next);
              }}>
                <option value="">Current and historical</option>
                <option value="current">Current</option>
                <option value="historical">Historical</option>
              </select>
            </label>
            <button type="submit">Search</button>
          </form>
          {board.students.total === 0 ? <p>{studentQuery || studentState ? "No students match." : "No students are enrolled in this batch."}</p> : (
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
        </>
      ) : null}

      {section === "teachers" ? (
        <>
          <div className="title-row">
            <h2>Teachers</h2>
            {canAssign && !board.closed && !board.archived ? <button type="button" onClick={() => setAssigning(true)}>Assign teacher</button> : null}
          </div>
          <p className="meta">A teaching assignment is not login access. Ending it keeps the record.</p>
          <form className="toolbar" onSubmit={(event) => event.preventDefault()}>
            <label>Search
              <input value={teacherQuery} aria-label="Search teachers" placeholder="Teacher, subject, or paper" onChange={(event) => setTeacherQuery(event.target.value)} />
            </label>
            <label>Status
              <select aria-label="Assignment status" value={teacherStatus} onChange={(event) => setTeacherStatus(event.target.value)}>
                <option value="">Any status</option>
                <option value="current">Current</option>
                <option value="ended">Ended</option>
              </select>
            </label>
            <label>Subject
              <select aria-label="Assignment subject" value={teacherSubject} onChange={(event) => setTeacherSubject(event.target.value)}>
                <option value="">Any subject</option>
                {board.curriculum.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
              </select>
            </label>
          </form>
          {visibleAssignments.length === 0 ? <p>{board.assignments.length === 0 ? "No teacher is assigned to this batch." : "No teachers match."}</p> : (
            <div className="table-wrap">
              <table className="people-table">
                <caption className="sr-only">Teachers for {board.name}.</caption>
                <thead><tr><th>Teacher</th><th>Subject</th><th>Paper</th><th>From</th><th>Until</th><th>Status</th>{canAssign ? <th>Actions</th> : null}</tr></thead>
                <tbody>
                  {visibleAssignments.map((row) => (
                    <tr key={row.id}>
                      <td><Link to={`/teachers/${row.teacher_id}?returnTo=${returnTo}`}>{row.teacher_name}</Link></td>
                      <td>{row.subject_name || "Not recorded"}</td>
                      <td>{row.paper_name || "Every paper"}</td>
                      <td>{formatDisplayDate(row.started_on)}</td>
                      <td>{formatDisplayDate(row.ended_on)}</td>
                      <td>{row.status === "ended" ? "Ended" : "Current"}</td>
                      {canAssign ? <td>{row.status === "current" ? <button type="button" className="quiet" onClick={() => endAssignment(row)}>End</button> : null}</td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}

      {section === "curriculum" ? (
        <>
          <h2>Curriculum</h2>
          <p className="meta">Subjects and curriculum items belong to {board.course_name || "the course"}. This batch uses that live curriculum. {board.course_id ? <Link to={`/courses/${board.course_id}?section=curriculum`}>{canCorrect ? "Edit the course curriculum" : "Open the course curriculum"}</Link> : null}</p>
          {board.curriculum.length === 0 ? <p>This course has no subjects yet.</p> : (
            board.curriculum.map((subject) => (
              <section key={subject.id}>
                <h3>{subject.name}</h3>
                {subject.papers.length === 0 && !(subject.units || []).length ? <p>No curriculum items yet.</p> : (
                  <ul>
                    {subject.papers.map((paper) => <li key={paper.id}>{kindLabel(kinds, "paper")} · {paper.name}</li>)}
                    {(subject.units || []).map((unit) => <li key={unit.id}>{kindLabel(kinds, unit.kind)} · {unit.name}</li>)}
                  </ul>
                )}
              </section>
            ))
          )}
        </>
      ) : null}

      {section === "assessments" ? (
        <>
          <h2>Assessments</h2>
          <form className="toolbar" onSubmit={(event) => {
            event.preventDefault();
            const next = new URLSearchParams(params);
            const field = event.currentTarget.elements.namedItem("assessment_q");
            const value = field instanceof HTMLInputElement ? field.value.trim() : "";
            if (value) next.set("assessment_q", value);
            else next.delete("assessment_q");
            next.delete("assessment_page");
            setParams(next);
          }}>
            <label>Search
              <input name="assessment_q" defaultValue={assessmentQuery} aria-label="Search assessments" placeholder="Marksheet title" />
            </label>
            <label>Status
              <select aria-label="Assessment status" value={assessmentStatus} onChange={(event) => {
                const next = new URLSearchParams(params);
                if (event.target.value) next.set("assessment_status", event.target.value);
                else next.delete("assessment_status");
                next.delete("assessment_page");
                setParams(next);
              }}>
                <option value="">Any status</option>
                <option value="draft">Draft</option>
                <option value="submitted">Submitted</option>
                <option value="published">Published</option>
              </select>
            </label>
            <label>Subject
              <select aria-label="Assessment subject" value={assessmentSubject} onChange={(event) => {
                const next = new URLSearchParams(params);
                if (event.target.value) next.set("assessment_subject", event.target.value);
                else next.delete("assessment_subject");
                next.delete("assessment_page");
                setParams(next);
              }}>
                <option value="">Any subject</option>
                {board.curriculum.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
              </select>
            </label>
            <button type="submit">Search</button>
          </form>
          {visibleExams.length === 0 ? <p>{assessmentQuery || assessmentStatus || assessmentSubject ? "No exams match." : <>No exams are recorded for this batch. {canImport ? <Link to={`/ecr/${board.id}`}>Open the exam register</Link> : "A permitted user can record an exam."}</>}</p> : (
            <div className="table-wrap">
              <table className="people-table">
                <caption className="sr-only">Exams for {board.name}.</caption>
                <thead><tr><th>Exam</th><th>Scope</th><th>Status</th><th>Exam date</th><th>Attended</th></tr></thead>
                <tbody>
                  {visibleExams.map((row) => (
                    <tr key={row.id}>
                      <td><Link to={`/marksheets/${row.marksheet_id}?${reportQuery.toString()}&returnTo=${returnTo}`}>{row.title}</Link></td>
                      <td>{row.scope_label}</td>
                      <td>{row.marksheet_status || "draft"}</td>
                      <td>{formatDisplayDate(row.exam_date)}</td>
                      <td>{row.attended} / {row.roster_total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p>
            <Link to={`/ecr/${board.id}`}>Exam register</Link>
            {" · "}
            <Link to={`/marksheets?${reportQuery.toString()}`}>Open marksheets</Link>
            {" · "}
            <Link to={`/cards?${reportQuery.toString()}`}>Open progress cards</Link>
          </p>
        </>
      ) : null}

      {addingStudent ? (
        <StudentDialog title="Add enrollment" onClose={() => { setAddingStudent(false); setHits([]); setSearched(false); }} dirty={Boolean(query.trim() || hits.length)}>
          <form className="form-grid" onSubmit={findStudents}>
            <p className="span-2">Find an existing student. A new applicant starts in Admissions.</p>
            <label className="span-2">Student
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
        </StudentDialog>
      ) : null}
      {assigning ? (
        <StudentDialog title="Assign teacher" onClose={() => setAssigning(false)} dirty={Boolean(teacherId || subjectId || paperId || startedOn)}>
          <form className="form-grid" onSubmit={assign}>
            <p className="span-2">This records who teaches the subject. It does not grant an account.</p>
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
              <button type="submit" disabled={saving || !teacherId || !subjectId}>{saving ? "Saving…" : "Assign teacher"}</button>
            </div>
          </form>
        </StudentDialog>
      ) : null}
    </section>
  );
}
