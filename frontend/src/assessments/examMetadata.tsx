import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { kindLabel, useCurriculumKinds, useExamTypes } from "../academics/kinds";
import { StudentDialog } from "../ui";

export type BatchRow = {
  id: string;
  name: string;
  branch_id: string;
  branch_name: string;
  course_id: string;
  course_name: string;
  archived?: boolean;
  closed?: boolean;
};

type ScopeItem = { id: string; name: string; kind?: string };
type SubjectOption = { id: string; name: string; papers: ScopeItem[]; units: ScopeItem[] };

export type ExamMetadataValues = {
  title: string;
  examDate: string;
  maximum: string;
  examKind: string;
  subjectId: string;
  scopeKind: string;
  itemIds: string[];
  batchId: string;
  branchId: string;
  courseId: string;
};

type LockedLabels = {
  branch?: string;
  course?: string;
  batch?: string;
  subject?: string;
  scopeKind?: string;
  scopeItems?: string;
};

type AddKind = "subject" | "partition" | "item" | "examType";

const emptyValues: ExamMetadataValues = {
  title: "",
  examDate: "",
  maximum: "",
  examKind: "",
  subjectId: "",
  scopeKind: "subject",
  itemIds: [],
  batchId: "",
  branchId: "",
  courseId: "",
};

export function ExamMetadataCreateForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (marksheetId: string) => void;
}) {
  const kinds = useCurriculumKinds();
  const examTypes = useExamTypes();
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [values, setValues] = useState<ExamMetadataValues>(emptyValues);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [addKind, setAddKind] = useState<AddKind | null>(null);
  const [loadError, setLoadError] = useState("");

  const activeKinds = kinds.filter((item) => !item.archived);
  const activeTypes = examTypes.filter((item) => !item.archived);
  const branches = useMemo(() => {
    const map = new Map<string, string>();
    for (const batch of batches) {
      if (batch.branch_id) map.set(batch.branch_id, batch.branch_name || batch.branch_id);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [batches]);
  const courses = useMemo(() => {
    const map = new Map<string, string>();
    for (const batch of batches) {
      if (values.branchId && batch.branch_id !== values.branchId) continue;
      if (batch.course_id) map.set(batch.course_id, batch.course_name || batch.course_id);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [batches, values.branchId]);
  const batchChoices = useMemo(
    () => batches.filter((batch) => (!values.branchId || batch.branch_id === values.branchId) && (!values.courseId || batch.course_id === values.courseId) && !batch.archived),
    [batches, values.branchId, values.courseId],
  );
  const subject = subjects.find((item) => item.id === values.subjectId);
  const partItems = !subject || values.scopeKind === "subject"
    ? []
    : values.scopeKind === "paper"
      ? subject.papers
      : subject.units.filter((item) => item.kind === values.scopeKind);
  const partLabel = values.scopeKind === "subject" ? "Sub Part" : kindLabel(kinds, values.scopeKind);

  useEffect(() => {
    let cancelled = false;
    api<{ items: BatchRow[] }>("/api/v1/exams/batches")
      .then((body) => {
        if (!cancelled) setBatches(body.items || []);
      })
      .catch((reason: Error) => {
        if (!cancelled) setLoadError(reason.message || "Could not load batches.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!values.batchId) {
      setSubjects([]);
      return;
    }
    let cancelled = false;
    api<{ subjects: SubjectOption[] }>(`/api/v1/exams?batch_id=${values.batchId}`)
      .then((body) => {
        if (!cancelled) setSubjects(body.subjects || []);
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message || "Could not load subjects.");
      });
    return () => {
      cancelled = true;
    };
  }, [values.batchId]);

  function patch(next: Partial<ExamMetadataValues>) {
    setValues((current) => ({ ...current, ...next }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const created = await api<{ marksheet_id: string }>("/api/v1/exams", {
        method: "POST",
        body: JSON.stringify({
          title: values.title,
          exam_date: values.examDate,
          maximum: Number(values.maximum),
          subject_id: values.subjectId,
          scope: { kind: values.scopeKind, item_ids: values.scopeKind === "subject" ? [] : values.itemIds },
          exam_kind: values.examKind,
          batch_ids: [values.batchId],
        }),
      });
      onCreated(created.marksheet_id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create the marksheet.");
      setSaving(false);
    }
  }

  async function addNamed(name: string) {
    if (!addKind) return;
    if (addKind === "examType") {
      const created = await api<{ key: string; label: string }>("/api/v1/exam-types", { method: "POST", body: JSON.stringify({ label: name }) });
      patch({ examKind: created.key });
      return;
    }
    if (addKind === "partition") {
      const created = await api<{ key: string; label: string }>("/api/v1/curriculum-kinds", { method: "POST", body: JSON.stringify({ label: name }) });
      patch({ scopeKind: created.key, itemIds: [] });
      return;
    }
    if (addKind === "subject") {
      if (!values.courseId) throw new Error("Choose a course before adding a subject.");
      const created = await api<{ id: string }>(`/api/v1/courses/${values.courseId}/subjects`, { method: "POST", body: JSON.stringify({ name }) });
      setSubjects((current) => [...current, { id: created.id, name, papers: [], units: [] }]);
      patch({ subjectId: created.id, itemIds: [] });
      return;
    }
    if (!values.subjectId || values.scopeKind === "subject") throw new Error("Choose a subject and sub part type first.");
    const created = await api<{ id: string; kind: string }>(`/api/v1/subjects/${values.subjectId}/items`, {
      method: "POST",
      body: JSON.stringify({ name, kind: values.scopeKind }),
    });
    const storage = kinds.find((item) => item.key === values.scopeKind)?.storage || "unit";
    const entry = { id: created.id, name, kind: created.kind };
    setSubjects((current) => current.map((row) => {
      if (row.id !== values.subjectId) return row;
      return storage === "paper"
        ? { ...row, papers: [...row.papers, entry] }
        : { ...row, units: [...row.units, entry] };
    }));
    patch({ itemIds: [...values.itemIds, created.id] });
  }

  const ready = Boolean(
    values.title.trim()
    && values.examDate
    && values.maximum
    && Number(values.maximum) > 0
    && values.examKind
    && values.subjectId
    && values.batchId
    && (values.scopeKind === "subject" || values.itemIds.length > 0),
  );

  return (
    <>
      <form className="form-grid" onSubmit={save}>
        {loadError ? <p className="error span-2" role="alert">{loadError}</p> : null}
        <label>Branch
          <select aria-label="Branch" value={values.branchId} onChange={(event) => patch({ branchId: event.target.value, courseId: "", batchId: "", subjectId: "", itemIds: [] })}>
            <option value="">Choose</option>
            {branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>Course
          <select aria-label="Course" value={values.courseId} onChange={(event) => patch({ courseId: event.target.value, batchId: "", subjectId: "", itemIds: [] })}>
            <option value="">Choose</option>
            {courses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>Batch
          <select aria-label="Batch" value={values.batchId} onChange={(event) => {
            const batch = batches.find((item) => item.id === event.target.value);
            patch({
              batchId: event.target.value,
              branchId: batch?.branch_id || values.branchId,
              courseId: batch?.course_id || values.courseId,
              subjectId: "",
              itemIds: [],
            });
          }}>
            <option value="">Choose</option>
            {batchChoices.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>Subject
          <span className="inline-field">
            <select aria-label="Subject" value={values.subjectId} disabled={!values.batchId} onChange={(event) => patch({ subjectId: event.target.value, itemIds: [] })}>
              <option value="">Choose</option>
              {subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <button type="button" className="quiet" disabled={!values.courseId} onClick={() => setAddKind("subject")}>Add</button>
          </span>
        </label>
        <label>Sub part type
          <span className="inline-field">
            <select aria-label="Sub part type" value={values.scopeKind} onChange={(event) => patch({ scopeKind: event.target.value, itemIds: [] })}>
              <option value="subject">Whole subject</option>
              {activeKinds.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
            <button type="button" className="quiet" onClick={() => setAddKind("partition")}>Add</button>
          </span>
        </label>
        <label>Exam Type
          <span className="inline-field">
            <select aria-label="Exam Type" value={values.examKind} onChange={(event) => patch({ examKind: event.target.value })}>
              <option value="">Choose</option>
              {activeTypes.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
            <button type="button" className="quiet" onClick={() => setAddKind("examType")}>Add</button>
          </span>
        </label>
        {values.scopeKind !== "subject" ? (
          <div className="span-2">
            <div className="title-row">
              <p className="meta">{partLabel}</p>
              <button type="button" className="quiet" disabled={!values.subjectId} onClick={() => setAddKind("item")}>Add</button>
            </div>
            {!values.subjectId ? <p className="meta">Choose a subject first.</p> : partItems.length === 0 ? (
              <p className="meta">No {partLabel.toLowerCase()} values yet. Add one.</p>
            ) : (
              <div className="permission-picks">
                {partItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={values.itemIds.includes(item.id) ? "permission is-selected" : "permission"}
                    aria-pressed={values.itemIds.includes(item.id)}
                    onClick={() => patch({
                      itemIds: values.itemIds.includes(item.id)
                        ? values.itemIds.filter((id) => id !== item.id)
                        : [...values.itemIds, item.id],
                    })}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
        <label className="span-2">Exam Name
          <input aria-label="Exam Name" value={values.title} onChange={(event) => patch({ title: event.target.value })} autoFocus />
        </label>
        <label>Exam Date
          <input aria-label="Exam Date" type="date" value={values.examDate} onChange={(event) => patch({ examDate: event.target.value })} />
        </label>
        <label>Total Mark
          <input aria-label="Total Mark" inputMode="decimal" value={values.maximum} onChange={(event) => patch({ maximum: event.target.value })} />
        </label>
        {error ? <p className="error span-2" role="alert">{error}</p> : null}
        <div className="dialog-actions span-2">
          <button type="button" className="text-button" onClick={onClose}>Back</button>
          <button type="submit" disabled={saving || !ready}>{saving ? "Creating…" : "Create draft"}</button>
        </div>
      </form>
      {addKind ? (
        <NamedAddDialog
          kind={addKind}
          partLabel={partLabel}
          onClose={() => setAddKind(null)}
          onSave={async (name) => {
            await addNamed(name);
            if (addKind !== "item") setAddKind(null);
          }}
          stayOpen={addKind === "item"}
        />
      ) : null}
    </>
  );
}

export function ExamMetadataEditForm({
  examId,
  marksheetId,
  initial,
  locked,
  canEditMaximum,
  onClose,
  onSaved,
}: {
  examId?: string;
  marksheetId: string;
  initial: Pick<ExamMetadataValues, "title" | "examDate" | "maximum" | "examKind">;
  locked: LockedLabels;
  canEditMaximum: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const examTypes = useExamTypes();
  const activeTypes = examTypes.filter((item) => !item.archived || item.key === initial.examKind);
  const [title, setTitle] = useState(initial.title);
  const [examDate, setExamDate] = useState(initial.examDate);
  const [maximum, setMaximum] = useState(initial.maximum);
  const [examKind, setExamKind] = useState(initial.examKind);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (examId) {
        const body: Record<string, string | number> = {
          title,
          exam_date: examDate,
          exam_kind: examKind,
        };
        if (canEditMaximum) body.maximum = Number(maximum);
        await api(`/api/v1/exams/${examId}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        await api(`/api/v1/marksheets/${marksheetId}`, {
          method: "PATCH",
          body: JSON.stringify({ title, exam_date: examDate || null }),
        });
      }
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the metadata.");
      setSaving(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={save}>
      {locked.branch ? <p className="meta">Branch · {locked.branch}</p> : null}
      {locked.course ? <p className="meta">Course · {locked.course}</p> : null}
      {locked.batch ? <p className="meta">Batch · {locked.batch}</p> : null}
      {locked.subject ? <p className="meta">Subject · {locked.subject}</p> : null}
      {locked.scopeKind ? <p className="meta">Sub part type · {locked.scopeKind}</p> : null}
      {locked.scopeItems ? <p className="meta">{locked.scopeItems}</p> : null}
      <label className="span-2">Exam Name
        <input aria-label="Exam Name" value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
      </label>
      <label>Exam Date
        <input aria-label="Exam Date" type="date" value={examDate} onChange={(event) => setExamDate(event.target.value)} required />
      </label>
      <label>Exam Type
        <select aria-label="Exam Type" value={examKind} onChange={(event) => setExamKind(event.target.value)} disabled={!examId}>
          <option value="">Choose</option>
          {activeTypes.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
      </label>
      <label>Total Mark
        <input aria-label="Total Mark" inputMode="decimal" value={maximum} disabled={!canEditMaximum || !examId} onChange={(event) => setMaximum(event.target.value)} />
      </label>
      {error ? <p className="error span-2" role="alert">{error}</p> : null}
      <div className="dialog-actions span-2">
        <button type="button" className="text-button" onClick={onClose}>Cancel</button>
        <button type="submit" disabled={saving || !title.trim() || !examDate || (Boolean(examId) && !examKind)}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </form>
  );
}

function NamedAddDialog({
  kind,
  partLabel,
  onClose,
  onSave,
  stayOpen,
}: {
  kind: AddKind;
  partLabel: string;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
  stayOpen?: boolean;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const copy = {
    subject: { title: "Add subject", label: "Subject name", submit: "Add subject" },
    partition: { title: "Add sub part type", label: "Sub part type name", submit: "Add type" },
    item: { title: `Add ${partLabel.toLowerCase()}`, label: `${partLabel} name`, submit: `Add ${partLabel.toLowerCase()}` },
    examType: { title: "Add exam type", label: "Exam type name", submit: "Add exam type" },
  }[kind];

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave(name.trim());
      setName("");
      if (!stayOpen) onClose();
      else setSaving(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add that.");
      setSaving(false);
    }
  }

  return (
    <StudentDialog title={copy.title} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <label className="span-2">{copy.label}
          <input value={name} onChange={(event) => setName(event.target.value)} autoFocus required />
        </label>
        {error ? <p className="error span-2" role="alert">{error}</p> : null}
        <div className="dialog-actions span-2">
          <button type="button" className="quiet" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={saving || !name.trim()}>{copy.submit}</button>
        </div>
      </form>
    </StudentDialog>
  );
}
