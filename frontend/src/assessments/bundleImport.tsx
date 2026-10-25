import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { CurriculumKind, ExamType, kindLabel, useCurriculumKinds, useExamTypes } from "../academics/kinds";

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
  context: { batches: Choice[]; subjects: Subject[] } | null;
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
};

const STEPS = ["Batches", "Exams", "Marks", "Confirm", "Results"];
const STATUS_LABEL: Record<string, string> = {
  needs_resolution: "Needs review",
  ready: "Ready",
  committed: "Saved",
  cancelled: "Cancelled",
};

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
  const [batchIds, setBatchIds] = useState<string[]>([]);
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
  const [typeName, setTypeName] = useState<Record<string, string>>({});
  const [partitionName, setPartitionName] = useState<Record<string, string>>({});
  const [itemName, setItemName] = useState<Record<string, string>>({});
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
    if (branch) setBranchId(branch);
    if (course) setCourseId(course);
    if (batch) setBatchIds([batch]);
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
      setStep(loaded.state === "committed" ? 4 : 1);
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

  async function addExamType(sheetIdForType: string) {
    const label = (typeName[sheetIdForType] || "").trim();
    if (!label) return;
    setError("");
    try {
      const created = await api<{ key: string; label: string }>("/api/v1/exam-types", { method: "POST", body: JSON.stringify({ label }) });
      setAddedTypes((current) => [...current, { key: created.key, label: created.label, archived: false }]);
      updateDraft(setDrafts, sheetIdForType, { examType: created.key, useExamId: "" });
      setTypeName((current) => ({ ...current, [sheetIdForType]: "" }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The exam type was not added.");
    }
  }

  async function addPartition(sheetIdForPartition: string) {
    const label = (partitionName[sheetIdForPartition] || "").trim();
    if (!label) return;
    setError("");
    try {
      const created = await api<{ key: string; label: string }>("/api/v1/curriculum-kinds", { method: "POST", body: JSON.stringify({ label }) });
      setAddedKinds((current) => [...current, { key: created.key, label: created.label, storage: "unit", locked: false, archived: false }]);
      updateDraft(setDrafts, sheetIdForPartition, { kind: created.key, itemIds: [], useExamId: "" });
      setPartitionName((current) => ({ ...current, [sheetIdForPartition]: "" }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The subject partition was not added.");
    }
  }

  async function addItem(sheetIdForItem: string, subjectId: string, kindKey: string) {
    const name = (itemName[sheetIdForItem] || "").trim();
    if (!name || !subjectId || kindKey === "subject") return;
    setError("");
    try {
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
        const draft = current[sheetIdForItem];
        if (!draft) return current;
        return { ...current, [sheetIdForItem]: { ...draft, itemIds: [...draft.itemIds, created.id], useExamId: "" } };
      });
      setItemName((current) => ({ ...current, [sheetIdForItem]: "" }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The item was not added.");
    }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("file") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !branchId || !courseId || batchIds.length === 0) return;
    setPending(true);
    setError("");
    const body = new FormData();
    body.append("branch_id", branchId);
    body.append("course_id", courseId);
    body.append("batch_ids", batchIds.join(","));
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

  async function saveDrafts(nextStep: number) {
    if (!preview) return;
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
      setStep(4);
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
    <section className="panel wide">
      <div className="page-title">
        <div>
          <p className="eyebrow">Assessments</p>
          <h1>Import exams</h1>
          <p className="page-lead">Each sheet becomes an exam for the batches you choose. Names and marks can be edited before they are saved.</p>
        </div>
        <div className="actions"><Link className="button" to="/ecr">Back to ECR</Link></div>
      </div>
      <ol className="wizard">
        {STEPS.map((label, index) => (
          <li key={label}>
            <button type="button" aria-current={step === index ? "step" : undefined} disabled={index > 0 && !preview} onClick={() => (index > step && preview ? saveDrafts(index) : setStep(index))}>
              {label}
            </button>
          </li>
        ))}
      </ol>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {step === 0 ? (
        <>
        <form className="form-grid" onSubmit={upload}>
          <label>Branch
            <select aria-label="Branch" value={branchId} onChange={(event) => { setBranchId(event.target.value); setCourseId(""); setBatchIds([]); }}>
              <option value="">Choose a branch</option>
              {branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>Course
            <select aria-label="Course" value={courseId} onChange={(event) => { setCourseId(event.target.value); setBatchIds([]); }}>
              <option value="">Choose a course</option>
              {courses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <div className="span-2">
            <p className="meta">Current batches</p>
            {currentBatches.length === 0 ? <p>Choose a branch and course to see its current batches.</p> : (
              <div className="permission-picks">
                {currentBatches.map((item) => (
                  <button key={item.id} type="button" className={batchIds.includes(item.id) ? "permission is-selected" : "permission"} aria-pressed={batchIds.includes(item.id)} onClick={() => setBatchIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])}>
                    {item.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <label className="span-2">Workbook
            <input name="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Workbook" onChange={(event) => setFileName(event.target.files?.[0]?.name || "")} />
          </label>
          <div className="dialog-actions span-2">
            <button type="submit" disabled={pending || !branchId || !courseId || batchIds.length === 0 || !fileName}>Continue</button>
          </div>
        </form>
        <ImportHistory items={history} pending={pending} onOpen={openHistory} onDelete={removeHistory} />
        </>
      ) : null}
      {step === 1 && preview ? (
        <div className="stack">
          {preview.sheets.map((item) => {
            const row = drafts[item.id];
            if (!row) return null;
            const subject = subjects.find((entry) => entry.id === row.subjectId);
            const items = !subject || row.kind === "subject" ? [] : row.kind === "paper" ? subject.papers : subject.units.filter((unit) => unit.kind === row.kind);
            return (
              <fieldset key={item.id} className="form-grid">
                <legend>{item.name}</legend>
                <label className="span-2">
                  <input type="checkbox" checked={row.included} onChange={(event) => updateDraft(setDrafts, item.id, { included: event.target.checked })} /> Include this sheet
                </label>
                {row.included ? (
                  <>
                    <label>Exam type
                      <select aria-label={`Exam type for ${item.name}`} value={row.examType} onChange={(event) => updateDraft(setDrafts, item.id, { examType: event.target.value, useExamId: "" })}>
                        <option value="">Choose an exam type</option>
                        {activeTypes.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
                      </select>
                    </label>
                    <label>New exam type
                      <span className="inline-field">
                        <input aria-label={`New exam type for ${item.name}`} value={typeName[item.id] || ""} onChange={(event) => setTypeName((current) => ({ ...current, [item.id]: event.target.value }))} />
                        <button type="button" disabled={!(typeName[item.id] || "").trim()} onClick={() => addExamType(item.id)}>Add exam type</button>
                      </span>
                    </label>
                    <label>Subject partition
                      <select aria-label={`Subject partition for ${item.name}`} value={row.kind} onChange={(event) => updateDraft(setDrafts, item.id, { kind: event.target.value, itemIds: [], useExamId: "" })}>
                        <option value="subject">Whole subject</option>
                        {activeKinds.map((kind) => <option key={kind.key} value={kind.key}>{kind.label}</option>)}
                      </select>
                    </label>
                    <label>New subject partition
                      <span className="inline-field">
                        <input aria-label={`New subject partition for ${item.name}`} value={partitionName[item.id] || ""} onChange={(event) => setPartitionName((current) => ({ ...current, [item.id]: event.target.value }))} />
                        <button type="button" disabled={!(partitionName[item.id] || "").trim()} onClick={() => addPartition(item.id)}>Add subject partition</button>
                      </span>
                    </label>
                    <label>Subject
                      <select aria-label={`Subject for ${item.name}`} value={row.subjectId} onChange={(event) => updateDraft(setDrafts, item.id, { subjectId: event.target.value, itemIds: [], useExamId: "" })}>
                        <option value="">Choose a subject</option>
                        {subjects.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                      </select>
                    </label>
                    {row.kind !== "subject" ? (
                      <div className="span-2">
                        <p className="meta">{kindLabel(kinds, row.kind)}</p>
                        <div className="permission-picks">
                          {items.map((entry) => (
                            <button key={entry.id} type="button" className={row.itemIds.includes(entry.id) ? "permission is-selected" : "permission"} aria-pressed={row.itemIds.includes(entry.id)} onClick={() => updateDraft(setDrafts, item.id, { itemIds: row.itemIds.includes(entry.id) ? row.itemIds.filter((id) => id !== entry.id) : [...row.itemIds, entry.id], useExamId: "" })}>
                              {entry.name}
                            </button>
                          ))}
                        </div>
                        <label>New {kindLabel(kinds, row.kind).toLowerCase()}
                          <span className="inline-field">
                            <input aria-label={`New item for ${item.name}`} value={itemName[item.id] || ""} disabled={!row.subjectId} onChange={(event) => setItemName((current) => ({ ...current, [item.id]: event.target.value }))} />
                            <button type="button" disabled={!row.subjectId || !(itemName[item.id] || "").trim()} onClick={() => addItem(item.id, row.subjectId, row.kind)}>Add item</button>
                          </span>
                        </label>
                      </div>
                    ) : null}
                    <label>Exam name
                      <input aria-label={`Exam name for ${item.name}`} value={row.title} onChange={(event) => updateDraft(setDrafts, item.id, { title: event.target.value, useExamId: "" })} />
                    </label>
                    <label>Maximum
                      <input inputMode="decimal" aria-label={`Maximum for ${item.name}`} value={row.maximum} onChange={(event) => updateDraft(setDrafts, item.id, { maximum: event.target.value, useExamId: "" })} />
                    </label>
                    <label>Exam date
                      <input type="date" aria-label={`Exam date for ${item.name}`} value={row.date} onChange={(event) => updateDraft(setDrafts, item.id, { date: event.target.value, useExamId: "" })} />
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
                        <button type="button" onClick={() => updateDraft(setDrafts, item.id, { title: similar.title, date: similar.exam_date, maximum: String(similar.maximum), subjectId: similar.subject_id, examType: similar.exam_kind || "", kind: similar.scope.kind, itemIds: similar.scope.item_ids, useExamId: similar.id })}>Update this exam</button>
                      </p>
                    ))}
                  </>
                ) : null}
              </fieldset>
            );
          })}
          <div className="dialog-actions">
            <button type="button" disabled={pending} onClick={() => saveDrafts(2)}>Continue</button>
          </div>
          <BlockerList blockers={preview.blockers} />
        </div>
      ) : null}
      {step === 2 && preview && sheet && draft ? (
        <div className="stack">
          <div className="sheet-tabs">
            {preview.sheets.filter((item) => drafts[item.id]?.included).map((item) => (
              <button key={item.id} type="button" aria-current={item.id === sheet.id ? "page" : undefined} onClick={() => setSheetId(item.id)}>{item.name}</button>
            ))}
          </div>
          <MarkTable
            sheet={sheet}
            marks={marks}
            onChange={(student, value) => {
              const key = `${sheet.id}:${student.row}`;
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
          />
          <div className="dialog-actions">
            <button type="button" disabled={pending} onClick={() => saveDrafts(3)}>Continue</button>
          </div>
          <BlockerList blockers={preview.blockers.filter((item) => !item.sheet_id || item.sheet_id === sheet.id)} />
        </div>
      ) : null}
      {step === 3 && preview ? (
        <div className="stack">
          <p>{preview.filename}</p>
          <Counts totals={preview.totals} />
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
      {step === 4 && preview ? (
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
  onChange,
}: {
  sheet: Sheet;
  marks: Record<string, { name: string; score: string; batchId: string; reason: string }>;
  onChange: (student: Student, value: Partial<{ name: string; score: string; batchId: string; reason: string }>) => void;
}) {
  const group = sheet.groups.find((item) => item.interpretation !== "skip_duplicate") || sheet.groups[0];
  if (!group) return <p>{sheet.name} has no mark table.</p>;
  const published = sheet.matched_exam?.status === "published";
  return (
    <table>
      <thead>
        <tr><th>Name</th><th>Mark</th><th>Batch</th><th>Match</th>{published ? <th>Reason</th> : null}</tr>
      </thead>
      <tbody>
        {group.students.map((student) => {
          const key = `${sheet.id}:${student.row}`;
          const edited = marks[key];
          const choices = student.batch_choices || [];
          return (
            <tr key={student.row}>
              <td><input aria-label={`Name on row ${student.row}`} value={edited?.name ?? student.display_name} onChange={(event) => onChange(student, { name: event.target.value })} /></td>
              <td><input aria-label={`Mark on row ${student.row}`} value={edited?.score ?? shownScore(student)} onChange={(event) => onChange(student, { score: event.target.value })} /></td>
              <td>
                {choices.length > 1 ? (
                  <select aria-label={`Batch for row ${student.row}`} value={edited?.batchId || student.batch_id || ""} onChange={(event) => onChange(student, { batchId: event.target.value })}>
                    <option value="">Choose a batch</option>
                    {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
                  </select>
                ) : (choices[0]?.name || "")}
              </td>
              <td>{matchLabel(student)}</td>
              {published ? <td><input aria-label={`Reason for row ${student.row}`} value={edited?.reason || ""} onChange={(event) => onChange(student, { reason: event.target.value })} /></td> : null}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function BlockerList({ blockers }: { blockers: Blocker[] }) {
  if (!blockers.length) return null;
  return <ul>{blockers.map((item) => <li key={`${item.code}-${item.sheet_id || ""}-${item.row || ""}-${item.message}`}>{item.message}</li>)}</ul>;
}

function matchLabel(student: Student) {
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
  for (const student of group?.students || []) {
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
  onOpen,
  onDelete,
}: {
  items: HistoryItem[];
  pending: boolean;
  onOpen: (id: string) => void;
  onDelete: (item: HistoryItem) => void;
}) {
  return (
    <section className="stack">
      <h2>Import history</h2>
      {items.length === 0 ? <p>No exam imports yet.</p> : (
        <table>
          <thead>
            <tr><th>File</th><th>Status</th><th>When</th><th></th></tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.filename}</td>
                <td><span className={`chip ${item.state}`}>{STATUS_LABEL[item.state] || item.state}</span></td>
                <td>{item.created_at ? new Date(item.created_at).toLocaleString() : "—"}</td>
                <td>
                  <button type="button" disabled={pending} onClick={() => onOpen(item.id)}>{item.state === "committed" ? "View" : "Continue"}</button>
                  {item.state !== "committed" ? <button type="button" className="text-button" onClick={() => onDelete(item)}>Delete</button> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
