import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, Session } from "../api";
import { CONTEXT_FIELDS, Option, clearDescendants, clearIncompatible, optionFits } from "../filters";

type Performance = {
  percentage: number | null;
  scored: number;
  expected: number;
  missing: number;
  absent: number;
  band: string | null;
};
type Student = {
  id: string;
  student_code: string;
  display_name: string;
  performance?: Performance;
  latest_exam_date?: string | null;
  empty_reason?: string | null;
};
type ReportSummary = Performance & { students: number; with_results: number };
type Result = {
  id: string;
  title: string | null;
  subject_id?: string | null;
  paper_id?: string | null;
  batch_id?: string | null;
  assessment_id?: string | null;
  status: string;
  score: number | null;
  maximum: number | null;
  percentage: number | null;
  band: string | null;
  rank: number | null;
  batch_rank: number | null;
  exam_date: string | null;
  attempt: string;
  marksheet_id?: string | null;
  included_in_total?: boolean;
};
type SubjectSummary = {
  subject_id: string | null;
  paper_id?: string | null;
  percentage: number | null;
  scored: number;
  expected: number;
  missing: number;
  absent: number;
  band: string | null;
};
type Card = {
  student_code: string;
  display_name: string;
  partial: boolean;
  coverage_note: string | null;
  empty_reason: string | null;
  policy_version: number;
  result_count?: number;
  enrollments?: { branch_id?: string | null; course_id?: string | null; batch_id?: string | null }[];
  performance: { percentage: number | null; scored: number; expected: number; missing: number; absent: number; label: string; band?: string | null };
  subjects?: SubjectSummary[];
  retests: { title: string | null; original_percentage: number | null; latest_percentage: number | null; change: number | null; baseline_outside_period?: boolean; batch_id?: string | null }[];
  results: Result[];
};
type ExportJob = { format: "pdf" | "xlsx"; state: "queued" | "running" | "ready" | "failed"; fileId?: string | null; error?: string };

const REPORT_FILTERS = ["branch_id", "course_id", "batch_id", "subject_id", "paper_id", "exam_type", "exam_date_from", "exam_date_to", "attempt"] as const;
const FILTER_LABELS: Record<string, string> = {
  q: "Student",
  branch_id: "Branch",
  course_id: "Course",
  batch_id: "Batch",
  subject_id: "Subject",
  paper_id: "Paper",
  exam_type: "Exam type",
  exam_date_from: "From",
  exam_date_to: "To",
  attempt: "Attempt",
};
const DIMENSIONS: Record<string, string> = {
  branch_id: "branch",
  course_id: "course",
  batch_id: "batch",
  subject_id: "subject",
  paper_id: "paper",
  exam_type: "exam_type",
};
const EMPTY_REASONS: Record<string, string> = {
  enrollment: "This student is not enrolled in the selected branch, course, or batch.",
  filters: "No published results match these filters.",
  unpublished: "No published results yet. Drafts stay off this card.",
  restricted: "No authorized results are available for this student.",
};
const BANDS: Record<string, string> = { danger: "Danger", "fifty-fifty": "Fifty-fifty", safe: "Safe" };
const EXPORT_LABELS = { queued: "Queued", running: "Running", ready: "Ready", failed: "Failed" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDate(value: string | null) {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  const label = MONTHS[Number(month) - 1];
  return label && day && year ? `${Number(day)} ${label} ${year}` : value;
}

function formatPercent(value: number | null) {
  return value == null ? "—" : value.toFixed(2);
}

function reportSort(value: string) {
  return value === "percentage" || value === "exam_date" ? value : "name";
}

function orderResults(rows: Result[], sort: string) {
  return [...rows].sort((left, right) => {
    const title = (left.title || "").localeCompare(right.title || "");
    if (sort === "percentage") {
      if (left.percentage == null && right.percentage == null) return title;
      if (left.percentage == null) return 1;
      if (right.percentage == null) return -1;
      return right.percentage - left.percentage || title;
    }
    if (sort === "exam_date") {
      if (!left.exam_date && !right.exam_date) return title;
      if (!left.exam_date) return 1;
      if (!right.exam_date) return -1;
      return right.exam_date.localeCompare(left.exam_date) || title;
    }
    return title || (left.exam_date || "").localeCompare(right.exam_date || "");
  });
}

function latestAttempts(rows: Result[]) {
  const groups = new Map<string, Result[]>();
  for (const row of rows) {
    if (row.included_in_total === false) continue;
    const key = row.assessment_id || row.id;
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  return [...groups.values()].map((items) => {
    const dated = items.filter((item) => item.exam_date);
    const pool = (dated.length ? dated : items).slice().sort((left, right) => (left.exam_date || "").localeCompare(right.exam_date || ""));
    return pool[pool.length - 1];
  });
}

function tally(rows: Result[]) {
  const chosen = latestAttempts(rows);
  const scored = chosen.filter((row) => row.status === "scored" && row.score != null && row.maximum);
  const missing = chosen.filter((row) => row.status === "missing").length;
  const absent = chosen.filter((row) => row.status === "absent").length;
  const obtained = scored.reduce((sum, row) => sum + Number(row.score), 0);
  const maximum = scored.reduce((sum, row) => sum + Number(row.maximum), 0);
  const exact = maximum ? (obtained / maximum) * 100 : null;
  return {
    percentage: exact == null ? null : Math.round((exact + Number.EPSILON) * 100) / 100,
    band: exact == null ? null : exact < 40 ? "danger" : exact > 60 ? "safe" : "fifty-fifty",
    scored: scored.length,
    expected: scored.length + missing + absent,
    missing,
    absent,
  };
}

function subjectsFrom(rows: Result[]): SubjectSummary[] {
  const groups = new Map<string, Result[]>();
  for (const row of rows) {
    const key = `${row.subject_id || ""}|${row.paper_id || ""}`;
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  return [...groups.entries()].map(([key, group]) => {
    const [subjectId, paperId] = key.split("|");
    return { subject_id: subjectId || null, paper_id: paperId || null, ...tally(group) };
  });
}

function ScoreBar({ percentage, band }: { percentage: number | null; band: string | null }) {
  return (
    <div className="comparison-score">
      <strong>{percentage == null ? "—" : `${formatPercent(percentage)}%`}</strong>
      <span className={`bar ${band || ""}`} aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, percentage ?? 0))}%` }} /></span>
    </div>
  );
}

function readApplied(params: URLSearchParams) {
  return Object.fromEntries(["q", "page", ...REPORT_FILTERS].map((key) => [key, params.get(key) || ""]));
}

function periodError(from: string, to: string) {
  if (from && to && from > to) return "The start date must be on or before the end date.";
  return "";
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = panelRef.current;
    function focusable() {
      if (!node) return [];
      return [...node.querySelectorAll<HTMLElement>("button, [href], input, select, textarea")].filter((item) => !item.hasAttribute("disabled"));
    }
    const fields = focusable();
    (fields.find((item) => item.matches("input, select, textarea")) || fields[0] || node)?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
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
      previous?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={panelRef} className="modal compact" role="dialog" aria-modal="true" aria-labelledby="report-filters-title" tabIndex={-1}>
        <div className="modal-head">
          <h2 id="report-filters-title">{title}</h2>
          <button type="button" className="text-button" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ReportFilters({
  draft,
  options,
  notice,
  rangeError,
  dirty,
  showSearch,
  onChange,
  onApply,
  onReset,
}: {
  draft: Record<string, string>;
  options: Record<string, Option[]>;
  notice: string;
  rangeError: string;
  dirty: boolean;
  showSearch: boolean;
  onChange: (key: string, value: string) => void;
  onApply: () => void;
  onReset: () => void;
}) {
  return (
    <form className="report-filters" onSubmit={(event: FormEvent) => { event.preventDefault(); onApply(); }}>
      <div className="form-grid">
        {showSearch ? (
          <label className="span-2">
            Student
            <input value={draft.q || ""} onChange={(event) => onChange("q", event.target.value)} placeholder="Name or student id" />
          </label>
        ) : null}
        {CONTEXT_FIELDS.map(([key, label, dimension]) => (
          <label key={key}>
            {label}
            <select value={draft[key] || ""} onChange={(event) => onChange(key, event.target.value)}>
              <option value="">All authorized</option>
              {(options[dimension] || []).filter((option) => optionFits(option, draft)).map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>
        ))}
        <label>
          Exam type
          <select value={draft.exam_type || ""} onChange={(event) => onChange("exam_type", event.target.value)}>
            <option value="">All authorized</option>
            {(options.exam_type || []).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label>
          Attempt
          <select value={draft.attempt || ""} onChange={(event) => onChange("attempt", event.target.value)}>
            <option value="">All authorized</option>
            <option value="original">Original</option>
            <option value="retest">Retest</option>
          </select>
        </label>
        <label>From<input type="date" value={draft.exam_date_from || ""} onChange={(event) => onChange("exam_date_from", event.target.value)} /></label>
        <label>To<input type="date" value={draft.exam_date_to || ""} onChange={(event) => onChange("exam_date_to", event.target.value)} /></label>
      </div>
      {notice ? <p className="ok" role="status">{notice}</p> : null}
      {rangeError ? <p className="error" role="alert">{rangeError}</p> : null}
      {dirty ? <p className="meta">Choices change when you apply them.</p> : null}
      <div className="dialog-actions">
        <button type="button" className="text-button" onClick={onReset}>Reset</button>
        <button type="submit">Apply</button>
      </div>
    </form>
  );
}

export function CardsPage({ session }: { session: Session }) {
  const [params, setParams] = useSearchParams();
  const applied = readApplied(params);
  const [draft, setDraft] = useState(applied);
  const [notice, setNotice] = useState("");
  const [rangeError, setRangeError] = useState("");
  const [options, setOptions] = useState<Record<string, Option[]>>({});
  const [students, setStudents] = useState<Student[]>([]);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [card, setCard] = useState<Card | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [heading, setHeading] = useState<{ id: string; name: string; code: string } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [exportJob, setExportJob] = useState<ExportJob | null>(null);
  const [exporting, setExporting] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [panel, setPanel] = useState("subjects");
  const [subjectSort, setSubjectSort] = useState("name");
  const [examSort, setExamSort] = useState("exam_date");
  const [batchPick, setBatchPick] = useState("");
  const appliedKey = params.toString();
  const studentId = params.get("student") || "";
  const sort = reportSort(params.get("sort") || "");
  const page = Number(applied.page) || 1;
  const requestKey = studentId;
  const listKey = ["list", applied.q, page, sort, ...REPORT_FILTERS.map((key) => applied[key])].join("|");
  const shown = card && loadedKey === requestKey ? card : null;

  useEffect(() => {
    setDraft(readApplied(params));
    setNotice("");
    setRangeError("");
  }, [appliedKey]);

  useEffect(() => {
    setPanel("subjects");
    setSubjectSort("name");
    setExamSort("exam_date");
    setBatchPick("");
  }, [studentId]);

  useEffect(() => {
    Promise.all(
      ["branch", "course", "batch", "subject", "paper", "exam_type"].map(async (dimension) => {
        const pageOptions = await api<{ items: Option[] }>(`/api/v1/context/options?dimension=${dimension}`);
        return [dimension, pageOptions.items] as const;
      }),
    ).then((pairs) => setOptions(Object.fromEntries(pairs))).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (studentId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setStudents([]);
    setSummary(null);
    setTotal(0);
    const search = new URLSearchParams();
    if (applied.q) search.set("q", applied.q);
    REPORT_FILTERS.forEach((key) => {
      if (applied[key]) search.set(key, applied[key]);
    });
    if (sort !== "name") search.set("sort", sort);
    search.set("page", String(page));
    search.set("page_size", "8");
    api<{ items: Student[]; total: number; pages: number; summary: ReportSummary }>(`/api/v1/students?${search.toString()}`)
      .then((result) => {
        if (cancelled) return;
        setStudents(result.items);
        setSummary(result.summary);
        setTotal(result.total);
        setPages(result.pages);
      })
      .catch((reason: Error) => {
        if (cancelled) return;
        setStudents([]);
        setSummary(null);
        setTotal(0);
        setError(reason.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [listKey, studentId]);

  useEffect(() => {
    if (!studentId) {
      setCard(null);
      setLoadedKey("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    api<Card>(`/api/v1/students/${studentId}/card`)
      .then((data) => {
        if (cancelled) return;
        setCard(data);
        setLoadedKey(requestKey);
        setHeading({ id: studentId, name: data.display_name, code: data.student_code });
      })
      .catch((reason: Error) => {
        if (cancelled) return;
        setCard(null);
        setError(reason.message);
        setLoadedKey(requestKey);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey]);

  function optionLabel(dimension: string, id?: string | null) {
    if (!id) return "";
    return options[dimension]?.find((option) => option.id === id)?.label || "";
  }

  function labelFor(key: string, value: string) {
    if (key === "attempt") return value === "retest" ? "Retest" : "Original";
    if (key === "exam_date_from" || key === "exam_date_to") return formatDate(value);
    const dimension = DIMENSIONS[key];
    return (dimension && optionLabel(dimension, value)) || value;
  }

  function write(next: URLSearchParams) {
    setParams(next);
  }

  function editDraft(key: string, value: string) {
    const merged = { ...draft, [key]: value };
    const fitted = clearIncompatible(merged, options, key);
    const opened = value ? { filters: fitted.filters, cleared: [] as string[] } : clearDescendants(fitted.filters, key);
    const cleared = [...fitted.cleared, ...opened.cleared];
    setDraft(value ? fitted.filters : opened.filters);
    setRangeError("");
    const labels = cleared.map((field) => FILTER_LABELS[field] || field).join(", ");
    setNotice(labels ? (value ? `${labels} cleared because it does not belong with that choice.` : `${labels} cleared because All authorized includes each of them.`) : "");
  }

  function openFilters() {
    setDraft(readApplied(params));
    setNotice("");
    setRangeError("");
    setFiltersOpen(true);
  }

  function closeFilters() {
    setDraft(readApplied(params));
    setNotice("");
    setRangeError("");
    setFiltersOpen(false);
  }

  function applyDraft() {
    const problem = periodError(draft.exam_date_from || "", draft.exam_date_to || "");
    if (problem) {
      setRangeError(problem);
      return;
    }
    const next = new URLSearchParams();
    if (studentId) next.set("student", studentId);
    if (draft.q) next.set("q", draft.q);
    REPORT_FILTERS.forEach((key) => {
      if (draft[key]) next.set(key, draft[key]);
    });
    if (sort !== "name") next.set("sort", sort);
    setFiltersOpen(false);
    write(next);
  }

  function resetFilters() {
    const next = new URLSearchParams();
    if (studentId) next.set("student", studentId);
    setFiltersOpen(false);
    write(next);
  }

  function open(student: Student) {
    const next = new URLSearchParams(params);
    next.set("student", student.id);
    write(next);
  }

  function closeCard() {
    const next = new URLSearchParams(params);
    next.delete("student");
    setCard(null);
    setLoadedKey("");
    write(next);
  }

  function removeFilter(key: string) {
    const opened = clearDescendants({ ...applied, [key]: "" }, key);
    const next = new URLSearchParams();
    if (studentId) next.set("student", studentId);
    if (key !== "q" && applied.q) next.set("q", applied.q);
    REPORT_FILTERS.forEach((field) => {
      if (opened.filters[field]) next.set(field, opened.filters[field]);
    });
    if (sort !== "name") next.set("sort", sort);
    write(next);
  }

  function chooseSort(value: string) {
    const next = new URLSearchParams(params);
    if (value === "name") next.delete("sort");
    else next.set("sort", value);
    next.delete("page");
    write(next);
  }

  function setPage(nextPage: number) {
    const next = new URLSearchParams(params);
    if (nextPage <= 1) next.delete("page");
    else next.set("page", String(nextPage));
    write(next);
  }

  async function exportCard(format: "pdf" | "xlsx") {
    if (!studentId || exporting) return;
    setExporting(true);
    setError("");
    setExportJob({ format, state: "queued" });
    try {
      const scope: Record<string, string> = { student_id: studentId };
      if (card) {
        const memberships = (card.enrollments || []).filter((item) => item.batch_id);
        const ordered = [...memberships].sort((left, right) => (optionLabel("batch", left.batch_id) || "").localeCompare(optionLabel("batch", right.batch_id) || ""));
        if (ordered.length > 1) {
          const selected = ordered.some((item) => item.batch_id === batchPick) ? batchPick : ordered[0].batch_id;
          if (selected) scope.batch_id = selected;
        }
      }
      const job = await api<{ id: string }>("/api/v1/reports/cards", {
        method: "POST",
        body: JSON.stringify({ format, scope }),
      });
      setExportJob({ format, state: "running" });
      const finished = await api<{ state: string; file_id: string | null; last_error: string | null }>(`/api/v1/jobs/${job.id}/run`, { method: "POST" });
      if (finished.state === "succeeded" && finished.file_id) {
        setExportJob({ format, state: "ready", fileId: finished.file_id });
        return;
      }
      setExportJob({ format, state: "failed", error: finished.last_error || "The export failed." });
    } catch (reason) {
      setExportJob({ format, state: "failed", error: reason instanceof Error ? reason.message : "The export failed." });
    } finally {
      setExporting(false);
    }
  }

  const active = ["q", ...REPORT_FILTERS].filter((key) => applied[key] && key !== "page");
  const draftComparable = Object.fromEntries(["q", ...REPORT_FILTERS].map((key) => [key, draft[key] || ""]));
  const appliedComparable = Object.fromEntries(["q", ...REPORT_FILTERS].map((key) => [key, applied[key] || ""]));
  const dirty = JSON.stringify(draftComparable) !== JSON.stringify(appliedComparable);
  const canPdf = session.actions.includes("export.pdf");
  const canSheet = session.actions.includes("export.xlsx");
  const rangeFrom = total === 0 ? 0 : (page - 1) * 8 + 1;
  const rangeTo = Math.min(total, (page - 1) * 8 + students.length);

  const filterButton = (
    <button type="button" className="filters-toggle" onClick={openFilters}>Filters{active.length ? ` (${active.length})` : ""}</button>
  );
  const filters = filtersOpen ? (
    <Dialog title="Report filters" onClose={closeFilters}>
      <ReportFilters
        draft={draft}
        options={options}
        notice={notice}
        rangeError={rangeError}
        dirty={dirty}
        showSearch={!studentId}
        onChange={editDraft}
        onApply={applyDraft}
        onReset={resetFilters}
      />
    </Dialog>
  ) : null;
  const appliedFilters = (
    <>
      {active.length === 0 ? <span>All authorized</span> : active.map((key) => (
        <button key={key} type="button" className="chip-button" onClick={() => removeFilter(key)}>{FILTER_LABELS[key]}: {labelFor(key, applied[key])}</button>
      ))}
      {active.length ? <button type="button" className="text-button" onClick={resetFilters}>Clear filters</button> : null}
      {filterButton}
    </>
  );

  if (studentId) {
    const allResults = shown?.results || [];
    const memberships = (shown?.enrollments || []).filter((item) => item.batch_id);
    const orderedMemberships = [...memberships].sort((left, right) => (optionLabel("batch", left.batch_id) || "").localeCompare(optionLabel("batch", right.batch_id) || ""));
    const selectedBatch = orderedMemberships.some((item) => item.batch_id === batchPick) ? batchPick : (orderedMemberships[0]?.batch_id || "");
    const splitBatch = orderedMemberships.length > 1;
    const results = splitBatch ? allResults.filter((item) => item.batch_id === selectedBatch) : allResults;
    const performance = shown ? (splitBatch ? tally(results) : shown.performance) : null;
    const history = orderResults(results, examSort);
    const danger = [...results].filter((result) => result.band === "danger").sort((left, right) => (left.percentage ?? 0) - (right.percentage ?? 0) || (left.title || "").localeCompare(right.title || ""));
    const gaps = results.filter((result) => result.status === "missing" || result.status === "absent");
    const returnTo = encodeURIComponent(`/cards?${params.toString()}`);
    const subjectName = (id?: string | null) => optionLabel("subject", id) || "Subject";
    const paperName = (id?: string | null) => optionLabel("paper", id) || "Paper";
    const empty = shown?.empty_reason ? EMPTY_REASONS[shown.empty_reason] || "Nothing matches this report." : "";
    const selectedEnrollment = orderedMemberships.find((item) => item.batch_id === selectedBatch) || orderedMemberships[0];
    const branchName = optionLabel("branch", selectedEnrollment?.branch_id);
    const courseName = optionLabel("course", selectedEnrollment?.course_id);
    const batchName = optionLabel("batch", selectedEnrollment?.batch_id);
    const studentName = shown?.display_name || (heading?.id === studentId ? heading.name : "");
    const studentCode = shown?.student_code || (heading?.id === studentId ? heading?.code : "");
    const photoInitials = studentName.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("");
    const retests = (shown?.retests || []).filter((item) => !splitBatch || item.batch_id === selectedBatch);
    const subjectRows = [...(splitBatch ? subjectsFrom(results) : (shown?.subjects || []))].sort((left, right) => {
      const label = subjectName(left.subject_id).localeCompare(subjectName(right.subject_id))
        || paperName(left.paper_id).localeCompare(paperName(right.paper_id));
      if (subjectSort !== "percentage") return label;
      if (left.percentage == null && right.percentage == null) return label;
      if (left.percentage == null) return 1;
      if (right.percentage == null) return -1;
      return right.percentage - left.percentage || label;
    });
    return (
      <section className="panel wide print-card" aria-busy={loading}>
        <button type="button" className="quiet back-link" onClick={closeCard}>← Progress cards</button>
        <div className="card-head">
          <div className="student-photo" role="img" aria-label={studentName ? `Photo space for ${studentName}` : "Student photo"}>{photoInitials}</div>
          <div className="card-person">
            <h1>{studentName || "Progress card"}</h1>
            <dl className="card-identity">
              {studentCode ? <div><dt>Student code</dt><dd>{studentCode}</dd></div> : null}
              {branchName ? <div><dt>Branch</dt><dd>{branchName}</dd></div> : null}
              {courseName ? <div><dt>Course</dt><dd>{courseName}</dd></div> : null}
              {splitBatch ? (
                <div>
                  <dt>Batch</dt>
                  <dd>
                    <select aria-label="Batch" value={selectedBatch} onChange={(event) => setBatchPick(event.target.value)}>
                      {orderedMemberships.map((item) => <option key={item.batch_id} value={item.batch_id || ""}>{optionLabel("batch", item.batch_id) || "Batch"}</option>)}
                    </select>
                  </dd>
                </div>
              ) : batchName ? <div><dt>Batch</dt><dd>{batchName}</dd></div> : null}
            </dl>
          </div>
          <div className="actions card-actions">
            {canPdf ? <button type="button" onClick={() => exportCard("pdf")} disabled={exporting}>PDF</button> : null}
            {canSheet ? <button type="button" onClick={() => exportCard("xlsx")} disabled={exporting}>Spreadsheet</button> : null}
            <button type="button" onClick={() => window.print()}>Print</button>
            {session.actions.includes("student.lookup") ? <Link to={`/students?student=${studentId}`}>View student</Link> : null}
          </div>
        </div>
        <p className="print-context">{[`Student code ${studentCode}`, branchName ? `Branch ${branchName}` : "", courseName ? `Course ${courseName}` : "", batchName ? `Batch ${batchName}` : ""].filter(Boolean).join(". ")}</p>
        {exportJob ? (
          <p className="meta" role="status">
            {exportJob.format === "pdf" ? "PDF" : "Spreadsheet"} export: {EXPORT_LABELS[exportJob.state]}.
            {exportJob.state === "ready" && exportJob.fileId ? <> <a href={`/api/v1/files/${exportJob.fileId}`}>Download</a></> : null}
            {exportJob.state === "failed" ? ` ${exportJob.error || "The export failed."}` : null}
          </p>
        ) : null}
        {error ? <p className="error" role="alert">{error}</p> : null}
        {loading && !shown ? <p role="status">Loading this card…</p> : null}
        {shown && empty ? <p role="status">{empty}</p> : null}
        {shown && !empty ? (
          <>
            <div className="academic-stats">
              <div><span>Weighted performance</span><strong>{performance?.percentage == null ? "—" : `${formatPercent(performance.percentage)}%`}</strong>{performance?.band ? <span className={`chip ${performance.band}`}>{BANDS[performance.band]}</span> : <small>Scored marks ÷ corresponding maxima</small>}</div>
              <div><span>Scored results</span><strong>{performance?.scored ?? 0}<small> / {performance?.expected ?? 0}</small></strong><small>Latest published attempt in this report</small></div>
              <div><span>Missing</span><strong>{performance?.missing ?? 0}</strong><small>No mark entered</small></div>
              <div><span>Absent</span><strong>{performance?.absent ?? 0}</strong><small>Marked absent</small></div>
            </div>
            {shown.partial ? <p className="meta">{shown.coverage_note || "Authorized subjects only."} Rank stays hidden where this card does not include the whole cohort.</p> : null}
            <nav className="page-tabs academic-panels" aria-label="Progress card">
              {([["subjects", "Subjects"], ["exams", "Exams"], ["attention", "Needs attention"]] as const).map(([id, label]) => (
                <button key={id} type="button" aria-selected={panel === id} onClick={() => setPanel(id)}>{label}</button>
              ))}
            </nav>
            <div className={panel === "subjects" ? "card-panel" : "card-panel is-hidden"}>
            <h2 className="sr-only">Subjects and papers</h2>
            {subjectRows.length === 0 ? <p>No published subjects match these filters.</p> : (
              <div className="table-wrap">
                <table className="people-table">
                  <caption className="sr-only">Subject and paper summaries for {shown.display_name}.</caption>
                  <thead>
                    <tr>
                      <th aria-sort={subjectSort === "name" ? "ascending" : "none"}><button type="button" className="sort" onClick={() => setSubjectSort("name")}>Subject</button></th>
                      <th>Paper</th>
                      <th aria-sort={subjectSort === "percentage" ? "descending" : "none"}><button type="button" className="sort" onClick={() => setSubjectSort("percentage")}>Performance</button></th>
                      <th>Results</th>
                      <th>Band</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subjectRows.map((subject) => (
                      <tr key={`${subject.subject_id || "subject"}-${subject.paper_id || "paper"}`}>
                        <td>{subjectName(subject.subject_id)}</td>
                        <td>{paperName(subject.paper_id)}</td>
                        <td><ScoreBar percentage={subject.percentage} band={subject.band} /></td>
                        <td className="nowrap">{subject.scored} of {subject.expected}</td>
                        <td>{subject.band ? <span className={`chip ${subject.band}`}>{BANDS[subject.band] || subject.band}</span> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            </div>
            <div className={panel === "attention" ? "card-panel" : "card-panel is-hidden"}>
            <h2 className="sr-only">Needs attention</h2>
            {danger.length === 0 && gaps.length === 0 ? <p>Nothing in this view is below 40%, missing, or absent.</p> : null}
            {danger.length === 0 && gaps.length > 0 ? <p>No scored results in this view fall in the danger band.</p> : null}
            {danger.length > 0 ? (
              <div className="table-wrap">
                <table className="people-table">
                  <caption className="sr-only">Results below 40% for {shown.display_name}.</caption>
                  <thead><tr><th className="place">#</th><th>Student</th><th>Performance</th><th>Results</th><th>Band</th></tr></thead>
                  <tbody>
                    {danger.map((result, index) => (
                      <tr key={result.id}>
                        <td className="place">{index + 1}</td>
                        <td><div className="student-cell"><span>{shown.display_name}</span><span className="meta">{shown.student_code}</span></div></td>
                        <td><ScoreBar percentage={result.percentage} band={result.band} /></td>
                        <td>
                          <div className="student-cell">
                            <span className="nowrap">{result.score ?? "—"} of {result.maximum ?? "—"}</span>
                            {result.marksheet_id ? <Link className="result-line" to={`/marksheets/${result.marksheet_id}?returnTo=${returnTo}`}>{result.title}</Link> : <span className="meta">{result.title}</span>}
                          </div>
                        </td>
                        <td>{result.band ? <span className={`chip ${result.band}`}>{BANDS[result.band]}</span> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {gaps.length > 0 ? (
              <div className="table-wrap">
                <table className="people-table">
                  <caption className="sr-only">Missing and absent results for {shown.display_name}.</caption>
                  <thead><tr><th>Assessment</th><th>Status</th></tr></thead>
                  <tbody>
                    {gaps.map((result) => (
                      <tr key={result.id}>
                        <td>{result.marksheet_id ? <Link to={`/marksheets/${result.marksheet_id}?returnTo=${returnTo}`}>{result.title}</Link> : result.title}</td>
                        <td>{result.status === "absent" ? "Absent" : "Missing"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            </div>
            <div className={panel === "exams" ? "card-panel" : "card-panel is-hidden"}>
            <h2 className="sr-only">Exams</h2>
            {history.length === 0 ? <p>No published exams match these filters.</p> : (
              <div className="table-wrap">
                <table className="people-table">
                  <caption className="sr-only">Exam history for {shown.display_name}.</caption>
                  <thead>
                    <tr>
                      <th aria-sort={examSort === "exam_date" ? "descending" : "none"}><button type="button" className="sort" onClick={() => setExamSort("exam_date")}>Date</button></th>
                      <th aria-sort={examSort === "name" ? "ascending" : "none"}><button type="button" className="sort" onClick={() => setExamSort("name")}>Assessment</button></th>
                      <th aria-sort={examSort === "percentage" ? "descending" : "none"}><button type="button" className="sort" onClick={() => setExamSort("percentage")}>Performance</button></th>
                      <th>Results</th>
                      <th>Band</th>
                      <th>Rank</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((result) => (
                      <tr key={result.id}>
                        <td className="nowrap">{formatDate(result.exam_date)}</td>
                        <td>
                          <div className="student-cell">
                            {result.marksheet_id ? <Link to={`/marksheets/${result.marksheet_id}?returnTo=${returnTo}`}>{result.title}</Link> : <span>{result.title}</span>}
                            <span className="meta">{subjectName(result.subject_id)}{result.attempt === "retest" ? " · Retest" : ""}{result.included_in_total === false ? " · kept out" : ""}</span>
                          </div>
                        </td>
                        <td><ScoreBar percentage={result.percentage} band={result.band} /></td>
                        <td className="nowrap">{result.score ?? "—"} of {result.maximum ?? "—"}</td>
                        <td>{result.band ? <span className={`chip ${result.band}`}>{BANDS[result.band] || result.band}</span> : result.status}</td>
                        <td>{result.rank ?? "—"}{result.batch_rank != null ? ` · batch ${result.batch_rank}` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {retests.length > 0 ? (
              <div className="table-wrap">
                <table className="people-table">
                  <caption>Original and retest</caption>
                  <thead><tr><th>Assessment</th><th>Original</th><th>Latest</th><th>Change</th><th>Basis</th></tr></thead>
                  <tbody>
                    {retests.map((item) => (
                      <tr key={item.title}>
                        <td>{item.title}</td>
                        <td>{formatPercent(item.original_percentage)}%</td>
                        <td>{formatPercent(item.latest_percentage)}%</td>
                        <td>{item.change == null ? "—" : `${item.change > 0 ? "+" : ""}${item.change}`}</td>
                        <td>{item.baseline_outside_period ? "Original is outside this period and is not in the total" : "Both attempts are in this report"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            </div>
          </>
        ) : null}
      </section>
    );
  }

  return (
    <section className="panel wide">
      <div className="page-title">
        <div>
          <p className="eyebrow">Students</p>
          <h1>Progress cards</h1>
        </div>
        <div className="actions">{appliedFilters}</div>
      </div>
      {filters}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {loading ? <p role="status">Loading students…</p> : null}
      {!loading && summary ? (
        <div className="academic-stats">
          <div><span>Weighted performance</span><strong>{summary.percentage == null ? "—" : `${formatPercent(summary.percentage)}%`}</strong>{summary.band ? <span className={`chip ${summary.band}`}>{BANDS[summary.band]}</span> : <small>Scored marks ÷ corresponding maxima</small>}</div>
          <div><span>Students</span><strong>{summary.students}</strong><small>{summary.with_results} with published results</small></div>
          <div><span>Scored results</span><strong>{summary.scored}<small> / {summary.expected}</small></strong><small>Latest published attempt in this report</small></div>
          <div><span>Incomplete results</span><strong>{summary.missing + summary.absent}</strong><small>{summary.missing} missing · {summary.absent} absent</small></div>
        </div>
      ) : null}
      {!loading && total === 0 ? <p>No students match this report.</p> : null}
      {students.length > 0 ? (
        <div className="table-wrap">
          <table className="people-table">
            <caption className="sr-only">{total} student{total === 1 ? "" : "s"}. Page {page} of {pages}. Sorted by {sort === "percentage" ? "overall percentage" : sort === "exam_date" ? "latest exam" : "name"}.</caption>
            <thead>
              <tr>
                <th aria-sort={sort === "name" ? "ascending" : "none"}><button type="button" className="sort" onClick={() => chooseSort("name")}>Student</button></th>
                <th aria-sort={sort === "percentage" ? "descending" : "none"}><button type="button" className="sort" onClick={() => chooseSort("percentage")}>Performance</button></th>
                <th>Results</th>
                <th>Band</th>
                <th aria-sort={sort === "exam_date" ? "descending" : "none"}><button type="button" className="sort" onClick={() => chooseSort("exam_date")}>Latest</button></th>
              </tr>
            </thead>
            <tbody>
              {students.map((student) => {
                const unpublished = student.empty_reason === "unpublished";
                const row = student.performance;
                return (
                  <tr key={student.id}>
                    <td>
                      <div className="student-cell">
                        <button type="button" className="quiet" onClick={() => open(student)}>{student.display_name}</button>
                        <span className="meta">{student.student_code}</span>
                      </div>
                    </td>
                    <td>{unpublished ? "No published results" : <ScoreBar percentage={row?.percentage ?? null} band={row?.band ?? null} />}</td>
                    <td className="nowrap">{unpublished || !row ? "—" : `${row.scored} of ${row.expected}`}</td>
                    <td>{row?.band ? <span className={`chip ${row.band}`}>{BANDS[row.band]}</span> : "—"}</td>
                    <td>{formatDate(student.latest_exam_date || null)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="pager">
        <button type="button" className="quiet" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
        <span>{rangeFrom}–{rangeTo} of {total}</span>
        <button type="button" className="quiet" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
      </p>
    </section>
  );
}
