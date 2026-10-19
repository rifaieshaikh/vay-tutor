import { FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { notify } from "../notify";
import { StudentDialog } from "../ui";

export type Question = {
  id: string;
  label: string;
  answer_type: string;
  choices: string[];
  required: boolean;
  place?: string;
  section?: string;
  required_stage?: string;
  on_profile?: boolean;
  retired?: boolean;
  order?: number;
  course_id?: string;
};

const PLACES = [
  { value: "enquiry", label: "Enquiry" },
  { value: "admission", label: "Admission" },
  { value: "both", label: "Both" },
];

const SECTIONS = [
  { value: "general", label: "General" },
  { value: "contact", label: "Contact" },
  { value: "guardian", label: "Guardian" },
  { value: "education", label: "Previous education" },
  { value: "course", label: "Course" },
];

const STAGES = [
  { value: "", label: "Optional" },
  { value: "admit", label: "Required to create the admission" },
  { value: "enroll", label: "Required to enroll" },
];

function placeLabel(place = "") {
  return PLACES.find((item) => item.value === place)?.label || "Both";
}

function sectionLabel(section = "") {
  return SECTIONS.find((item) => item.value === section)?.label || "General";
}

function stageLabel(question: Question) {
  if (question.required_stage === "admit") return "Required to create the admission";
  if (question.required_stage === "enroll") return "Required to enroll";
  if (question.required) return "Required";
  return "Optional";
}

const ANSWER_KINDS = [
  { value: "yes_no", label: "Yes / No" },
  { value: "boolean", label: "Consent checkbox" },
  { value: "choice", label: "Dropdown" },
  { value: "text", label: "Text box" },
  { value: "textarea", label: "Text area" },
];

export function answerKindLabel(kind = "") {
  return ANSWER_KINDS.find((item) => item.value === kind)?.label || kind;
}

export function QuestionControl({ type, choices, value, label, onChange, controlId }: { type: string; choices: string[]; value: string; label: string; onChange: (value: string) => void; controlId?: string }) {
  if (type === "yes_no") {
    const selected = value === "Yes" || value === "No" ? value : "";
    return (
      <select id={controlId} aria-label={label} value={selected} onChange={(event) => onChange(event.target.value)}>
        <option value="">Not answered</option>
        <option value="Yes">Yes</option>
        <option value="No">No</option>
      </select>
    );
  }
  if (type === "boolean") {
    return (
      <input id={controlId} type="checkbox" aria-label={label} checked={["yes", "true", "1"].includes(value.trim().toLowerCase())} onChange={(event) => onChange(event.target.checked ? "Yes" : "")} />
    );
  }
  if (type === "choice") {
    return (
      <select id={controlId} aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Not recorded</option>
        {choices.map((choice) => <option key={choice}>{choice}</option>)}
      </select>
    );
  }
  if (type === "textarea") {
    return <textarea id={controlId} rows={4} aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />;
  }
  return <input id={controlId} aria-label={label} type={type === "date" ? "date" : type === "number" ? "number" : "text"} value={value} onChange={(event) => onChange(event.target.value)} />;
}

export function AnswerFields({ questions, answers, onChange, requiredNote }: { questions: Question[]; answers: Record<string, string>; onChange: (id: string, value: string) => void; requiredNote: string }) {
  return questions.filter((item) => !item.retired).map((item) => {
    const note = item.required_stage === "admit" ? "required to create the admission" : item.required_stage === "enroll" ? "required to enroll" : item.required ? requiredNote : "";
    const caption = note ? `${item.label} (${note})` : item.label;
    if (item.answer_type === "boolean") {
      return (
        <label key={item.id} className="checkbox-row span-2">
          <QuestionControl controlId={`field-${item.id}`} type={item.answer_type} choices={item.choices} value={answers[item.id] || ""} label={caption} onChange={(value) => onChange(item.id, value)} />
          <span>{caption}</span>
        </label>
      );
    }
    return (
      <label key={item.id} className="span-2">{caption}
        <QuestionControl controlId={`field-${item.id}`} type={item.answer_type} choices={item.choices} value={answers[item.id] || ""} label={caption} onChange={(value) => onChange(item.id, value)} />
      </label>
    );
  });
}

type Draft = {
  id: string;
  label: string;
  answerType: string;
  choices: string;
  place: string;
  section: string;
  requiredStage: string;
  onProfile: boolean;
};

function emptyDraft(place: string, section = "general"): Draft {
  return { id: "", label: "", answerType: "text", choices: "", place, section, requiredStage: "", onProfile: false };
}

function draftFrom(item: Question, place: string): Draft {
  return {
    id: item.id,
    label: item.label,
    answerType: item.answer_type,
    choices: item.choices.join("\n"),
    place: item.place || place,
    section: item.section || "general",
    requiredStage: item.required_stage || (item.required ? "enroll" : ""),
    onProfile: Boolean(item.on_profile),
  };
}

function choiceLines(value: string) {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

export function FormsPage() {
  const [params] = useSearchParams();
  const initialCourse = params.get("course_id") || "";
  const [questions, setQuestions] = useState<Question[]>([]);
  const [courseQuestions, setCourseQuestions] = useState<Question[]>([]);
  const [courses, setCourses] = useState<{ id: string; name: string }[]>([]);
  const [courseId, setCourseId] = useState(initialCourse);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [courseState, setCourseState] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<"enquiry" | "admission" | null>(null);
  const [previewAnswers, setPreviewAnswers] = useState<Record<string, string>>({});
  const [attempt, setAttempt] = useState(0);

  function loadGeneral() {
    setState("loading");
    api<{ items: Question[] }>("/api/v1/form-questions?include_retired=true")
      .then((result) => {
        setQuestions(result.items);
        setState("ready");
        setError("");
      })
      .catch((reason: Error) => {
        setState("error");
        setError(reason.message || "Questions could not be loaded.");
      });
  }

  useEffect(() => { loadGeneral(); }, [attempt]);

  useEffect(() => {
    api<{ courses: { id: string; name: string }[] }>("/api/v1/catalog")
      .then((catalog) => setCourses([...(catalog.courses || [])].sort((left, right) => left.name.localeCompare(right.name))))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!courseId) {
      setCourseQuestions([]);
      setCourseState("idle");
      return;
    }
    let cancelled = false;
    setCourseState("loading");
    api<{ items: Question[] }>(`/api/v1/courses/${courseId}/questions?include_retired=true`)
      .then((result) => {
        if (cancelled) return;
        setCourseQuestions(result.items);
        setCourseState("ready");
      })
      .catch((reason: Error) => {
        if (cancelled) return;
        setCourseState("error");
        setError(reason.message || "Course questions could not be loaded.");
      });
    return () => { cancelled = true; };
  }, [courseId, attempt]);

  async function saveDraft(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const body = {
      label: draft.label,
      answer_type: draft.answerType,
      choices: choiceLines(draft.choices),
      required: Boolean(draft.requiredStage),
      place: draft.place,
      section: draft.section,
      required_stage: draft.requiredStage,
      on_profile: draft.onProfile,
    };
    const course = draft.place === "course";
    const path = course
      ? `/api/v1/courses/${courseId}/questions${draft.id ? `/${draft.id}` : ""}`
      : `/api/v1/form-questions${draft.id ? `/${draft.id}` : ""}`;
    try {
      await api(path, { method: draft.id ? "PATCH" : "POST", body: JSON.stringify(body) });
      notify(draft.id ? "Saved the question." : "Added the question.");
      setDraft(null);
      setAttempt((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The question was not saved.");
    }
  }

  async function move(items: Question[], item: Question, direction: -1 | 1, course = false) {
    const index = items.findIndex((entry) => entry.id === item.id);
    const neighbor = items[index + direction];
    if (!neighbor) return;
    const base = course ? `/api/v1/courses/${courseId}/questions` : "/api/v1/form-questions";
    try {
      await api(`${base}/${item.id}`, { method: "PATCH", body: JSON.stringify({ order: neighbor.order || index + 1 + direction }) });
      await api(`${base}/${neighbor.id}`, { method: "PATCH", body: JSON.stringify({ order: item.order || index + 1 }) });
      setAttempt((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The order was not saved.");
    }
  }

  async function retire(item: Question, course = false) {
    const path = course ? `/api/v1/courses/${courseId}/questions/${item.id}` : `/api/v1/form-questions/${item.id}`;
    try {
      const result = await api<{ retired?: boolean }>(path, { method: "DELETE" });
      notify(result.retired ? `Retired ${item.label}. Earlier answers stay on their records.` : `Removed ${item.label}.`);
      setAttempt((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The question was not removed.");
    }
  }

  const enquiryPreview = questions.filter((item) => !item.retired && (item.place === "enquiry" || item.place === "both" || !item.place));
  const admissionPreview = questions.filter((item) => !item.retired && (item.place === "admission" || item.place === "both" || !item.place));

  return (
    <section className="panel wide">
      <div className="page-title">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Forms</h1>
          <p className="page-lead">Questions used on enquiries, admissions, and course records.</p>
        </div>
        <div className="actions">
          <button type="button" className="secondary" onClick={() => setPreview("enquiry")}>Preview enquiry</button>
          <button type="button" className="secondary" onClick={() => setPreview("admission")}>Preview admission</button>
          <button type="button" onClick={() => setDraft(emptyDraft("both"))}>Add question</button>
        </div>
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {state === "loading" ? <p role="status">Loading questions…</p> : null}
      {state === "error" ? <button type="button" className="secondary" onClick={() => setAttempt((value) => value + 1)}>Try again</button> : null}
      {state === "ready" && questions.length === 0 ? <p>No general questions yet.</p> : null}
      {state === "ready" && questions.length > 0 ? (
        <QuestionTable
          items={questions}
          onEdit={(item) => setDraft(draftFrom(item, item.place || "both"))}
          onMove={(item, direction) => void move(questions, item, direction)}
          onRetire={(item) => void retire(item)}
        />
      ) : null}
      <div className="title-row">
        <h2>Course questions</h2>
      </div>
      <label>Course
        <select aria-label="Course" value={courseId} onChange={(event) => setCourseId(event.target.value)}>
          <option value="">Choose a course</option>
          {courses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      {courseId ? <p className="actions"><button type="button" onClick={() => setDraft(emptyDraft("course", "course"))}>Add course question</button></p> : null}
      {courseState === "loading" ? <p role="status">Loading course questions…</p> : null}
      {courseState === "error" ? <button type="button" className="secondary" onClick={() => setAttempt((value) => value + 1)}>Try again</button> : null}
      {courseState === "ready" && courseQuestions.length === 0 ? <p>No questions for this course.</p> : null}
      {courseState === "ready" && courseQuestions.length > 0 ? (
        <QuestionTable
          items={courseQuestions}
          onEdit={(item) => setDraft(draftFrom({ ...item, place: "course" }, "course"))}
          onMove={(item, direction) => void move(courseQuestions, item, direction, true)}
          onRetire={(item) => void retire(item, true)}
        />
      ) : null}
      {draft ? (
        <StudentDialog title={draft.id ? "Edit question" : "Question"} onClose={() => setDraft(null)}>
          <form className="form-grid" onSubmit={saveDraft}>
            <label className="span-2">Question
              <input value={draft.label} required onChange={(event) => setDraft({ ...draft, label: event.target.value })} />
            </label>
            {draft.place === "course" ? null : (
              <label>Shows on
                <select value={draft.place} onChange={(event) => setDraft({ ...draft, place: event.target.value })}>
                  {PLACES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
            )}
            <label>Section
              <select value={draft.section} onChange={(event) => setDraft({ ...draft, section: event.target.value })}>
                {SECTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label>Answer
              <select value={draft.answerType} onChange={(event) => setDraft({ ...draft, answerType: event.target.value })}>
                {ANSWER_KINDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label>Requirement
              <select value={draft.requiredStage} onChange={(event) => setDraft({ ...draft, requiredStage: event.target.value })}>
                {STAGES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="checkbox-row span-2">
              <input type="checkbox" checked={draft.onProfile} onChange={(event) => setDraft({ ...draft, onProfile: event.target.checked })} />
              <span>Show on the student profile</span>
            </label>
            {draft.answerType === "choice" ? (
              <label className="span-2">Options, one on each line
                <textarea rows={4} value={draft.choices} onChange={(event) => setDraft({ ...draft, choices: event.target.value })} />
              </label>
            ) : null}
            <div className="dialog-actions span-2">
              <button type="button" className="quiet" onClick={() => setDraft(null)}>Cancel</button>
              <button type="submit" disabled={!draft.label.trim()}>Save</button>
            </div>
          </form>
        </StudentDialog>
      ) : null}
      {preview ? (
        <StudentDialog title={preview === "enquiry" ? "Enquiry preview" : "Admission preview"} onClose={() => setPreview(null)}>
          <form className="form-grid" onSubmit={(event) => event.preventDefault()}>
            <AnswerFields questions={preview === "enquiry" ? enquiryPreview : admissionPreview} answers={previewAnswers} onChange={(id, value) => setPreviewAnswers((current) => ({ ...current, [id]: value }))} requiredNote="required" />
            {(preview === "enquiry" ? enquiryPreview : admissionPreview).length === 0 ? <p className="span-2">No questions for this form.</p> : null}
            <div className="dialog-actions span-2">
              <button type="button" className="quiet" onClick={() => setPreview(null)}>Close</button>
            </div>
          </form>
        </StudentDialog>
      ) : null}
      <p className="meta">Course pages link here. <Link to="/courses">Courses</Link></p>
    </section>
  );
}

function QuestionTable({ items, onEdit, onMove, onRetire }: { items: Question[]; onEdit: (item: Question) => void; onMove: (item: Question, direction: -1 | 1) => void; onRetire: (item: Question) => void }) {
  return (
    <div className="table-wrap">
      <table className="people-table">
        <caption className="sr-only">Questions</caption>
        <thead><tr><th>Question</th><th>Answer</th><th>Section</th><th>Requirement</th><th>Actions</th></tr></thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={item.id}>
              <td>{item.label}{item.retired ? " · retired" : ""}{item.place && item.place !== "course" ? ` · ${placeLabel(item.place)}` : ""}</td>
              <td>{answerKindLabel(item.answer_type)}{item.choices.length ? ` · ${item.choices.join(" · ")}` : ""}</td>
              <td>{sectionLabel(item.section)}</td>
              <td>{stageLabel(item)}{item.on_profile ? " · on the student profile" : ""}</td>
              <td>
                <div className="actions">
                  <button type="button" className="quiet" disabled={item.retired} onClick={() => onEdit(item)}>Edit</button>
                  <button type="button" className="quiet" disabled={index === 0 || item.retired} onClick={() => onMove(item, -1)}>Move up</button>
                  <button type="button" className="quiet" disabled={index === items.length - 1 || item.retired} onClick={() => onMove(item, 1)}>Move down</button>
                  <button type="button" className="quiet" disabled={item.retired} onClick={() => onRetire(item)}>{item.retired ? "Retired" : "Remove"}</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
