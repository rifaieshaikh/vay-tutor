import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { CONTEXT_FIELDS, Option, clearDescendants, clearIncompatible, optionFits } from "../filters";

type Section = { id: string; label: string; students: number; results: number; percentage: number | null; band: string | null; coverage: string; missing?: number; absent?: number; marksheet_ids?: string[] };
type Standing = {
  student_id: string;
  student_name?: string;
  student_code?: string;
  percentage: number | null;
  band: string | null;
  scored: number;
  expected: number;
};
type Board = {
  id: string;
  label: string;
  top_students: Standing[];
  top_student_count: number;
  attention: Attention[];
  attention_result_count: number;
  attention_student_count: number;
  attention_page?: number;
  attention_pages?: number;
};
type Attention = {
  id: string;
  student_id?: string | null;
  student_name?: string;
  student_code?: string;
  title: string | null;
  score: number | null;
  maximum: number | null;
  percentage: number | null;
  band: string;
  marksheet_id?: string | null;
};
type View = {
  level: string;
  policy_version?: number;
  policy_label?: string;
  students: number;
  enrollments: number;
  roster_confirmed: boolean;
  pending_recalculation: boolean;
  empty: boolean;
  performance: {
    percentage: number | null;
    participation: number | null;
    participation_scored?: number;
    participation_expected?: number;
    participation_basis?: string;
    missing: number;
    absent: number;
    scored?: number;
    expected?: number;
  };
  sections: Section[];
  top_students?: Standing[];
  top_student_count?: number;
  boards?: Board[];
  attention: Attention[];
  attention_count?: number;
  attention_result_count?: number;
  attention_student_count?: number;
  attention_sample_count?: number;
  attention_page?: number;
  attention_pages?: number;
};

const LEVELS = ["institute", "branch", "course", "batch", "subject", "paper"] as const;
const LEVEL_LABELS: Record<string, string> = {
  institute: "Institute",
  branch: "Branch",
  course: "Course",
  batch: "Batch",
  subject: "Subject",
  paper: "Paper",
};
const SECTION_HEADINGS: Record<string, string> = {
  institute: "Branches",
  branch: "Courses",
  course: "Batches",
  batch: "Subjects",
  subject: "Papers",
  paper: "Assessments",
};
const FILTERS = [
  ["branch_id", "Branch", "branch"],
  ["course_id", "Course", "course"],
  ["batch_id", "Batch", "batch"],
  ["subject_id", "Subject", "subject"],
  ["paper_id", "Paper", "paper"],
  ["exam_type", "Exam type", "exam_type"],
] as const;
const FILTER_KEYS = ["branch_id", "course_id", "batch_id", "subject_id", "paper_id", "exam_type", "attempt", "exam_date_from", "exam_date_to"] as const;
const CRUMBS: { level: (typeof LEVELS)[number]; field: string; dimension: string }[] = [
  { level: "branch", field: "branch_id", dimension: "branch" },
  { level: "course", field: "course_id", dimension: "course" },
  { level: "batch", field: "batch_id", dimension: "batch" },
  { level: "subject", field: "subject_id", dimension: "subject" },
  { level: "paper", field: "paper_id", dimension: "paper" },
];
const DRILL: Record<string, [string, string]> = {
  institute: ["branch", "branch_id"],
  branch: ["course", "course_id"],
  course: ["batch", "batch_id"],
  batch: ["subject", "subject_id"],
  subject: ["paper", "paper_id"],
};
const CHILD: Record<string, string> = { institute: "branch", branch: "course", course: "batch", batch: "subject", subject: "paper", paper: "assessment" };
const BANDS: Record<string, string> = { danger: "Danger", "fifty-fifty": "Fifty-fifty", safe: "Safe" };

function panelTabs(level: string) {
  const tabs: [string, string][] = [
    ["comparison", SECTION_HEADINGS[level] || "Comparison"],
    ["top", "Top students"],
  ];
  if (level !== "institute") tabs.push(["attention", "Needs attention"]);
  return tabs;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  const label = MONTHS[Number(month) - 1];
  return label && day && year ? `${Number(day)} ${label} ${year}` : value;
}

function formatPercent(value: number | null | undefined) {
  return value == null ? "—" : value.toFixed(2);
}

function periodError(from: string, to: string) {
  if (from && to && from > to) return "The start date must be on or before the end date.";
  return "";
}

function coverageLabel(value: string) {
  const [scored, expected] = value.split("/");
  return scored != null && expected != null ? `${scored} of ${expected}` : value;
}

function sectionOrder(left: Section, right: Section) {
  const label = left.label.localeCompare(right.label);
  if (left.percentage == null && right.percentage == null) return label;
  if (left.percentage == null) return 1;
  if (right.percentage == null) return -1;
  return left.percentage - right.percentage || label;
}

function studentCard(studentId: string, cardSuffix: string) {
  return `/cards?student=${studentId}${cardSuffix ? `&${cardSuffix}` : ""}`;
}

function StudentName({ id, name, code, cardSuffix }: { id?: string | null; name?: string; code?: string; cardSuffix: string }) {
  return (
    <div className="student-cell">
      {id ? <Link to={studentCard(id, cardSuffix)}>{name || "Student"}</Link> : <span>{name || "Student"}</span>}
      {code ? <span className="meta">{code}</span> : null}
    </div>
  );
}

function ScoreBar({ percentage, band }: { percentage: number | null; band: string | null }) {
  return (
    <div className="comparison-score">
      <strong>{percentage == null ? "—" : `${formatPercent(percentage)}%`}</strong>
      <span className={`bar ${band || ""}`} aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, percentage ?? 0))}%` }} /></span>
    </div>
  );
}

const GROUP_LABEL: Record<string, string> = { institute: "Course", branch: "Course", course: "Batch", batch: "Subject", subject: "Paper", paper: "Assessment" };

function GroupBar({ level, groups, selected, onSelect, note }: { level: string; groups: { id: string; label: string }[]; selected: string; onSelect: (id: string) => void; note: string }) {
  return (
    <div className="group-bar">
      {groups.length > 1 ? (
        <label className="group-pick">
          {GROUP_LABEL[level] || "Group"}
          <select value={selected} onChange={(event) => onSelect(event.target.value)}>
            {groups.map((group) => <option key={group.id} value={group.id}>{group.label}</option>)}
          </select>
        </label>
      ) : null}
      <span className="meta">{note}</span>
    </div>
  );
}

function StandingList({ shown, level, cardSuffix }: { shown: View; level: string; cardSuffix: string }) {
  const blocks = (shown.boards || []).filter((board) => board.top_student_count > 0);
  const [picked, setPicked] = useState(blocks[0]?.id || "");
  const selected = blocks.some((board) => board.id === picked) ? picked : (blocks[0]?.id || "");
  const block = blocks.find((board) => board.id === selected);
  if (!block) return <p>No students in the safe band in this view yet.</p>;
  const note = block.top_student_count > block.top_students.length ? `${block.top_students.length} of ${block.top_student_count}` : `${block.top_student_count}`;
  return (
    <>
      <GroupBar level={level} groups={blocks} selected={selected} onSelect={setPicked} note={note} />
      <div className="table-wrap">
        <table className="people-table">
          <caption className="sr-only">Highest safe percentages for {block.label || "this view"}, up to 20.</caption>
          <thead><tr><th className="place">#</th><th>Student</th><th>Performance</th><th>Results</th><th>Band</th></tr></thead>
          <tbody>
            {block.top_students.map((item, index) => (
              <tr key={item.student_id}>
                <td className="place">{index + 1}</td>
                <td><StudentName id={item.student_id} name={item.student_name} code={item.student_code} cardSuffix={cardSuffix} /></td>
                <td><ScoreBar percentage={item.percentage} band={item.band} /></td>
                <td className="nowrap">{item.scored} of {item.expected}</td>
                <td>{item.band ? <span className={`chip ${item.band}`}>{BANDS[item.band]}</span> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AttentionBoards({ shown, level, cardSuffix, returnTo }: { shown: View; level: string; cardSuffix: string; returnTo: string }) {
  const boards = (shown.boards || []).filter((board) => board.attention_result_count > 0);
  const [picked, setPicked] = useState(boards[0]?.id || "");
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState("lowest");
  const [page, setPage] = useState(1);
  const selected = boards.some((board) => board.id === picked) ? picked : (boards[0]?.id || "");
  const board = boards.find((item) => item.id === selected);
  const needle = query.trim().toLowerCase();
  const matched = (board?.attention || []).filter((item) => {
    if (!needle) return true;
    return `${item.student_name || ""} ${item.student_code || ""} ${item.title || ""}`.toLowerCase().includes(needle);
  }).sort((left, right) => {
    if (order === "name") return (left.student_name || "").localeCompare(right.student_name || "") || (left.percentage ?? 0) - (right.percentage ?? 0);
    if (order === "assessment") return (left.title || "").localeCompare(right.title || "") || (left.percentage ?? 0) - (right.percentage ?? 0);
    return (left.percentage ?? 0) - (right.percentage ?? 0) || (left.student_name || "").localeCompare(right.student_name || "");
  });
  const pages = Math.max(1, Math.ceil(matched.length / 20));
  const current = Math.min(page, pages);
  useEffect(() => { setPage(1); }, [selected, needle, order]);
  if (!board) return <p>No scored results in this view fall in the danger band.</p>;
  const slice = matched.slice((current - 1) * 20, current * 20);
  const from = matched.length === 0 ? 0 : (current - 1) * 20 + 1;
  const to = from + slice.length - 1;
  const note = matched.length > slice.length ? `${from}–${to} of ${matched.length}` : `${matched.length}`;
  return (
    <>
      <GroupBar level={level} groups={boards} selected={selected} onSelect={setPicked} note={note} />
      <div className="toolbar attention-controls">
        <label>Find a student<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or student code" /></label>
        <label>Order by<select value={order} onChange={(event) => setOrder(event.target.value)}><option value="lowest">Lowest percentage first</option><option value="name">Student name</option><option value="assessment">Assessment</option></select></label>
      </div>
      {slice.length === 0 ? <p>No results match this search.</p> : (
        <div className="table-wrap">
          <table className="people-table">
            <caption className="sr-only">Scored results in the danger band for {board.label}.</caption>
            <thead><tr><th className="place">#</th><th>Student</th><th>Performance</th><th>Results</th><th>Band</th></tr></thead>
            <tbody>
              {slice.map((item, index) => (
                <tr key={item.id}>
                  <td className="place">{(current - 1) * 20 + index + 1}</td>
                  <td><StudentName id={item.student_id} name={item.student_name} code={item.student_code} cardSuffix={cardSuffix} /></td>
                  <td><ScoreBar percentage={item.percentage} band={item.band} /></td>
                  <td>
                    <div className="student-cell">
                      <span className="nowrap">{item.score ?? "—"} of {item.maximum ?? "—"}</span>
                      {item.marksheet_id ? <Link className="result-line" to={`/marksheets/${item.marksheet_id}?returnTo=${returnTo}`}>{item.title}</Link> : <span className="meta">{item.title}</span>}
                    </div>
                  </td>
                  <td>{item.band ? <span className={`chip ${item.band}`}>{BANDS[item.band] || item.band}</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 ? (
        <p className="pager">
          <button type="button" className="quiet" disabled={current <= 1} onClick={() => setPage(current - 1)}>Previous</button>
          <span>Page {current} of {pages}</span>
          <button type="button" className="quiet" disabled={current >= pages} onClick={() => setPage(current + 1)}>Next</button>
        </p>
      ) : null}
    </>
  );
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
      <div ref={panelRef} className="modal compact" role="dialog" aria-modal="true" aria-labelledby="academic-filters-title" tabIndex={-1}>
        <div className="modal-head">
          <h2 id="academic-filters-title">{title}</h2>
          <button type="button" className="text-button" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function read(params: URLSearchParams) {
  const filters: Record<string, string> = {};
  for (const key of FILTER_KEYS) filters[key] = params.get(key) || "";
  return { level: params.get("level") || "institute", filters, page: Number(params.get("page") || 1) };
}

function dataKey(params: URLSearchParams) {
  const query = new URLSearchParams(params);
  query.delete("panel");
  return query.toString();
}

export function ViewsPage() {
  const [params, setParams] = useSearchParams();
  const { level, filters } = read(params);
  const requestedPanel = params.get("panel") || "comparison";
  const panel = panelTabs(level).some(([id]) => id === requestedPanel) ? requestedPanel : "comparison";
  const [draft, setDraft] = useState(filters);
  const [options, setOptions] = useState<Record<string, Option[]>>({});
  const [view, setView] = useState<View | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [notice, setNotice] = useState("");
  const [rangeError, setRangeError] = useState("");
  const [sectionSearch, setSectionSearch] = useState("");
  const [sectionSort, setSectionSort] = useState("lowest");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const appliedKey = dataKey(params);
  const shown = view && loadedKey === appliedKey ? view : null;

  function write(nextLevel: string, nextFilters: Record<string, string>, nextPage = 1, nextPanel = "") {
    const query = new URLSearchParams({ level: nextLevel });
    if (nextPage > 1) query.set("page", String(nextPage));
    const allowed = panelTabs(nextLevel).some(([id]) => id === nextPanel);
    if (allowed && nextPanel !== "comparison") query.set("panel", nextPanel);
    Object.entries(nextFilters).forEach(([key, value]) => {
      if (value && FILTER_KEYS.includes(key as (typeof FILTER_KEYS)[number])) query.set(key, value);
    });
    setParams(query);
  }

  useEffect(() => {
    setDraft(read(params).filters);
    setRangeError("");
  }, [appliedKey]);

  useEffect(() => {
    const current = read(params);
    const query = new URLSearchParams();
    if (current.page > 1) query.set("page", String(current.page));
    const attentionPage = Number(params.get("attention_page") || 1);
    if (attentionPage > 1) query.set("attention_page", String(attentionPage));
    Object.entries(current.filters).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    const key = dataKey(params);
    let cancelled = false;
    setLoading(true);
    setError("");
    api<View>(`/api/v1/views/${current.level}?${query.toString()}`)
      .then((loaded) => {
        if (cancelled) return;
        setView(loaded);
        setLoadedKey(key);
      })
      .catch((reason: Error) => {
        if (cancelled) return;
        setView(null);
        setError(reason.message);
        setLoadedKey(key);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appliedKey]);

  useEffect(() => {
    Promise.all(
      ["branch", "course", "batch", "subject", "paper", "exam_type"].map(async (dimension) => {
        const pageData = await api<{ items: Option[] }>(`/api/v1/context/options?dimension=${dimension}`);
        return [dimension, pageData.items] as const;
      }),
    ).then((pairs) => setOptions(Object.fromEntries(pairs))).catch(() => undefined);
  }, []);

  function optionLabel(dimension: string, id: string) {
    return options[dimension]?.find((option) => option.id === id)?.label || id;
  }

  function labelFor(key: string, value: string) {
    if (key === "attempt") return value === "retest" ? "Retest" : "Original";
    if (key === "exam_date_from" || key === "exam_date_to") return formatDate(value);
    const field = FILTERS.find(([name]) => name === key);
    return field ? optionLabel(field[2], value) : value;
  }

  function editDraft(key: string, value: string) {
    const merged = { ...draft, [key]: value };
    const fitted = clearIncompatible(merged, options, key);
    const opened = value ? { filters: fitted.filters, cleared: [] as string[] } : clearDescendants(fitted.filters, key);
    const cleared = [...fitted.cleared, ...opened.cleared];
    setDraft(value ? fitted.filters : opened.filters);
    setRangeError("");
    const labels = cleared.map((field) => FILTERS.find(([name]) => name === field)?.[1] || field).join(", ");
    setNotice(labels ? (value ? `${labels} cleared because it does not belong with that choice.` : `${labels} cleared because All authorized includes each of them.`) : "");
  }

  function openFilters() {
    setDraft(read(params).filters);
    setNotice("");
    setRangeError("");
    setFiltersOpen(true);
  }

  function closeFilters() {
    setDraft(read(params).filters);
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
    setNotice("");
    setFiltersOpen(false);
    write(level, draft, 1, panel);
  }

  function resetFilters() {
    const empty = Object.fromEntries(FILTER_KEYS.map((key) => [key, ""]));
    setDraft(empty);
    setNotice("");
    setRangeError("");
    setSectionSearch("");
    setFiltersOpen(false);
    write(level, empty, 1, panel);
  }

  function removeFilter(key: string) {
    const opened = clearDescendants({ ...filters, [key]: "" }, key);
    write(level, opened.filters, 1, panel);
  }

  function explainCleared(cleared: string[]) {
    const labels = cleared.map((field) => FILTERS.find(([name]) => name === field)?.[1] || field).join(", ");
    setNotice(labels ? `${labels} cleared because it does not belong with that choice.` : "");
  }

  function drill(section: Section) {
    const step = DRILL[level];
    if (!step || !section.id) return;
    const next = { ...filters, [step[1]]: section.id };
    const fitted = clearIncompatible(next, options, step[1]);
    explainCleared(fitted.cleared);
    write(step[0], fitted.filters, 1);
  }

  async function confirmRoster() {
    if (!filters.batch_id) return;
    setError("");
    try {
      await api("/api/v1/rosters/confirm", { method: "POST", body: JSON.stringify({ batch_id: filters.batch_id }) });
      const query = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value) query.set(key, value);
      });
      const loaded = await api<View>(`/api/v1/views/${level}?${query.toString()}`);
      setView(loaded);
      setLoadedKey(params.toString());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not confirm the roster.");
    }
  }

  const active = FILTER_KEYS.filter((key) => filters[key]);
  const levelIndex = LEVELS.indexOf(level as (typeof LEVELS)[number]);
  const crumbs = [
    { label: "Institute", level: "institute" },
    ...CRUMBS.filter((crumb) => LEVELS.indexOf(crumb.level) <= levelIndex && filters[crumb.field]).map((crumb) => ({
      label: optionLabel(crumb.dimension, filters[crumb.field]),
      level: crumb.level,
    })),
  ];
  const orderedSections = shown ? [...shown.sections]
    .filter((section) => section.label.toLowerCase().includes(sectionSearch.toLowerCase()))
    .sort((a, b) => sectionSort === "name" ? a.label.localeCompare(b.label) : sectionSort === "students" ? b.students - a.students || a.label.localeCompare(b.label) : sectionSort === "highest" ? (b.percentage ?? -1) - (a.percentage ?? -1) || a.label.localeCompare(b.label) : sectionOrder(a, b)) : [];
  function goToLevel(nextLevel: string) {
    setNotice("");
    write(nextLevel, filters, 1);
  }

  function showPanel(nextPanel: string) {
    write(level, filters, Number(params.get("page") || 1), nextPanel);
  }

  const dirty = FILTER_KEYS.some((key) => (draft[key] || "") !== (filters[key] || ""));
  const returnTo = encodeURIComponent(`/views?${params.toString()}`);
  const cardQuery = new URLSearchParams();
  FILTER_KEYS.forEach((key) => {
    if (filters[key]) cardQuery.set(key, filters[key]);
  });
  const cardSuffix = cardQuery.toString();

  function assessmentLink(section: Section) {
    if (section.marksheet_ids?.length === 1) return `/marksheets/${section.marksheet_ids[0]}?returnTo=${returnTo}`;
    const query = new URLSearchParams();
    FILTER_KEYS.forEach((key) => { if (filters[key]) query.set(key, filters[key]); });
    query.set("q", section.label);
    return `/marksheets?${query}`;
  }

  return (
    <section className="panel wide academic-page" aria-busy={loading}>
      <div className="page-title">
        <div>
          <p className="eyebrow">Reporting</p>
          <h1>Academic performance</h1>
        </div>
        <div className="actions">
          {active.length === 0 ? <span>All authorized</span> : active.map((key) => (
            <button key={key} type="button" className="chip-button" onClick={() => removeFilter(key)}>{FILTERS.find(([name]) => name === key)?.[1] || (key === "exam_date_from" ? "From" : key === "exam_date_to" ? "To" : "Attempt")}: {labelFor(key, filters[key])}</button>
          ))}
          {active.length ? <button type="button" className="text-button" onClick={resetFilters}>Clear filters</button> : null}
          <button type="button" className="filters-toggle" onClick={openFilters}>Filters{active.length ? ` (${active.length})` : ""}</button>
        </div>
      </div>
      <nav className="page-tabs academic-levels" aria-label="Academic level">
        {LEVELS.map((item) => (
          <button key={item} type="button" aria-current={level === item ? "page" : undefined} onClick={() => goToLevel(item)}>{LEVEL_LABELS[item]}</button>
        ))}
      </nav>
      {filtersOpen ? (
        <Dialog title="Report filters" onClose={closeFilters}>
          <p className="meta">Apply changes to update the entire view.</p>
          <form className="report-filters" onSubmit={(event: FormEvent) => { event.preventDefault(); applyDraft(); }}>
            <div className="form-grid">
              {CONTEXT_FIELDS.map(([key, label, dimension]) => (
                <label key={key}>
                  {label}
                  <select value={draft[key] || ""} onChange={(event) => editDraft(key, event.target.value)}>
                    <option value="">All authorized</option>
                    {(options[dimension] || []).filter((option) => optionFits(option, draft)).map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </select>
                </label>
              ))}
              <label>
                Exam type
                <select value={draft.exam_type || ""} onChange={(event) => editDraft("exam_type", event.target.value)}>
                  <option value="">All authorized</option>
                  {(options.exam_type || []).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              </label>
              <label>
                Attempt
                <select value={draft.attempt || ""} onChange={(event) => editDraft("attempt", event.target.value)}>
                  <option value="">All authorized</option>
                  <option value="original">Original</option>
                  <option value="retest">Retest</option>
                </select>
              </label>
              <label>From<input type="date" value={draft.exam_date_from || ""} onChange={(event) => editDraft("exam_date_from", event.target.value)} /></label>
              <label>To<input type="date" value={draft.exam_date_to || ""} onChange={(event) => editDraft("exam_date_to", event.target.value)} /></label>
            </div>
            {notice ? <p className="ok" role="status">{notice}</p> : null}
            {rangeError || periodError(draft.exam_date_from || "", draft.exam_date_to || "") ? <p className="error" role="alert">{rangeError || periodError(draft.exam_date_from || "", draft.exam_date_to || "")}</p> : null}
            {dirty ? <p className="meta">Choices change when you apply them.</p> : null}
            <div className="dialog-actions">
              <button type="button" className="text-button" onClick={resetFilters}>Reset</button>
              <button type="submit" disabled={Boolean(periodError(draft.exam_date_from || "", draft.exam_date_to || ""))}>Apply filters</button>
            </div>
          </form>
        </Dialog>
      ) : null}
      {loading ? <p role="status">Loading this view…</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {shown ? (
        <article>
          {crumbs.length > 1 ? (
            <nav className="crumbs" aria-label="Academic path">
              {crumbs.map((crumb, index) => (
                <span key={crumb.level}>
                  {index > 0 ? <span aria-hidden="true"> / </span> : null}
                  {index < crumbs.length - 1 ? <button type="button" className="quiet" onClick={() => goToLevel(crumb.level)}>{crumb.label}</button> : <span>{crumb.label}</span>}
                </span>
              ))}
            </nav>
          ) : null}
          {shown.empty ? (
            <p role="status">{shown.students} student{shown.students === 1 ? "" : "s"} on the imported marklists. No published results match this view.</p>
          ) : (
            <div className="academic-stats">
              <div><span>Weighted performance</span><strong>{shown.performance.percentage == null ? "—" : `${formatPercent(shown.performance.percentage)}%`}</strong><small>Scored marks ÷ corresponding maxima</small></div>
              <div><span>Students</span><strong>{shown.students}</strong><small>{shown.enrollments} matching enrollments</small></div>
              <div><span>Scored results</span><strong>{shown.performance.scored ?? 0}<small> / {shown.performance.expected ?? 0}</small></strong><small>Listed results, not full-roster coverage</small></div>
              <div><span>Incomplete results</span><strong>{(shown.performance.missing || 0) + (shown.performance.absent || 0)}</strong><small>{shown.performance.missing} missing · {shown.performance.absent} absent</small></div>
            </div>
          )}
          {shown.performance.participation != null ? (
            <p className="meta">Participation {formatPercent(shown.performance.participation * 100)}%: {shown.performance.participation_scored ?? 0} scored of {shown.performance.participation_expected ?? 0} confirmed eligible opportunities.</p>
          ) : level === "batch" && filters.batch_id && !shown.roster_confirmed ? (
            <p className="meta"><button type="button" onClick={confirmRoster}>Confirm this batch list</button></p>
          ) : null}
          {shown.pending_recalculation ? <p className="meta">Some published marks used an older policy. The percentages here follow the current rules.</p> : null}
          <nav className="page-tabs academic-panels" aria-label="Report">
            {panelTabs(level).map(([id, label]) => (
              <button key={id} type="button" aria-selected={panel === id} onClick={() => showPanel(id)}>{label}</button>
            ))}
          </nav>
          {panel === "comparison" ? (
            <>
              {shown.sections.length > 1 ? (
              <div className="toolbar comparison-controls">
                {shown.sections.length > 8 ? <label>Find a {CHILD[level] || "section"}<input value={sectionSearch} onChange={(event) => setSectionSearch(event.target.value)} placeholder="Search section names" /></label> : null}
                <label>Order by<select value={sectionSort} onChange={(event) => setSectionSort(event.target.value)}><option value="lowest">Lowest performance first</option><option value="highest">Highest performance first</option><option value="name">Name</option><option value="students">Most students</option></select></label>
                {sectionSearch ? <span className="meta">{orderedSections.length} of {shown.sections.length} shown</span> : null}
              </div>
              ) : null}
              {orderedSections.length === 0 ? <p>No sections match these filters or the section search.</p> : (
                <div className="table-wrap">
                  <table>
                    <caption className="sr-only">{SECTION_HEADINGS[level]} in this view, in the selected order. Open a row to explore its published results.</caption>
                    <thead><tr><th>Section</th><th>Students</th><th>Results</th><th>Performance</th><th>Band</th><th>Scored</th><th>Missing / absent</th></tr></thead>
                    <tbody>
                      {orderedSections.map((section) => (
                        <tr key={section.id || section.label}>
                          <td>
                            {level === "paper" ? <Link to={assessmentLink(section)}>{section.label}</Link> : section.id ? <button type="button" className="quiet" onClick={() => drill(section)}>{section.label}</button> : section.label}
                          </td>
                          <td>{section.students}</td>
                          <td>{section.results}</td>
                          <td><div className="comparison-score"><strong>{section.percentage == null ? "—" : `${formatPercent(section.percentage)}%`}</strong><span className={`bar ${section.band || ""}`} aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, section.percentage ?? 0))}%` }} /></span></div></td>
                          <td>{section.band ? <span className={`chip ${section.band}`}>{BANDS[section.band]}</span> : "—"}</td>
                          <td>{coverageLabel(section.coverage)}</td><td>{section.missing ?? 0} / {section.absent ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : null}
          {panel === "top" ? <StandingList shown={shown} level={level} cardSuffix={cardSuffix} /> : null}
          {panel === "attention" ? <AttentionBoards shown={shown} level={level} cardSuffix={cardSuffix} returnTo={returnTo} /> : null}
          <p><Link to={`/cards${cardSuffix ? `?${cardSuffix}` : ""}`}>Open progress cards for this context →</Link></p>
        </article>
      ) : null}
    </section>
  );
}
