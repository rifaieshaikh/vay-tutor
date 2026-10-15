import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, api, Session } from "../api";
import { Option, optionFits } from "../filters";
import { IntakeTabs } from "../intakeTabs";
import { notify } from "../notify";
import { StudentDialog } from "./Catalog";

type CourseOption = { id: string; name: string };
type Question = { id: string; label: string; answer_type: string; choices: string[]; required: boolean; place?: string };
type AcademicRecord = { qualification: string; stream: string; institution: string; mark: string; year_of_passing: string; board: string };
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
  enquiry_id: string | null;
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
const GENDERS = ["Female", "Male", "Other"];
const BLOOD = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"];
const EMPTY_RECORD: AcademicRecord = { qualification: "", stream: "", institution: "", mark: "", year_of_passing: "", board: "" };

function coursesOf(catalog: { courses: CourseOption[] } | null) {
  return [...(catalog?.courses || [])].sort((left, right) => left.name.localeCompare(right.name));
}

const PLACES = [
  { value: "enquiry", label: "Enquiry" },
  { value: "admission", label: "Admission" },
  { value: "both", label: "Both" },
];

function placeLabel(place = "") {
  return PLACES.find((item) => item.value === place)?.label || "Both";
}

const ANSWER_KINDS = [
  { value: "boolean", label: "Checkbox" },
  { value: "choice", label: "Dropdown" },
  { value: "text", label: "Text box" },
  { value: "textarea", label: "Text area" },
];

export function answerKindLabel(kind = "") {
  return ANSWER_KINDS.find((item) => item.value === kind)?.label || kind;
}

export function QuestionControl({ type, choices, value, label, onChange }: { type: string; choices: string[]; value: string; label: string; onChange: (value: string) => void }) {
  if (type === "boolean") {
    return (
      <input type="checkbox" aria-label={label} checked={["yes", "true", "1"].includes(value.trim().toLowerCase())} onChange={(event) => onChange(event.target.checked ? "Yes" : "")} />
    );
  }
  if (type === "choice") {
    return (
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Not recorded</option>
        {choices.map((choice) => <option key={choice}>{choice}</option>)}
      </select>
    );
  }
  if (type === "textarea") {
    return <textarea rows={4} aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />;
  }
  return <input aria-label={label} type={type === "date" ? "date" : type === "number" ? "number" : "text"} value={value} onChange={(event) => onChange(event.target.value)} />;
}

function AnswerFields({ questions, answers, onChange, requiredNote }: { questions: Question[]; answers: Record<string, string>; onChange: (id: string, value: string) => void; requiredNote: string }) {
  return questions.map((item) => {
    const caption = `${item.label}${item.required ? ` (${requiredNote})` : ""}`;
    if (item.answer_type === "boolean") {
      return (
        <label key={item.id} className="checkbox-row span-2">
          <QuestionControl type={item.answer_type} choices={item.choices} value={answers[item.id] || ""} label={caption} onChange={(value) => onChange(item.id, value)} />
          <span>{caption}</span>
        </label>
      );
    }
    return (
      <label key={item.id} className="span-2">{caption}
        <QuestionControl type={item.answer_type} choices={item.choices} value={answers[item.id] || ""} label={caption} onChange={(value) => onChange(item.id, value)} />
      </label>
    );
  });
}

function FormQuestions({ form, canEdit }: { form: "enquiry" | "admission"; canEdit: boolean }) {
  const [items, setItems] = useState<Question[]>([]);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [answerType, setAnswerType] = useState("text");
  const [choices, setChoices] = useState("");
  const [required, setRequired] = useState(false);
  const [place, setPlace] = useState<string>(form);
  const [error, setError] = useState("");

  function load() {
    api<{ items: Question[] }>(`/api/v1/form-questions?form=${form}`).then((result) => setItems(result.items)).catch((reason: Error) => setError(reason.message));
  }

  useEffect(() => { load(); }, [form]);

  async function add(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api("/api/v1/form-questions", {
        method: "POST",
        body: JSON.stringify({
          label,
          answer_type: answerType,
          choices: choices.split(",").map((item) => item.trim()).filter(Boolean),
          required,
          place,
        }),
      });
      setLabel("");
      setChoices("");
      setRequired(false);
      setPlace(form);
      setAdding(false);
      notify("Saved the question.");
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The question was not saved.");
    }
  }

  async function remove(item: Question) {
    setError("");
    try {
      await api(`/api/v1/form-questions/${item.id}`, { method: "DELETE" });
      notify(`Removed ${item.label}.`);
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The question was not removed.");
    }
  }

  return (
    <>
      <div className="title-row">
        <h2>Questions</h2>
        {canEdit ? <button type="button" onClick={() => { setLabel(""); setAnswerType("text"); setChoices(""); setRequired(false); setPlace(form); setAdding(true); }}>Add question</button> : null}
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {items.length === 0 ? <p>No questions for this form.</p> : (
        <ul className="people">
          {items.map((item) => (
            <li key={item.id}>
              <span>{item.label}{item.required ? " · required" : ""} · {answerKindLabel(item.answer_type)} · {placeLabel(item.place)}{item.choices.length ? ` · ${item.choices.join(", ")}` : ""}</span>
              {canEdit ? <button type="button" className="quiet" onClick={() => void remove(item)}>Remove</button> : null}
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <StudentDialog title="Question" onClose={() => setAdding(false)}>
          <form className="form-grid" onSubmit={add}>
            <label className="span-2">Question
              <input value={label} required onChange={(event) => setLabel(event.target.value)} />
            </label>
            <label>Shows on
              <select value={place} onChange={(event) => setPlace(event.target.value)}>
                {PLACES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label>Answer
              <select value={answerType} onChange={(event) => setAnswerType(event.target.value)}>
                {ANSWER_KINDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label>Required
              <select value={required ? "yes" : "no"} onChange={(event) => setRequired(event.target.value === "yes")}>
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </label>
            {answerType === "choice" ? (
              <label className="span-2">Options, separated by commas
                <input value={choices} onChange={(event) => setChoices(event.target.value)} />
              </label>
            ) : null}
            <div className="dialog-actions span-2">
              <button type="button" className="quiet" onClick={() => setAdding(false)}>Cancel</button>
              <button type="submit" disabled={!label.trim()}>Save</button>
            </div>
          </form>
        </StudentDialog>
      ) : null}
    </>
  );
}

export function EnquiriesPage({ session }: { session: Session }) {
  const canManage = session.actions.includes("student.manage");
  const canEditQuestions = session.actions.includes("catalog.correct") || session.actions.includes("catalog.manage");
  const [items, setItems] = useState<Enquiry[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  function load(search = query) {
    setLoading(true);
    api<{ items: Enquiry[]; total: number }>(`/api/v1/enquiries?q=${encodeURIComponent(search)}`)
      .then((result) => {
        setItems(result.items);
        setTotal(result.total);
        setError("");
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load("");
    api<{ courses: CourseOption[] }>("/api/v1/catalog").then((catalog) => setCourses(coursesOf(catalog))).catch(() => undefined);
  }, []);

  return (
    <section className="panel wide">
      <div className="page-title">
        <div>
          <p className="eyebrow">People</p>
          <h1>Enquiry</h1>
        </div>
        {canManage ? (
          <div className="actions">
            <button type="button" onClick={() => setImporting(true)}>Import</button>
            <button type="button" onClick={() => setAdding(true)}>Add enquiry</button>
          </div>
        ) : null}
      </div>
      <IntakeTabs current="enquiries" />
      <FormQuestions form="enquiry" canEdit={canEditQuestions} />
      {error ? <p className="error" role="alert">{error}</p> : null}
      <form className="filter-row" onSubmit={(event) => { event.preventDefault(); load(query); }}>
        <label>Search
          <input value={query} aria-label="Search enquiries" onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button type="submit">Search</button>
      </form>
      <p className="filter-row"><span>{loading ? "Loading enquiries…" : `${total} enquir${total === 1 ? "y" : "ies"}`}</span></p>
      {items.length === 0 && !loading ? <p>No enquiries yet.</p> : null}
      {items.length > 0 ? (
        <div className="table-wrap">
          <table className="people-table">
            <caption className="sr-only">Enquiries</caption>
            <thead>
              <tr><th>Name</th><th>WhatsApp</th><th>Course</th><th>Interest</th><th>Follow-ups</th><th>Status</th></tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td><Link to={`/students/enquiries/${item.id}`}>{item.name}</Link></td>
                  <td>{item.whatsapp || "Not recorded"}</td>
                  <td>{item.course_name || "Not recorded"}</td>
                  <td>{item.interest || "Not recorded"}</td>
                  <td>{item.follow_up_count ?? item.follow_ups.length}</td>
                  <td>{item.admission_id ? "Admitted" : "Open"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {adding ? <EnquiryForm courses={courses} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} /> : null}
      {importing ? <ImportDialog kind="enquiries" onClose={() => setImporting(false)} onSaved={() => { setImporting(false); load(); }} /> : null}
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
  const [follow, setFollow] = useState({ at: "", note: "", interest: "", next_on: "" });

  function load() {
    api<Enquiry>(`/api/v1/enquiries/${enquiryId}`).then(setEnquiry).catch((reason: Error) => setError(reason.message));
  }

  useEffect(() => {
    load();
    api<{ courses: CourseOption[] }>("/api/v1/catalog").then((catalog) => setCourses(coursesOf(catalog))).catch(() => undefined);
  }, [enquiryId]);

  async function addFollow(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api(`/api/v1/enquiries/${enquiryId}/follow-ups`, { method: "POST", body: JSON.stringify(follow) });
      setFollow({ at: "", note: "", interest: "", next_on: "" });
      notify("Saved the follow-up.");
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The follow-up was not saved.");
    }
  }

  async function convert() {
    setError("");
    try {
      const result = await api<{ id: string }>(`/api/v1/enquiries/${enquiryId}/convert`, { method: "POST" });
      notify("Opened the admission.");
      navigate(`/students/admissions/${result.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The enquiry was not admitted.");
    }
  }

  if (!enquiry) {
    return <section className="panel">{error ? <p className="error" role="alert">{error}</p> : <p>Loading enquiry…</p>}</section>;
  }
  return (
    <section className="panel wide">
      <Link className="quiet back-link" to="/students/enquiries">← Enquiry</Link>
      <IntakeTabs current="enquiries" />
      <div className="title-row">
        <div>
          <p className="eyebrow">Enquiry</p>
          <h1>{enquiry.name}</h1>
          <p className="meta">{enquiry.admission_id ? "Admitted" : "Open"}</p>
        </div>
        {canManage ? (
          <div className="actions">
            <button type="button" onClick={() => setEditing(true)}>Edit</button>
            {enquiry.admission_id ? <Link to={`/students/admissions/${enquiry.admission_id}`}>Open admission</Link> : <button type="button" onClick={() => void convert()}>Admit</button>}
          </div>
        ) : null}
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
                  <td>{item.at}</td>
                  <td>{item.note}</td>
                  <td>{item.interest || "Not recorded"}</td>
                  <td>{item.next_on || "Not recorded"}</td>
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
          <div className="dialog-actions span-2"><button type="submit">Add follow-up</button></div>
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
    <StudentDialog title={initial ? "Edit enquiry" : "Add enquiry"} onClose={onClose}>
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
          <button type="button" className="quiet" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </StudentDialog>
  );
}

export function AdmissionsPage({ session }: { session: Session }) {
  const canManage = session.actions.includes("student.manage");
  const canEditQuestions = session.actions.includes("catalog.correct") || session.actions.includes("catalog.manage");
  const [items, setItems] = useState<Admission[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  function load(search = query) {
    setLoading(true);
    api<{ items: Admission[]; total: number }>(`/api/v1/admissions?q=${encodeURIComponent(search)}`)
      .then((result) => {
        setItems(result.items);
        setTotal(result.total);
        setError("");
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load("");
    api<{ courses: CourseOption[] }>("/api/v1/catalog").then((catalog) => setCourses(coursesOf(catalog))).catch(() => undefined);
  }, []);

  return (
    <section className="panel wide">
      <div className="page-title">
        <div>
          <p className="eyebrow">People</p>
          <h1>Admissions</h1>
        </div>
        {canManage ? (
          <div className="actions">
            <button type="button" onClick={() => setImporting(true)}>Import</button>
            <button type="button" onClick={() => setAdding(true)}>Add admission</button>
          </div>
        ) : null}
      </div>
      <IntakeTabs current="admissions" />
      <FormQuestions form="admission" canEdit={canEditQuestions} />
      {error ? <p className="error" role="alert">{error}</p> : null}
      <form className="filter-row" onSubmit={(event) => { event.preventDefault(); load(query); }}>
        <label>Search
          <input value={query} aria-label="Search admissions" onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button type="submit">Search</button>
      </form>
      <p className="filter-row"><span>{loading ? "Loading admissions…" : `${total} admission${total === 1 ? "" : "s"}`}</span></p>
      {items.length === 0 && !loading ? <p>No admissions yet.</p> : null}
      {items.length > 0 ? (
        <div className="table-wrap">
          <table className="people-table">
            <caption className="sr-only">Admissions</caption>
            <thead><tr><th>Name</th><th>Contact</th><th>Course</th><th>Status</th></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td><Link to={`/students/admissions/${item.id}`}>{item.name}</Link></td>
                  <td>{item.phone}</td>
                  <td>{item.course_name || "Not recorded"}</td>
                  <td>{item.status === "converted" ? "Student" : "Open"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {adding ? <AdmissionEditor courses={courses} onClose={() => setAdding(false)} onSaved={(id) => { setAdding(false); if (id) load(); }} /> : null}
      {importing ? <ImportDialog kind="admissions" onClose={() => setImporting(false)} onSaved={() => { setImporting(false); load(); }} /> : null}
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

  function load() {
    api<Admission>(`/api/v1/admissions/${admissionId}`).then(setAdmission).catch((reason: Error) => setError(reason.message));
  }

  useEffect(() => {
    load();
    api<{ courses: CourseOption[] }>("/api/v1/catalog").then((catalog) => setCourses(coursesOf(catalog))).catch(() => undefined);
    if (canManage) {
      api<{ branches: Option[]; batches: Option[] }>("/api/v1/students/options?manage=true").then(setOptions).catch(() => undefined);
    }
  }, [admissionId]);

  async function convert(decision = "", studentId = "") {
    setSaving(true);
    setError("");
    try {
      const result = await api<{ id: string }>(`/api/v1/admissions/${admissionId}/convert`, {
        method: "POST",
        body: JSON.stringify({ branch_id: branchId, batch_id: batchId, decision, student_id: studentId }),
      });
      notify("Saved the student.");
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
      <Link className="quiet back-link" to="/students/admissions">← Admissions</Link>
      <IntakeTabs current="admissions" />
      <div className="title-row">
        <div>
          <p className="eyebrow">Admission</p>
          <h1>{admission.name}</h1>
          <p className="meta">{admission.course_name} · {open ? "Open" : "Student"}</p>
        </div>
        <div className="actions">
          {canManage && open ? <button type="button" onClick={() => setEditing(true)}>Edit</button> : null}
          {admission.student_id ? <Link to={`/students/${admission.student_id}`}>Open student</Link> : null}
        </div>
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <dl className="facts">
        <div><dt>Contact number</dt><dd>{admission.phone}</dd></div>
        <div><dt>Date of birth</dt><dd className={admission.date_of_birth ? undefined : "is-empty"}>{admission.date_of_birth || "Not recorded"}</dd></div>
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
          <h2 className="span-2">Make this a student</h2>
          {admission.match_decision === "attach" ? <p className="span-2">This import was confirmed for an existing student. Choose the branch and batch, or create a new student instead.</p> : null}
          {admission.matches.length > 0 && !admission.match_decision ? <p className="span-2">A student with this name and contact number is already on file. You will be asked to confirm before anything is changed.</p> : null}
          <label>Branch
            <select value={branchId} required onChange={(event) => { setBranchId(event.target.value); setBatchId(""); }}>
              <option value="">Choose</option>
              {options.branches.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label>Batch
            <select value={batchId} required onChange={(event) => setBatchId(event.target.value)}>
              <option value="">Choose</option>
              {batches.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <div className="dialog-actions span-2">
            <button type="submit" disabled={saving || !branchId || !batchId}>{saving ? "Saving…" : "Continue"}</button>
            {admission.match_decision === "attach" ? <button type="button" className="quiet" disabled={saving} onClick={() => void convert("create")}>Create a new student</button> : null}
          </div>
        </form>
      ) : null}
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
      {editing ? (
        <AdmissionEditor
          courses={courses}
          initial={admission}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); load(); }}
        />
      ) : null}
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

function AdmissionEditor({ courses, initial, onClose, onSaved }: { courses: CourseOption[]; initial?: Admission; onClose: () => void; onSaved: (id?: string) => void }) {
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
      if (initial) await api(`/api/v1/admissions/${initial.id}`, { method: "PATCH", body: JSON.stringify(body) });
      else await api("/api/v1/admissions", { method: "POST", body: JSON.stringify(body) });
      notify(`Saved ${name}.`);
      onSaved(initial?.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The admission was not saved.");
      setSaving(false);
    }
  }

  return (
    <StudentDialog title={initial ? "Edit admission" : "Add admission"} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <label className="span-2">Course
          <select value={courseId} required onChange={(event) => setCourseId(event.target.value)}>
            <option value="">Choose</option>
            {courses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>Name
          <input value={name} required onChange={(event) => setName(event.target.value)} />
        </label>
        <label>Contact number
          <input value={phone} required onChange={(event) => setPhone(event.target.value)} />
        </label>
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
        {businessQuestions.length ? <p className="span-2 section-label">Questions</p> : null}
        <AnswerFields questions={businessQuestions} answers={business} onChange={(id, value) => setBusiness({ ...business, [id]: value })} requiredNote="required to enrol" />
        {questions.length ? <p className="span-2 section-label">Course questions</p> : null}
        <AnswerFields questions={questions} answers={answers} onChange={(id, value) => setAnswers({ ...answers, [id]: value })} requiredNote="required to enrol" />
        <p className="span-2 section-label">Academic records</p>
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
          <button type="button" className="quiet" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={saving || !name.trim() || !phone.trim() || !courseId}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </StudentDialog>
  );
}

function ImportDialog({ kind, onClose, onSaved }: { kind: "enquiries" | "admissions"; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const blocked = rows.length === 0 || rows.some((row) => row.errors.length > 0 || ((row.matches || []).length > 0 && row.decision !== "attach" && row.decision !== "create"));

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
    <StudentDialog title={kind === "enquiries" ? "Import enquiries" : "Import admissions"} onClose={onClose}>
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
        <button type="button" className="quiet" onClick={onClose}>Cancel</button>
        <button type="button" disabled={blocked || saving} onClick={() => void commit()}>{saving ? "Saving…" : "Save import"}</button>
      </div>
    </StudentDialog>
  );
}
