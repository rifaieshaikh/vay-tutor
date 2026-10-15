import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";
import { notify } from "../notify";
import { StudentDialog } from "../ui";

export type Question = { id: string; label: string; answer_type: string; choices: string[]; required: boolean; place?: string };

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

export function AnswerFields({ questions, answers, onChange, requiredNote }: { questions: Question[]; answers: Record<string, string>; onChange: (id: string, value: string) => void; requiredNote: string }) {
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

export function FormQuestions({ form, canEdit }: { form: "enquiry" | "admission"; canEdit: boolean }) {
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

