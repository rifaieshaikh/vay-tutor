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
  performance: { percentage: number | null; scored: number; expected: number; missing: number; absent: number; label: string };
  subjects?: SubjectSummary[];
  retests: { title: string | null; original_percentage: number | null; latest_percentage: number | null; change: number | null; baseline_outside_period?: boolean }[];
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

function byDate(left: Result, right: Result) {
  return (left.exam_date || "9999-99-99").localeCompare(right.exam_date || "9999-99-99");
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
  const appliedKey = params.toString();
  const studentId = params.get("student") || "";
  const sort = reportSort(params.get("sort") || "");
  const page = Number(applied.page) || 1;
  const requestKey = [studentId, ...REPORT_FILTERS.map((key) => applied[key])].join("|");
  const listKey = ["list", applied.q, page, sort, ...REPORT_FILTERS.map((key) => applied[key])].join("|");
  const shown = card && loadedKey === requestKey ? card : null;

  useEffect(() => {
    setDraft(readApplied(params));
    setNotice("");
    setRangeError("");
  }, [appliedKey]);

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
    const search = new URLSearchParams();
    REPORT_FILTERS.forEach((key) => {
      if (applied[key]) search.set(key, applied[key]);
    });
    const suffix = search.toString();
    api<Card>(`/api/v1/students/${studentId}/card${suffix ? `?${suffix}` : ""}`)
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
      REPORT_FILTERS.forEach((key) => {
        if (applied[key]) scope[key] = applied[key];
      });
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
  const appliedRow = (
    <p className="filter-row">
      {active.length === 0 ? <span>All authorized</span> : active.map((key) => (
        <span key={key} className="chip">{FILTER_LABELS[key]}: {labelFor(key, applied[key])}</span>
      ))}
    </p>
  );

  if (studentId) {
    const results = shown?.results || [];
    const chronological = [...results].sort(byDate);
    const history = orderResults(results, sort);
    const latest = [...chronological].reverse().slice(0, 5);
    const attention = orderResults(results.filter((result) => result.band === "danger" || result.status === "missing" || result.status === "absent"), sort);
    const trend = chronological.filter((result) => result.status === "scored" && result.percentage != null);
    const returnTo = encodeURIComponent(`/cards?${params.toString()}`);
    const subjectName = (id?: string | null) => optionLabel("subject", id) || "Subject";
    const paperName = (id?: string | null) => optionLabel("paper", id) || "Paper";
    const empty = shown?.empty_reason ? EMPTY_REASONS[shown.empty_reason] || "Nothing matches this report." : "";
    const membership = (shown?.enrollments || [])
      .map((item) => [optionLabel("branch", item.branch_id), optionLabel("course", item.course_id), optionLabel("batch", item.batch_id)].filter(Boolean).join(" · "))
      .filter(Boolean);
    const period = applied.exam_date_from || applied.exam_date_to
      ? `${applied.exam_date_from ? formatDate(applied.exam_date_from) : "Any start"} – ${applied.exam_date_to ? formatDate(applied.exam_date_to) : "Any end"}`
      : "All dates";
    const subjectRows = [...(shown?.subjects || [])].sort((left, right) => {
      const label = subjectName(left.subject_id).localeCompare(subjectName(right.subject_id))
        || paperName(left.paper_id).localeCompare(paperName(right.paper_id));
      if (sort !== "percentage") return label;
      if (left.percentage == null && right.percentage == null) return label;
      if (left.percentage == null) return 1;
      if (right.percentage == null) return -1;
      return right.percentage - left.percentage || label;
    });
    return (
      <section className="panel wide print-card" aria-busy={loading}>
        <button type="button" className="quiet back-link" onClick={closeCard}>← Progress cards</button>
        <div className="title-row">
          <div>
            <h1>{shown?.display_name || (heading?.id === studentId ? heading.name : "Progress card")}</h1>
            {(shown || heading?.id === studentId) ? (
              <p className="meta">{shown?.student_code || heading?.code}{shown ? ` · policy ${shown.policy_version}` : ""}</p>
            ) : null}
            {shown && membership.length ? <p className="meta">{membership.join("; ")}</p> : null}
            {shown ? <p className="meta">Reporting period: {period}</p> : null}
          </div>
          <div className="actions">
            {filterButton}
            {canPdf ? <button type="button" className="text-button" onClick={() => exportCard("pdf")} disabled={exporting}>Export PDF</button> : null}
            {canSheet ? <button type="button" className="text-button" onClick={() => exportCard("xlsx")} disabled={exporting}>Export spreadsheet</button> : null}
            <button type="button" className="text-button" onClick={() => window.print()}>Print</button>
          </div>
        </div>
        {exportJob ? (
          <p className="meta" role="status">
            {exportJob.format === "pdf" ? "PDF" : "Spreadsheet"} export: {EXPORT_LABELS[exportJob.state]}.
            {exportJob.state === "ready" && exportJob.fileId ? <> <a href={`/api/v1/files/${exportJob.fileId}`}>Download</a></> : null}
            {exportJob.state === "failed" ? ` ${exportJob.error || "The export failed."}` : null}
          </p>
        ) : null}
        {filters}
        {appliedRow}
        {error ? <p className="error" role="alert">{error}</p> : null}
        {loading && !shown ? <p role="status">Loading this card…</p> : null}
        {shown && empty ? <p role="status">{empty}</p> : null}
        {shown && !empty ? (
          <>
            <p className="meta">{shown.result_count ?? results.length} published result{(shown.result_count ?? results.length) === 1 ? "" : "s"} in this report.</p>
            <div className="stat-line">
              <span><strong>{shown.performance.percentage == null ? "—" : `${formatPercent(shown.performance.percentage)}%`}</strong> Overall</span>
              <span><strong>{shown.performance.scored}</strong> of {shown.performance.expected} scored</span>
              <span><strong>{shown.performance.missing}</strong> Missing</span>
              <span><strong>{shown.performance.absent}</strong> Absent</span>
            </div>
            {shown.partial ? <p className="meta">{shown.coverage_note || "Authorized subjects only."} Rank stays hidden where this card does not include the whole cohort.</p> : null}
            <h2>Subjects and papers</h2>
            {subjectRows.length === 0 ? <p>No published subjects match these filters.</p> : (
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">Subject and paper summaries for {shown.display_name}.</caption>
                  <thead>
                    <tr>
                      <th aria-sort={sort === "name" ? "ascending" : "none"}><button type="button" className="sort" onClick={() => chooseSort("name")}>Subject</button></th>
                      <th>Paper</th>
                      <th aria-sort={sort === "percentage" ? "descending" : "none"}><button type="button" className="sort" onClick={() => chooseSort("percentage")}>%</button></th>
                      <th>Scored</th>
                      <th>Missing</th>
                      <th>Absent</th>
                      <th>Band</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subjectRows.map((subject) => (
                      <tr key={`${subject.subject_id || "subject"}-${subject.paper_id || "paper"}`}>
                        <td>{subjectName(subject.subject_id)}</td>
                        <td>{paperName(subject.paper_id)}</td>
                        <td>{formatPercent(subject.percentage)}</td>
                        <td>{subject.scored} of {subject.expected}</td>
                        <td>{subject.missing}</td>
                        <td>{subject.absent}</td>
                        <td>{subject.band ? <span className={`chip ${subject.band}`}>{BANDS[subject.band] || subject.band}</span> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <h2>Performance over time</h2>
            {trend.length === 0 ? <p>No scored exams in this view, so there is no trend yet.</p> : (
              <ul className="trend">
                {trend.map((result) => (
                  <li key={result.id}>
                    <span>{formatDate(result.exam_date)} · {result.title}</span>
                    <div className="bar" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, result.percentage || 0))}%` }} /></div>
                    <span>{formatPercent(result.percentage)}%</span>
                  </li>
                ))}
              </ul>
            )}
            <h2>Latest results</h2>
            {latest.length === 0 ? <p>No published exams match these filters.</p> : (
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">Latest results for {shown.display_name}.</caption>
                  <thead><tr><th>Assessment</th><th>Date</th><th>%</th><th>Band</th></tr></thead>
                  <tbody>
                    {latest.map((result) => (
                      <tr key={result.id}>
                        <td>{result.marksheet_id ? <Link to={`/marksheets/${result.marksheet_id}?returnTo=${returnTo}`}>{result.title}</Link> : result.title}</td>
                        <td>{formatDate(result.exam_date)}</td>
                        <td>{formatPercent(result.percentage)}</td>
                        <td>{result.band ? <span className={`chip ${result.band}`}>{BANDS[result.band] || result.band}</span> : result.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <h2>Needs attention</h2>
            {attention.length === 0 ? <p>Nothing in this view is below 40%, missing, or absent.</p> : (
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">Results that need attention for {shown.display_name}.</caption>
                  <thead><tr><th>Assessment</th><th>Status</th><th>%</th></tr></thead>
                  <tbody>
                    {attention.map((result) => (
                      <tr key={result.id}>
                        <td>{result.marksheet_id ? <Link to={`/marksheets/${result.marksheet_id}?returnTo=${returnTo}`}>{result.title}</Link> : result.title}</td>
                        <td>{result.band === "danger" ? "Danger" : result.status === "absent" ? "Absent" : "Missing"}</td>
                        <td>{formatPercent(result.percentage)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <h2>Original and retest</h2>
            {shown.retests.length === 0 ? <p>No published retest sits beside an original attempt in this view.</p> : (
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">Original and latest retest for {shown.display_name}.</caption>
                  <thead><tr><th>Assessment</th><th>Original</th><th>Latest</th><th>Change</th><th>Basis</th></tr></thead>
                  <tbody>
                    {shown.retests.map((item) => (
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
            )}
            <p className="meta">The latest published attempt inside this report is the one in the total. The original stays in this comparison.</p>
            <h2>Exam history</h2>
            {chronological.length === 0 ? <p>No published exams match these filters.</p> : (
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">Exam history for {shown.display_name}.</caption>
                  <thead>
                    <tr>
                      <th aria-sort={sort === "exam_date" ? "descending" : "none"}><button type="button" className="sort" onClick={() => chooseSort("exam_date")}>Date</button></th>
                      <th>Subject</th>
                      <th aria-sort={sort === "name" ? "ascending" : "none"}><button type="button" className="sort" onClick={() => chooseSort("name")}>Assessment</button></th>
                      <th>Attempt</th>
                      <th>Score</th>
                      <th aria-sort={sort === "percentage" ? "descending" : "none"}><button type="button" className="sort" onClick={() => chooseSort("percentage")}>%</button></th>
                      <th>Band</th>
                      <th>Rank</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((result) => (
                      <tr key={result.id}>
                        <td>{formatDate(result.exam_date)}</td>
                        <td>{subjectName(result.subject_id)}</td>
                        <td>{result.marksheet_id ? <Link to={`/marksheets/${result.marksheet_id}?returnTo=${returnTo}`}>{result.title}</Link> : result.title}</td>
                        <td>{result.attempt === "retest" ? "Retest" : "Original"}{result.included_in_total === false ? " · kept out" : ""}</td>
                        <td className="nowrap">{result.score ?? "—"} / {result.maximum ?? "—"}</td>
                        <td>{formatPercent(result.percentage)}</td>
                        <td>{result.band ? <span className={`chip ${result.band}`}>{BANDS[result.band] || result.band}</span> : result.status}</td>
                        <td>{result.rank ?? "—"}{result.batch_rank != null ? ` · batch ${result.batch_rank}` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
        {filterButton}
      </div>
      <p className="page-lead">Published results only. Open Filters, choose the report, then apply it. All authorized means every branch, course, batch, subject, or paper you can view.</p>
      {filters}
      {appliedRow}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {loading ? <p role="status">Loading students…</p> : null}
      {!loading && summary ? (
        <>
          <div className="stat-line">
            <span><strong>{summary.percentage == null ? "—" : `${formatPercent(summary.percentage)}%`}</strong> Overall</span>
            <span><strong>{summary.scored}</strong> of {summary.expected} scored</span>
            <span><strong>{summary.missing}</strong> Missing</span>
            <span><strong>{summary.absent}</strong> Absent</span>
          </div>
          <p className="meta">{summary.students} student{summary.students === 1 ? "" : "s"}. {summary.with_results} with published results in this report. The overall uses the same weighted total as a progress card.</p>
        </>
      ) : null}
      {!loading && total === 0 ? <p>No students match this report.</p> : null}
      {students.length > 0 ? (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">{total} student{total === 1 ? "" : "s"}. Page {page} of {pages}. Sorted by {sort === "percentage" ? "overall percentage" : sort === "exam_date" ? "latest exam" : "name"}.</caption>
            <thead>
              <tr>
                <th>ID</th>
                <th aria-sort={sort === "name" ? "ascending" : "none"}><button type="button" className="sort" onClick={() => chooseSort("name")}>Student</button></th>
                <th aria-sort={sort === "percentage" ? "descending" : "none"}><button type="button" className="sort" onClick={() => chooseSort("percentage")}>%</button></th>
                <th>Scored</th>
                <th>Missing</th>
                <th>Absent</th>
                <th>Band</th>
                <th aria-sort={sort === "exam_date" ? "descending" : "none"}><button type="button" className="sort" onClick={() => chooseSort("exam_date")}>Latest</button></th>
              </tr>
            </thead>
            <tbody>
              {students.map((student) => {
                const unpublished = student.empty_reason === "unpublished";
                const performance = student.performance;
                return (
                  <tr key={student.id}>
                    <td>{student.student_code}</td>
                    <td><button type="button" className="quiet" onClick={() => open(student)}>{student.display_name}</button></td>
                    <td>{unpublished ? "No published results" : performance?.percentage == null ? "—" : formatPercent(performance.percentage)}</td>
                    <td>{unpublished || !performance ? "—" : `${performance.scored} of ${performance.expected}`}</td>
                    <td>{unpublished || !performance ? "—" : performance.missing}</td>
                    <td>{unpublished || !performance ? "—" : performance.absent}</td>
                    <td>{performance?.band ? <span className={`chip ${performance.band}`}>{BANDS[performance.band]}</span> : "—"}</td>
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
