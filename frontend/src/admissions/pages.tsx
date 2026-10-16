import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError, api, Session } from "../api";
import { Option, optionFits } from "../filters";
import { formatDisplayDate } from "../format";
import { useUnsaved } from "../guard";
import { notify } from "../notify";
import { useRecordLabel } from "../orientation";
import { AcademicRecord, BLOOD_GROUPS, EMPTY_RECORD, GENDERS } from "../records";
import { confirmDiscard, StudentDialog } from "../ui";
import { AnswerFields, FormQuestions, Question } from "./questions";

type CourseOption = { id: string; name: string };
type Answer = { question_id: string; label?: string; value: string };
type FollowUp = { id: string; at: string; note: string; interest: string; next_on: string };
type Enquiry = {
  id: string;
  name: string;
  whatsapp: string;
  present_institution: string;
  course_id: string;
  course_name: string;
  interest: string;
  references: string;
  details: string;
  questions?: Question[];
  answers?: Answer[];
  follow_ups: FollowUp[];
  follow_up_count?: number;
  admission_id: string | null;
  stage?: string;
  next_action?: string;
};
type Match = { id: string; display_name: string; student_code: string; phone: string };
type Admission = {
  id: string;
  course_id: string;
  course_name: string;
  name: string;
  phone: string;
  date_of_birth: string;
  gender: string;
  blood_group: string;
  email: string;
  street: string;
  address_line_2: string;
  place: string;
  district: string;
  state: string;
  pin: string;
  guardian_name: string;
  guardian_phone: string;
  academic_records: AcademicRecord[];
  course_answers: Answer[];
  business_answers?: Answer[];
  questions: Question[];
  status: string;
  student_id: string | null;
  enrollment_id?: string | null;
  branch_id?: string | null;
  batch_id?: string | null;
  enquiry_id: string | null;
  stage?: string;
  next_action?: string;
  match_decision: string;
  match_student_id: string;
  matches: Match[];
};
type PreviewRow = {
  row: number;
  errors: string[];
  matches?: Match[];
  values: Record<string, unknown>;
  answers?: Answer[];
  business_answers?: Answer[];
  decision?: string;
  student_id?: string;
};

const INTERESTS = ["High", "Medium", "Low"];
const BLOOD = BLOOD_GROUPS;

function readable(text: string) {
  return text.replace(/\d{4}-\d{2}-\d{2}/g, (value) => formatDisplayDate(value));
}

function withParam(params: URLSearchParams, key: string, value: string) {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value);
  else next.delete(key);
  if (key !== "page") next.delete("page");
  return next;
}

function missingAnswers(questions: Question[], answers: { question_id: string; value: string }[]) {
  return questions.filter((question) => question.required && !answers.some((item) => item.question_id === question.id && item.value.trim()));
}

function coursesOf(catalog: { courses: CourseOption[] } | null) {
  return [...(catalog?.courses || [])].sort((left, right) => left.name.localeCompare(right.name));
}

export function EnquiriesPage({ session }: { session: Session }) {
  const [params, setParams] = useSearchParams();
  const followUp = params.get("follow_up") || "";
  const courseId = params.get("course_id") || "";
  const query = params.get("q") || "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const canManage = session.actions.includes("student.manage");
  const canEditQuestions = session.actions.includes("catalog.correct") || session.actions.includes("catalog.manage");
  const [items, setItems] = useState<Enquiry[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [draft, setDraft] = useState(query);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const filtered = Boolean(query || followUp || courseId);

  useEffect(() => { setDraft(query); }, [query]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (draft === query) return;
      setParams(withParam(params, "q", draft.trim()));
    }, 300);
    return () => window.clearTimeout(handle);
  }, [draft, query, params, setParams]);

  useEffect(() => {
    const searchParams = new URLSearchParams();
    if (query) searchParams.set("q", query);
    if (followUp) searchParams.set("follow_up", followUp);
    if (courseId) searchParams.set("course_id", courseId);
    searchParams.set("page", String(page));
    let cancelled = false;
    setLoading(true);
    api<{ items: Enquiry[]; total: number; pages: number }>(`/api/v1/enquiries?${searchParams.toString()}`)
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        setTotal(result.total);
        setPages(result.pages);
        setError("");
      })
      .catch((reason: Error) => { if (!cancelled) setError(reason.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    api<{ courses: CourseOption[] }>("/api/v1/catalog").then((catalog) => { if (!cancelled) setCourses(coursesOf(catalog)); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [followUp, courseId, query, page, revision]);

  return (
    <section className="panel wide">
      <div className="page-title">
        <div>
          <p className="eyebrow">Admissions</p>
          <h1>Enquiries</h1>
          {followUp === "due" ? <p className="page-lead">Enquiries awaiting follow-up.</p> : null}
        </div>
        {canManage ? (
          <div className="actions">
            <button type="button" onClick={() => setImporting(true)}>Import</button>
            <button type="button" onClick={() => setAdding(true)}>Add enquiry</button>
          </div>
        ) : null}
      </div>
      {canEditQuestions ? (
        <p className="actions">
          <button type="button" className="secondary" aria-expanded={questionsOpen} onClick={() => setQuestionsOpen((open) => !open)}>Form questions</button>
        </p>
      ) : null}
      {questionsOpen ? <FormQuestions form="enquiry" canEdit={canEditQuestions} /> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      <form className="filter-row" onSubmit={(event) => { event.preventDefault(); setParams(withParam(params, "q", draft.trim())); }}>
        <label>Search
          <input value={draft} aria-label="Search enquiries" onChange={(event) => setDraft(event.target.value)} />
        </label>
        <label>Follow-up
          <select aria-label="Follow-up" value={followUp} onChange={(event) => setParams(withParam(params, "follow_up", event.target.value))}>
            <option value="">Any</option>
            <option value="due">Due</option>
          </select>
        </label>
        <label>Course
          <select aria-label="Course" value={courseId} onChange={(event) => setParams(withParam(params, "course_id", event.target.value))}>
            <option value="">Any course</option>
            {courses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
      </form>
      <p className="filter-row">
        <span>{loading ? "Loading enquiries…" : `${total} enquir${total === 1 ? "y" : "ies"}`}</span>
        {followUp ? <button type="button" className="quiet" onClick={() => setParams(withParam(params, "follow_up", ""))}>Due</button> : null}
        {courseId ? <button type="button" className="quiet" onClick={() => setParams(withParam(params, "course_id", ""))}>{courses.find((item) => item.id === courseId)?.name || "Course"}</button> : null}
        {query ? <button type="button" className="quiet" onClick={() => setParams(withParam(params, "q", ""))}>{query}</button> : null}
        {filtered ? <button type="button" className="quiet" onClick={() => setParams(new URLSearchParams())}>Clear</button> : null}
      </p>
      {items.length === 0 && !loading ? <p>{filtered ? "No enquiries match." : "No enquiries yet."}</p> : null}
      {items.length > 0 ? (
        <div className="table-wrap">
          <table className="people-table">
            <caption className="sr-only">Enquiries</caption>
            <thead>
              <tr><th>Name</th><th>WhatsApp</th><th>Course</th><th>Interest</th><th>Stage</th><th>Next</th></tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td><Link to={`/students/enquiries/${item.id}`}>{item.name}</Link></td>
                  <td>{item.whatsapp || "Not recorded"}</td>
                  <td>{item.course_name || "Not recorded"}</td>
                  <td>{item.interest || "Not recorded"}</td>
                  <td>{item.stage || (item.admission_id ? "Admitted" : "Enquiry")}</td>
                  <td>{item.admission_id ? <Link to={`/students/admissions/${item.admission_id}`}>Open admission</Link> : readable(item.next_action || "Follow up")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {pages > 1 ? (
        <p className="actions">
          <button type="button" className="secondary" disabled={page <= 1} onClick={() => setParams(withParam(params, "page", String(page - 1)))}>Previous</button>
          <span>Page {page} of {pages}</span>
          <button type="button" className="secondary" disabled={page >= pages} onClick={() => setParams(withParam(params, "page", String(page + 1)))}>Next</button>
        </p>
      ) : null}
      {adding ? <EnquiryForm courses={courses} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); setRevision((value) => value + 1); }} /> : null}
      {importing ? <ImportDialog kind="enquiries" onClose={() => setImporting(false)} onSaved={() => { setImporting(false); setRevision((value) => value + 1); }} /> : null}
    </section>
  );
}

export function EnquiryPage({ session }: { session: Session }) {
  const { enquiryId = "" } = useParams();
  const navigate = useNavigate();
  const canManage = session.actions.includes("student.manage");
  const [enquiry, setEnquiry] = useState<Enquiry | null>(null);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [admitting, setAdmitting] = useState(false);
  const [savingFollow, setSavingFollow] = useState(false);
  const [follow, setFollow] = useState({ at: "", note: "", interest: "", next_on: "" });
  const followDirty = Boolean(follow.at || follow.note || follow.interest || follow.next_on);
  useRecordLabel(enquiry?.name || "");
  useUnsaved(followDirty);

  function load() {
    api<Enquiry>(`/api/v1/enquiries/${enquiryId}`).then(setEnquiry).catch((reason: Error) => setError(reason.message));
  }

  useEffect(() => {
    load();
    api<{ courses: CourseOption[] }>("/api/v1/catalog").then((catalog) => setCourses(coursesOf(catalog))).catch(() => undefined);
  }, [enquiryId]);

  async function addFollow(event: FormEvent) {
    event.preventDefault();
    if (savingFollow) return;
    setSavingFollow(true);
    setError("");
    try {
      await api(`/api/v1/enquiries/${enquiryId}/follow-ups`, { method: "POST", body: JSON.stringify(follow) });
      setFollow({ at: "", note: "", interest: "", next_on: "" });
      notify("Saved the follow-up.");
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The follow-up was not saved.");
    } finally {
      setSavingFollow(false);
    }
  }

  async function convert() {
    if (admitting) return;
    setAdmitting(true);
    setError("");
    try {
      const result = await api<{ id: string }>(`/api/v1/enquiries/${enquiryId}/convert`, { method: "POST" });
      notify("Opened the admission.");
      navigate(`/students/admissions/${result.id}`);
    } catch (reason) {
      setAdmitting(false);
      setError(reason instanceof Error ? reason.message : "The enquiry was not admitted.");
    }
  }

  if (!enquiry) {
    return <section className="panel">{error ? <p className="error" role="alert">{error}</p> : <p>Loading enquiry…</p>}</section>;
  }
  return (
    <section className="panel wide">
      <div className="title-row">
        <div>
          <p className="eyebrow">Enquiry</p>
          <h1>{enquiry.name}</h1>
          <p className="meta">{enquiry.stage || (enquiry.admission_id ? "Admitted" : "Enquiry")} · {readable(enquiry.next_action || (enquiry.admission_id ? "Open the admission" : "Record a follow-up"))}</p>
        </div>
        <div className="actions">
          {canManage ? <button type="button" onClick={() => setEditing(true)}>Edit</button> : null}
          {enquiry.admission_id ? <Link className="button" to={`/students/admissions/${enquiry.admission_id}`}>Open admission</Link> : canManage ? <button type="button" disabled={admitting} onClick={() => void convert()}>{admitting ? "Admitting…" : "Admit"}</button> : null}
        </div>
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <dl className="facts">
        <div><dt>WhatsApp</dt><dd className={enquiry.whatsapp ? undefined : "is-empty"}>{enquiry.whatsapp || "Not recorded"}</dd></div>
        <div><dt>Interest</dt><dd className={enquiry.interest ? undefined : "is-empty"}>{enquiry.interest || "Not recorded"}</dd></div>
        <div className="span-2"><dt>Present institution</dt><dd className={enquiry.present_institution ? undefined : "is-empty"}>{enquiry.present_institution || "Not recorded"}</dd></div>
        <div className="span-2"><dt>Interested course</dt><dd className={enquiry.course_name ? undefined : "is-empty"}>{enquiry.course_name || "Not recorded"}</dd></div>
        <div className="span-2"><dt>References</dt><dd className={enquiry.references ? undefined : "is-empty"}>{enquiry.references || "Not recorded"}</dd></div>
        <div className="span-2"><dt>Other details</dt><dd className={enquiry.details ? undefined : "is-empty"}>{enquiry.details || "Not recorded"}</dd></div>
        {(enquiry.answers || []).map((item) => (
          <div key={item.question_id} className="span-2"><dt>{item.label || "Question"}</dt><dd className={item.value ? undefined : "is-empty"}>{item.value || "Not recorded"}</dd></div>
        ))}
      </dl>
      <h2>Follow-ups</h2>
      {enquiry.follow_ups.length === 0 ? <p>No follow-ups yet.</p> : (
        <div className="table-wrap">
          <table className="people-table">
            <caption className="sr-only">Follow-ups</caption>
            <thead><tr><th>Date</th><th>Discussed</th><th>Interest</th><th>Next</th></tr></thead>
            <tbody>
              {enquiry.follow_ups.map((item) => (
                <tr key={item.id}>
                  <td>{formatDisplayDate(item.at)}</td>
                  <td>{item.note}</td>
                  <td>{item.interest || "Not recorded"}</td>
                  <td>{formatDisplayDate(item.next_on)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManage ? (
        <form className="form-grid" onSubmit={addFollow}>
          <label>Date
            <input type="date" value={follow.at} required onChange={(event) => setFollow({ ...follow, at: event.target.value })} />
          </label>
          <label>Interest after this contact
            <select value={follow.interest} onChange={(event) => setFollow({ ...follow, interest: event.target.value })}>
              <option value="">Not recorded</option>
              {INTERESTS.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="span-2">What was discussed
            <textarea rows={3} value={follow.note} required onChange={(event) => setFollow({ ...follow, note: event.target.value })} />
          </label>
          <label>Next follow-up
            <input type="date" value={follow.next_on} onChange={(event) => setFollow({ ...follow, next_on: event.target.value })} />
          </label>
          <div className="dialog-actions span-2"><button type="submit" disabled={savingFollow}>{savingFollow ? "Saving…" : "Add follow-up"}</button></div>
        </form>
      ) : null}
      {editing ? <EnquiryForm courses={courses} initial={enquiry} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} /> : null}
    </section>
  );
}

function EnquiryForm({ courses, initial, onClose, onSaved }: { courses: CourseOption[]; initial?: Enquiry; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name || "");
  const [whatsapp, setWhatsapp] = useState(initial?.whatsapp || "");
  const [institution, setInstitution] = useState(initial?.present_institution || "");
  const [courseId, setCourseId] = useState(initial?.course_id || "");
  const [interest, setInterest] = useState(initial?.interest || "");
  const [references, setReferences] = useState(initial?.references || "");
  const [details, setDetails] = useState(initial?.details || "");
  const [questions, setQuestions] = useState<Question[]>(initial?.questions || []);
  const [answers, setAnswers] = useState<Record<string, string>>(Object.fromEntries((initial?.answers || []).map((item) => [item.question_id, item.value])));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const answersDirty = questions.some((item) => (answers[item.id] || "") !== ((initial?.answers || []).find((answer) => answer.question_id === item.id)?.value || ""));
  const dirty = !saving && (
    name !== (initial?.name || "")
    || whatsapp !== (initial?.whatsapp || "")
    || institution !== (initial?.present_institution || "")
    || courseId !== (initial?.course_id || "")
    || interest !== (initial?.interest || "")
    || references !== (initial?.references || "")
    || details !== (initial?.details || "")
    || answersDirty
  );
  useUnsaved(dirty);

  useEffect(() => {
    if (initial) return;
    api<{ items: Question[] }>("/api/v1/form-questions?form=enquiry").then((result) => setQuestions(result.items)).catch(() => setQuestions([]));
  }, [initial]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const body = {
      name,
      whatsapp,
      present_institution: institution,
      course_id: courseId,
      interest,
      references,
      details,
      answers: questions.map((item) => ({ question_id: item.id, value: answers[item.id] || "" })),
    };
    try {
      if (initial) {
        await api(`/api/v1/enquiries/${initial.id}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        await api("/api/v1/enquiries", { method: "POST", body: JSON.stringify(body) });
      }
      notify(initial ? `Saved ${name}.` : `Added ${name}.`);
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The enquiry was not saved.");
      setSaving(false);
    }
  }

  return (
    <StudentDialog title={initial ? "Edit enquiry" : "Add enquiry"} dirty={dirty} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <label className="span-2">Name
          <input value={name} required onChange={(event) => setName(event.target.value)} />
        </label>
        <label>WhatsApp number
          <input value={whatsapp} onChange={(event) => setWhatsapp(event.target.value)} />
        </label>
        <label>Level of interest
          <select value={interest} onChange={(event) => setInterest(event.target.value)}>
            <option value="">Not recorded</option>
            {INTERESTS.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="span-2">Present institution
          <input value={institution} onChange={(event) => setInstitution(event.target.value)} />
        </label>
        <label className="span-2">Interested course
          <select value={courseId} onChange={(event) => setCourseId(event.target.value)}>
            <option value="">Not recorded</option>
            {courses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="span-2">References
          <textarea rows={2} value={references} onChange={(event) => setReferences(event.target.value)} />
        </label>
        <label className="span-2">Other details
          <textarea rows={3} value={details} onChange={(event) => setDetails(event.target.value)} />
        </label>
        <AnswerFields questions={questions} answers={answers} onChange={(id, value) => setAnswers({ ...answers, [id]: value })} requiredNote="required to admit" />
        {error ? <p className="error span-2" role="alert">{error}</p> : null}
        <div className="dialog-actions span-2">
          <button type="button" className="quiet" onClick={() => { if (confirmDiscard(dirty)) onClose(); }}>Cancel</button>
          <button type="submit" disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </StudentDialog>
  );
}

export function AdmissionsPage({ session }: { session: Session }) {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") || "";
  const courseId = params.get("course_id") || "";
  const query = params.get("q") || "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const canManage = session.actions.includes("student.manage");
  const canEditQuestions = session.actions.includes("catalog.correct") || session.actions.includes("catalog.manage");
  const [items, setItems] = useState<Admission[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [draft, setDraft] = useState(query);
  const [importing, setImporting] = useState(false);
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const filtered = Boolean(query || status || courseId);
  const [courses, setCourses] = useState<CourseOption[]>([]);

  useEffect(() => { setDraft(query); }, [query]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (draft === query) return;
      setParams(withParam(params, "q", draft.trim()));
    }, 300);
    return () => window.clearTimeout(handle);
  }, [draft, query, params, setParams]);

  useEffect(() => {
    const searchParams = new URLSearchParams();
    if (query) searchParams.set("q", query);
    if (status) searchParams.set("status", status);
    if (courseId) searchParams.set("course_id", courseId);
    searchParams.set("page", String(page));
    let cancelled = false;
    setLoading(true);
    api<{ items: Admission[]; total: number; pages: number }>(`/api/v1/admissions?${searchParams.toString()}`)
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        setTotal(result.total);
        setPages(result.pages);
        setError("");
      })
      .catch((reason: Error) => { if (!cancelled) setError(reason.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    api<{ courses: CourseOption[] }>("/api/v1/catalog").then((catalog) => { if (!cancelled) setCourses(coursesOf(catalog)); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [status, courseId, query, page, revision]);

  return (
    <section className="panel wide">
      <div className="page-title">
        <div>
          <p className="eyebrow">Admissions</p>
          <h1>Admissions</h1>
          {status === "open" ? <p className="page-lead">Admissions awaiting enrollment.</p> : null}
        </div>
        {canManage ? (
          <div className="actions">
            <button type="button" className="secondary" onClick={() => setImporting(true)}>Import</button>
            <Link className="button" to="/students/admissions/new">Add admission</Link>
          </div>
        ) : null}
      </div>
      {canEditQuestions ? (
        <p className="actions">
          <button type="button" className="secondary" aria-expanded={questionsOpen} onClick={() => setQuestionsOpen((open) => !open)}>Form questions</button>
        </p>
      ) : null}
      {questionsOpen ? <FormQuestions form="admission" canEdit={canEditQuestions} /> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      <form className="filter-row" onSubmit={(event) => { event.preventDefault(); setParams(withParam(params, "q", draft.trim())); }}>
        <label>Search
          <input value={draft} aria-label="Search admissions" onChange={(event) => setDraft(event.target.value)} />
        </label>
        <label>Status
          <select aria-label="Status" value={status} onChange={(event) => setParams(withParam(params, "status", event.target.value))}>
            <option value="">Any</option>
            <option value="open">Open</option>
            <option value="converted">Enrolled</option>
          </select>
        </label>
        <label>Course
          <select aria-label="Course" value={courseId} onChange={(event) => setParams(withParam(params, "course_id", event.target.value))}>
            <option value="">Any course</option>
            {courses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
      </form>
      <p className="filter-row">
        <span>{loading ? "Loading admissions…" : `${total} admission${total === 1 ? "" : "s"}`}</span>
        {status ? <button type="button" className="quiet" onClick={() => setParams(withParam(params, "status", ""))}>{status === "converted" ? "Enrolled" : "Open"}</button> : null}
        {courseId ? <button type="button" className="quiet" onClick={() => setParams(withParam(params, "course_id", ""))}>{courses.find((item) => item.id === courseId)?.name || "Course"}</button> : null}
        {query ? <button type="button" className="quiet" onClick={() => setParams(withParam(params, "q", ""))}>{query}</button> : null}
        {filtered ? <button type="button" className="quiet" onClick={() => setParams(new URLSearchParams())}>Clear</button> : null}
      </p>
      {items.length === 0 && !loading ? <p>{filtered ? "No admissions match." : "No admissions yet."}</p> : null}
      {items.length > 0 ? (
        <div className="table-wrap">
          <table className="people-table">
            <caption className="sr-only">Admissions</caption>
            <thead><tr><th>Name</th><th>Contact</th><th>Course</th><th>Stage</th><th>Next</th></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td><Link to={`/students/admissions/${item.id}`}>{item.name}</Link></td>
                  <td>{item.phone}</td>
                  <td>{item.course_name || "Not recorded"}</td>
                  <td>{item.stage || (item.status === "converted" ? "Enrolled" : "Open")}</td>
                  <td>{item.student_id ? <Link to={`/students/${item.student_id}`}>Open student</Link> : "Enroll in a batch"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {pages > 1 ? (
        <p className="actions">
          <button type="button" className="secondary" disabled={page <= 1} onClick={() => setParams(withParam(params, "page", String(page - 1)))}>Previous</button>
          <span>Page {page} of {pages}</span>
          <button type="button" className="secondary" disabled={page >= pages} onClick={() => setParams(withParam(params, "page", String(page + 1)))}>Next</button>
        </p>
      ) : null}
      {importing ? <ImportDialog kind="admissions" onClose={() => setImporting(false)} onSaved={() => { setImporting(false); setRevision((value) => value + 1); }} /> : null}
    </section>
  );
}

export function AdmissionPage({ session }: { session: Session }) {
  const { admissionId = "" } = useParams();
  const navigate = useNavigate();
  const canManage = session.actions.includes("student.manage");
  const [admission, setAdmission] = useState<Admission | null>(null);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [options, setOptions] = useState<{ branches: Option[]; batches: Option[] }>({ branches: [], batches: [] });
  const [editing, setEditing] = useState(false);
  const [branchId, setBranchId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [error, setError] = useState("");
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [gaps, setGaps] = useState<string[]>([]);
  const [businessQuestions, setBusinessQuestions] = useState<Question[]>([]);
  useRecordLabel(admission?.name || "");
  useUnsaved(!editing && !saving && Boolean(branchId || batchId));

  function load() {
    api<Admission>(`/api/v1/admissions/${admissionId}`).then(setAdmission).catch((reason: Error) => setError(reason.message));
  }

  useEffect(() => {
    load();
    api<{ courses: CourseOption[] }>("/api/v1/catalog").then((catalog) => setCourses(coursesOf(catalog))).catch(() => undefined);
    if (canManage) {
      api<{ branches: Option[]; batches: Option[] }>("/api/v1/students/options?manage=true").then(setOptions).catch((reason: Error) => setError(reason.message || "Branches could not be loaded."));
    }
    api<{ items: Question[] }>("/api/v1/form-questions?form=admission").then((result) => setBusinessQuestions(result.items)).catch(() => setBusinessQuestions([]));
  }, [admissionId]);

  function enrollmentGaps() {
    if (!admission) return [];
    const missing = missingAnswers(businessQuestions, admission.business_answers || []).map((item) => item.label);
    missing.push(...missingAnswers(admission.questions || [], admission.course_answers).map((item) => item.label));
    if (!branchId) missing.push("Branch");
    if (!batchId) missing.push("Batch");
    return missing;
  }

  async function convert(decision = "", studentId = "") {
    if (saving) return;
    const missing = enrollmentGaps();
    setGaps(missing);
    if (missing.length) return;
    setSaving(true);
    setError("");
    try {
      const result = await api<{ id: string }>(`/api/v1/admissions/${admissionId}/convert`, {
        method: "POST",
        body: JSON.stringify({ branch_id: branchId, batch_id: batchId, decision, student_id: studentId }),
      });
      notify(`Enrolled ${admission?.name || "the student"}.`);
      navigate(`/students/${result.id}`);
    } catch (reason) {
      setSaving(false);
      if (reason instanceof ApiError && reason.code === "admission.match") {
        const found = (reason.details as { matches?: Match[] }).matches || admission?.matches || [];
        setMatches(found);
        return;
      }
      setError(reason instanceof Error ? reason.message : "The admission was not saved.");
    }
  }

  if (!admission) {
    return <section className="panel">{error ? <p className="error" role="alert">{error}</p> : <p>Loading admission…</p>}</section>;
  }
  const batches = options.batches.filter((item) => optionFits(item, { branch_id: branchId, course_id: admission.course_id }));
  const open = admission.status !== "converted";
  return (
    <section className="panel wide">
      <div className="title-row">
        <div>
          <p className="eyebrow">Admission</p>
          <h1>{admission.name}</h1>
          <p className="meta">{admission.course_name} · {admission.stage || (open ? "Open" : "Enrolled")} · {admission.next_action || (open ? "Enroll in a batch" : "Open the student")}</p>
        </div>
        <div className="actions">
          {admission.enquiry_id ? <Link to={`/students/enquiries/${admission.enquiry_id}`}>Open enquiry</Link> : null}
          {canManage && open && !editing ? <button type="button" className="secondary" onClick={() => setEditing(true)}>Edit</button> : null}
          {admission.student_id ? <Link to={`/students/${admission.student_id}`}>Open student</Link> : null}
          {admission.batch_id ? <Link to={`/batches/${admission.batch_id}?branch_id=${admission.branch_id || ""}&course_id=${admission.course_id}&batch_id=${admission.batch_id}`}>Open batch</Link> : null}
        </div>
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {editing ? (
        <AdmissionForm
          courses={courses}
          initial={admission}
          onCancel={() => setEditing(false)}
          onSaved={() => { setEditing(false); load(); }}
        />
      ) : (
      <>
      <dl className="facts">
        <div><dt>Contact number</dt><dd>{admission.phone}</dd></div>
        <div><dt>Date of birth</dt><dd className={admission.date_of_birth ? undefined : "is-empty"}>{formatDisplayDate(admission.date_of_birth)}</dd></div>
        <div><dt>Gender</dt><dd className={admission.gender ? undefined : "is-empty"}>{admission.gender || "Not recorded"}</dd></div>
        <div><dt>Blood group</dt><dd className={admission.blood_group ? undefined : "is-empty"}>{admission.blood_group || "Not recorded"}</dd></div>
        <div className="span-2"><dt>Email</dt><dd className={admission.email ? undefined : "is-empty"}>{admission.email || "Not recorded"}</dd></div>
        <div className="span-2"><dt>Address</dt><dd className={admission.street ? undefined : "is-empty"}>{[admission.street, admission.address_line_2, admission.place, admission.district, admission.state, admission.pin].filter(Boolean).join(", ") || "Not recorded"}</dd></div>
        <div><dt>Parent or guardian</dt><dd className={admission.guardian_name ? undefined : "is-empty"}>{admission.guardian_name || "Not recorded"}</dd></div>
        <div><dt>Parent contact</dt><dd className={admission.guardian_phone ? undefined : "is-empty"}>{admission.guardian_phone || "Not recorded"}</dd></div>
      </dl>
      <h2>Academic records</h2>
      {admission.academic_records.length === 0 ? <p>No academic records yet.</p> : <RecordTable records={admission.academic_records} />}
      {(admission.business_answers || []).length ? (
        <>
          <h2>Questions</h2>
          <dl className="facts">
            {(admission.business_answers || []).map((item) => (
              <div key={item.question_id} className="span-2"><dt>{item.label || "Question"}</dt><dd className={item.value ? undefined : "is-empty"}>{item.value || "Not recorded"}</dd></div>
            ))}
          </dl>
        </>
      ) : null}
      {admission.course_answers.length ? (
        <>
          <h2>Course details</h2>
          <dl className="facts">
            {admission.course_answers.map((item) => (
              <div key={item.question_id} className="span-2"><dt>{item.label || "Question"}</dt><dd className={item.value ? undefined : "is-empty"}>{item.value || "Not recorded"}</dd></div>
            ))}
          </dl>
        </>
      ) : null}
      {canManage && open ? (
        <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void convert(admission.match_decision, admission.match_student_id); }}>
          <h2 className="span-2">Enroll</h2>
          {admission.match_decision === "attach" ? <p className="span-2">This import was confirmed for an existing student. Choose the branch and batch, or create a new student instead.</p> : null}
          {admission.matches.length > 0 && !admission.match_decision ? <p className="span-2">A student with this name and contact number is already on file. You will be asked to confirm before anything is changed.</p> : null}
          <label>Branch
            <select value={branchId} onChange={(event) => { setBranchId(event.target.value); setBatchId(""); setGaps([]); setError(""); }}>
              <option value="">Choose</option>
              {options.branches.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label>Batch
            <select value={batchId} onChange={(event) => { setBatchId(event.target.value); setGaps([]); setError(""); }}>
              <option value="">Choose</option>
              {batches.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          {gaps.length ? (
            <div className="span-2" role="alert">
              <p className="error">Enroll needs:</p>
              <ul>{gaps.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          ) : null}
          <div className="dialog-actions span-2">
            <button type="submit" disabled={saving}>{saving ? "Enrolling…" : "Enroll"}</button>
            {admission.match_decision === "attach" ? <button type="button" className="quiet" disabled={saving} onClick={() => void convert("create")}>Create a new student</button> : null}
          </div>
        </form>
      ) : null}
      </>
      )}
      {matches ? (
        <StudentDialog title="This student may already exist" onClose={() => setMatches(null)}>
          <p>Add this course to the existing student, or create a new student.</p>
          {matches.map((item) => (
            <div className="title-row" key={item.id}>
              <p>{item.display_name} · {item.student_code} · {item.phone}</p>
              <button type="button" onClick={() => void convert("attach", item.id)}>Add to this student</button>
            </div>
          ))}
          <div className="dialog-actions">
            <button type="button" className="quiet" onClick={() => setMatches(null)}>Cancel</button>
            <button type="button" onClick={() => void convert("create")}>Create a new student</button>
          </div>
        </StudentDialog>
      ) : null}
    </section>
  );
}

export function AdmissionCreatePage() {
  const navigate = useNavigate();
  const [courses, setCourses] = useState<CourseOption[]>([]);
  useEffect(() => {
    api<{ courses: CourseOption[] }>("/api/v1/catalog").then((catalog) => setCourses(coursesOf(catalog))).catch(() => undefined);
  }, []);
  return (
    <section className="panel wide">
      <div className="page-title">
        <div>
          <p className="eyebrow">Admissions</p>
          <h1>New admission</h1>
        </div>
      </div>
      <AdmissionForm courses={courses} onSaved={(id) => navigate(`/students/admissions/${id}`)} />
    </section>
  );
}

function RecordTable({ records }: { records: AcademicRecord[] }) {
  return (
    <div className="table-wrap">
      <table className="people-table">
        <caption className="sr-only">Academic records</caption>
        <thead><tr><th>Qualification</th><th>Stream</th><th>Institution</th><th>Mark</th><th>Year</th><th>Board</th></tr></thead>
        <tbody>
          {records.map((item, index) => (
            <tr key={`${item.qualification}-${index}`}>
              <td>{item.qualification || "Not recorded"}</td>
              <td>{item.stream || "Not recorded"}</td>
              <td>{item.institution || "Not recorded"}</td>
              <td>{item.mark || "Not recorded"}</td>
              <td>{item.year_of_passing || "Not recorded"}</td>
              <td>{item.board || "Not recorded"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdmissionForm({ courses, initial, onSaved, onCancel }: { courses: CourseOption[]; initial?: Admission; onSaved: (id: string) => void; onCancel?: () => void }) {
  const [courseId, setCourseId] = useState(initial?.course_id || "");
  const [questions, setQuestions] = useState<Question[]>(initial?.questions || []);
  const [name, setName] = useState(initial?.name || "");
  const [phone, setPhone] = useState(initial?.phone || "");
  const [dob, setDob] = useState(initial?.date_of_birth || "");
  const [gender, setGender] = useState(initial?.gender || "");
  const [blood, setBlood] = useState(initial?.blood_group || "");
  const [email, setEmail] = useState(initial?.email || "");
  const [street, setStreet] = useState(initial?.street || "");
  const [line2, setLine2] = useState(initial?.address_line_2 || "");
  const [place, setPlace] = useState(initial?.place || "");
  const [district, setDistrict] = useState(initial?.district || "");
  const [stateName, setStateName] = useState(initial?.state || "");
  const [pin, setPin] = useState(initial?.pin || "");
  const [guardian, setGuardian] = useState(initial?.guardian_name || "");
  const [guardianPhone, setGuardianPhone] = useState(initial?.guardian_phone || "");
  const [records, setRecords] = useState<AcademicRecord[]>(initial?.academic_records.length ? initial.academic_records : [{ ...EMPTY_RECORD }]);
  const [answers, setAnswers] = useState<Record<string, string>>(Object.fromEntries((initial?.course_answers || []).map((item) => [item.question_id, item.value])));
  const [businessQuestions, setBusinessQuestions] = useState<Question[]>([]);
  const [business, setBusiness] = useState<Record<string, string>>(Object.fromEntries((initial?.business_answers || []).map((item) => [item.question_id, item.value])));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const stored = (list: Answer[] | undefined, id: string) => list?.find((item) => item.question_id === id)?.value || "";
  const dirty = !saving && (
    name !== (initial?.name || "")
    || phone !== (initial?.phone || "")
    || courseId !== (initial?.course_id || "")
    || dob !== (initial?.date_of_birth || "")
    || gender !== (initial?.gender || "")
    || blood !== (initial?.blood_group || "")
    || email !== (initial?.email || "")
    || street !== (initial?.street || "")
    || line2 !== (initial?.address_line_2 || "")
    || place !== (initial?.place || "")
    || district !== (initial?.district || "")
    || stateName !== (initial?.state || "")
    || pin !== (initial?.pin || "")
    || guardian !== (initial?.guardian_name || "")
    || guardianPhone !== (initial?.guardian_phone || "")
    || questions.some((item) => (answers[item.id] || "") !== stored(initial?.course_answers, item.id))
    || businessQuestions.some((item) => (business[item.id] || "") !== stored(initial?.business_answers, item.id))
    || JSON.stringify(records) !== JSON.stringify(initial?.academic_records?.length ? initial.academic_records : [{ ...EMPTY_RECORD }])
  );
  useUnsaved(dirty);

  useEffect(() => {
    if (!courseId) {
      setQuestions([]);
      return;
    }
    api<{ items: Question[] }>(`/api/v1/courses/${courseId}/questions`).then((result) => setQuestions(result.items)).catch(() => setQuestions([]));
  }, [courseId]);

  useEffect(() => {
    api<{ items: Question[] }>("/api/v1/form-questions?form=admission").then((result) => setBusinessQuestions(result.items)).catch(() => setBusinessQuestions([]));
  }, []);

  function updateRecord(index: number, key: keyof AcademicRecord, value: string) {
    setRecords((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const body = {
      course_id: courseId,
      name,
      phone,
      date_of_birth: dob,
      gender,
      blood_group: blood,
      email,
      street,
      address_line_2: line2,
      place,
      district,
      state: stateName,
      pin,
      guardian_name: guardian,
      guardian_phone: guardianPhone,
      academic_records: records,
      course_answers: questions.map((item) => ({ question_id: item.id, value: answers[item.id] || "" })),
      business_answers: businessQuestions.map((item) => ({ question_id: item.id, value: business[item.id] || "" })),
    };
    try {
      const saved = initial
        ? await api<{ id: string }>(`/api/v1/admissions/${initial.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : await api<{ id: string }>("/api/v1/admissions", { method: "POST", body: JSON.stringify(body) });
      notify(`Saved ${name}.`);
      onSaved(saved.id || initial?.id || "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The admission was not saved.");
      setSaving(false);
    }
  }

  return (
      <form className="form-grid" onSubmit={save}>
        <h2 className="span-2">Person</h2>
        <label>Name
          <input value={name} required onChange={(event) => setName(event.target.value)} />
        </label>
        <label>Contact number
          <input value={phone} required onChange={(event) => setPhone(event.target.value)} />
        </label>
        <h2 className="span-2">Course</h2>
        <label className="span-2">Course
          <select value={courseId} required onChange={(event) => setCourseId(event.target.value)}>
            <option value="">Choose</option>
            {courses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <h2 className="span-2">Required to enroll</h2>
        <p className="span-2">Save is allowed without these. Enroll asks for any that are still empty.</p>
        <AnswerFields questions={businessQuestions} answers={business} onChange={(id, value) => setBusiness({ ...business, [id]: value })} requiredNote="required to enroll" />
        <AnswerFields questions={questions} answers={answers} onChange={(id, value) => setAnswers({ ...answers, [id]: value })} requiredNote="required to enroll" />
        <h2 className="span-2">Optional details</h2>
        <label>Date of birth
          <input type="date" value={dob} onChange={(event) => setDob(event.target.value)} />
        </label>
        <label>Gender
          <select value={gender} onChange={(event) => setGender(event.target.value)}>
            <option value="">Not recorded</option>
            {GENDERS.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label>Blood group
          <select value={blood} onChange={(event) => setBlood(event.target.value)}>
            <option value="">Not recorded</option>
            {BLOOD.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label>Email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="span-2">Address line 1
          <input value={street} onChange={(event) => setStreet(event.target.value)} />
        </label>
        <label className="span-2">Address line 2
          <input value={line2} onChange={(event) => setLine2(event.target.value)} />
        </label>
        <label>City
          <input value={place} onChange={(event) => setPlace(event.target.value)} />
        </label>
        <label>District
          <input value={district} onChange={(event) => setDistrict(event.target.value)} />
        </label>
        <label>State
          <input value={stateName} onChange={(event) => setStateName(event.target.value)} />
        </label>
        <label>PIN
          <input value={pin} inputMode="numeric" maxLength={6} onChange={(event) => setPin(event.target.value)} />
        </label>
        <label>Parent or guardian
          <input value={guardian} onChange={(event) => setGuardian(event.target.value)} />
        </label>
        <label>Parent contact
          <input value={guardianPhone} onChange={(event) => setGuardianPhone(event.target.value)} />
        </label>
        <h2 className="span-2">Academic records</h2>
        {records.map((record, index) => (
          <div className="span-2 form-grid" key={index}>
            <label>Qualification
              <input value={record.qualification} aria-label={`Qualification ${index + 1}`} onChange={(event) => updateRecord(index, "qualification", event.target.value)} />
            </label>
            <label>Stream or department
              <input value={record.stream} aria-label={`Stream ${index + 1}`} onChange={(event) => updateRecord(index, "stream", event.target.value)} />
            </label>
            <label className="span-2">Institution
              <input value={record.institution} aria-label={`Institution ${index + 1}`} onChange={(event) => updateRecord(index, "institution", event.target.value)} />
            </label>
            <label>Mark
              <input value={record.mark} aria-label={`Mark ${index + 1}`} onChange={(event) => updateRecord(index, "mark", event.target.value)} />
            </label>
            <label>Year of passing
              <input value={record.year_of_passing} inputMode="numeric" maxLength={4} aria-label={`Year ${index + 1}`} onChange={(event) => updateRecord(index, "year_of_passing", event.target.value)} />
            </label>
          </div>
        ))}
        <div className="span-2">
          <button type="button" className="quiet" onClick={() => setRecords((current) => [...current, { ...EMPTY_RECORD }])}>Add academic record</button>
        </div>
        {error ? <p className="error span-2" role="alert">{error}</p> : null}
        <div className="dialog-actions span-2">
          {onCancel ? <button type="button" className="secondary" onClick={() => { if (confirmDiscard(dirty)) onCancel(); }}>Cancel</button> : <Link className="secondary" to="/students/admissions">Cancel</Link>}
          <button type="submit" disabled={saving || !name.trim() || !phone.trim() || !courseId}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </form>
  );
}

function ImportDialog({ kind, onClose, onSaved }: { kind: "enquiries" | "admissions"; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const blocked = rows.length === 0 || rows.some((row) => row.errors.length > 0 || ((row.matches || []).length > 0 && row.decision !== "attach" && row.decision !== "create"));
  const dirty = rows.length > 0 && !saving;
  useUnsaved(dirty);

  async function preview(file: File) {
    setError("");
    const body = new FormData();
    body.set("file", file);
    try {
      const result = await api<{ rows: PreviewRow[] }>(`/api/v1/${kind}/import`, { method: "POST", body });
      setRows(result.rows.map((row) => ({ ...row, decision: (row.matches || []).length ? "" : "create", student_id: "" })));
    } catch (reason) {
      setRows([]);
      setError(reason instanceof Error ? reason.message : "The workbook was not read.");
    }
  }

  async function commit() {
    setSaving(true);
    setError("");
    const payload = rows.map((row) => {
      const values = row.values || {};
      if (kind === "enquiries") {
        return {
          name: values.name || "",
          whatsapp: values.whatsapp || "",
          present_institution: values.present_institution || "",
          course_id: values.course_id || "",
          interest: values.interest || "",
          references: values.references || "",
          details: values.details || "",
          answers: row.answers || [],
        };
      }
      return {
        course_id: values.course_id || "",
        name: values.name || "",
        phone: values.phone || "",
        date_of_birth: values.date_of_birth || "",
        gender: values.gender || "",
        blood_group: values.blood_group || "",
        email: values.email || "",
        street: values.street || "",
        address_line_2: values.address_line_2 || "",
        place: values.place || "",
        district: values.district || "",
        state: values.state || "",
        pin: values.pin || "",
        guardian_name: values.guardian_name || "",
        guardian_phone: values.guardian_phone || "",
        academic_records: values.academic_records || [],
        course_answers: row.answers || [],
        business_answers: row.business_answers || [],
        decision: row.decision || "create",
        student_id: row.decision === "attach" ? row.student_id || "" : "",
      };
    });
    try {
      await api(`/api/v1/${kind}/import/commit`, { method: "POST", body: JSON.stringify({ rows: payload }) });
      notify(kind === "enquiries" ? "Imported the enquiries." : "Imported the admissions.");
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The workbook was not saved.");
      setSaving(false);
    }
  }

  return (
    <StudentDialog title={kind === "enquiries" ? "Import enquiries" : "Import admissions"} dirty={dirty} onClose={onClose}>
      <p>Only name is required for an enquiry. An admission needs a name and a contact number. Other columns can be filled in later.</p>
      <label>Workbook
        <input type="file" accept=".xlsx" aria-label="Workbook" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void preview(file);
        }} />
      </label>
      {rows.length > 0 ? (
        <div className="table-wrap">
          <table className="people-table">
            <caption className="sr-only">Import preview</caption>
            <thead><tr><th>Row</th><th>Name</th><th>Result</th>{kind === "admissions" ? <th>Match</th> : null}</tr></thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.row} className={row.errors.length ? "row-error" : undefined}>
                  <td>{row.row}</td>
                  <td>{String(row.values.name || "Not recorded")}</td>
                  <td>{row.errors.join(" ") || "Ready"}</td>
                  {kind === "admissions" ? (
                    <td>
                      {(row.matches || []).length === 0 ? "New student" : (
                        <select aria-label={`Match for row ${row.row}`} value={row.decision === "attach" ? row.student_id || "" : row.decision || ""} onChange={(event) => {
                          const value = event.target.value;
                          setRows((current) => current.map((item, itemIndex) => itemIndex === index ? {
                            ...item,
                            decision: value === "create" ? "create" : "attach",
                            student_id: value === "create" ? "" : value,
                          } : item));
                        }}>
                          <option value="">Confirm</option>
                          {(row.matches || []).map((match) => <option key={match.id} value={match.id}>Add to {match.display_name} ({match.student_code})</option>)}
                          <option value="create">Create a new student</option>
                        </select>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      <div className="dialog-actions">
        <button type="button" className="quiet" onClick={() => { if (confirmDiscard(dirty)) onClose(); }}>Cancel</button>
        <button type="button" disabled={blocked || saving} onClick={() => void commit()}>{saving ? "Saving…" : "Save import"}</button>
      </div>
    </StudentDialog>
  );
}
