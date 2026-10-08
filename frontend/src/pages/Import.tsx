import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";

type Student = {
  row: number;
  display_name: string;
  status: string;
  score: number | null;
  before_score?: number | null;
  percentage: number | null;
  rank: number | null;
  source_rank: number | null;
  batch_session: string | null;
  enrolled_batches?: string[];
  change?: string;
  added?: boolean;
};
type Group = {
  id: string;
  maximum: number;
  interpretation: string;
  confirmed: boolean;
  duplicate_of: string | null;
  students: Student[];
};
type Counts = Record<"academic" | "students" | "enrollments" | "results", Record<string, number>>;
type Sheet = {
  id: string;
  name: string;
  title: string;
  included: boolean;
  heading_conflict: boolean;
  heading_acknowledged: boolean;
  branch_name: string;
  course_name: string;
  subject_name: string;
  paper_number: number | null;
  exam_date: string | null;
  batches: { session_key: string; label: string }[];
  rows: { row: number; cells: string[]; role: string }[];
  groups: Group[];
  planned?: Counts;
};
type Blocker = { code: string; message: string; sheet_id?: string; row?: number; group_id?: string };
type Preview = {
  id: string;
  state: string;
  ready: boolean;
  filename: string;
  sheets: Sheet[];
  blockers: Blocker[];
  totals: { result_rows: number; students_to_create: number; students_to_reuse: number; updates?: number; planned?: Counts };
  outcomes: { name: string; status: string; reason?: string }[];
  summary?: { counts: Counts; by_sheet: { name: string; status: string }[] } | null;
};
type HistoryItem = {
  id: string;
  filename: string;
  state: string;
  created_at?: string | null;
  outcomes: { name: string; status: string; reason?: string }[];
  summary?: Preview["summary"];
};

const LEVELS = [
  ["branch", "Branch"],
  ["course", "Course"],
  ["batch", "Batch"],
  ["subject", "Subject"],
  ["paper", "Paper"],
  ["exam_type", "Exam type"],
] as const;
const STEPS = ["File and levels", "Sheets", "Resolve", "Correct errors", "Confirm", "Results"];
const STATUS_LABEL: Record<string, string> = {
  committed: "Imported",
  needs_resolution: "Needs correction",
  ready: "Ready to import",
  cancelled: "Cancelled",
  committing: "Importing",
};

function rowCodes(sheet: Sheet, student: Student, blockers: Blocker[]) {
  return blockers.filter((item) => item.sheet_id === sheet.id && item.row === student.row).map((item) => item.code);
}

function rowNeedsFix(sheet: Sheet, student: Student, blockers: Blocker[]) {
  if (student.change === "reject" || student.change === "update" || student.status === "invalid") return true;
  return rowCodes(sheet, student, blockers).length > 0;
}

function groupNeedsChoice(sheet: Sheet, group: Group) {
  return !group.confirmed && Boolean(group.duplicate_of || sheet.groups.length > 1);
}

function scoreNeedsEdit(student: Student, codes: string[]) {
  return student.status === "invalid" || codes.includes("import.invalid_mark") || codes.includes("import.correction_needed") || (student.change === "reject" && student.before_score != null);
}

function badCellCount(sheet: Sheet, blockers: Blocker[]) {
  let count = sheet.heading_conflict && !sheet.heading_acknowledged ? 1 : 0;
  count += sheet.groups.filter((group) => groupNeedsChoice(sheet, group)).length;
  const seen = new Set<string>();
  for (const group of sheet.groups) {
    for (const student of group.students) {
      const codes = rowCodes(sheet, student, blockers);
      if (codes.includes("import.batch_unassigned")) seen.add(`batch-${student.row}`);
      if (codes.includes("import.duplicate_row")) seen.add(`name-${student.row}`);
      if (scoreNeedsEdit(student, codes)) seen.add(`score-${group.id}-${student.row}`);
    }
  }
  return count + seen.size;
}

function sessionLabel(key: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  const months: Record<string, string> = { "01": "January", "09": "September" };
  if (!match || !months[match[2]]) return key;
  return `${months[match[2]]} ${match[1]}`;
}

function columnLetter(index: number) {
  return String.fromCharCode(65 + index);
}

function markText(student: Student) {
  if (student.status === "absent") return "AB";
  if (student.status === "missing" || student.score == null) return "";
  return String(student.score);
}

function CellMenu({ label, options, ariaLabel, onPick }: { label: string; ariaLabel: string; options: { value: string; label: string }[]; onPick: (value: string) => void }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState({ top: 0, left: 0, width: 0 });

  useEffect(() => {
    if (!open) return;
    function close(event: MouseEvent) {
      const target = event.target as Node;
      if (anchor.current?.contains(target) || menu.current?.contains(target)) return;
      setOpen(false);
    }
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="cell-face"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          const rect = anchor.current?.getBoundingClientRect();
          if (rect) setPlace({ top: rect.bottom + 2, left: rect.left, width: Math.max(rect.width, 168) });
          setOpen((current) => !current);
        }}
      >
        {label}
      </button>
      {open ? (
        <div ref={menu} className="cell-menu" style={{ top: place.top, left: place.left, minWidth: place.width }} role="listbox">
          {options.map((option) => (
            <button key={option.value} type="button" role="option" onClick={() => { onPick(option.value); setOpen(false); }}>{option.label}</button>
          ))}
        </div>
      ) : null}
    </>
  );
}

function NameCell({ value, label, bad, title, onCommit, extra }: { value: string; label: string; bad: boolean; title?: string; onCommit: (name: string) => void; extra?: ReactNode }) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  function commit(text: string) {
    const cleaned = text.trim().replace(/\s+/g, " ");
    if (!cleaned || cleaned === value) {
      setDraft(value);
      return;
    }
    setDraft(cleaned);
    onCommit(cleaned);
  }

  return (
    <td className={bad ? "name bad" : "name"} title={title}>
      <input
        aria-label={label}
        value={draft}
        onFocus={(event) => {
          focused.current = true;
          const field = event.currentTarget;
          requestAnimationFrame(() => field.select());
        }}
        onMouseUp={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => { focused.current = false; commit(event.currentTarget.value); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setDraft(value);
            return;
          }
          if (event.key !== "Enter") return;
          event.preventDefault();
          commit(event.currentTarget.value);
        }}
      />
      {extra}
    </td>
  );
}

function ScoreCell({ student, bad, skipped, title, onCommit }: { student: Student; bad: boolean; skipped: boolean; title?: string; onCommit: (correction: Record<string, unknown>) => void }) {
  const [draft, setDraft] = useState(markText(student));
  const [reason, setReason] = useState("");
  const focused = useRef(false);
  const typed = useRef(markText(student));
  const needsReason = student.before_score != null;

  useEffect(() => {
    if (focused.current) return;
    const saved = markText(student);
    typed.current = saved;
    setDraft(saved);
  }, [student.score, student.status]);

  function commit(text: string, nextReason = reason) {
    const cleaned = text.trim();
    const upper = cleaned.toUpperCase();
    let correction: Record<string, unknown> | null = null;
    if (upper === "A" || upper === "AB") {
      if (student.status !== "absent") correction = { action: "replace", status: "absent", score: null, reason: nextReason };
    } else if (cleaned === "") {
      if (student.status !== "missing") correction = { action: "replace", status: "missing", score: null, reason: nextReason };
    } else {
      const score = Number(cleaned);
      if (Number.isNaN(score)) return;
      if (!(student.status === "scored" && student.score === score)) correction = { action: "replace", status: "scored", score, reason: nextReason };
    }
    if (!correction) return;
    if (needsReason && !String(correction.reason || "").trim()) return;
    typed.current = cleaned;
    onCommit(correction);
  }

  return (
    <td className={bad ? "bad" : skipped ? "skipped" : undefined} title={title}>
      <input
        aria-label={`Score for ${student.display_name}`}
        value={draft}
        inputMode="decimal"
        onFocus={(event) => {
          focused.current = true;
          const field = event.currentTarget;
          requestAnimationFrame(() => field.select());
        }}
        onMouseUp={(event) => event.currentTarget.select()}
        onChange={(event) => { typed.current = event.target.value; setDraft(event.target.value); }}
        onBlur={(event) => { focused.current = false; if (!needsReason) commit(event.currentTarget.value); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            const saved = markText(student);
            typed.current = saved;
            setDraft(saved);
            return;
          }
          if (event.key !== "Enter") return;
          event.preventDefault();
          commit(event.currentTarget.value);
        }}
      />
      {needsReason && bad ? (
        <>
          <input aria-label={`Reason for ${student.display_name}`} placeholder="Reason" value={reason} onChange={(event) => setReason(event.target.value)} onBlur={() => commit(draft, reason)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(draft); } }} />
          <button type="button" className="cell-link" onClick={() => onCommit({ action: "keep" })}>Keep {student.before_score}</button>
        </>
      ) : null}
    </td>
  );
}

const ROW_ROLE: Record<string, string> = {
  branch: "Used as Branch",
  course: "Used as Course and batch",
  paper: "Used as Subject and paper",
  series: "Series",
  title: "Exam title",
  header: "Column headings",
  legend: "Not a student",
  note: "Not a student",
};

function sharedValue(sheets: Sheet[], read: (sheet: Sheet) => string) {
  const values = sheets.map(read);
  return values.every((value) => value === values[0]) ? values[0] || "" : "";
}

function ContextField({ label, value, onCommit }: { label: string; value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  function commit(text: string) {
    const cleaned = text.trim().replace(/\s+/g, " ");
    if (cleaned === value) {
      setDraft(value);
      return;
    }
    setDraft(cleaned);
    onCommit(cleaned);
  }

  return (
    <label>
      {label}
      <input
        aria-label={label}
        value={draft}
        placeholder="Same for every sheet"
        onFocus={() => { focused.current = true; }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => { focused.current = false; commit(event.currentTarget.value); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setDraft(value);
            return;
          }
          if (event.key !== "Enter") return;
          event.preventDefault();
          commit(event.currentTarget.value);
        }}
      />
    </label>
  );
}

function ContextBar({ sheets, onCommit }: { sheets: Sheet[]; onCommit: (field: string, value: string) => void }) {
  const branch = sharedValue(sheets, (sheet) => sheet.branch_name);
  const course = sharedValue(sheets, (sheet) => sheet.course_name);
  const batch = sharedValue(sheets, (sheet) => sheet.batches.map((item) => item.label).join(", "));
  const subject = sharedValue(sheets, (sheet) => sheet.subject_name);
  const paper = sharedValue(sheets, (sheet) => (sheet.paper_number == null ? "" : String(sheet.paper_number)));
  return (
    <div className="context-bar">
      <p>These apply to every sheet in this file. The opening rows below show where each value was read.</p>
      <ContextField label="Branch" value={branch} onCommit={(value) => onCommit("branch", value)} />
      <ContextField label="Course" value={course} onCommit={(value) => onCommit("course", value)} />
      <ContextField label="Batch" value={batch} onCommit={(value) => onCommit("batch", value)} />
      <ContextField label="Subject" value={subject} onCommit={(value) => onCommit("subject", value)} />
      <ContextField label="Paper" value={paper} onCommit={(value) => onCommit("paper", value)} />
    </div>
  );
}

const GROUP_CHOICES = [
  ["assessment", "Same exam"],
  ["separate_assessment", "Separate exam"],
  ["retest", "Retest"],
  ["component", "Component"],
  ["skip_duplicate", "Skip duplicate"],
] as const;

export function ImportPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const fromList = useRef(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [sheetId, setSheetId] = useState("");
  const [defaults, setDefaults] = useState<Record<string, { mode: string; value: string }>>({});
  const [confirmUpdates, setConfirmUpdates] = useState(false);
  const [correctionNote, setCorrectionNote] = useState("");
  const saveChain = useRef(Promise.resolve());

  async function loadHistory() {
    const loaded = await api<{ items: HistoryItem[] }>("/api/v1/imports");
    setHistory(loaded.items);
  }

  useEffect(() => {
    loadHistory().catch((reason: Error) => setError(reason.message));
  }, []);

  useEffect(() => {
    if (params.get("new") !== "1") return;
    fromList.current = true;
    setPreview(null);
    setStep(0);
    setError("");
    setOpen(true);
    const next = new URLSearchParams(params);
    next.delete("new");
    setParams(next, { replace: true });
  }, [params, setParams]);

  function closeWizard() {
    setOpen(false);
    if (fromList.current) navigate("/marksheets");
  }

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeWizard();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function levelChange(field: string, key: "mode" | "value", value: string) {
    setDefaults((current) => {
      const existing = current[field] || { mode: "detect", value: "" };
      return { ...current, [field]: { ...existing, [key]: value } };
    });
  }

  function showImport(next: Preview, preferred?: number) {
    setPreview(next);
    const firstProblem = next.sheets.find((sheet) => sheet.groups.some((group) => group.students.some((student) => rowNeedsFix(sheet, student, next.blockers))));
    setSheetId(firstProblem?.id || next.sheets.find((sheet) => sheet.included)?.id || next.sheets[0]?.id || "");
    if (preferred !== undefined) setStep(preferred);
    else if (next.state === "committed") setStep(5);
    else if (next.blockers.some((item) => item.code !== "import.correction_needed")) setStep(2);
    else setStep(3);
    setOpen(true);
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    const input = event.currentTarget.elements.namedItem("file") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setPending(true);
    const body = new FormData();
    body.append("file", file);
    try {
      const created = await api<{ id: string }>("/api/v1/imports", { method: "POST", body });
      if (Object.keys(defaults).length) {
        await api(`/api/v1/imports/${created.id}`, { method: "PATCH", body: JSON.stringify({ defaults }) });
      }
      showImport(await api<Preview>(`/api/v1/imports/${created.id}`), 1);
      await loadHistory();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Upload failed.");
    } finally {
      setPending(false);
    }
  }

  function save(body: { sheets?: Record<string, unknown>; defaults?: Record<string, unknown> }) {
    if (!preview) return Promise.resolve();
    const importId = preview.id;
    const run = async () => {
      setError("");
      await api(`/api/v1/imports/${importId}`, { method: "PATCH", body: JSON.stringify(body) });
      setPreview(await api<Preview>(`/api/v1/imports/${importId}`));
    };
    const next = saveChain.current.then(run, run);
    saveChain.current = next;
    return next;
  }

  async function patchSheet(targetId: string, choice: Record<string, unknown>) {
    try {
      await save({ sheets: { [targetId]: choice } });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save that decision.");
    }
  }

  async function commit() {
    if (!preview) return;
    setError("");
    try {
      const result = await api<Preview>(`/api/v1/imports/${preview.id}/commit`, {
        method: "POST",
        body: JSON.stringify({ confirm_updates: confirmUpdates || (preview.totals.updates || 0) === 0 }),
      });
      setPreview(await api<Preview>(`/api/v1/imports/${preview.id}`));
      setStep(5);
      setMessage(result.summary
        ? `Import finished. ${result.summary.counts.results.insert} results inserted, ${result.summary.counts.results.update} updated.`
        : "Import finished. Drafts stay unpublished until you review the marksheets.");
      await loadHistory();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Commit failed.");
    }
  }

  async function correctRow(targetId: string, key: string, correction: Record<string, unknown>) {
    setCorrectionNote("");
    await patchSheet(targetId, { corrections: { [key]: correction } });
    setCorrectionNote("Saved.");
  }

  async function uploadCorrections(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview) return;
    const input = event.currentTarget.elements.namedItem("corrections") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setError("");
    const body = new FormData();
    body.append("file", file);
    try {
      const result = await api<{ applied: { student: string }[]; unmatched: { student: string; message: string }[] }>(
        `/api/v1/imports/${preview.id}/corrections`,
        { method: "POST", body },
      );
      setPreview(await api<Preview>(`/api/v1/imports/${preview.id}`));
      const missed = result.unmatched.map((item) => `${item.student}: ${item.message}`).join(" ");
      setCorrectionNote(`Applied ${result.applied.length} correction${result.applied.length === 1 ? "" : "s"}. ${missed}`);
      input.value = "";
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not read the correction file.");
    }
  }

  async function cancel() {
    if (!preview || preview.state === "committed") return;
    await api(`/api/v1/imports/${preview.id}/cancel`, { method: "POST" });
    setOpen(false);
    setPreview(null);
    setMessage("Import cancelled. It remains in the history.");
    await loadHistory();
    if (fromList.current) navigate("/marksheets");
  }

  const activeSheet = preview?.sheets.find((sheet) => sheet.id === sheetId) || preview?.sheets[0];
  const updates = preview?.totals.updates || 0;
  const problemCount = useMemo(() => {
    if (!preview) return 0;
    return preview.sheets.reduce(
      (sum, sheet) => sum + sheet.groups.reduce((inner, group) => inner + group.students.filter((student) => rowNeedsFix(sheet, student, preview.blockers)).length, 0),
      0,
    );
  }, [preview]);

  return (
    <section className="panel wide">
      <div className="page-title">
        <div>
          <p className="eyebrow">Import Marklist</p>
          <h1>Import history</h1>
        </div>
        <button type="button" onClick={() => { setPreview(null); setStep(0); setError(""); setOpen(true); }}>Import marklist</button>
      </div>
      <p>Each workbook stays in this list. Opening the import wizard does not remove earlier imports. Close the window and the history is still here.</p>
      {error && !open ? <p className="error" role="alert">{error}</p> : null}
      {message ? <p className="ok" role="status">{message}</p> : null}
      {history.length === 0 ? <p>No imports yet.</p> : (
        <div className="table-wrap">
          <table className="history">
            <caption>Workbooks uploaded for this institute</caption>
            <thead>
              <tr><th>File</th><th>When</th><th>Status</th><th>Sheets</th><th>Results</th><th></th></tr>
            </thead>
            <tbody>
              {history.map((item) => (
                <tr key={item.id}>
                  <td>{item.filename}</td>
                  <td>{item.created_at ? new Date(item.created_at).toLocaleString() : "—"}</td>
                  <td><span className={`chip ${item.state}`}>{STATUS_LABEL[item.state] || item.state}</span></td>
                  <td>{item.outcomes.length ? `${item.outcomes.filter((outcome) => outcome.status === "committed").length} imported, ${item.outcomes.filter((outcome) => outcome.status === "skipped").length} skipped` : "—"}</td>
                  <td>{item.summary ? `${item.summary.counts.results.insert} inserted, ${item.summary.counts.results.update} updated` : "—"}</td>
                  <td><button type="button" className="text-button" onClick={() => api<Preview>(`/api/v1/imports/${item.id}`).then(showImport).catch((reason: Error) => setError(reason.message))}>{item.state === "committed" ? "View" : "Continue"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open ? (
        <div className="modal-backdrop">
          <div className={preview && (step === 2 || step === 3) ? "modal sheet-view" : "modal"} role="dialog" aria-modal="true" aria-labelledby="import-title">
            <div className="modal-head">
              <h2 id="import-title">{preview?.filename || "Import marklist"}</h2>
              <button type="button" className="text-button" onClick={closeWizard}>Close</button>
            </div>
            <ol className="wizard">
              {STEPS.map((label, index) => (
                <li key={label}>
                  <button type="button" aria-current={step === index ? "step" : undefined} disabled={!preview && index > 0} onClick={() => setStep(index)}>
                    {index + 1}. {label}
                  </button>
                </li>
              ))}
            </ol>
            {error ? <p className="error" role="alert">{error}</p> : null}

            {step === 0 ? (
              <>
                <p>Detect keeps the value found in the workbook. Existing or new applies one value to every sheet.</p>
                <div className="stack">
                  {LEVELS.map(([field, label]) => (
                    <label key={field}>
                      {label}
                      <select value={defaults[field]?.mode || "detect"} onChange={(event) => levelChange(field, "mode", event.target.value)}>
                        <option value="detect">Detect</option>
                        <option value="existing">Existing</option>
                        <option value="new">New</option>
                      </select>
                      {defaults[field]?.mode && defaults[field].mode !== "detect" ? (
                        <input value={defaults[field].value} onChange={(event) => levelChange(field, "value", event.target.value)} placeholder={label} />
                      ) : null}
                    </label>
                  ))}
                </div>
                <form onSubmit={upload}>
                  <label>
                    Workbook
                    <input name="file" type="file" accept=".xlsx" required />
                  </label>
                  <button type="submit" disabled={pending}>{pending ? "Reading…" : "Upload and continue"}</button>
                </form>
              </>
            ) : null}

            {preview && step === 1 ? (
              <>
                <p>Included sheets are the only ones that will be saved.</p>
                <ul className="people">
                  {preview.sheets.map((sheet) => (
                    <li key={sheet.id}>
                      <label>
                        <input type="checkbox" checked={sheet.included} onChange={(event) => patchSheet(sheet.id, { included: event.target.checked, skip_reason: event.target.checked ? "" : "Skipped during review." })} />
                        {sheet.name}
                      </label>
                      <span>{sheet.subject_name} · {sheet.batches.map((batch) => batch.label).join(", ") || "No batch"}</span>
                    </li>
                  ))}
                </ul>
                <div className="actions">
                  <button type="button" className="text-button" onClick={() => setStep(0)}>Back</button>
                  <button type="button" onClick={() => setStep(2)}>Next</button>
                </div>
              </>
            ) : null}

            {preview && step === 2 ? (
              <>
                <p>The opening rows show what was read from the file. Branch, course, batch, subject, and paper at the top apply to every sheet. On a combined exam, a student already in one of the sheet’s batches keeps that batch. Otherwise choose from the batches written on the sheet.</p>
                {correctionNote ? <p className="ok" role="status">{correctionNote}</p> : null}
                <SheetGrid
                  sheets={preview.sheets.filter((sheet) => sheet.included)}
                  activeId={activeSheet?.id || ""}
                  blockers={preview.blockers}
                  onSelect={setSheetId}
                  onHeading={(targetId) => patchSheet(targetId, { acknowledge_heading: true })}
                  onGroup={(targetId, groupId, interpretation) => patchSheet(targetId, { groups: { [groupId]: { interpretation, confirmed: true } } })}
                  onBatch={(targetId, row, session) => patchSheet(targetId, { row_batches: { [String(row)]: session } })}
                  onDrop={(targetId, row) => patchSheet(targetId, { drop_rows: [row] })}
                  onScore={(targetId, key, correction) => correctRow(targetId, key, correction)}
                  onName={(targetId, row, name) => patchSheet(targetId, { names: { [String(row)]: name } })}
                  onAdd={(targetId, row) => patchSheet(targetId, { added: { [String(row)]: { name: "" } } })}
                  onContext={(field, value) => save({ defaults: { [field]: { mode: value ? "new" : "detect", value } } }).catch((reason: Error) => setError(reason.message))}
                />
                <div className="actions">
                  <button type="button" className="text-button" onClick={() => setStep(1)}>Back</button>
                  <button type="button" onClick={() => setStep(3)}>Next</button>
                </div>
              </>
            ) : null}

            {preview && step === 3 && activeSheet ? (
              <>
                <p>{problemCount === 0 ? "No cells need a correction. You can still review each sheet." : `${problemCount} cell${problemCount === 1 ? "" : "s"} need a decision. Edit the red cells, or upload a file.`}</p>
                {correctionNote ? <p className="ok" role="status">{correctionNote}</p> : null}
                <div className="upload-pair">
                  <form onSubmit={uploadCorrections}>
                    <h3>Upload a correction file</h3>
                    <p>Columns: Sheet, Student, Score, and Reason. <a href={`/api/v1/imports/${preview.id}/correction-template`}>Download the problem lines</a>.</p>
                    <label>
                      Correction file
                      <input name="corrections" type="file" accept=".xlsx" required />
                    </label>
                    <button type="submit">Apply correction file</button>
                  </form>
                  <form onSubmit={upload}>
                    <h3>Upload a new workbook</h3>
                    <p>Replace this file with a corrected workbook. The earlier upload stays in the history.</p>
                    <label>
                      New workbook
                      <input name="file" type="file" accept=".xlsx" required />
                    </label>
                    <button type="submit" disabled={pending}>{pending ? "Reading…" : "Use this workbook"}</button>
                  </form>
                </div>
                <SheetGrid
                  sheets={preview.sheets.filter((sheet) => sheet.included)}
                  activeId={activeSheet.id}
                  blockers={preview.blockers}
                  onSelect={setSheetId}
                  onHeading={(targetId) => patchSheet(targetId, { acknowledge_heading: true })}
                  onGroup={(targetId, groupId, interpretation) => patchSheet(targetId, { groups: { [groupId]: { interpretation, confirmed: true } } })}
                  onBatch={(targetId, row, session) => patchSheet(targetId, { row_batches: { [String(row)]: session } })}
                  onDrop={(targetId, row) => patchSheet(targetId, { drop_rows: [row] })}
                  onScore={(targetId, key, correction) => correctRow(targetId, key, correction)}
                  onName={(targetId, row, name) => patchSheet(targetId, { names: { [String(row)]: name } })}
                  onAdd={(targetId, row) => patchSheet(targetId, { added: { [String(row)]: { name: "" } } })}
                  onContext={(field, value) => save({ defaults: { [field]: { mode: value ? "new" : "detect", value } } }).catch((reason: Error) => setError(reason.message))}
                />
                <div className="actions">
                  <button type="button" className="text-button" onClick={() => setStep(2)}>Back</button>
                  <button type="button" onClick={() => setStep(4)} disabled={!preview.ready}>Next</button>
                </div>
              </>
            ) : null}

            {preview && step === 4 ? (
              <>
                <h3>Confirm import</h3>
                <CountGrid counts={preview.totals.planned} />
                <p>New rows become drafts. A published score changes only when you entered a reason. A score you keep stays as it is.</p>
                {updates > 0 ? (
                  <label>
                    <input type="checkbox" checked={confirmUpdates} onChange={(event) => setConfirmUpdates(event.target.checked)} />
                    I confirm {updates} update{updates === 1 ? "" : "s"} to existing results.
                  </label>
                ) : <p>No existing results will change.</p>}
                <div className="actions">
                  <button type="button" className="text-button" onClick={() => setStep(3)}>Back</button>
                  <button type="button" className="text-button" onClick={cancel}>Cancel import</button>
                  <button type="button" onClick={commit} disabled={!preview.ready || preview.state === "committed" || (updates > 0 && !confirmUpdates)}>Import drafts</button>
                </div>
              </>
            ) : null}

            {preview && step === 5 ? (
              <>
                <h3>Import results</h3>
                {preview.summary ? <CountGrid counts={preview.summary.counts} /> : <p>{preview.state === "committed" ? "This import was saved before outcome counts were recorded." : "This import has not been committed."}</p>}
                <ul>
                  {preview.outcomes.map((item) => <li key={item.name}>{item.name}: {item.status}{item.reason ? ` — ${item.reason}` : ""}</li>)}
                </ul>
                {preview.state === "committed" ? <p><a href={`/api/v1/imports/${preview.id}/outcome-report`}>Download outcome report</a></p> : null}
                <p><Link to="/marksheets">Review the draft marksheets</Link></p>
                <button type="button" onClick={closeWizard}>Close</button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SheetGrid({
  sheets,
  activeId,
  blockers,
  onSelect,
  onHeading,
  onGroup,
  onBatch,
  onDrop,
  onScore,
  onName,
  onAdd,
  onContext,
}: {
  sheets: Sheet[];
  activeId: string;
  blockers: Blocker[];
  onSelect: (id: string) => void;
  onHeading: (sheetId: string) => void;
  onGroup: (sheetId: string, groupId: string, interpretation: string) => void;
  onBatch: (sheetId: string, row: number, session: string) => void;
  onDrop: (sheetId: string, row: number) => void;
  onScore: (sheetId: string, key: string, correction: Record<string, unknown>) => void;
  onName: (sheetId: string, row: number, name: string) => void;
  onAdd: (sheetId: string, row: number) => void;
  onContext: (field: string, value: string) => void;
}) {
  const sheet = sheets.find((item) => item.id === activeId) || sheets[0];
  if (!sheet) return null;
  const lines = new Map<number, { row: number; name: string; batch: string | null; enrolled: string[]; students: Map<string, Student> }>();
  for (const group of sheet.groups) {
    for (const student of group.students) {
      const line = lines.get(student.row) || { row: student.row, name: student.display_name, batch: student.batch_session, enrolled: student.enrolled_batches || [], students: new Map() };
      line.students.set(group.id, student);
      line.batch = line.batch || student.batch_session;
      if (student.enrolled_batches?.length) line.enrolled = student.enrolled_batches;
      lines.set(student.row, line);
    }
  }
  const rows = [...lines.values()].sort((left, right) => left.row - right.row);
  const source = sheet.rows || [];
  const fileMax = source.length ? Math.max(...source.map((item) => item.row)) : Number.POSITIVE_INFINITY;
  const leading = source.filter((item) => item.role !== "student" && item.row < (rows.find((line) => line.row <= fileMax)?.row ?? Number.POSITIVE_INFINITY));
  const trailing = source.filter((item) => item.role !== "student" && item.row > (rows.filter((line) => line.row <= fileMax).at(-1)?.row ?? -1));
  const inFile = rows.filter((line) => line.row <= fileMax);
  const extra = rows.filter((line) => line.row > fileMax);
  const columns = 2 + sheet.groups.length;
  const nextRow = Math.max(fileMax === Number.POSITIVE_INFINITY ? 0 : fileMax, ...rows.map((line) => line.row), 0) + 1;

  function sourceLine(item: { row: number; cells: string[]; role: string }) {
    return (
      <tr key={`source-${item.row}`} className="source-row">
        <th className="row-no">{item.row}</th>
        <td className="name">{item.cells.filter(Boolean).join("  ·  ")}</td>
        <td className="used" colSpan={1 + sheet.groups.length}>{ROW_ROLE[item.role] || "Not a student"}</td>
      </tr>
    );
  }

  function studentLine(line: { row: number; name: string; batch: string | null; enrolled: string[]; students: Map<string, Student> }) {
    const sample = line.students.values().next().value as Student | undefined;
    const codes = sample ? rowCodes(sheet, sample, blockers) : [];
    const batchBad = codes.includes("import.batch_unassigned");
    const nameBad = codes.includes("import.duplicate_row");
    const batchLabel = sheet.batches.find((batch) => batch.session_key === line.batch)?.label || "";
    return (
      <tr key={line.row}>
        <th className="row-no">{line.row}</th>
        <NameCell
          value={line.name}
          label={`Name for row ${line.row}`}
          bad={nameBad}
          title={nameBad ? blockers.find((item) => item.sheet_id === sheet.id && item.row === line.row && item.code === "import.duplicate_row")?.message : undefined}
          onCommit={(name) => onName(sheet.id, line.row, name)}
          extra={nameBad || sample?.added ? <button type="button" className="cell-link" onClick={() => onDrop(sheet.id, line.row)}>{nameBad ? "Drop" : "Remove"}</button> : null}
        />
        <td className={batchBad ? "batch bad" : "batch"} title={batchBad ? blockers.find((item) => item.sheet_id === sheet.id && item.row === line.row && item.code === "import.batch_unassigned")?.message : undefined}>
          {sheet.batches.length > 1 ? (
            <>
              {line.enrolled.length ? <span className="batch-note">Already in {line.enrolled.map(sessionLabel).join(", ")}</span> : null}
              <span className="batch-choices" role="group" aria-label={`Batch for ${line.name || "the new row"}`}>
                {sheet.batches.map((batch) => (
                  <button
                    key={batch.session_key}
                    type="button"
                    className={line.batch === batch.session_key ? "batch-choice chosen" : "batch-choice"}
                    aria-pressed={line.batch === batch.session_key}
                    onClick={() => onBatch(sheet.id, line.row, batch.session_key)}
                  >
                    {batch.label}
                  </button>
                ))}
              </span>
            </>
          ) : batchLabel}
        </td>
        {sheet.groups.map((group) => {
          const student = line.students.get(group.id);
          if (!student) return <td key={group.id} />;
          const scoreCodes = rowCodes(sheet, student, blockers);
          const bad = scoreNeedsEdit(student, scoreCodes);
          const skipped = group.interpretation === "skip_duplicate" && group.confirmed;
          return (
            <ScoreCell
              key={group.id}
              student={student}
              bad={bad}
              skipped={skipped}
              title={bad ? blockers.find((item) => item.sheet_id === sheet.id && item.row === student.row)?.message : undefined}
              onCommit={(correction) => onScore(sheet.id, `${group.id}:${student.row}`, correction)}
            />
          );
        })}
      </tr>
    );
  }

  return (
    <div className="excel">
      <ContextBar sheets={sheets} onCommit={onContext} />
      <div className="table-wrap">
        <table className="sheet-grid">
          <caption>{sheet.name}. Click a name or a mark and type. Press Enter to keep it.</caption>
          <thead>
            <tr>
              <th className="col-letter" />
              {Array.from({ length: columns }, (_, index) => <th key={index} className="col-letter">{columnLetter(index)}</th>)}
            </tr>
            <tr>
              <th className="col-letter" />
              <th>Student</th>
              <th>Batch</th>
              {sheet.groups.map((group) => {
                const choice = groupNeedsChoice(sheet, group);
                const label = GROUP_CHOICES.find(([value]) => value === group.interpretation)?.[1] || String(group.maximum);
                return (
                  <th key={group.id} className={choice ? "bad" : undefined}>
                    {choice || sheet.groups.length > 1 || group.duplicate_of ? (
                      <CellMenu
                        label={choice ? label : String(group.maximum)}
                        ariaLabel={`${group.maximum} mark column on ${sheet.name}`}
                        options={GROUP_CHOICES.map(([value, text]) => ({ value, label: text }))}
                        onPick={(value) => onGroup(sheet.id, group.id, value)}
                      />
                    ) : group.maximum}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sheet.heading_conflict && !sheet.heading_acknowledged ? (
              <tr>
                <th className="row-no" />
                <td className="name">Heading</td>
                <td className="bad" colSpan={1 + sheet.groups.length}>
                  <button type="button" className="cell-link" onClick={() => onHeading(sheet.id)}>
                    Heading and sheet name disagree. Use {sheet.batches[0]?.label || "the batch from the sheet name"}
                  </button>
                </td>
              </tr>
            ) : null}
            {leading.map(sourceLine)}
            {inFile.map(studentLine)}
            {trailing.map(sourceLine)}
            {extra.map(studentLine)}
          </tbody>
        </table>
      </div>
      <div className="excel-foot">
        <button type="button" className="text-button" onClick={() => onAdd(sheet.id, nextRow)}>Add row</button>
      </div>
      <div className="sheet-tabs excel-tabs" role="tablist" aria-label="Sheets">
        {sheets.map((item) => {
          const count = badCellCount(item, blockers);
          return (
            <button key={item.id} type="button" role="tab" aria-selected={item.id === sheet.id} className={count ? "has-error" : undefined} onClick={() => onSelect(item.id)}>
              {item.name}{count ? ` (${count})` : ""}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CountGrid({ counts }: { counts?: Counts }) {
  if (!counts) return null;
  const kinds = [
    ["academic", "Academic details"],
    ["students", "Students"],
    ["enrollments", "Enrollments"],
    ["results", "Results"],
  ] as const;
  return (
    <div className="counts">
      {kinds.map(([key, label]) => (
        <article key={key} className="count-card">
          <h3>{label}</h3>
          <p>{counts[key].insert} insert · {counts[key].update} update · {counts[key].unchanged} unchanged</p>
          <p>{counts[key].skip} skip · {counts[key].reject} reject</p>
        </article>
      ))}
    </div>
  );
}
