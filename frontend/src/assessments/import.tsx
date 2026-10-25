import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { notify } from "../notify";
import { Icon } from "../ui";

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
  marksheet_id?: string;
  source?: string;
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
  failed: "Failed",
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
  let value = index + 1;
  let letters = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return letters;
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

export function ImportPage({ canUpload = true, examId = "" }: { canUpload?: boolean; examId?: string }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const fromList = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [sheetId, setSheetId] = useState("");
  const [defaults, setDefaults] = useState<Record<string, { mode: string; value: string }>>({});
  const [confirmUpdates, setConfirmUpdates] = useState(false);
  const [exam, setExam] = useState<{ id: string; title: string; maximum: number; scope_label: string; marksheet_id: string; exam_date: string } | null>(null);
  const saveChain = useRef(Promise.resolve());
  type ScopeItem = { id: string; name: string; archived?: boolean; closed?: boolean; branch_id?: string; course_id?: string; subject_id?: string };
  type GridRow = { enrollment_code: string; name: string; score: string };
  const [scopeCatalog, setScopeCatalog] = useState<{
    branches: ScopeItem[];
    courses: ScopeItem[];
    batches: ScopeItem[];
    subjects: ScopeItem[];
    papers: ScopeItem[];
    offerings: { branch_id?: string; course_id?: string }[];
  } | null>(null);
  const [scope, setScope] = useState({ branch_id: "", course_id: "", batch_id: "", subject_id: "", paper_id: "", title: "", maximum: "", exam_type: "unit" });
  const [grid, setGrid] = useState<GridRow[]>([]);

  const stateFilter = params.get("state") || "";
  const [inheritedLabel, setInheritedLabel] = useState("");
  const [scopeLabels, setScopeLabels] = useState<Record<string, string>>({});
  const inheritedDefaults = useRef<Record<string, { mode: string; value: string }>>({});

  const branchFilter = params.get("branch_id") || "";
  const courseFilter = params.get("course_id") || "";
  const batchFilter = params.get("batch_id") || "";

  async function loadHistory() {
    const search = new URLSearchParams();
    if (examId) search.set("exam_id", examId);
    if (stateFilter) search.set("state", stateFilter);
    if (branchFilter) search.set("branch_id", branchFilter);
    if (courseFilter) search.set("course_id", courseFilter);
    if (batchFilter) search.set("batch_id", batchFilter);
    const query = search.toString();
    const loaded = await api<{ items: HistoryItem[] }>(`/api/v1/imports${query ? `?${query}` : ""}`);
    setHistory(loaded.items);
  }

  useEffect(() => {
    loadHistory().catch((reason: Error) => setError(reason.message));
  }, [stateFilter, branchFilter, courseFilter, batchFilter, examId]);

  useEffect(() => {
    if (!examId) return;
    api<{ id: string; title: string; maximum: number; scope_label: string; marksheet_id: string; exam_date: string }>(`/api/v1/exams/${examId}`)
      .then((loaded) => {
        setExam(loaded);
        setOpen(true);
        setStep(0);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [examId]);

  useEffect(() => {
    const branchId = params.get("branch_id") || "";
    const courseId = params.get("course_id") || "";
    const batchId = params.get("batch_id") || "";
    if (!branchId && !courseId && !batchId) return;
    let cancelled = false;
    Promise.all(
      ["branch", "course", "batch"].map((dimension) => api<{ items: { id: string; label: string }[] }>(`/api/v1/context/options?dimension=${dimension}`)),
    ).then(([branches, courses, batches]) => {
      if (cancelled) return;
      const next: Record<string, { mode: string; value: string }> = {};
      const labels: string[] = [];
      const branch = branches.items.find((item) => item.id === branchId);
      const course = courses.items.find((item) => item.id === courseId);
      const batch = batches.items.find((item) => item.id === batchId);
      if (branch) {
        next.branch = { mode: "existing", value: branch.label };
        labels.push(branch.label);
      }
      if (course) {
        next.course = { mode: "existing", value: course.label };
        labels.push(course.label);
      }
      if (batch) {
        next.batch = { mode: "existing", value: batch.label };
        labels.push(batch.label);
      }
      inheritedDefaults.current = next;
      setDefaults((current) => ({ ...next, ...current }));
      setInheritedLabel(labels.join(" · "));
      setScopeLabels({
        branch_id: branch?.label || "",
        course_id: course?.label || "",
        batch_id: batch?.label || "",
      });
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [params]);

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
    const node = dialogRef.current;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : openerRef.current;
    const hidden: HTMLElement[] = [];
    let current: HTMLElement | null = node;
    while (current && current !== document.body) {
      const parent = current.parentElement;
      if (!parent) break;
      for (const child of parent.children) {
        if (child !== current && child instanceof HTMLElement && !child.hasAttribute("inert")) {
          child.setAttribute("inert", "");
          hidden.push(child);
        }
      }
      current = parent;
    }
    const fields = node ? [...node.querySelectorAll<HTMLElement>("button, input, select, textarea")].filter((item) => !item.hasAttribute("disabled")) : [];
    (fields.find((item) => item.matches("input, select, textarea")) || fields[0] || node)?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeWizard();
        return;
      }
      if (event.key !== "Tab" || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>("button, input, select, textarea")].filter((item) => !item.hasAttribute("disabled"));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      hidden.forEach((item) => item.removeAttribute("inert"));
      openerRef.current?.focus();
    };
  }, [open]);

  function levelChange(field: string, key: "mode" | "value", value: string) {
    setDefaults((current) => {
      const existing = current[field] || { mode: "detect", value: "" };
      return { ...current, [field]: { ...existing, [key]: value } };
    });
  }

  useEffect(() => {
    if (!open || scopeCatalog) return;
    api<{ branches: ScopeItem[]; courses: ScopeItem[]; batches: ScopeItem[]; subjects: ScopeItem[]; papers: ScopeItem[]; offerings: { branch_id?: string; course_id?: string }[] }>("/api/v1/catalog")
      .then(setScopeCatalog)
      .catch((reason: Error) => setError(reason.message));
  }, [open, scopeCatalog]);

  useEffect(() => {
    if (!open || !scope.batch_id) return;
    api<{ items: { enrollment_code: string; display_name: string }[] }>(`/api/v1/batches/${scope.batch_id}/roster`)
      .then((result) => {
        setGrid((result.items || []).map((item) => ({ enrollment_code: item.enrollment_code, name: item.display_name, score: "" })));
      })
      .catch((reason: Error) => setError(reason.message));
  }, [open, scope.batch_id]);

  function applyPaste(text: string) {
    const lines = text.replace(/\r/g, "").split("\n").filter((line) => line.trim());
    if (!lines.length) return;
    const cells = lines.map((line) => line.split("\t"));
    const header = cells[0].map((cell) => cell.trim().toLowerCase());
    const start = header.some((cell) => cell.includes("enroll")) ? 1 : 0;
    setGrid(cells.slice(start).map((row) => ({
      enrollment_code: (row[0] || "").trim(),
      name: (row[1] || "").trim(),
      score: (row[2] || "").trim(),
    })));
  }

  function named(items: ScopeItem[] | undefined, id: string) {
    return items?.find((item) => item.id === id)?.name || "";
  }

  function chooseScope(field: keyof typeof scope, value: string) {
    setScope((current) => {
      const next = { ...current, [field]: value };
      if (field === "branch_id") {
        next.course_id = "";
        next.batch_id = "";
        next.subject_id = "";
        next.paper_id = "";
      }
      if (field === "course_id") {
        next.batch_id = "";
        next.subject_id = "";
        next.paper_id = "";
      }
      if (field === "subject_id") next.paper_id = "";
      return next;
    });
    const catalogField = field === "branch_id" ? "branch" : field === "course_id" ? "course" : field === "batch_id" ? "batch" : field === "subject_id" ? "subject" : field === "paper_id" ? "paper" : "";
    if (!catalogField || !scopeCatalog) return;
    const list = catalogField === "branch" ? scopeCatalog.branches : catalogField === "course" ? scopeCatalog.courses : catalogField === "batch" ? scopeCatalog.batches : catalogField === "subject" ? scopeCatalog.subjects : scopeCatalog.papers;
    levelChange(catalogField, "mode", value ? "existing" : "detect");
    levelChange(catalogField, "value", named(list, value));
  }

  async function saveGrid() {
    setError("");
    const maximum = Number(scope.maximum);
    if (!scope.title.trim() || !scope.subject_id || !scope.paper_id || !(maximum > 0)) {
      setError("Enter a title, subject, paper, and maximum before saving the marks.");
      return;
    }
    setPending(true);
    try {
      await api("/api/v1/marksheets/grid", {
        method: "POST",
        body: JSON.stringify({
          title: scope.title.trim(),
          branch_id: scope.branch_id,
          course_id: scope.course_id,
          batch_id: scope.batch_id,
          subject_id: scope.subject_id,
          paper_id: scope.paper_id,
          exam_type: scope.exam_type,
          maximum,
          rows: grid.map((row) => ({ enrollment_code: row.enrollment_code, score: row.score })),
        }),
      });
      notify("Marksheet saved.");
      setOpen(false);
      await loadHistory();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The marks were not saved.");
    } finally {
      setPending(false);
    }
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
    const input = event.currentTarget.elements.namedItem("file") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setPending(true);
    const body = new FormData();
    body.append("file", file);
    try {
      const created = await api<{ id: string }>(examId ? `/api/v1/exams/${examId}/marklist` : "/api/v1/imports", { method: "POST", body });
      const chosen = examId ? {} : { ...inheritedDefaults.current, ...defaults };
      if (Object.keys(chosen).length) {
        await api(`/api/v1/imports/${created.id}`, { method: "PATCH", body: JSON.stringify({ defaults: chosen }) });
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
      const marksheetTo = exam?.marksheet_id ? `/marksheets/${exam.marksheet_id}` : "/marksheets";
      notify(result.summary
        ? `Import finished. ${result.summary.counts.results.insert} results inserted, ${result.summary.counts.results.update} updated.`
        : "Import finished. Drafts stay unpublished until you review the marksheet.", "success", { label: examId ? "Open marksheet" : "Open marksheets", to: examId ? marksheetTo : "/marksheets" });
      await loadHistory();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Commit failed.");
    }
  }

  async function correctRow(targetId: string, key: string, correction: Record<string, unknown>) {
    await patchSheet(targetId, { corrections: { [key]: correction } });
    notify("Saved.");
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
      notify(`Applied ${result.applied.length} correction${result.applied.length === 1 ? "" : "s"}. ${missed}`);
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
    notify("Import cancelled. It remains in the history.");
    await loadHistory();
    if (fromList.current) navigate("/marksheets");
  }

  async function removeHistory(item: HistoryItem) {
    const label = item.filename || "this import";
    if (item.state === "committed") return;
    if (!window.confirm(`Delete ${label} from the import history?`)) return;
    try {
      await api(`/api/v1/imports/${item.id}`, { method: "DELETE" });
      if (preview?.id === item.id) {
        setOpen(false);
        setPreview(null);
      }
      notify("Import removed from the history.");
      await loadHistory();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The import was not deleted.");
    }
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
          <p className="eyebrow">Assessments</p>
          <h1>{exam ? exam.title : "Import history"}</h1>
          {exam ? <p className="page-lead">{exam.scope_label} · out of {exam.maximum} · {exam.exam_date}</p> : null}
          {stateFilter === "failed" ? <p className="page-lead">Failed imports.</p> : null}
        </div>
        {canUpload ? <button type="button" onClick={() => { setPreview(null); setStep(0); setError(""); setOpen(true); }}>{examId ? "Upload marklist" : "Import marklist"}</button> : null}
      </div>
      {stateFilter || branchFilter || courseFilter || batchFilter ? (
        <p className="filter-row">
          {stateFilter ? <button type="button" className="quiet" onClick={() => { const next = new URLSearchParams(params); next.delete("state"); setParams(next); }}>{stateFilter === "failed" ? "Failed" : stateFilter}</button> : null}
          {branchFilter ? <button type="button" className="quiet" onClick={() => { const next = new URLSearchParams(params); next.delete("branch_id"); setParams(next); }}>Branch{scopeLabels.branch_id ? `: ${scopeLabels.branch_id}` : ""}</button> : null}
          {courseFilter ? <button type="button" className="quiet" onClick={() => { const next = new URLSearchParams(params); next.delete("course_id"); setParams(next); }}>Course{scopeLabels.course_id ? `: ${scopeLabels.course_id}` : ""}</button> : null}
          {batchFilter ? <button type="button" className="quiet" onClick={() => { const next = new URLSearchParams(params); next.delete("batch_id"); setParams(next); }}>Batch{scopeLabels.batch_id ? `: ${scopeLabels.batch_id}` : ""}</button> : null}
          <button type="button" className="quiet" onClick={() => setParams(new URLSearchParams())}>Clear</button>
        </p>
      ) : null}
      <p>A saved import stays in this list. You can delete an import that has not been saved.</p>
      {error && !open ? <p className="error" role="alert">{error}</p> : null}
      {history.length === 0 ? <p>{stateFilter === "failed" ? "No failed imports." : "No imports yet."}</p> : (
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
                  <td>{canUpload ? (
                    <div className="row-actions">
                      {item.marksheet_id ? <Link to={`/marksheets/${item.marksheet_id}`}>Open</Link> : (
                        <button type="button" onClick={() => api<Preview>(`/api/v1/imports/${item.id}`).then(showImport).catch((reason: Error) => setError(reason.message))}>{item.state === "committed" ? "View" : "Continue"}</button>
                      )}
                      {item.state === "committed" ? null : <button type="button" className="quiet" onClick={() => removeHistory(item)}>Delete</button>}
                    </div>
                  ) : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open ? (
        <div className="modal-backdrop">
          <div ref={dialogRef} className={preview && (step === 1 || step === 2 || step === 3 || step === 5) ? "modal sheet-view" : "modal"} role="dialog" aria-modal="true" aria-labelledby="import-title" tabIndex={-1}>
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
                <p>{examId ? "Upload a workbook with a name column and a mark column. Marks are saved for students already enrolled in this exam’s batches. A name that is not enrolled is left out." : "Upload the marklist workbook. Detect keeps a value found in the file. Existing or new applies one value to every sheet."}</p>
                {inheritedLabel && !examId ? <p>This import uses {inheritedLabel}. A workbook that names something else must be confirmed before it is saved.</p> : null}
                {examId ? null : (
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
                )}
                <form onSubmit={upload}>
                  <label>
                    Workbook
                    <input name="file" type="file" accept=".xlsx" required />
                  </label>
                  <button type="submit" disabled={pending}>{pending ? "Reading…" : "Upload and continue"}</button>
                </form>
                {examId ? null : (
                <details>
                  <summary>Enter marks for one batch</summary>
                  <p>Choose the batch, then paste marks from Excel or type them in the grid. The enrollment number is the row key.</p>
                  <div className="stack">
                    <label>Branch
                      <select aria-label="Branch" value={scope.branch_id} onChange={(event) => chooseScope("branch_id", event.target.value)}>
                        <option value="">Choose a branch</option>
                        {(scopeCatalog?.branches || []).filter((item) => !item.archived).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                    </label>
                    <label>Course
                      <select aria-label="Course" value={scope.course_id} disabled={!scope.branch_id} onChange={(event) => chooseScope("course_id", event.target.value)}>
                        <option value="">Choose a course</option>
                        {(scopeCatalog?.courses || []).filter((item) => !item.archived && scopeCatalog?.offerings.some((offering) => offering.branch_id === scope.branch_id && offering.course_id === item.id)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                    </label>
                    <label>Batch
                      <select aria-label="Batch" value={scope.batch_id} disabled={!scope.course_id} onChange={(event) => chooseScope("batch_id", event.target.value)}>
                        <option value="">Choose a batch</option>
                        {(scopeCatalog?.batches || []).filter((item) => !item.archived && !item.closed && item.branch_id === scope.branch_id && item.course_id === scope.course_id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                    </label>
                  </div>
                  {scope.batch_id ? (
                    <>
                      <div className="actions">
                        <button type="button" className="secondary" onClick={() => navigator.clipboard.readText().then(applyPaste).catch(() => setError("The clipboard could not be read. Paste into the grid instead."))}>Paste from Excel</button>
                      </div>
                      <p>Paste replaces the grid. Columns are enrollment number, name, and score. Type absent for a student who was not present. Leave a score blank to skip that student.</p>
                      <div className="table-wrap" onPaste={(event) => {
                        const text = event.clipboardData.getData("text");
                        if (text.includes("\t") || text.includes("\n")) {
                          event.preventDefault();
                          applyPaste(text);
                        }
                      }}>
                        <table className="sheet-grid">
                          <caption>Marks for this batch</caption>
                          <thead>
                            <tr>
                              <th className="col-letter" />
                              <th className="col-letter">A</th>
                              <th className="col-letter">B</th>
                              <th className="col-letter">C</th>
                            </tr>
                            <tr>
                              <th className="col-letter" />
                              <th>Enrollment number</th>
                              <th>Name</th>
                              <th>Score</th>
                            </tr>
                          </thead>
                          <tbody>
                            {grid.map((row, index) => (
                              <tr key={`${row.enrollment_code}-${index}`}>
                                <th className="row-no">{index + 1}</th>
                                <td><input aria-label={`Enrollment number ${index + 1}`} value={row.enrollment_code} onChange={(event) => setGrid((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, enrollment_code: event.target.value } : item))} /></td>
                                <td><input aria-label={`Name ${index + 1}`} value={row.name} onChange={(event) => setGrid((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} /></td>
                                <td><input aria-label={`Score ${index + 1}`} value={row.score} onChange={(event) => setGrid((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, score: event.target.value } : item))} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {grid.length === 0 ? <p>This batch has no current students. Paste rows to enter marks for enrollment numbers you already have.</p> : null}
                      <div className="stack">
                        <label>Title
                          <input aria-label="Marksheet title" value={scope.title} onChange={(event) => setScope((current) => ({ ...current, title: event.target.value }))} />
                        </label>
                        <label>Subject
                          <select aria-label="Subject" value={scope.subject_id} onChange={(event) => chooseScope("subject_id", event.target.value)}>
                            <option value="">Choose a subject</option>
                            {(scopeCatalog?.subjects || []).filter((item) => item.course_id === scope.course_id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                          </select>
                        </label>
                        <label>Paper
                          <select aria-label="Paper" value={scope.paper_id} onChange={(event) => chooseScope("paper_id", event.target.value)}>
                            <option value="">Choose a paper</option>
                            {(scopeCatalog?.papers || []).filter((item) => item.subject_id === scope.subject_id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                          </select>
                        </label>
                        <label>Exam type
                          <select aria-label="Exam type" value={scope.exam_type} onChange={(event) => setScope((current) => ({ ...current, exam_type: event.target.value }))}>
                            <option value="unit">Unit</option>
                            <option value="part">Part</option>
                            <option value="chapter">Chapter</option>
                          </select>
                        </label>
                        <label>Maximum
                          <input aria-label="Maximum" inputMode="decimal" value={scope.maximum} onChange={(event) => setScope((current) => ({ ...current, maximum: event.target.value }))} />
                        </label>
                      </div>
                      <button type="button" disabled={pending} onClick={() => void saveGrid()}>{pending ? "Saving…" : "Save marks"}</button>
                    </>
                  ) : null}
                </details>
                )}
              </>
            ) : null}

            {preview && step === 1 ? (
              <div className="excel-step">
                <p>{examId ? "Include the one sheet that belongs to this exam. The other sheets in the file are left out." : "Tick a sheet tab to include it. Included sheets are the only ones that will be saved."}</p>
                {examBlockers(preview)}
                <SourceGrid
                  sheets={preview.sheets}
                  activeId={activeSheet?.id || ""}
                  onSelect={setSheetId}
                  onToggle={(targetId, included) => patchSheet(targetId, { included, skip_reason: included ? "" : "Skipped during review." })}
                />
                <div className="actions">
                  <button type="button" className="text-button" onClick={() => setStep(0)}>Back</button>
                  <button type="button" onClick={() => setStep(2)} disabled={!preview.sheets.some((sheet) => sheet.included)}>Next</button>
                </div>
              </div>
            ) : null}

            {preview && step === 2 ? (
              <>
                <p>{examId ? "Each row needs a name and a mark. Names that are not enrolled in this exam’s batches are left out. Skip every extra mark column." : "The opening rows show what was read from the file. Branch, course, batch, subject, and paper at the top apply to every sheet. On a combined exam, a student already in one of the sheet’s batches keeps that batch. Otherwise choose from the batches written on the sheet."}</p>
                {examBlockers(preview)}
                <SheetGrid
                  lockContext={Boolean(examId)}
                  sheets={preview.sheets.filter((sheet) => sheet.included)}
                  activeId={activeSheet?.id || ""}
                  blockers={preview.blockers}
                  onSelect={setSheetId}
                  onHeading={(targetId) => patchSheet(targetId, { acknowledge_heading: true })}
                  onContextAck={(targetId) => patchSheet(targetId, { acknowledge_context: true })}
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
                {examBlockers(preview)}
                <SheetGrid
                  lockContext={Boolean(examId)}
                  sheets={preview.sheets.filter((sheet) => sheet.included)}
                  activeId={activeSheet.id}
                  blockers={preview.blockers}
                  onSelect={setSheetId}
                  onHeading={(targetId) => patchSheet(targetId, { acknowledge_heading: true })}
                  onContextAck={(targetId) => patchSheet(targetId, { acknowledge_context: true })}
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
                <p>{examId ? "Marks are written onto this exam. Students, admissions, and enrollments are not created. A published score changes only when you entered a reason." : "New rows become drafts. A published score changes only when you entered a reason. A score you keep stays as it is."}</p>
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
              <div className="excel-step">
                <h3>Import results</h3>
                {preview.summary ? <CountGrid counts={preview.summary.counts} /> : <p>{preview.state === "committed" ? "This import was saved before outcome counts were recorded." : "This import has not been committed."}</p>}
                <div className="excel">
                  <div className="table-wrap">
                    <table className="sheet-grid">
                      <caption>Imported sheets</caption>
                      <thead>
                        <tr>
                          <th className="col-letter" />
                          <th className="col-letter">A</th>
                          <th className="col-letter">B</th>
                          <th className="col-letter">C</th>
                        </tr>
                        <tr>
                          <th className="col-letter" />
                          <th>Sheet</th>
                          <th>Status</th>
                          <th>Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.outcomes.map((item, index) => (
                          <tr key={`${item.name}-${index}`}>
                            <th className="row-no">{index + 1}</th>
                            <td className="cell-text">{item.name}</td>
                            <td className="cell-text">{item.status === "committed" ? "Imported" : item.status === "skipped" ? "Skipped" : item.status === "failed" ? "Failed" : item.status}</td>
                            <td className="cell-text">{item.reason || ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                {preview.state === "committed" ? <p><a href={`/api/v1/imports/${preview.id}/outcome-report`}>Download outcome report</a></p> : null}
                <p><Link to="/marksheets">Review the draft marksheets</Link></p>
                <button type="button" onClick={closeWizard}>Close</button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SourceGrid({
  sheets,
  activeId,
  onSelect,
  onToggle,
}: {
  sheets: Sheet[];
  activeId: string;
  onSelect: (id: string) => void;
  onToggle: (id: string, included: boolean) => void;
}) {
  const sheet = sheets.find((item) => item.id === activeId) || sheets[0];
  if (!sheet) return null;
  const rows = sheet.rows || [];
  const width = Math.max(1, ...rows.map((row) => row.cells.length));
  return (
    <div className="excel">
      <div className="table-wrap">
        <table className="sheet-grid">
          <caption>{sheet.name}. Tick a sheet tab to include it.</caption>
          <thead>
            <tr>
              <th className="col-letter" />
              {Array.from({ length: width }, (_, index) => <th key={index} className="col-letter">{columnLetter(index)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.row} className={row.role === "header" ? "source-row" : undefined}>
                <th className="row-no">{row.row}</th>
                {Array.from({ length: width }, (_, index) => (
                  <td key={index} className="cell-text">{row.cells[index] || ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="sheet-tabs excel-tabs" role="tablist" aria-label="Sheets">
        {sheets.map((item) => (
          <span key={item.id} className={item.included ? "tab" : "tab excluded"}>
            <input type="checkbox" checked={item.included} aria-label={`Include ${item.name}`} onChange={(event) => onToggle(item.id, event.target.checked)} />
            <button type="button" role="tab" aria-selected={item.id === sheet.id} onClick={() => onSelect(item.id)}>{item.name}</button>
          </span>
        ))}
      </div>
    </div>
  );
}

function examBlockers(preview: Preview) {
  const notes = preview.blockers.filter((item) => item.code === "import.exam_sheet" || item.code === "import.exam_column");
  if (!notes.length) return null;
  return notes.map((item) => <p key={`${item.code}-${item.sheet_id || ""}`} className="error" role="alert">{item.message}</p>);
}

function SheetGrid({
  sheets,
  activeId,
  blockers,
  lockContext = false,
  onSelect,
  onHeading,
  onContextAck,
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
  lockContext?: boolean;
  onSelect: (id: string) => void;
  onHeading: (sheetId: string) => void;
  onContextAck: (sheetId: string) => void;
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
  const columns = (lockContext ? 1 : 2) + sheet.groups.length;
  const nextRow = Math.max(fileMax === Number.POSITIVE_INFINITY ? 0 : fileMax, ...rows.map((line) => line.row), 0) + 1;

  function sourceLine(item: { row: number; cells: string[]; role: string }) {
    return (
      <tr key={`source-${item.row}`} className="source-row">
        <th className="row-no">{item.row}</th>
        <td className="name">{item.cells.filter(Boolean).join("  ·  ")}</td>
        <td className="used" colSpan={(lockContext ? 0 : 1) + sheet.groups.length}>{ROW_ROLE[item.role] || "Not a student"}</td>
      </tr>
    );
  }

  function studentLine(line: { row: number; name: string; batch: string | null; enrolled: string[]; students: Map<string, Student> }) {
    const sample = line.students.values().next().value as Student | undefined;
    const codes = sample ? rowCodes(sheet, sample, blockers) : [];
    const batchBad = codes.includes("import.batch_unassigned");
    const nameBad = codes.includes("import.duplicate_row");
    const batchLabel = sheet.batches.find((batch) => batch.session_key === line.batch)?.label || "";
    const unmatched = [...line.students.entries()].some(([groupId, student]) => {
      const group = sheet.groups.find((item) => item.id === groupId);
      return student.change === "skip" && group?.interpretation !== "skip_duplicate";
    });
    return (
      <tr key={line.row}>
        <th className="row-no">{line.row}</th>
        <NameCell
          value={line.name}
          label={`Name for row ${line.row}`}
          bad={nameBad}
          title={nameBad ? blockers.find((item) => item.sheet_id === sheet.id && item.row === line.row && item.code === "import.duplicate_row")?.message : undefined}
          onCommit={(name) => onName(sheet.id, line.row, name)}
          extra={
            <>
              {lockContext && unmatched ? <span className="batch-note">Not enrolled</span> : null}
              {nameBad || sample?.added ? <button type="button" className="cell-link" onClick={() => onDrop(sheet.id, line.row)}>{nameBad ? "Drop" : "Remove"}</button> : null}
            </>
          }
        />
        {lockContext ? null : <td className={batchBad ? "batch bad" : "batch"} title={batchBad ? blockers.find((item) => item.sheet_id === sheet.id && item.row === line.row && item.code === "import.batch_unassigned")?.message : undefined}>
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
        </td>}
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
      {lockContext ? null : <ContextBar sheets={sheets} onCommit={onContext} />}
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
              {lockContext ? null : <th>Batch</th>}
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
                    ) : lockContext && sheet.groups.length === 1 ? "Mark" : group.maximum}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {!lockContext && blockers.some((item) => item.code === "import.context_conflict" && item.sheet_id === sheet.id) ? (
              <tr>
                <th className="row-no" />
                <td className="name">Context</td>
                <td className="bad" colSpan={1 + sheet.groups.length}>
                  <button type="button" className="cell-link" onClick={() => onContextAck(sheet.id)}>
                    This sheet does not match the selected branch, course, or batch. Use the selected context
                  </button>
                </td>
              </tr>
            ) : null}
            {!lockContext && sheet.heading_conflict && !sheet.heading_acknowledged ? (
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
        <div className="icon-actions">
          <button type="button" onClick={() => onAdd(sheet.id, nextRow)} aria-label="Add row" title="Add row"><Icon name="add" /></button>
        </div>
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
