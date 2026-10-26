import { ReactNode, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, Session } from "../api";
import { studentRecordHref } from "../students";
import { ExamType, useExamTypes } from "../academics/kinds";
import { Band, BandMark, bandClass, bandStyle } from "../bands";
import { Option } from "../filters";
import { moveTab } from "../ui";

type Performance = {
  percentage: number | null;
  scored: number;
  expected: number;
  missing: number;
  absent: number;
  band: string | null;
  band_name?: string | null;
  band_place?: string | null;
  band_color?: string | null;
};
type EnrollmentCard = {
  id?: string;
  batch_id?: string | null;
  branch_id?: string | null;
  course_id?: string | null;
  batch_name?: string;
  performance?: Performance;
  latest_exam_date?: string | null;
  empty_reason?: string | null;
};
type Student = {
  id: string;
  student_code: string;
  display_name: string;
  performance?: Performance;
  latest_exam_date?: string | null;
  empty_reason?: string | null;
  enrollments?: EnrollmentCard[];
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
  band_name?: string | null;
  band_place?: string | null;
  band_color?: string | null;
  rank: number | null;
  batch_rank: number | null;
  top_score: number | null;
  batch_top_score: number | null;
  exam_date: string | null;
  attempt: string;
  exam_kind?: string;
  part_key?: string;
  part_label?: string;
  part_items?: { key: string; label: string }[];
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
  band_name?: string | null;
  band_place?: string | null;
  band_color?: string | null;
};
type Card = {
  student_code: string;
  display_name: string;
  photo_id?: string | null;
  partial: boolean;
  coverage_note: string | null;
  empty_reason: string | null;
  policy_version: number;
  bands?: Band[];
  result_count?: number;
  enrollments?: { branch_id?: string | null; course_id?: string | null; batch_id?: string | null }[];
  performance: { percentage: number | null; scored: number; expected: number; missing: number; absent: number; label: string; band?: string | null; band_name?: string | null; band_place?: string | null; band_color?: string | null };
  subjects?: SubjectSummary[];
  retests: { title: string | null; original_percentage: number | null; latest_percentage: number | null; change: number | null; baseline_outside_period?: boolean; batch_id?: string | null; exam_kind?: string }[];
  results: Result[];
};
type ExportJob = { format: "pdf" | "xlsx"; state: "queued" | "running" | "ready" | "failed"; fileId?: string | null; filename?: string | null; error?: string };

const ENROLLMENT_KEYS = ["branch_id", "course_id", "batch_id"] as const;
const EMPTY_REASONS: Record<string, string> = {
  enrollment: "This student is not enrolled in the selected branch, course, or batch.",
  filters: "No published results match these filters.",
  unpublished: "No published results yet. Drafts stay off this card.",
  restricted: "No authorized results are available for this student.",
};
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

function formatMark(score: number | null, maximum: number | null) {
  if (score == null) return "—";
  return `${score} of ${maximum ?? "—"}`;
}

function progressFileStem(name: string, code: string, batch: string) {
  const stem = [name, code, batch, "progress card"].map((part) => part.trim()).filter(Boolean).join(" ");
  return stem.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Progress card";
}

function reportSort(value: string) {
  return value === "percentage" || value === "exam_date" ? value : "name";
}

function examTabs(rows: Result[], types: ExamType[]) {
  const weight = new Map(types.map((item) => [item.key, item.weight ?? 99]));
  const label = new Map(types.map((item) => [item.key, item.label]));
  const heading = new Map(types.map((item) => [item.key, (item.part_heading || "Part").trim() || "Part"]));
  const keys = [...new Set(rows.map((row) => row.exam_kind || "").filter(Boolean))];
  keys.sort((left, right) => (weight.get(left) ?? 99) - (weight.get(right) ?? 99) || (label.get(left) || left).localeCompare(label.get(right) || right));
  const tabs = keys.map((key) => ({ key, label: label.get(key) || key, partHeading: heading.get(key) || "Part" }));
  if (rows.some((row) => !row.exam_kind)) tabs.push({ key: "", label: "Exam", partHeading: "Part" });
  return tabs;
}

function examPanelId(key: string) {
  return `kind:${key}`;
}

function partKey(row: Result) {
  return row.part_key || `${row.subject_id || ""}|${row.paper_id || "subject"}`;
}

function partLabel(row: Result, paper: (id?: string | null) => string) {
  if (row.part_label) return row.part_label;
  if (row.paper_id) return paper(row.paper_id);
  return "Whole subject";
}

function examLines(rows: Result[], kind: string, subjectName: (id?: string | null) => string, paperName: (id?: string | null) => string) {
  const lines: { result: Result; partKey: string; partLabel: string; subjectId: string }[] = [];
  for (const result of rows) {
    if ((result.exam_kind || "") !== kind) continue;
    const items = result.part_items?.length ? result.part_items : [{ key: partKey(result), label: partLabel(result, paperName) }];
    for (const item of items) lines.push({ result, partKey: item.key, partLabel: item.label, subjectId: result.subject_id || "" });
  }
  return lines.sort((left, right) => (
    subjectName(left.subjectId).localeCompare(subjectName(right.subjectId))
    || (left.result.exam_date || "").localeCompare(right.result.exam_date || "")
    || (left.result.title || "").localeCompare(right.result.title || "")
    || left.result.id.localeCompare(right.result.id)
    || (left.partLabel === "Whole subject" ? 0 : 1) - (right.partLabel === "Whole subject" ? 0 : 1)
    || left.partLabel.localeCompare(right.partLabel)
  ));
}

function resultMark(result: Result) {
  if (result.status === "absent") return "Absent";
  if (result.status === "missing") return "Missing";
  if (result.status === "exempt") return "Exempt";
  if (result.score == null) return "—";
  return `${result.score} of ${result.maximum ?? "—"}`;
}

function ScoreBar({ percentage, band, place, color }: { percentage: number | null; band: string | null; place?: string | null; color?: string | null }) {
  if (percentage == null) return <strong>—</strong>;
  return (
    <div className="comparison-score">
      <strong>{formatPercent(percentage)}%</strong>
      <span className={`bar ${bandClass(band, place, color)}`} style={bandStyle(color)} aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, percentage))}%` }} /></span>
    </div>
  );
}

function studentsReturn(value: string | null) {
  if (!value || !value.startsWith("/students") || value.startsWith("//") || value.includes("://") || value.includes("\\")) return "";
  return value;
}

function readApplied(params: URLSearchParams) {
  return { q: params.get("q") || "", page: params.get("page") || "" };
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

export function CardsPage({ session }: { session: Session }) {
  const [params, setParams] = useSearchParams();
  const applied = readApplied(params);
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
  const [query, setQuery] = useState(applied.q);
  const [optionsError, setOptionsError] = useState("");
  const [optionsAttempt, setOptionsAttempt] = useState(0);
  const [panel, setPanel] = useState("subjects");
  const examTypes = useExamTypes();
  const [photoFailed, setPhotoFailed] = useState(false);
  const studentId = params.get("student") || "";
  const sort = reportSort(params.get("sort") || "");
  const page = Number(applied.page) || 1;
  const listReturn = studentsReturn(params.get("returnTo"));
  const reportScope = new URLSearchParams();
  for (const key of ENROLLMENT_KEYS) {
    const value = params.get(key);
    if (value) reportScope.set(key, value);
  }
  const requestKey = `${studentId}?${reportScope.toString()}`;
  const listKey = ["list", applied.q, page, sort].join("|");
  const shown = card && loadedKey === requestKey ? card : null;
  const cardPending = Boolean(studentId) && loadedKey !== requestKey;

  useEffect(() => {
    setQuery(applied.q);
  }, [applied.q]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const trimmed = query.trim();
      if (trimmed === applied.q) return;
      const next = new URLSearchParams(params);
      next.delete("page");
      next.delete("student");
      if (trimmed) next.set("q", trimmed);
      else next.delete("q");
      setParams(next);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [query, applied.q, params, setParams]);

  useEffect(() => {
    setPanel("subjects");
  }, [studentId]);

  useEffect(() => {
    setPhotoFailed(false);
  }, [studentId, card?.photo_id]);

  useEffect(() => {
    Promise.all(
      ["branch", "course", "batch", "subject", "paper"].map(async (dimension) => {
        const pageOptions = await api<{ items: Option[] }>(`/api/v1/context/options?dimension=${dimension}`);
        return [dimension, pageOptions.items] as const;
      }),
    ).then((pairs) => {
      setOptions(Object.fromEntries(pairs));
      setOptionsError("");
    }).catch((reason: Error) => {
      setOptionsError(reason.message || "Names could not be loaded.");
    });
  }, [optionsAttempt]);

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
    const suffix = reportScope.toString();
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

  useEffect(() => {
    if (!studentId || !card || loadedKey !== requestKey || params.get("batch_id")) return;
    const memberships = (card.enrollments || []).filter((item) => item.batch_id);
    const chosen = memberships[0];
    if (!chosen?.batch_id) return;
    const next = new URLSearchParams(params);
    next.set("batch_id", chosen.batch_id);
    if (chosen.branch_id) next.set("branch_id", chosen.branch_id);
    if (chosen.course_id) next.set("course_id", chosen.course_id);
    setParams(next, { replace: true });
  }, [studentId, card, loadedKey, requestKey, params, setParams]);

  function optionLabel(dimension: string, id?: string | null) {
    if (!id) return "";
    return options[dimension]?.find((option) => option.id === id)?.label || "";
  }

  function write(next: URLSearchParams) {
    setParams(next);
  }

  function commitSearch() {
    const trimmed = query.trim();
    if (trimmed === applied.q) return;
    const next = new URLSearchParams(params);
    next.delete("page");
    next.delete("student");
    if (trimmed) next.set("q", trimmed);
    else next.delete("q");
    write(next);
  }

  function open(student: Student, enrollment: EnrollmentCard) {
    const next = new URLSearchParams(params);
    next.set("student", student.id);
    if (enrollment.batch_id) next.set("batch_id", enrollment.batch_id);
    if (enrollment.branch_id) next.set("branch_id", enrollment.branch_id);
    if (enrollment.course_id) next.set("course_id", enrollment.course_id);
    write(next);
  }

  function closeCard() {
    const next = new URLSearchParams(params);
    next.delete("student");
    for (const key of ENROLLMENT_KEYS) next.delete(key);
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
      reportScope.forEach((value, key) => {
        scope[key] = value;
      });
      const job = await api<{ id: string }>("/api/v1/reports/cards", {
        method: "POST",
        body: JSON.stringify({ format, scope }),
      });
      setExportJob({ format, state: "running" });
      const finished = await api<{ state: string; file_id: string | null; last_error: string | null; filename?: string | null }>(`/api/v1/jobs/${job.id}/run`, { method: "POST" });
      if (finished.state === "succeeded" && finished.file_id) {
        setExportJob({ format, state: "ready", fileId: finished.file_id, filename: finished.filename });
        return;
      }
      setExportJob({ format, state: "failed", error: finished.last_error || "The export failed." });
    } catch (reason) {
      setExportJob({ format, state: "failed", error: reason instanceof Error ? reason.message : "The export failed." });
    } finally {
      setExporting(false);
    }
  }

  const canPdf = session.actions.includes("export.pdf");
  const canSheet = session.actions.includes("export.xlsx");
  const rangeFrom = total === 0 ? 0 : (page - 1) * 8 + 1;
  const rangeTo = Math.min(total, (page - 1) * 8 + students.length);

  if (studentId) {
    const allResults = shown?.results || [];
    const memberships = (shown?.enrollments || []).filter((item) => item.batch_id);
    const orderedMemberships = [...memberships].sort((left, right) => (optionLabel("batch", left.batch_id) || "").localeCompare(optionLabel("batch", right.batch_id) || ""));
    const requestedBatch = params.get("batch_id") || "";
    const selectedBatch = orderedMemberships.some((item) => item.batch_id === requestedBatch) ? requestedBatch : "";
    const results = selectedBatch ? allResults.filter((item) => item.batch_id === selectedBatch) : [];
    const performance = shown && selectedBatch ? shown.performance : null;
    const danger = [...results].filter((result) => result.band_place === "low" || (result.band_place == null && result.band === "danger")).sort((left, right) => (left.percentage ?? 0) - (right.percentage ?? 0) || (left.title || "").localeCompare(right.title || ""));
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
    const photoId = shown?.photo_id || "";
    const retests = (shown?.retests || []).filter((item) => !selectedBatch || item.batch_id === selectedBatch);
    function printCard() {
      const previous = document.title;
      document.title = progressFileStem(studentName, studentCode || "", batchName);
      window.print();
      document.title = previous;
    }
    const typeTabs = examTabs(results, examTypes);
    const cardTabs = [...typeTabs.map((tab) => examPanelId(tab.key)), "attention"];
    const activePanel = cardTabs.includes(panel) ? panel : (typeTabs[0] ? examPanelId(typeTabs[0].key) : "attention");
    return (
      <section className="panel wide print-card" aria-busy={loading}>
        {listReturn ? <Link className="quiet back-link" to={listReturn}>← Students</Link> : <button type="button" className="quiet back-link" onClick={closeCard}>← Progress cards</button>}
        {optionsError ? <p className="error" role="alert">{optionsError} <button type="button" className="quiet" onClick={() => setOptionsAttempt((value) => value + 1)}>Try again</button></p> : null}
        <div className="card-head">
          <div className="student-photo" role="img" aria-label={photoId && !photoFailed ? `Photo of ${studentName}` : (studentName ? `Photo space for ${studentName}` : "Student photo")}>
            {photoId && !photoFailed ? <img src={`/api/v1/students/${studentId}/photo?v=${photoId}`} alt="" onError={() => setPhotoFailed(true)} /> : photoInitials}
          </div>
          <div className="card-person">
            <p className="print-kicker">Progress card</p>
            <h1>{studentName || "Progress card"}</h1>
            <dl className="card-identity">
              {studentCode ? <div><dt>Student code</dt><dd>{studentCode}</dd></div> : null}
              {branchName ? <div><dt>Branch</dt><dd>{branchName}</dd></div> : null}
              {courseName ? <div><dt>Course</dt><dd>{courseName}</dd></div> : null}
              {orderedMemberships.length > 1 ? (
                <div>
                  <dt>Batch</dt>
                  <dd>
                    <select className="no-print" aria-label="Batch" value={selectedBatch} onChange={(event) => {
                      const next = new URLSearchParams(params);
                      const chosen = orderedMemberships.find((item) => item.batch_id === event.target.value);
                      next.set("batch_id", event.target.value);
                      if (chosen?.branch_id) next.set("branch_id", chosen.branch_id);
                      if (chosen?.course_id) next.set("course_id", chosen.course_id);
                      write(next);
                    }}>
                      {orderedMemberships.map((item) => <option key={item.batch_id} value={item.batch_id || ""}>{optionLabel("batch", item.batch_id) || "Batch"}</option>)}
                    </select>
                    <span className="print-only">{batchName || "Batch"}</span>
                  </dd>
                </div>
              ) : batchName ? <div><dt>Batch</dt><dd>{batchName}</dd></div> : null}
            </dl>
          </div>
          <div className="actions card-actions">
            {canPdf ? <button type="button" onClick={() => exportCard("pdf")} disabled={exporting}>PDF</button> : null}
            {canSheet ? <button type="button" onClick={() => exportCard("xlsx")} disabled={exporting}>Spreadsheet</button> : null}
            <button type="button" onClick={printCard}>Print</button>
            {session.actions.includes("student.lookup") ? <Link to={studentRecordHref(studentId, listReturn || "/students", { q: "", branch_id: selectedEnrollment?.branch_id || "", course_id: selectedEnrollment?.course_id || "", batch_id: selectedEnrollment?.batch_id || "" })}>View student</Link> : null}
          </div>
        </div>
        <p className="print-context">{[`Student code ${studentCode}`, branchName ? `Branch ${branchName}` : "", courseName ? `Course ${courseName}` : "", batchName ? `Batch ${batchName}` : ""].filter(Boolean).join(". ")}</p>
        {exportJob ? (
          <Dialog title={exportJob.format === "pdf" ? "PDF progress card" : "Spreadsheet progress card"} onClose={() => setExportJob(null)}>
            {exportJob.state === "queued" || exportJob.state === "running" ? <p role="status">Preparing the progress card…</p> : null}
            {exportJob.state === "ready" ? (
              <>
                <p>{studentName ? `${studentName}'s progress card is ready.` : "The progress card is ready."}</p>
                {exportJob.filename ? <p className="export-file">{exportJob.filename}</p> : null}
                <div className="dialog-actions">
                  <button type="button" className="text-button" onClick={() => setExportJob(null)}>Close</button>
                  {exportJob.fileId ? <a className="button" href={`/api/v1/files/${exportJob.fileId}`}>Download</a> : null}
                </div>
              </>
            ) : null}
            {exportJob.state === "failed" ? (
              <>
                <p className="error" role="alert">{exportJob.error || "The export failed."}</p>
                <div className="dialog-actions">
                  <button type="button" onClick={() => setExportJob(null)}>Close</button>
                </div>
              </>
            ) : null}
          </Dialog>
        ) : null}
        {error ? <p className="error" role="alert">{error}</p> : null}
        {cardPending ? <p role="status">Loading this card…</p> : null}
        {shown && empty ? <p role="status">{empty}</p> : null}
        {shown && !empty ? (
          <>
            <div className="academic-stats">
              <div><span>Weighted performance</span><strong>{performance?.percentage == null ? "—" : `${formatPercent(performance.percentage)}%`}</strong>{performance?.band ? <BandMark band={performance.band} name={performance.band_name} place={performance.band_place} color={performance.band_color} /> : <small>Scored marks ÷ corresponding maxima</small>}</div>
              <div><span>Scored results</span><strong>{performance?.scored ?? 0}<small> / {performance?.expected ?? 0}</small></strong><small>Latest published attempt in this report</small></div>
              <div><span>Missing</span><strong>{performance?.missing ?? 0}</strong><small>No mark entered</small></div>
              <div><span>Absent</span><strong>{performance?.absent ?? 0}</strong><small>Marked absent</small></div>
            </div>
            {shown.partial ? <p className="meta">{shown.coverage_note || "Authorized subjects only."} Rank and the top mark stay hidden where this card does not include the whole cohort.</p> : null}
            <nav className="page-tabs academic-panels" role="tablist" aria-label="Progress card" onKeyDown={(event) => moveTab(event, cardTabs, activePanel, setPanel)}>
              {typeTabs.map((tab) => (
                <button key={examPanelId(tab.key)} type="button" role="tab" aria-selected={activePanel === examPanelId(tab.key)} onClick={() => setPanel(examPanelId(tab.key))}>{tab.label}</button>
              ))}
              <button type="button" role="tab" aria-selected={activePanel === "attention"} onClick={() => setPanel("attention")}>Needs attention</button>
            </nav>
            {typeTabs.map((tab) => {
              const lines = examLines(results, tab.key, subjectName, paperName);
              const subjectSpans = new Map<string, number>();
              const examSpans = new Map<string, number>();
              for (const line of lines) {
                subjectSpans.set(line.subjectId, (subjectSpans.get(line.subjectId) || 0) + 1);
                examSpans.set(line.result.id, (examSpans.get(line.result.id) || 0) + 1);
              }
              const seenSubjects = new Set<string>();
              const seenExams = new Set<string>();
              const typeRetests = retests.filter((item) => (item.exam_kind || "") === tab.key);
              return (
                <div key={examPanelId(tab.key)} className={activePanel === examPanelId(tab.key) ? "card-panel" : "card-panel is-hidden"}>
                  <h2 className="sr-only">{tab.label}</h2>
                  {lines.length === 0 ? <p>No published subjects on this enrollment.</p> : (
                    <div className="table-wrap">
                      <table className="people-table">
                        <caption className="sr-only">{tab.label} results for {shown.display_name}.</caption>
                        <thead>
                          <tr>
                            <th>Subject</th>
                            <th>{tab.partHeading}</th>
                            <th>Mark</th>
                            <th>Percentage</th>
                            <th>Band</th>
                            <th>Batch Rank</th>
                            <th>Exam Rank</th>
                            <th>Exam Top Mark</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lines.map((line) => {
                            const firstSubject = !seenSubjects.has(line.subjectId);
                            if (firstSubject) seenSubjects.add(line.subjectId);
                            const firstExam = !seenExams.has(line.result.id);
                            if (firstExam) seenExams.add(line.result.id);
                            const result = line.result;
                            const examSpan = examSpans.get(result.id) || 1;
                            return (
                              <tr key={`${result.id}-${line.partKey}`}>
                                {firstSubject ? <td rowSpan={subjectSpans.get(line.subjectId) || 1}>{subjectName(line.subjectId)}</td> : null}
                                <td>
                                  {result.marksheet_id ? (
                                    <Link to={`/marksheets/${result.marksheet_id}?returnTo=${returnTo}`} aria-label={`${line.partLabel}, ${result.title}`}>{line.partLabel}</Link>
                                  ) : line.partLabel}
                                </td>
                                {firstExam ? (
                                  <>
                                    <td rowSpan={examSpan}>
                                      <div className="student-cell">
                                        <span className="nowrap">{resultMark(result)}</span>
                                        {result.attempt === "retest" ? <span className="meta">Retest</span> : null}
                                        {result.included_in_total === false ? <span className="meta">Kept out of the total</span> : null}
                                      </div>
                                    </td>
                                    <td rowSpan={examSpan}><ScoreBar percentage={result.percentage} band={result.band} place={result.band_place} color={result.band_color} /></td>
                                    <td rowSpan={examSpan}>{result.band ? <BandMark band={result.band} name={result.band_name} place={result.band_place} color={result.band_color} /> : resultMark(result)}</td>
                                    <td rowSpan={examSpan}>{result.batch_rank ?? result.rank ?? "—"}</td>
                                    <td rowSpan={examSpan}>{result.rank ?? "—"}</td>
                                    <td rowSpan={examSpan} className="nowrap">{formatMark(result.top_score, result.maximum)}</td>
                                  </>
                                ) : null}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {typeRetests.length > 0 ? (
                    <div className="table-wrap">
                      <table className="people-table">
                        <caption>Original and retest</caption>
                        <thead><tr><th>Assessment</th><th>Original</th><th>Latest</th><th>Change</th><th>Basis</th></tr></thead>
                        <tbody>
                          {typeRetests.map((item) => (
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
              );
            })}
            <div className={activePanel === "attention" ? "card-panel" : "card-panel is-hidden"}>
            <h2 className="sr-only">Needs attention</h2>
            {danger.length === 0 && gaps.length === 0 ? <p>Nothing in this view is in the lowest band, missing, or absent.</p> : null}
            {danger.length === 0 && gaps.length > 0 ? <p>No scored results in this view fall in the lowest band.</p> : null}
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
                        <td><ScoreBar percentage={result.percentage} band={result.band} place={result.band_place} color={result.band_color} /></td>
                        <td>
                          <div className="student-cell">
                            <span className="nowrap">{result.score ?? "—"} of {result.maximum ?? "—"}</span>
                            {result.marksheet_id ? <Link className="result-line" to={`/marksheets/${result.marksheet_id}?returnTo=${returnTo}`}>{result.title}</Link> : <span className="meta">{result.title}</span>}
                          </div>
                        </td>
                        <td><BandMark band={result.band} name={result.band_name} place={result.band_place} color={result.band_color} /></td>
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
      </div>
      <div className="toolbar common">
        <label>Search
          <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitSearch(); } }} placeholder="Name or student id" />
        </label>
      </div>
      <p className="filter-row">
        <span role="status">{loading ? "Loading students…" : `${total} student${total === 1 ? "" : "s"}`}</span>
      </p>
      {optionsError ? <p className="error" role="alert">{optionsError} <button type="button" className="quiet" onClick={() => setOptionsAttempt((value) => value + 1)}>Try again</button></p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {!loading && summary ? (
        <div className="academic-stats">
          <div><span>Weighted performance</span><strong>{summary.percentage == null ? "—" : `${formatPercent(summary.percentage)}%`}</strong>{summary.band ? <BandMark band={summary.band} name={summary.band_name} place={summary.band_place} color={summary.band_color} /> : <small>Scored marks ÷ corresponding maxima</small>}</div>
          <div><span>Students</span><strong>{summary.students}</strong><small>{summary.with_results} with published results</small></div>
          <div><span>Scored results</span><strong>{summary.scored}<small> / {summary.expected}</small></strong><small>Latest published attempt in this report</small></div>
          <div><span>Incomplete results</span><strong>{summary.missing + summary.absent}</strong><small>{summary.missing} missing · {summary.absent} absent</small></div>
        </div>
      ) : null}
      {!loading && total === 0 ? <p>{applied.q ? "No students match that search." : "No students yet."}</p> : null}
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
                <th>Batch</th>
                <th aria-sort={sort === "exam_date" ? "descending" : "none"}><button type="button" className="sort" onClick={() => chooseSort("exam_date")}>Latest</button></th>
              </tr>
            </thead>
            <tbody>
              {students.flatMap((student) => (student.enrollments || []).filter((enrollment) => enrollment.batch_id).map((enrollment) => {
                const unpublished = enrollment.empty_reason === "unpublished";
                const row = enrollment.performance;
                return (
                  <tr key={`${student.id}:${enrollment.batch_id}`}>
                    <td>
                      <div className="student-cell">
                        <button type="button" className="quiet" onClick={() => open(student, enrollment)}>{student.display_name}</button>
                        <span className="meta">{student.student_code}</span>
                      </div>
                    </td>
                    <td>{unpublished ? "No published results" : <ScoreBar percentage={row?.percentage ?? null} band={row?.band ?? null} place={row?.band_place} color={row?.band_color} />}</td>
                    <td className="nowrap">{unpublished || !row ? "—" : `${row.scored} of ${row.expected}`}</td>
                    <td><BandMark band={row?.band} name={row?.band_name} place={row?.band_place} color={row?.band_color} /></td>
                    <td>{enrollment.batch_name || optionLabel("batch", enrollment.batch_id) || "Batch"}</td>
                    <td>{formatDate(enrollment.latest_exam_date || null)}</td>
                  </tr>
                );
              }))}
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
