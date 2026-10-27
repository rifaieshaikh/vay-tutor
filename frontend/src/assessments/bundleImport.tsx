import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { CurriculumKind, ExamType, kindLabel, useCurriculumKinds, useExamTypes } from "../academics/kinds";
import { StudentDialog } from "../ui";

type BatchRow = {
  id: string;
  name: string;
  branch_id: string;
  branch_name: string;
  course_id: string;
  course_name: string;
  archived: boolean;
  closed: boolean;
};

type Item = { id: string; name: string; kind?: string };
type Subject = { id: string; name: string; papers: Item[]; units: Item[] };
type Choice = { id: string; name: string };
type Student = {
  row: number;
  display_name: string;
  score: number | null;
  status: string;
  change?: string;
  match?: string;
  create_student?: boolean;
  batch_id?: string;
  batch_choices?: Choice[];
  roster?: boolean;
  student_id?: string;
};
type Group = { id: string; maximum: number | null; interpretation: string; students: Student[] };
type ExamFields = {
  title: string;
  exam_date: string;
  maximum: number | null;
  subject_id: string;
  scope: { kind: string; item_ids: string[] };
  exam_kind?: string;
  use_exam_id?: string;
};
type Similar = ExamFields & { id: string; status?: string; batch_ids?: string[] };
type Sheet = {
  id: string;
  name: string;
  included: boolean;
  suggested_title: string;
  exam_date: string;
  exam: ExamFields | null;
  similar_exams: Similar[];
  matched_exam: (Similar & { status?: string }) | null;
  groups: Group[];
  selected_batch_ids?: string[];
  cover_roster?: boolean;
  roster_reason?: string;
};
type Blocker = { code: string; message: string; sheet_id?: string; row?: number };
type HistoryItem = {
  id: string;
  filename: string;
  state: string;
  created_at: string | null;
  bundle: boolean;
  outcomes: { status: string }[];
};

type Preview = {
  id: string;
  state?: string;
  ready: boolean;
  filename: string;
  sheets: Sheet[];
  blockers: Blocker[];
  totals: { updates?: number; planned?: { results?: Record<string, number>; students?: Record<string, number>; enrollments?: Record<string, number> } };
  outcomes: { name: string; status: string; exam_id?: string; created?: boolean }[];
  context: { batches: Choice[]; subjects: Subject[]; branch_id?: string; course_id?: string } | null;
};

type Draft = {
  included: boolean;
  title: string;
  date: string;
  maximum: string;
  subjectId: string;
  examType: string;
  kind: string;
  itemIds: string[];
  useExamId: string;
  keepGroup: string;
  batchIds: string[];
  coverRoster: boolean;
  rosterReason: string;
};

const STEPS = ["File", "Marks", "Confirm", "Results"];
const STATUS_LABEL: Record<string, string> = {
  needs_resolution: "Needs review",
  ready: "Ready",
  committed: "Saved",
  cancelled: "Cancelled",
};
const ASIDE_HISTORY_LIMIT = 4;

export function BundleImportPage() {
  const [params] = useSearchParams();
  const loadedKinds = useCurriculumKinds();
  const loadedTypes = useExamTypes();
  const [addedKinds, setAddedKinds] = useState<CurriculumKind[]>([]);
  const [addedTypes, setAddedTypes] = useState<ExamType[]>([]);
  const kinds = [...loadedKinds, ...addedKinds.filter((item) => !loadedKinds.some((known) => known.key === item.key))];
  const examTypes = [...loadedTypes, ...addedTypes.filter((item) => !loadedTypes.some((known) => known.key === item.key))];
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [branchId, setBranchId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [marks, setMarks] = useState<Record<string, { name: string; score: string; batchId: string; reason: string }>>({});
  const [step, setStep] = useState(0);
  const [sheetId, setSheetId] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [confirmUpdates, setConfirmUpdates] = useState(false);
  const [fileName, setFileName] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [dialog, setDialog] = useState<null | { kind: "subject" | "partition" | "item" | "examType"; sheetId: string }>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [attempted, setAttempted] = useState<Record<string, boolean>>({});
  const [focusMark, setFocusMark] = useState<{ sheetId: string; row: number } | null>(null);
  const seeded = useRef(false);

  useEffect(() => {
    api<{ items: BatchRow[] }>("/api/v1/exams/batches")
      .then((body) => setBatches(body.items))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Batches could not be loaded."));
    api<{ items: HistoryItem[] }>("/api/v1/imports")
      .then((body) => setHistory(body.items.filter((item) => item.bundle)))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (seeded.current || batches.length === 0) return;
    const branch = params.get("branch_id") || "";
    const course = params.get("course_id") || "";
    const batch = params.get("batch_id") || "";
    if (!branch && !course && !batch) return;
    seeded.current = true;
    const row = batch ? batches.find((item) => item.id === batch) : undefined;
    if (row && !branch) setBranchId(row.branch_id);
    else if (branch) setBranchId(branch);
    if (row && !course) setCourseId(row.course_id);
    else if (course) setCourseId(course);
  }, [batches, params]);

  const branches = useMemo(() => unique(batches.map((item) => ({ id: item.branch_id, name: item.branch_name }))), [batches]);
  const courses = useMemo(
    () => unique(batches.filter((item) => item.branch_id === branchId).map((item) => ({ id: item.course_id, name: item.course_name }))),
    [batches, branchId],
  );
  const currentBatches = batches.filter((item) => item.branch_id === branchId && item.course_id === courseId && !item.archived && !item.closed);
  const activeKinds = kinds.filter((item) => !item.archived);
  const activeTypes = examTypes.filter((item) => !item.archived);

  function remember(next: Preview, replace = false) {
    setPreview(next);
    if (next.context?.branch_id) setBranchId(next.context.branch_id);
    if (next.context?.course_id) setCourseId(next.context.course_id);
    setDrafts((current) => {
      const merged = replace ? {} : { ...current };
      for (const sheet of next.sheets) {
        if (merged[sheet.id]) continue;
        const exam = sheet.exam;
        const active = sheet.groups.find((group) => group.interpretation !== "skip_duplicate");
        merged[sheet.id] = {
          included: sheet.included,
          title: exam?.title || sheet.suggested_title || sheet.name,
          date: exam?.exam_date || sheet.exam_date || "",
          maximum: exam?.maximum == null ? "" : String(exam.maximum),
          subjectId: exam?.subject_id || "",
          examType: exam?.exam_kind || "",
          kind: exam?.scope.kind || "subject",
          itemIds: exam?.scope.item_ids || [],
          useExamId: exam?.use_exam_id || "",
          keepGroup: active?.id || sheet.groups[0]?.id || "",
          batchIds: sheet.selected_batch_ids?.length
            ? sheet.selected_batch_ids
            : (!replace && params.get("batch_id") ? [params.get("batch_id") || ""].filter(Boolean) : []),
          coverRoster: Boolean(sheet.cover_roster),
          rosterReason: sheet.roster_reason || "",
        };
      }
      return merged;
    });
    const first = next.sheets.find((sheet) => sheet.included)?.id || next.sheets[0]?.id || "";
    setSheetId((current) => (replace || !current ? first : current));
  }

  function refreshHistory() {
    api<{ items: HistoryItem[] }>("/api/v1/imports")
      .then((body) => setHistory(body.items.filter((item) => item.bundle)))
      .catch(() => undefined);
  }

  async function openHistory(id: string) {
    setPending(true);
    setError("");
    try {
      const loaded = await api<Preview>(`/api/v1/imports/${id}`);
      remember(loaded, true);
      setMarks({});
      setStep(loaded.state === "committed" ? 3 : 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That import could not be opened.");
    } finally {
      setPending(false);
    }
  }

  async function removeHistory(item: HistoryItem) {
    if (!window.confirm(`Delete ${item.filename} from the import history?`)) return;
    try {
      await api(`/api/v1/imports/${item.id}`, { method: "DELETE" });
      if (preview?.id === item.id) {
        setPreview(null);
        setStep(0);
      }
      refreshHistory();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The import was not deleted.");
    }
  }

  async function addExamType(sheetIdForType: string, label: string) {
    const created = await api<{ key: string; label: string; part_heading?: string }>("/api/v1/exam-types", { method: "POST", body: JSON.stringify({ label }) });
    setAddedTypes((current) => [...current, { key: created.key, label: created.label, archived: false, part_heading: created.part_heading || "Part" }]);
    updateDraft(setDrafts, sheetIdForType, { examType: created.key, useExamId: "" });
    setDialog(null);
  }

  async function addPartition(sheetIdForPartition: string, label: string) {
    const created = await api<{ key: string; label: string }>("/api/v1/curriculum-kinds", { method: "POST", body: JSON.stringify({ label }) });
    setAddedKinds((current) => [...current, { key: created.key, label: created.label, storage: "unit", locked: false, archived: false }]);
    updateDraft(setDrafts, sheetIdForPartition, { kind: created.key, itemIds: [], useExamId: "" });
    setDialog(null);
  }

  async function addSubject(sheetIdForSubject: string, name: string) {
    const course = preview?.context?.course_id || courseId;
    if (!course) throw new Error("Choose a course before adding a subject.");
    const created = await api<{ id: string }>(`/api/v1/courses/${course}/subjects`, { method: "POST", body: JSON.stringify({ name }) });
    setPreview((current) => current?.context ? {
      ...current,
      context: {
        ...current.context,
        subjects: [...current.context.subjects, { id: created.id, name, papers: [], units: [] }],
      },
    } : current);
    updateDraft(setDrafts, sheetIdForSubject, { subjectId: created.id, itemIds: [], useExamId: "" });
    setDialog(null);
  }

  async function addItem(sheetIdForItem: string, subjectId: string, kindKey: string, name: string) {
    if (!subjectId || kindKey === "subject") throw new Error("Choose a subject and sub part type first.");
    const created = await api<{ id: string; kind: string }>(`/api/v1/subjects/${subjectId}/items`, { method: "POST", body: JSON.stringify({ name, kind: kindKey }) });
    const storage = kinds.find((item) => item.key === kindKey)?.storage || "unit";
    setPreview((current) => current ? {
      ...current,
      context: current.context ? {
        ...current.context,
        subjects: current.context.subjects.map((subject) => {
          if (subject.id !== subjectId) return subject;
          const entry = { id: created.id, name, kind: created.kind };
          return storage === "paper"
            ? { ...subject, papers: [...subject.papers, entry] }
            : { ...subject, units: [...subject.units, entry] };
        }),
      } : current.context,
    } : current);
    setDrafts((current) => {
      const row = current[sheetIdForItem];
      if (!row) return current;
      return { ...current, [sheetIdForItem]: { ...row, itemIds: [...row.itemIds, created.id], useExamId: "" } };
    });
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("file") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !branchId || !courseId) return;
    setPending(true);
    setError("");
    const body = new FormData();
    body.append("branch_id", branchId);
    body.append("course_id", courseId);
    const linkedBatch = params.get("batch_id") || "";
    if (linkedBatch) body.append("batch_ids", linkedBatch);
    body.append("file", file);
    try {
      const created = await api<{ id: string }>("/api/v1/exams/import", { method: "POST", body });
      remember(await api<Preview>(`/api/v1/imports/${created.id}`));
      refreshHistory();
      setStep(1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Upload failed.");
    } finally {
      setPending(false);
    }
  }

  async function saveSheet(target: Sheet, nextDraft: Draft, marksOverride?: typeof marks) {
    if (!preview) return;
    setDrafts((current) => ({ ...current, [target.id]: nextDraft }));
    setPending(true);
    setError("");
    try {
      await api(`/api/v1/imports/${preview.id}`, {
        method: "PATCH",
        body: JSON.stringify({ sheets: { [target.id]: sheetPayload(target, nextDraft, marksOverride || marks) } }),
      });
      remember(await api<Preview>(`/api/v1/imports/${preview.id}`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The sheet was not saved.");
    } finally {
      setPending(false);
    }
  }

  async function saveDrafts(nextStep: number) {
    if (!preview) return;
    if (nextStep > 1) {
      const invalid = preview.sheets.find((item) => {
        const row = drafts[item.id];
        return row?.included && Object.keys(sheetFieldErrors(row, activeKinds, activeTypes)).length > 0;
      });
      if (invalid) {
        setAttempted((current) => ({ ...current, [invalid.id]: true }));
        setSheetId(invalid.id);
        setError("Fix the highlighted fields on this sheet before continuing.");
        return;
      }
    }
    setPending(true);
    setError("");
    try {
      for (const sheet of preview.sheets) {
        const draft = drafts[sheet.id];
        if (!draft) continue;
        await api(`/api/v1/imports/${preview.id}`, {
          method: "PATCH",
          body: JSON.stringify({ sheets: { [sheet.id]: sheetPayload(sheet, draft, marks) } }),
        });
      }
      remember(await api<Preview>(`/api/v1/imports/${preview.id}`));
      setStep(nextStep);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The sheet was not saved.");
    } finally {
      setPending(false);
    }
  }

  async function removeRow(target: Sheet, student: Student) {
    if (!preview) return;
    setPending(true);
    setError("");
    try {
      await api(`/api/v1/imports/${preview.id}`, {
        method: "PATCH",
        body: JSON.stringify({ sheets: { [target.id]: { drop_rows: [student.row] } } }),
      });
      remember(await api<Preview>(`/api/v1/imports/${preview.id}`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That row was not removed.");
    } finally {
      setPending(false);
    }
  }

  async function addMarkRow(target: Sheet, keepGroup: string) {
    if (!preview) return;
    const group = target.groups.find((item) => item.id === keepGroup)
      || target.groups.find((item) => item.interpretation !== "skip_duplicate")
      || target.groups[0];
    if (!group) return;
    const nextRow = Math.max(0, ...group.students.filter((student) => !student.roster).map((student) => student.row)) + 1;
    setPending(true);
    setError("");
    try {
      await api(`/api/v1/imports/${preview.id}`, {
        method: "PATCH",
        body: JSON.stringify({ sheets: { [target.id]: { added: { [String(nextRow)]: { name: "" } } } } }),
      });
      remember(await api<Preview>(`/api/v1/imports/${preview.id}`));
      setMarks((current) => ({
        ...current,
        [`${target.id}:${nextRow}`]: { name: "", score: "", batchId: "", reason: "" },
      }));
      setFocusMark({ sheetId: target.id, row: nextRow });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The mark row was not added.");
    } finally {
      setPending(false);
    }
  }

  async function commit() {
    if (!preview) return;
    setPending(true);
    setError("");
    try {
      await api(`/api/v1/imports/${preview.id}/commit`, {
        method: "POST",
        body: JSON.stringify({ confirm_updates: confirmUpdates || !(preview.totals.updates) }),
      });
      remember(await api<Preview>(`/api/v1/imports/${preview.id}`));
      refreshHistory();
      setStep(3);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The marks were not saved.");
    } finally {
      setPending(false);
    }
  }

  const sheet = preview?.sheets.find((item) => item.id === sheetId) || preview?.sheets[0];
  const draft = sheet ? drafts[sheet.id] : undefined;
  const subjects = preview?.context?.subjects || [];

  return (
    <section className={`panel wide import-exams${step === 0 ? " import-exams-start" : ""}`}>
      <div className="page-title">
        <div>
          <h1>Import exams</h1>
          {step === 0 ? (
            <p className="page-lead">Choose the branch, course, and workbook to start.</p>
          ) : (
            <p className="page-lead">Step {step + 1} of {STEPS.length} · {STEPS[step]}{preview ? ` · ${preview.filename}` : ""}</p>
          )}
        </div>
        <div className="actions">
          <Link className="button" to="/ecr">Back to ECR</Link>
        </div>
      </div>
      {step > 0 ? (
        <nav className="wizard wizard-steps" aria-label="Import steps">
          <ol>
            {STEPS.map((label, index) => (
              <li key={label}>
                <button type="button" aria-current={step === index ? "step" : undefined} disabled={index > 0 && !preview} onClick={() => (index > step && preview ? void saveDrafts(index) : setStep(index))}>
                  <span className="wizard-index">{index + 1}</span>
                  {label}
                </button>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {step === 0 ? (
        <div className="import-start">
          <div className="import-file">
            <h2>New import</h2>
            <form className="form-grid import-file-form" onSubmit={upload}>
              <label>Branch
                <select aria-label="Branch" value={branchId} onChange={(event) => { setBranchId(event.target.value); setCourseId(""); }}>
                  <option value="">Choose a branch</option>
                  {branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label>Course
                <select aria-label="Course" value={courseId} onChange={(event) => setCourseId(event.target.value)}>
                  <option value="">Choose a course</option>
                  {courses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label className="span-2">Workbook
                <input name="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Workbook" onChange={(event) => setFileName(event.target.files?.[0]?.name || "")} />
                {fileName ? <span className="meta">{fileName}</span> : <span className="meta">Excel workbook (.xlsx)</span>}
              </label>
              <div className="dialog-actions span-2">
                <button type="submit" disabled={pending || !branchId || !courseId || !fileName}>{pending ? "Uploading…" : "Continue"}</button>
              </div>
            </form>
          </div>
          <aside className="import-aside">
            <div className="title-row">
              <h2>Past imports</h2>
              {history.length > ASIDE_HISTORY_LIMIT ? (
                <button type="button" className="quiet" onClick={() => setShowHistory(true)}>
                  View all ({history.length})
                </button>
              ) : null}
            </div>
            <ImportHistory
              items={history.slice(0, ASIDE_HISTORY_LIMIT)}
              pending={pending}
              compact
              onOpen={(id) => void openHistory(id)}
              onDelete={removeHistory}
            />
            {history.length > ASIDE_HISTORY_LIMIT ? (
              <p className="meta import-aside-more">Showing {ASIDE_HISTORY_LIMIT} most recent</p>
            ) : null}
          </aside>
        </div>
      ) : null}
      {showHistory ? (
        <StudentDialog title="Past imports" onClose={() => setShowHistory(false)}>
          <ImportHistory
            items={history}
            pending={pending}
            onOpen={(id) => {
              setShowHistory(false);
              void openHistory(id);
            }}
            onDelete={removeHistory}
          />
        </StudentDialog>
      ) : null}
      {step === 1 && preview && sheet && draft ? (
        <div className="import-marks">
          <div className="import-marks-body">
          {(() => {
            const row = draft;
            const item = sheet;
            const subject = subjects.find((entry) => entry.id === row.subjectId);
            const valueLabel = row.kind === "subject" ? "Sub part values" : kindLabel(kinds, row.kind);
            const items = !subject || row.kind === "subject" ? [] : row.kind === "paper" ? subject.papers : subject.units.filter((unit) => unit.kind === row.kind);
            const fieldErrors = attempted[item.id] ? sheetFieldErrors(row, activeKinds, activeTypes) : {};
            const markAttempted = () => setAttempted((current) => ({ ...current, [item.id]: true }));
            const saveCovered = (next: Draft) => {
              markAttempted();
              updateDraft(setDrafts, item.id, next);
              if (next.coverRoster) void saveSheet(item, next);
            };
            if (!row.included) {
              return <p className="meta">This sheet is left out. Tick Include on its tab to set exam details and marks.</p>;
            }
            return (
              <fieldset className="form-grid import-sheet-fields">
                <legend className="sr-only">{item.name}</legend>
                <label>
                  Batches
                  {currentBatches.length === 0 ? <p className="meta">This course has no current batches.</p> : (
                    <MultiSelect
                      ariaLabel={`Batches for ${item.name}`}
                      emptyLabel="Choose batches"
                      options={currentBatches.map((batch) => ({ id: batch.id, name: batch.name }))}
                      values={row.batchIds}
                      invalid={Boolean(fieldErrors.batches)}
                      disabled={pending}
                      onChange={(batchIds) => {
                        markAttempted();
                        void saveSheet(item, { ...row, batchIds });
                      }}
                    />
                  )}
                  {fieldErrors.batches ? <span className="field-error">{fieldErrors.batches}</span> : null}
                </label>
                <label>Subject
                  <span className="inline-field">
                    <select className={fieldErrors.subject ? "invalid" : undefined} aria-label={`Subject for ${item.name}`} value={row.subjectId} onChange={(event) => { markAttempted(); updateDraft(setDrafts, item.id, { subjectId: event.target.value, itemIds: [], useExamId: "" }); }} onBlur={markAttempted}>
                      <option value="">Choose a subject</option>
                      {subjects.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                    </select>
                    <button type="button" className="quiet" onClick={() => setDialog({ kind: "subject", sheetId: item.id })}>Add</button>
                  </span>
                  {fieldErrors.subject ? <span className="field-error">{fieldErrors.subject}</span> : null}
                </label>
                <label>Sub part type
                  <span className="inline-field">
                    <select className={fieldErrors.kind ? "invalid" : undefined} aria-label={`Sub part type for ${item.name}`} value={row.kind} onChange={(event) => { markAttempted(); updateDraft(setDrafts, item.id, { kind: event.target.value, itemIds: [], useExamId: "" }); }} onBlur={markAttempted}>
                      <option value="subject">Whole subject</option>
                      {activeKinds.map((kind) => <option key={kind.key} value={kind.key}>{kind.label}</option>)}
                    </select>
                    <button type="button" className="quiet" onClick={() => setDialog({ kind: "partition", sheetId: item.id })}>Add</button>
                  </span>
                  {fieldErrors.kind ? <span className="field-error">{fieldErrors.kind}</span> : null}
                </label>
                <label>Exam type
                  <span className="inline-field">
                    <select className={fieldErrors.examType ? "invalid" : undefined} aria-label={`Exam type for ${item.name}`} value={row.examType} onChange={(event) => { markAttempted(); void saveSheet(item, { ...row, examType: event.target.value, useExamId: "" }); }} onBlur={markAttempted}>
                      <option value="">Choose an exam type</option>
                      {activeTypes.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
                    </select>
                    <button type="button" className="quiet" onClick={() => setDialog({ kind: "examType", sheetId: item.id })}>Add</button>
                  </span>
                  {fieldErrors.examType ? <span className="field-error">{fieldErrors.examType}</span> : null}
                </label>
                {row.kind !== "subject" ? (
                  <label>
                    {valueLabel} values
                    <span className="inline-field">
                      <MultiSelect
                        ariaLabel={`${valueLabel} values for ${item.name}`}
                        emptyLabel={row.subjectId ? `Choose ${valueLabel.toLowerCase()} values` : "Choose a subject first"}
                        options={items.map((entry) => ({ id: entry.id, name: entry.name }))}
                        values={row.itemIds}
                        invalid={Boolean(fieldErrors.items)}
                        disabled={!row.subjectId}
                        onChange={(itemIds) => {
                          markAttempted();
                          updateDraft(setDrafts, item.id, { itemIds, useExamId: "" });
                        }}
                      />
                      <button type="button" className="quiet" disabled={!row.subjectId} onClick={() => setDialog({ kind: "item", sheetId: item.id })}>Add</button>
                    </span>
                    {row.subjectId && items.length === 0 ? <span className="meta">No {valueLabel.toLowerCase()} values yet. Add one.</span> : null}
                    {fieldErrors.items ? <span className="field-error">{fieldErrors.items}</span> : null}
                  </label>
                ) : null}
                <label className="checkbox-row span-2">
                  <input type="checkbox" checked={row.coverRoster} onChange={(event) => void saveSheet(item, { ...row, coverRoster: event.target.checked })} /> Apply to every current student. Anyone missing from this sheet is marked absent.
                </label>
                <label>Exam name
                  <input className={fieldErrors.title ? "invalid" : undefined} aria-label={`Exam name for ${item.name}`} value={row.title} onChange={(event) => updateDraft(setDrafts, item.id, { title: event.target.value, useExamId: "" })} onBlur={(event) => saveCovered({ ...row, title: event.target.value, useExamId: "" })} />
                  {fieldErrors.title ? <span className="field-error">{fieldErrors.title}</span> : null}
                </label>
                <label>Maximum
                  <input className={fieldErrors.maximum ? "invalid" : undefined} inputMode="decimal" aria-label={`Maximum for ${item.name}`} value={row.maximum} onChange={(event) => updateDraft(setDrafts, item.id, { maximum: event.target.value, useExamId: "" })} onBlur={(event) => saveCovered({ ...row, maximum: event.target.value, useExamId: "" })} />
                  {fieldErrors.maximum ? <span className="field-error">{fieldErrors.maximum}</span> : null}
                </label>
                <label>Exam date
                  <input className={fieldErrors.date ? "invalid" : undefined} type="date" aria-label={`Exam date for ${item.name}`} value={row.date} onChange={(event) => updateDraft(setDrafts, item.id, { date: event.target.value, useExamId: "" })} onBlur={(event) => saveCovered({ ...row, date: event.target.value, useExamId: "" })} />
                  {fieldErrors.date ? <span className="field-error">{fieldErrors.date}</span> : null}
                </label>
                {item.groups.length > 1 ? (
                  <label>Mark column
                    <select aria-label={`Mark column for ${item.name}`} value={row.keepGroup} onChange={(event) => updateDraft(setDrafts, item.id, { keepGroup: event.target.value })}>
                      {item.groups.map((group) => <option key={group.id} value={group.id}>{group.maximum == null ? "Mark" : `Mark (${group.maximum})`}</option>)}
                    </select>
                  </label>
                ) : null}
                {item.matched_exam ? <p className="meta span-2">This matches {item.matched_exam.title}. Saving updates that exam.</p> : null}
                {item.similar_exams.map((similar) => (
                  <p key={similar.id} className="span-2">
                    {similar.title} on {similar.exam_date} is out of {similar.maximum} ({similar.status || "draft"}).
                    <button type="button" onClick={() => void saveSheet(item, { ...row, title: similar.title, date: similar.exam_date, maximum: String(similar.maximum), subjectId: similar.subject_id, examType: similar.exam_kind || "", kind: similar.scope.kind, itemIds: similar.scope.item_ids, useExamId: similar.id })}>Update this exam</button>
                  </p>
                ))}
                {row.coverRoster && item.matched_exam?.status === "published" ? (
                  <label className="span-2">Reason for students missing from this sheet
                    <input aria-label={`Reason for absent students on ${item.name}`} value={row.rosterReason} onChange={(event) => updateDraft(setDrafts, item.id, { rosterReason: event.target.value })} onBlur={(event) => void saveSheet(item, { ...row, rosterReason: event.target.value })} />
                  </label>
                ) : null}
              </fieldset>
            );
          })()}
          {draft.included ? (
            <MarkTable
              sheet={sheet}
              marks={marks}
              keepGroup={draft.keepGroup}
              focusRow={focusMark?.sheetId === sheet.id ? focusMark.row : null}
              onFocused={() => setFocusMark(null)}
              onRemove={(student) => void removeRow(sheet, student)}
              onChange={(student, value) => {
                const key = student.roster && student.student_id ? `roster:${sheet.id}:${student.student_id}` : `${sheet.id}:${student.row}`;
                setMarks((current) => {
                  const previous = current[key];
                  return {
                    ...current,
                    [key]: {
                      name: value.name ?? previous?.name ?? student.display_name,
                      score: value.score ?? previous?.score ?? shownScore(student),
                      batchId: value.batchId ?? previous?.batchId ?? student.batch_id ?? "",
                      reason: value.reason ?? previous?.reason ?? "",
                    },
                  };
                });
              }}
              onNameCommit={(student, name) => {
                const key = `${sheet.id}:${student.row}`;
                const previous = marks[key];
                const nextMarks = {
                  ...marks,
                  [key]: {
                    name,
                    score: previous?.score ?? shownScore(student),
                    batchId: previous?.batchId ?? student.batch_id ?? "",
                    reason: previous?.reason ?? "",
                  },
                };
                setMarks(nextMarks);
                void saveSheet(sheet, draft, nextMarks);
              }}
            />
          ) : null}
          <BlockerList blockers={preview.blockers.filter((entry) => (!entry.sheet_id || entry.sheet_id === sheet.id) && entry.code !== "import.exam_fields" && entry.code !== "import.batch")} />
          </div>
          <div className="import-marks-chrome">
            <div className="sheet-tabs excel-tabs import-sheet-tabs" role="tablist" aria-label="Sheets">
              {preview.sheets.map((item) => {
                const tabDraft = drafts[item.id];
                const included = tabDraft?.included ?? item.included;
                const needsWork = tabDraft ? sheetNeedsWork(tabDraft, activeKinds, activeTypes) : false;
                const label = sheetTabLabel(item, tabDraft, subjects);
                return (
                  <div key={item.id} className={`tab${included ? "" : " excluded"}${needsWork ? " needs-work" : ""}`}>
                    <input
                      type="checkbox"
                      checked={included}
                      disabled={pending}
                      aria-label={`Include ${item.name}`}
                      onChange={(event) => {
                        if (!tabDraft) return;
                        void saveSheet(item, { ...tabDraft, included: event.target.checked });
                      }}
                    />
                    <button type="button" role="tab" aria-selected={item.id === sheet.id} title={label} onClick={() => setSheetId(item.id)}>
                      <span className="tab-label">{label}</span>
                      {needsWork ? <span className="tab-dot" aria-label="Needs details" /> : null}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="import-marks-foot">
              <button type="button" className="quiet" disabled={pending || !draft.included} onClick={() => void addMarkRow(sheet, draft.keepGroup)}>Add mark</button>
              <button type="button" disabled={pending} onClick={() => void saveDrafts(2)}>Continue</button>
            </div>
          </div>
          {dialog?.sheetId === sheet.id ? (
            <ImportAddDialog
              kind={dialog.kind}
              valueLabel={dialog.kind === "item" ? kindLabel(kinds, draft.kind) : ""}
              onClose={() => setDialog(null)}
              onSubmit={async (name) => {
                if (dialog.kind === "subject") await addSubject(dialog.sheetId, name);
                else if (dialog.kind === "partition") await addPartition(dialog.sheetId, name);
                else if (dialog.kind === "examType") await addExamType(dialog.sheetId, name);
                else await addItem(dialog.sheetId, draft.subjectId, draft.kind, name);
              }}
              stayOpen={dialog.kind === "item"}
            />
          ) : null}
        </div>
      ) : null}
      {step === 2 && preview ? (
        <div className="stack">
          <p>{preview.filename}</p>
          <Counts totals={preview.totals} />
          {preview.sheets.some((item) => item.included && item.cover_roster) ? (
            <p>Students who are not on a sheet that applies to everyone are marked absent. A saved score for someone left off that sheet is replaced.</p>
          ) : null}
          {(preview.totals.updates || 0) > 0 ? (
            <label>
              <input type="checkbox" checked={confirmUpdates} onChange={(event) => setConfirmUpdates(event.target.checked)} /> Confirm updates to marks already saved
            </label>
          ) : null}
          <BlockerList blockers={preview.blockers} />
          <div className="dialog-actions">
            <button type="button" disabled={pending || !preview.ready || ((preview.totals.updates || 0) > 0 && !confirmUpdates)} onClick={commit}>Save exams</button>
          </div>
        </div>
      ) : null}
      {step === 3 && preview ? (
        <div className="stack">
          <p>The workbook is saved. Publish a marklist from Marksheets when it is ready.</p>
          <ul>
            {preview.outcomes.map((item) => (
              <li key={`${item.name}-${item.exam_id || item.status}`}>{item.name}: {item.status}{item.created ? ", new exam" : ""}</li>
            ))}
          </ul>
          <Link className="button" to="/ecr">Open ECR</Link>
        </div>
      ) : null}
    </section>
  );
}

function MarkTable({
  sheet,
  marks,
  keepGroup,
  focusRow,
  onFocused,
  onChange,
  onNameCommit,
  onRemove,
}: {
  sheet: Sheet;
  marks: Record<string, { name: string; score: string; batchId: string; reason: string }>;
  keepGroup: string;
  focusRow: number | null;
  onFocused: () => void;
  onChange: (student: Student, value: Partial<{ name: string; score: string; batchId: string; reason: string }>) => void;
  onNameCommit: (student: Student, name: string) => void;
  onRemove: (student: Student) => void;
}) {
  const group = sheet.groups.find((item) => item.id === keepGroup) || sheet.groups.find((item) => item.interpretation !== "skip_duplicate") || sheet.groups[0];
  const focusRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (focusRow == null) return;
    const node = focusRef.current;
    if (!node) return;
    node.focus();
    node.scrollIntoView({ block: "nearest" });
    onFocused();
  }, [focusRow, group?.students.length]);
  if (!group) return <p>{sheet.name} has no mark table.</p>;
  const published = sheet.matched_exam?.status === "published";
  const listed = group.students.filter((student) => !student.roster);
  const missing = group.students.filter((student) => student.roster);
  return (
    <>
      <p className="meta">Marks</p>
      <table>
        <thead>
          <tr><th>Name</th><th>Mark</th><th>Batch</th><th>Match</th>{published ? <th>Reason</th> : null}<th></th></tr>
        </thead>
        <tbody>
          {listed.map((student) => {
            const key = `${sheet.id}:${student.row}`;
            const edited = marks[key];
            const choices = student.batch_choices || [];
            const nameValue = edited?.name ?? student.display_name;
            return (
              <tr key={student.row}>
                <td>
                  <input
                    ref={focusRow === student.row ? focusRef : undefined}
                    aria-label={`Name on row ${student.row}`}
                    value={nameValue}
                    onChange={(event) => onChange(student, { name: event.target.value })}
                    onBlur={(event) => {
                      const next = event.target.value.trim();
                      const before = (student.display_name || "").trim();
                      if (next === before) return;
                      onNameCommit(student, event.target.value);
                    }}
                  />
                </td>
                <td><input aria-label={`Mark on row ${student.row}`} value={edited?.score ?? shownScore(student)} onChange={(event) => onChange(student, { score: event.target.value })} /></td>
                <td>
                  {choices.length > 1 ? (
                    <select aria-label={`Batch for row ${student.row}`} value={edited?.batchId || student.batch_id || ""} onChange={(event) => onChange(student, { batchId: event.target.value })}>
                      <option value="">Choose a batch</option>
                      {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
                    </select>
                  ) : (choices[0]?.name || "")}
                </td>
                <td>{matchLabel(student, nameValue)}</td>
                {published ? <td><input aria-label={`Reason for row ${student.row}`} value={edited?.reason || ""} onChange={(event) => onChange(student, { reason: event.target.value })} /></td> : null}
                <td><button type="button" className="text-button" aria-label={`Remove ${student.display_name || `row ${student.row}`}`} onClick={() => onRemove(student)}>Remove</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {sheet.cover_roster && missing.length === 0 ? <p>Every current student in the selected batches is on this sheet.</p> : null}
      {missing.length > 0 ? (
        <>
          <p className="meta">Not on the sheet. These students are marked absent.</p>
          <table>
            <thead>
              <tr><th>Name</th><th>Mark</th><th>Batch</th><th>Match</th></tr>
            </thead>
            <tbody>
              {missing.map((student) => {
                const key = `roster:${sheet.id}:${student.student_id}`;
                const edited = marks[key];
                const choices = student.batch_choices || [];
                return (
                  <tr key={student.student_id || student.row}>
                    <td>{student.display_name}</td>
                    <td><input aria-label={`Mark for ${student.display_name}`} value={edited?.score ?? shownScore(student)} onChange={(event) => onChange(student, { score: event.target.value.trim() === "" ? "AB" : event.target.value })} /></td>
                    <td>
                      {choices.length > 1 ? (
                        <select aria-label={`Batch for ${student.display_name}`} value={edited?.batchId || student.batch_id || ""} onChange={(event) => onChange(student, { batchId: event.target.value })}>
                          <option value="">Choose a batch</option>
                          {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
                        </select>
                      ) : (choices[0]?.name || "")}
                    </td>
                    <td>{matchLabel(student)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ) : null}
    </>
  );
}

function BlockerList({ blockers }: { blockers: Blocker[] }) {
  if (!blockers.length) return null;
  return <ul>{blockers.map((item) => <li key={`${item.code}-${item.sheet_id || ""}-${item.row || ""}-${item.message}`}>{item.message}</li>)}</ul>;
}

function MultiSelect({
  ariaLabel,
  emptyLabel,
  options,
  values,
  invalid = false,
  disabled = false,
  onChange,
}: {
  ariaLabel: string;
  emptyLabel: string;
  options: { id: string; name: string }[];
  values: string[];
  invalid?: boolean;
  disabled?: boolean;
  onChange: (ids: string[]) => void;
}) {
  const selected = options.filter((item) => values.includes(item.id));
  const summary = selected.length === 0
    ? emptyLabel
    : selected.length <= 2
      ? selected.map((item) => item.name).join(", ")
      : `${selected.length} selected`;
  return (
    <details className={`multi-select${invalid ? " invalid" : ""}${disabled ? " is-disabled" : ""}`}>
      <summary aria-label={ariaLabel}>{summary}</summary>
      <div className="multi-select-menu" role="group" aria-label={ariaLabel}>
        {options.length === 0 ? <p className="meta">Nothing to choose yet.</p> : null}
        {options.map((item) => {
          const checked = values.includes(item.id);
          return (
            <label key={item.id} className="checkbox-row">
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() => onChange(checked ? values.filter((id) => id !== item.id) : [...values, item.id])}
              />
              {item.name}
            </label>
          );
        })}
      </div>
    </details>
  );
}

function sheetFieldErrors(draft: Draft, kinds: CurriculumKind[], examTypes: ExamType[]) {
  const errors: Record<string, string> = {};
  if (!draft.included) return errors;
  if (!draft.batchIds.length) errors.batches = "Choose a batch.";
  if (!draft.subjectId) errors.subject = "Choose a subject.";
  if (draft.kind !== "subject") {
    const kindRow = kinds.find((item) => item.key === draft.kind);
    if (!kindRow) errors.kind = "Choose a sub part type.";
    else if (!draft.itemIds.length) errors.items = `Choose at least one ${kindRow.label.toLowerCase()}.`;
  }
  if (!draft.examType || !examTypes.some((item) => item.key === draft.examType)) errors.examType = "Choose an exam type.";
  if (!draft.title.trim()) errors.title = "Enter an exam name.";
  const maximum = Number(draft.maximum);
  if (draft.maximum.trim() === "" || !Number.isFinite(maximum) || maximum <= 0) errors.maximum = "Enter a maximum greater than zero.";
  if (!draft.date) errors.date = "Enter the exam date.";
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) errors.date = "Enter a calendar date.";
  return errors;
}

function sheetNeedsWork(draft: Draft, kinds: CurriculumKind[], examTypes: ExamType[]) {
  return Object.keys(sheetFieldErrors(draft, kinds, examTypes)).length > 0;
}

function sheetTabLabel(sheet: Sheet, draft: Draft | undefined, subjects: Subject[]) {
  if (!draft?.included) return sheet.name;
  const title = draft.title.trim();
  const subject = subjects.find((entry) => entry.id === draft.subjectId)?.name;
  if (title && subject && title.toLowerCase() !== sheet.name.toLowerCase()) return `${title} · ${subject}`;
  if (title) return title;
  if (subject) return `${sheet.name} · ${subject}`;
  return sheet.name;
}

function ImportAddDialog({
  kind,
  valueLabel,
  stayOpen = false,
  onClose,
  onSubmit,
}: {
  kind: "subject" | "partition" | "item" | "examType";
  valueLabel: string;
  stayOpen?: boolean;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const titles = {
    subject: { title: "Add subject", label: "Subject name", submit: "Add subject" },
    partition: { title: "Add sub part type", label: "Sub part type", submit: "Add sub part type" },
    item: { title: `Add ${valueLabel.toLowerCase() || "value"}`, label: `${valueLabel || "Value"} name`, submit: `Add ${valueLabel.toLowerCase() || "value"}` },
    examType: { title: "Add exam type", label: "Exam type", submit: "Add exam type" },
  }[kind];

  async function save(event: FormEvent) {
    event.preventDefault();
    const label = name.trim();
    if (!label) return;
    setSaving(true);
    setError("");
    try {
      await onSubmit(label);
      setName("");
      if (!stayOpen) onClose();
      else setSaving(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add that.");
      setSaving(false);
    }
  }

  return (
    <StudentDialog title={titles.title} onClose={onClose} dirty={Boolean(name.trim())}>
      <form onSubmit={(event) => void save(event)}>
        <label>{titles.label}
          <input value={name} aria-label={titles.label} onChange={(event) => setName(event.target.value)} />
        </label>
        {kind === "partition" ? <p className="meta">This is saved in Settings and becomes available for every subject.</p> : null}
        {kind === "item" ? <p className="meta">Add as many as you need. Each one is selected for this sheet.</p> : null}
        {error ? <p className="error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="quiet" onClick={onClose}>{stayOpen ? "Done" : "Cancel"}</button>
          <button type="submit" disabled={saving || !name.trim()}>{titles.submit}</button>
        </div>
      </form>
    </StudentDialog>
  );
}

function matchLabel(student: Student, editedName?: string) {
  const name = (editedName ?? student.display_name ?? "").trim();
  if (!student.roster && !name) return "Ignored until named";
  if (student.roster) {
    if (student.match === "choose") return "Choose a batch";
    if (student.status === "scored") return "Will score";
    if (student.change === "update") return "Will mark absent";
    if (student.change === "unchanged") return "Already absent";
    return "Absent";
  }
  if (student.match === "ambiguous") return "More than one student";
  if (student.match === "choose") return "Choose a batch";
  if (student.match === "enroll" && student.create_student) return "New student, will enroll";
  if (student.match === "enroll") return "Will enroll";
  if (student.match === "enrolled") return "Enrolled";
  if (student.match === "skip") return "Left out";
  return student.change || "";
}

function Counts({ totals }: { totals: Preview["totals"] }) {
  const results = totals.planned?.results || {};
  const students = totals.planned?.students || {};
  const enrollments = totals.planned?.enrollments || {};
  return (
    <p>
      Results: {results.insert || 0} new, {results.update || 0} updated, {results.unchanged || 0} unchanged, {results.skip || 0} skipped.
      {" "}Students: {students.unchanged || 0} already known, {students.insert || 0} new.
      {" "}Enrollments: {enrollments.insert || 0} new, {enrollments.unchanged || 0} already in the batch.
    </p>
  );
}

function unique(items: { id: string; name: string }[]) {
  const seen = new Map<string, string>();
  for (const item of items) if (item.id && !seen.has(item.id)) seen.set(item.id, item.name);
  return [...seen.entries()].map(([id, name]) => ({ id, name }));
}

function updateDraft(setDrafts: (value: (current: Record<string, Draft>) => Record<string, Draft>) => void, id: string, patch: Partial<Draft>) {
  setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
}

function sheetPayload(sheet: Sheet, draft: Draft, marks: Record<string, { name: string; score: string; batchId: string; reason: string }>) {
  const group = sheet.groups.find((item) => item.id === draft.keepGroup) || sheet.groups.find((item) => item.interpretation !== "skip_duplicate") || sheet.groups[0];
  const names: Record<string, string> = {};
  const corrections: Record<string, { score?: string; status?: string; action: string; reason?: string }> = {};
  const rowBatchIds: Record<string, string> = {};
  const rosterMarks: Record<string, { score: string; status: string; batch_id: string; reason: string }> = {};
  for (const student of group?.students || []) {
    if (student.roster && student.student_id) {
      const edited = marks[`roster:${sheet.id}:${student.student_id}`];
      if (!edited) continue;
      const token = edited.score.trim();
      const absent = token === "" || token.toUpperCase() === "AB" || token.toUpperCase() === "A";
      rosterMarks[student.student_id] = {
        score: absent ? "" : token,
        status: absent ? "absent" : "scored",
        batch_id: edited.batchId || "",
        reason: edited.reason || "",
      };
      continue;
    }
    const edited = marks[`${sheet.id}:${student.row}`];
    if (!edited) continue;
    if (edited.name && edited.name !== student.display_name) names[String(student.row)] = edited.name;
    if (edited.batchId) rowBatchIds[String(student.row)] = edited.batchId;
    if (edited.score !== undefined && edited.score !== shownScore(student)) {
      const token = edited.score.trim();
      corrections[`${group?.id}:${student.row}`] = token === ""
        ? { status: "missing", action: "replace", reason: edited.reason }
        : token.toUpperCase() === "AB" || token.toUpperCase() === "A"
          ? { status: "absent", action: "replace", reason: edited.reason }
          : { score: token, status: "scored", action: "replace", reason: edited.reason };
    }
  }
  const groups = Object.fromEntries(sheet.groups.map((item) => [
    item.id,
    { interpretation: item.id === (group?.id || item.id) ? (item.interpretation === "skip_duplicate" ? "separate_assessment" : item.interpretation) : "skip_duplicate", confirmed: true },
  ]));
  return {
    included: draft.included,
    batch_ids: draft.batchIds,
    cover_roster: draft.coverRoster,
    roster_reason: draft.rosterReason,
    roster_marks: rosterMarks,
    use_exam_id: draft.useExamId,
    exam: {
      title: draft.title,
      exam_date: draft.date,
      maximum: draft.maximum === "" ? null : Number(draft.maximum),
      subject_id: draft.subjectId,
      exam_kind: draft.examType,
      scope: { kind: draft.kind, item_ids: draft.kind === "subject" ? [] : draft.itemIds },
    },
    groups: sheet.groups.length > 1 ? groups : {},
    names,
    corrections,
    row_batch_ids: rowBatchIds,
  };
}

function shownScore(student: Student) {
  if (student.status === "absent") return "AB";
  if (student.score == null) return "";
  return String(student.score);
}

function ImportHistory({
  items,
  pending,
  compact = false,
  onOpen,
  onDelete,
}: {
  items: HistoryItem[];
  pending: boolean;
  compact?: boolean;
  onOpen: (id: string) => void;
  onDelete: (item: HistoryItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const statuses = useMemo(
    () => Array.from(new Set(items.map((item) => item.state))).sort(),
    [items],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (status && item.state !== status) return false;
      if (!needle) return true;
      return item.filename.toLowerCase().includes(needle);
    });
  }, [items, query, status]);

  if (items.length === 0) return <p className="meta">No exam imports yet.</p>;
  if (compact) {
    return (
      <ul className="import-history-list">
        {items.map((item) => (
          <li key={item.id}>
            <div>
              <strong>{item.filename}</strong>
              <p className="meta">
                <span className={`chip ${item.state}`}>{STATUS_LABEL[item.state] || item.state}</span>
                {" · "}
                {item.created_at ? new Date(item.created_at).toLocaleString() : "—"}
              </p>
            </div>
            <div className="row-actions">
              <button type="button" disabled={pending} onClick={() => onOpen(item.id)}>{item.state === "committed" ? "View" : "Continue"}</button>
              {item.state !== "committed" ? <button type="button" className="quiet" onClick={() => onDelete(item)}>Delete</button> : null}
            </div>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="stack import-history">
      <div className="toolbar import-history-filters">
        <label>Search
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="File name"
            aria-label="Search imports"
          />
        </label>
        <label>Status
          <select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            {statuses.map((value) => (
              <option key={value} value={value}>{STATUS_LABEL[value] || value}</option>
            ))}
          </select>
        </label>
      </div>
      {filtered.length === 0 ? (
        <p className="meta">No matching imports.</p>
      ) : (
        <>
          <p className="meta">{filtered.length} of {items.length}</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>File</th><th>Status</th><th>When</th><th></th></tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id}>
                    <td>{item.filename}</td>
                    <td><span className={`chip ${item.state}`}>{STATUS_LABEL[item.state] || item.state}</span></td>
                    <td>{item.created_at ? new Date(item.created_at).toLocaleString() : "—"}</td>
                    <td className="row-actions">
                      <button type="button" disabled={pending} onClick={() => onOpen(item.id)}>{item.state === "committed" ? "View" : "Continue"}</button>
                      {item.state !== "committed" ? <button type="button" className="quiet" onClick={() => onDelete(item)}>Delete</button> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
