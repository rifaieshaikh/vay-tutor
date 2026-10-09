import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError, api } from "../api";
import { CONTEXT_FIELDS, Option, clearIncompatible, optionFits } from "../filters";
import { Band, BandFields, bandsPayload, bandsReady, draftsFrom } from "../bands";
import { Icon, StudentDialog } from "./Catalog";

type Marksheet = {
  id: string;
  title: string;
  status: string;
  branch_id?: string | null;
  course_id?: string | null;
  subject_id?: string | null;
  paper_id?: string | null;
  batch_ids?: string[];
  exam_date: string | null;
  exam_type: string | null;
  source_file: string | null;
  source_sheet: string | null;
  file_id: string | null;
  maximum: number | null;
  revision: number | null;
  edit_version: number;
  uploader_name?: string;
  reviewer_name?: string;
};
type Person = { id: string; display_name: string; student_code: string };
type Result = {
  id: string;
  display_name?: string;
  student_code?: string;
  status: string;
  score: number | null;
  rank: number | null;
  percentage: number | null;
  previous_score: number | null;
  source?: { row?: number };
};
type Detail = Marksheet & { attempt_kind?: string; available_students?: Person[]; results: Result[]; bands?: Band[] | null };
type Draft = { score: string; status: string };

const FILTER_KEYS = ["q", "status", "exam_type", "branch_id", "course_id", "batch_id", "subject_id", "paper_id", "exam_date_from", "exam_date_to", "sort", "page"];
const ADVANCED_KEYS = ["exam_type", "branch_id", "course_id", "paper_id", "exam_date_from", "exam_date_to"];
const STATUS_OPTIONS = [
  { id: "draft", label: "Draft" },
  { id: "submitted", label: "Submitted" },
  { id: "published", label: "Published" },
  { id: "withdrawn", label: "Withdrawn" },
];
const LABELS: Record<string, string> = {
  q: "Search",
  status: "Status",
  exam_type: "Exam type",
  exam_date_from: "From",
  exam_date_to: "To",
  sort: "Sort",
  branch_id: "Branch",
  course_id: "Course",
  batch_id: "Batch",
  subject_id: "Subject",
  paper_id: "Paper",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function readFilters(params: URLSearchParams) {
  return Object.fromEntries(FILTER_KEYS.map((key) => [key, params.get(key) || ""]));
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  const label = MONTHS[Number(month) - 1];
  return label && day && year ? `${Number(day)} ${label} ${year}` : value;
}

function statusClass(status: string) {
  if (status === "published") return "chip committed";
  if (status === "withdrawn" || status === "rejected") return "chip reject";
  if (status === "submitted") return "chip update";
  return "chip";
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
      <div ref={panelRef} className="modal compact" role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabIndex={-1}>
        <div className="modal-head">
          <h2 id="dialog-title">{title}</h2>
          <button type="button" className="text-button" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function cardReturn(value: string | null) {
  if (!value || value.startsWith("//") || value.includes("://")) return "";
  if (value.startsWith("/cards") || value.startsWith("/views")) return value;
  return "";
}

function scoreProblem(draft: Draft | undefined, maximum: number | null) {
  if (!draft || draft.status !== "scored") return "";
  const text = draft.score.trim();
  if (!text) return "Enter a score, or mark the row missing or absent.";
  const score = Number(text);
  if (!Number.isFinite(score)) return "Enter a number.";
  if (score < 0 || (maximum != null && score > maximum)) {
    return `Use a score from 0 through ${maximum ?? "the maximum"}.`;
  }
  return "";
}

function storedScore(value: string) {
  const text = value.trim();
  return text === "" ? null : Number(text);
}

export function MarksheetsPage({ canAdd = false }: { canAdd?: boolean }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [panel, setPanel] = useState<"choose" | "add" | "filters" | null>(null);
  const [draftSheet, setDraftSheet] = useState<Record<string, string>>({ attempt: "original", exam_type: "unit" });
  const filters = readFilters(params);
  const [items, setItems] = useState<Marksheet[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [options, setOptions] = useState<Record<string, Option[]>>({});
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  function write(next: Record<string, string>) {
    const query = new URLSearchParams();
    Object.entries(next).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    setParams(query);
  }

  async function load(next = filters) {
    const query = new URLSearchParams();
    Object.entries(next).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    if (!query.get("page")) query.set("page", "1");
    setLoading(true);
    try {
      const page = await api<{ items: Marksheet[]; total: number; pages: number }>(`/api/v1/marksheets?${query.toString()}`);
      setItems(page.items);
      setTotal(page.total);
      setPages(page.pages);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch((reasonText: Error) => setError(reasonText.message));
    Promise.all(
      ["branch", "course", "batch", "subject", "paper", "exam_type"].map(async (dimension) => {
        const page = await api<{ items: Option[] }>(`/api/v1/context/options?dimension=${dimension}`);
        return [dimension, page.items] as const;
      }),
    ).then((pairs) => setOptions(Object.fromEntries(pairs))).catch(() => undefined);
  }, [params]);

  useEffect(() => {
    if (loading) return;
    const saved = sessionStorage.getItem("vay-marksheets-scroll");
    if (!saved) return;
    sessionStorage.removeItem("vay-marksheets-scroll");
    window.scrollTo(0, Number(saved));
  }, [loading, items.length]);

  function choose(key: string, value: string) {
    const merged = { ...filters, [key]: value, page: "1" };
    const { filters: next, cleared } = clearIncompatible(merged, options, key);
    setNotice(cleared.length ? `${cleared.map((field) => LABELS[field]).join(", ")} cleared because it does not belong with that choice.` : "");
    write(next);
  }

  function optionLabel(dimension: string, id?: string | null) {
    if (!id) return "";
    return options[dimension]?.find((option) => option.id === id)?.label || "";
  }

  function labelFor(key: string, value: string) {
    if (key === "status") return STATUS_OPTIONS.find((option) => option.id === value)?.label || value;
    if (key === "exam_type") return optionLabel("exam_type", value) || value;
    const dimension = CONTEXT_FIELDS.find(([field]) => field === key)?.[2];
    return (dimension && optionLabel(dimension, value)) || value;
  }

  function placeFor(sheet: Marksheet) {
    return [optionLabel("branch", sheet.branch_id), optionLabel("course", sheet.course_id)].filter(Boolean).join(" · ");
  }

  function contextFor(sheet: Marksheet) {
    const batches = (sheet.batch_ids || []).map((id) => optionLabel("batch", id)).filter(Boolean);
    return [optionLabel("subject", sheet.subject_id), optionLabel("paper", sheet.paper_id), batches.join(", ")].filter(Boolean).join(" · ");
  }

  const active = Object.entries(filters).filter(([key, value]) => value && !["page", "sort"].includes(key));
  const advancedCount = ADVANCED_KEYS.filter((key) => filters[key]).length;
  const page = Number(filters.page) || 1;
  const rangeFrom = total === 0 ? 0 : (page - 1) * 8 + 1;
  const rangeTo = Math.min(total, (page - 1) * 8 + items.length);
  const kept = new URLSearchParams(params);
  kept.delete("open");
  const listQuery = kept.toString();
  if (params.get("open")) {
    return <Navigate to={`/marksheets/${params.get("open")}${listQuery ? `?${listQuery}` : ""}`} replace />;
  }

  return (
    <section className="panel wide">
      <div className="page-title">
        <div>
          <p className="eyebrow">After import</p>
          <h1>Marksheets</h1>
        </div>
        {canAdd ? (
          <div className="icon-actions">
            <button type="button" onClick={() => { setError(""); setPanel("choose"); }} aria-label="Add marksheet" title="Add marksheet"><Icon name="add" /></button>
          </div>
        ) : null}
      </div>
      <p className="page-lead">Enter marks here, or import a workbook. A draft stays off progress cards until it is published.</p>
      <div className="toolbar common">
        <label>
          Search
          <input value={filters.q} onChange={(event) => choose("q", event.target.value)} placeholder="Assessment or student" />
        </label>
        <label>
          Status
          <select value={filters.status} onChange={(event) => choose("status", event.target.value)}>
            <option value="">All</option>
            {STATUS_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label>
          Subject
          <select value={filters.subject_id} onChange={(event) => choose("subject_id", event.target.value)}>
            <option value="">All</option>
            {(options.subject || []).filter((option) => optionFits(option, filters)).map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          Batch
          <select value={filters.batch_id} onChange={(event) => choose("batch_id", event.target.value)}>
            <option value="">All</option>
            {(options.batch || []).filter((option) => optionFits(option, filters)).map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>
        <div className="icon-actions">
          <button type="button" onClick={() => setPanel("filters")} aria-label={advancedCount ? `Filters, ${advancedCount} applied` : "Filters"} title="Filters"><Icon name="filter" /></button>
        </div>
      </div>
      {notice ? <p className="ok" role="status">{notice}</p> : null}
      <p className="filter-row">
        {active.map(([key, value]) => (
          <button key={key} type="button" className="chip-button" onClick={() => choose(key, "")}>{LABELS[key]}: {labelFor(key, value)}</button>
        ))}
        {active.length ? (
          <div className="icon-actions">
            <button type="button" onClick={() => write({ sort: filters.sort })} aria-label="Clear filters" title="Clear filters"><Icon name="clear" /></button>
          </div>
        ) : null}
        <span>{total} marksheet{total === 1 ? "" : "s"}</span>
      </p>
      {panel === "filters" ? (
        <Dialog title="Filter marksheets" onClose={() => setPanel(null)}>
          <div className="form-grid">
            <label>
              Branch
              <select value={filters.branch_id} onChange={(event) => choose("branch_id", event.target.value)}>
                <option value="">All</option>
                {(options.branch || []).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
            <label>
              Course
              <select value={filters.course_id} onChange={(event) => choose("course_id", event.target.value)}>
                <option value="">All</option>
                {(options.course || []).filter((option) => optionFits(option, filters)).map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </label>
            <label>
              Paper
              <select value={filters.paper_id} onChange={(event) => choose("paper_id", event.target.value)}>
                <option value="">All</option>
                {(options.paper || []).filter((option) => optionFits(option, filters)).map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </label>
            <label>
              Exam type
              <select value={filters.exam_type} onChange={(event) => choose("exam_type", event.target.value)}>
                <option value="">All</option>
                {(options.exam_type || []).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
            <label>From<input type="date" value={filters.exam_date_from} onChange={(event) => choose("exam_date_from", event.target.value)} /></label>
            <label>To<input type="date" value={filters.exam_date_to} onChange={(event) => choose("exam_date_to", event.target.value)} /></label>
          </div>
          <div className="dialog-actions">
            {active.length ? <button type="button" className="text-button" onClick={() => write({ sort: filters.sort })}>Clear</button> : null}
            <button type="button" onClick={() => setPanel(null)}>Done</button>
          </div>
        </Dialog>
      ) : null}
      {panel === "choose" ? (
        <Dialog title="Add a marksheet" onClose={() => setPanel(null)}>
          <div className="choice-list">
            <button type="button" className="choice" onClick={() => setPanel("add")}>
              <strong>Enter here</strong>
              <span>Create a draft, then add students who are already enrolled.</span>
            </button>
            <button type="button" className="choice" onClick={() => navigate("/import?new=1")}>
              <strong>Import a workbook</strong>
              <span>Upload an Excel marklist and correct it before it is saved.</span>
            </button>
          </div>
        </Dialog>
      ) : null}
      {panel === "add" ? (
        <Dialog title="New draft marksheet" onClose={() => setPanel(null)}>
          <form onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            const form = new FormData(event.currentTarget);
            try {
              const created = await api<{ id: string }>("/api/v1/marksheets", {
                method: "POST",
                body: JSON.stringify({
                  title: form.get("title"),
                  branch_id: draftSheet.branch_id,
                  course_id: draftSheet.course_id,
                  batch_id: draftSheet.batch_id,
                  subject_id: draftSheet.subject_id,
                  paper_id: draftSheet.paper_id,
                  exam_type: draftSheet.exam_type,
                  attempt: draftSheet.attempt,
                  maximum: Number(form.get("maximum")),
                  exam_date: form.get("exam_date") || null,
                }),
              });
              navigate(`/marksheets/${created.id}`);
            } catch (reasonText) {
              if (reasonText instanceof ApiError && reasonText.code === "marksheet.exists" && reasonText.details.id) {
                navigate(`/marksheets/${reasonText.details.id}`);
                return;
              }
              setError(reasonText instanceof Error ? reasonText.message : "Could not add the marksheet.");
            }
          }}>
            <div className="form-grid">
              <label className="span-2">Title<input name="title" required placeholder="Unit exam" autoFocus /></label>
              {CONTEXT_FIELDS.map(([key, label, dimension]) => (
                <label key={key}>
                  {label}
                  <select required value={draftSheet[key] || ""} onChange={(event) => {
                    const merged = { ...draftSheet, [key]: event.target.value };
                    const { filters: next } = clearIncompatible(merged, options, key);
                    setDraftSheet(next);
                  }}>
                    <option value="">Choose</option>
                    {(options[dimension] || []).filter((option) => optionFits(option, draftSheet)).map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </select>
                </label>
              ))}
              <label>
                Exam type
                <select value={draftSheet.exam_type} onChange={(event) => setDraftSheet((current) => ({ ...current, exam_type: event.target.value }))}>
                  {(options.exam_type || []).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              </label>
              <label>
                Attempt
                <select value={draftSheet.attempt} onChange={(event) => setDraftSheet((current) => ({ ...current, attempt: event.target.value }))}>
                  <option value="original">Original</option>
                  <option value="retest">Retest</option>
                </select>
              </label>
              <label>Maximum<input name="maximum" type="number" min="0.01" step="0.01" required /></label>
              <label>Exam date<input name="exam_date" type="date" /></label>
            </div>
            {error ? <p className="error" role="alert">{error}</p> : null}
            <div className="dialog-actions">
              <button type="button" className="text-button" onClick={() => setPanel("choose")}>Back</button>
              <button type="submit">Create draft</button>
            </div>
          </form>
        </Dialog>
      ) : null}
      {error && panel !== "add" ? <p className="error" role="alert">{error}</p> : null}
      {loading && items.length === 0 ? <p role="status">Loading marksheets…</p> : null}
      {!loading && items.length === 0 ? <p>No marksheets match these filters.</p> : null}
      {items.length > 0 ? (
        <div className="table-wrap">
          <table className="register">
            <caption className="sr-only">{total} marksheet{total === 1 ? "" : "s"}. Open a row to review it. Page {filters.page || 1} of {pages}.</caption>
            <thead>
              <tr>
                <th aria-sort={(filters.sort || "title") === "title" ? "ascending" : "none"}>
                  <button type="button" className="sort" onClick={() => choose("sort", "title")}>Assessment</button>
                </th>
                <th>Branch and course</th>
                <th>Subject, paper, batch</th>
                <th>Type</th>
                <th aria-sort={filters.sort === "exam_date" ? "ascending" : "none"}>
                  <button type="button" className="sort" onClick={() => choose("sort", "exam_date")}>Date</button>
                </th>
                <th aria-sort={filters.sort === "status" ? "ascending" : "none"}>
                  <button type="button" className="sort" onClick={() => choose("sort", "status")}>Status</button>
                </th>
                <th>Max</th>
                <th>Source</th>
                <th>Uploaded by</th>
                <th>Reviewed by</th>
                <th>Revision</th>
              </tr>
            </thead>
            <tbody>
              {items.map((sheet) => (
                <tr key={sheet.id}>
                  <td>
                    <Link className="sort" to={`/marksheets/${sheet.id}${listQuery ? `?${listQuery}` : ""}`} onClick={() => sessionStorage.setItem("vay-marksheets-scroll", String(window.scrollY))}>{sheet.title}</Link>
                  </td>
                  <td>{placeFor(sheet) || "—"}</td>
                  <td>{contextFor(sheet) || "—"}</td>
                  <td>{optionLabel("exam_type", sheet.exam_type) || sheet.exam_type || "—"}</td>
                  <td>{formatDate(sheet.exam_date)}</td>
                  <td><span className={statusClass(sheet.status)}>{STATUS_OPTIONS.find((option) => option.id === sheet.status)?.label || sheet.status}</span></td>
                  <td>{sheet.maximum ?? "—"}</td>
                  <td>
                    <span className="source-file">{sheet.source_file || "—"}</span>
                    <span className="source-sheet">{sheet.source_sheet || ""}</span>
                  </td>
                  <td>{sheet.uploader_name || "—"}</td>
                  <td>{sheet.reviewer_name || "—"}</td>
                  <td>{sheet.revision ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="pager">
        <button type="button" className="quiet" disabled={page <= 1} onClick={() => write({ ...filters, page: String(page - 1) })}>Previous</button>
        <span>{rangeFrom}–{rangeTo} of {total}</span>
        <button type="button" className="quiet" disabled={page >= pages} onClick={() => write({ ...filters, page: String(page + 1) })}>Next</button>
      </p>
    </section>
  );
}

export function MarksheetPage({ canSetBands = false }: { canSetBands?: boolean }) {
  const { marksheetId = "" } = useParams();
  const [params] = useSearchParams();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [options, setOptions] = useState<Record<string, Option[]>>({});
  const [studentId, setStudentId] = useState("");
  const [rowStatus, setRowStatus] = useState("scored");
  const [rowScore, setRowScore] = useState("");
  const [panel, setPanel] = useState<"student" | "withdraw" | null>(null);
  const [tab, setTab] = useState<"results" | "details">("results");
  const [bandEditor, setBandEditor] = useState(false);
  const [defaults, setDefaults] = useState<Band[] | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const versionRef = useRef(0);
  const savingRef = useRef(false);
  const returned = cardReturn(params.get("returnTo"));
  const listParams = new URLSearchParams(params);
  listParams.delete("returnTo");
  const listQuery = listParams.toString();
  const back = returned || `/marksheets${listQuery ? `?${listQuery}` : ""}`;
  const backLabel = returned?.startsWith("/views") ? "← Academic view" : returned ? "← Progress card" : "← Marksheets";

  async function reload() {
    const fresh = await api<Detail>(`/api/v1/marksheets/${marksheetId}`);
    versionRef.current = fresh.edit_version;
    setDetail(fresh);
    return fresh;
  }

  useEffect(() => {
    let active = true;
    setDetail(null);
    setEditing(false);
    setDrafts({});
    setReason("");
    setError("");
    setMessage("");
    setSaveState("idle");
    setTab("results");
    api<Detail>(`/api/v1/marksheets/${marksheetId}`).then((fresh) => {
      if (!active) return;
      versionRef.current = fresh.edit_version;
      setDetail(fresh);
    }).catch((reasonText: Error) => {
      if (active) setError(reasonText.message);
    });
    return () => {
      active = false;
    };
  }, [marksheetId]);

  useEffect(() => {
    api<{ bands?: Band[] }>("/api/v1/policies/active")
      .then((policy) => setDefaults(policy.bands || null))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    Promise.all(
      ["branch", "course", "batch", "subject", "paper", "exam_type"].map(async (dimension) => {
        const page = await api<{ items: Option[] }>(`/api/v1/context/options?dimension=${dimension}`);
        return [dimension, page.items] as const;
      }),
    ).then((pairs) => setOptions(Object.fromEntries(pairs))).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!editing) return;
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editing]);

  function startEdit() {
    if (!detail) return;
    setDrafts(Object.fromEntries(detail.results.map((result) => [result.id, { score: result.score == null ? "" : String(result.score), status: result.status }])));
    setReason("");
    setError("");
    setMessage("");
    setSaveState("idle");
    setTab("results");
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDrafts({});
    setReason("");
    setSaveState("idle");
  }

  function updateDraft(result: Result, next: Partial<Draft>) {
    setDrafts((current) => {
      const prior = current[result.id] || { score: result.score == null ? "" : String(result.score), status: result.status };
      const status = next.status ?? prior.status;
      const score = next.score !== undefined ? next.score : prior.score;
      return { ...current, [result.id]: { status, score: status === "scored" ? score : "" } };
    });
    setSaveState("idle");
  }

  async function saveEdits() {
    if (!detail || savingRef.current) return;
    setError("");
    const problems = detail.results.flatMap((result) => {
      const problem = scoreProblem(drafts[result.id], detail.maximum);
      return problem ? [`${result.display_name || "A student"}: ${problem}`] : [];
    });
    if (problems.length) {
      setSaveState("error");
      setError(problems.join(" "));
      return;
    }
    const changes = detail.results.flatMap((result) => {
      const draft = drafts[result.id];
      if (!draft) return [];
      const score = storedScore(draft.score);
      if (score === result.score && draft.status === result.status) return [];
      return [{ result, score, status: draft.status }];
    });
    if (changes.length === 0) {
      cancelEdit();
      return;
    }
    if (detail.status === "published" && !reason.trim()) {
      setSaveState("error");
      setError("A published correction needs a reason.");
      return;
    }
    const label = (id: string) => changes.find((change) => change.result.id === id)?.result.display_name || detail.results.find((result) => result.id === id)?.display_name || "A student";
    savingRef.current = true;
    setSaveState("saving");
    try {
      if (detail.status === "published") {
        try {
          await api(`/api/v1/marksheets/${detail.id}/correct`, {
            method: "POST",
            body: JSON.stringify({
              reason,
              edit_version: versionRef.current,
              changes: changes.map((change) => ({ result_id: change.result.id, score: change.score, status: change.status })),
            }),
          });
        } catch (reasonText) {
          if (reasonText instanceof ApiError && reasonText.code === "marksheet.conflict") {
            const fresh = await reload();
            versionRef.current = fresh.edit_version;
          }
          const why = reasonText instanceof Error ? reasonText.message : "Could not save.";
          setSaveState("error");
          setError(`Nothing in this save was stored. Your edits are still on this page. ${why} This page is on the latest version, so you can save again.`);
          return;
        }
        setMessage("Saved. A new revision is active. The previous scores are kept.");
        setSaveState("saved");
        setEditing(false);
        setDrafts({});
        await reload();
        return;
      }
      const committed: string[] = [];
      let version = versionRef.current;
      for (const change of changes) {
        try {
          const saved = await api<{ edit_version: number }>(`/api/v1/marksheets/${detail.id}/results/${change.result.id}`, {
            method: "PATCH",
            body: JSON.stringify({ score: change.score, status: change.status, edit_version: version }),
          });
          version = saved.edit_version;
          versionRef.current = version;
          committed.push(change.result.id);
          setDrafts((current) => ({
            ...current,
            [change.result.id]: { score: change.score == null ? "" : String(change.score), status: change.status },
          }));
        } catch (reasonText) {
          const fresh = await reload();
          versionRef.current = fresh.edit_version;
          const pending = changes.filter((item) => !committed.includes(item.result.id));
          const stored = committed.length ? `Saved ${committed.map(label).join(", ")}.` : "Nothing in this save was stored.";
          const waiting = pending.length ? ` Still unsaved: ${pending.map((item) => label(item.result.id)).join(", ")}.` : "";
          const why = reasonText instanceof Error ? reasonText.message : "Could not save.";
          setSaveState("error");
          setError(`${stored}${waiting} ${why} This page is on the latest version, so you can save the remaining edits.`);
          return;
        }
      }
      setMessage("Saved.");
      setSaveState("saved");
      setEditing(false);
      setDrafts({});
      await reload();
    } finally {
      savingRef.current = false;
    }
  }

  async function publish(sheet: Detail) {
    setError("");
    try {
      await api(`/api/v1/marksheets/${sheet.id}/publish`, { method: "POST" });
      setMessage(`${sheet.title} is published.`);
      await reload();
    } catch (reasonText) {
      setError(reasonText instanceof Error ? reasonText.message : "Could not publish.");
    }
  }

  async function saveDate(event: FormEvent<HTMLFormElement>, sheet: Detail) {
    event.preventDefault();
    setError("");
    try {
      await api(`/api/v1/marksheets/${sheet.id}`, {
        method: "PATCH",
        body: JSON.stringify({ exam_date: new FormData(event.currentTarget).get("exam_date") }),
      });
      await reload();
    } catch (reasonText) {
      setError(reasonText instanceof Error ? reasonText.message : "Could not save the date.");
    }
  }

  async function withdraw(event: FormEvent<HTMLFormElement>, sheet: Detail) {
    event.preventDefault();
    setError("");
    try {
      await api(`/api/v1/marksheets/${sheet.id}/withdraw`, {
        method: "POST",
        body: JSON.stringify({ reason: new FormData(event.currentTarget).get("reason"), edit_version: sheet.edit_version }),
      });
      setMessage("The published revision was withdrawn.");
      await reload();
      return true;
    } catch (reasonText) {
      setError(reasonText instanceof Error ? reasonText.message : "Could not withdraw.");
      return false;
    }
  }

  async function addStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return false;
    setError("");
    try {
      await api(`/api/v1/marksheets/${detail.id}/results`, {
        method: "POST",
        body: JSON.stringify({
          student_id: studentId,
          status: rowStatus,
          score: rowStatus === "scored" ? Number(rowScore) : null,
        }),
      });
      setStudentId("");
      setRowScore("");
      setMessage("Student added to this draft.");
      await reload();
      return true;
    } catch (reasonText) {
      setError(reasonText instanceof Error ? reasonText.message : "Could not add the student.");
      return false;
    }
  }

  function optionLabel(dimension: string, id?: string | null) {
    if (!id) return "";
    return options[dimension]?.find((option) => option.id === id)?.label || "";
  }

  const changed = detail?.results.filter((result) => {
    const draft = drafts[result.id];
    return draft && (draft.score !== (result.score == null ? "" : String(result.score)) || draft.status !== result.status);
  }) || [];
  const statusLabel = STATUS_OPTIONS.find((option) => option.id === detail?.status)?.label || detail?.status;
  const viewStatus = (result: Result) => (editing && drafts[result.id] ? drafts[result.id].status : result.status);
  const counts = {
    scored: detail?.results.filter((result) => viewStatus(result) === "scored").length || 0,
    missing: detail?.results.filter((result) => viewStatus(result) === "missing").length || 0,
    absent: detail?.results.filter((result) => viewStatus(result) === "absent").length || 0,
  };
  if (!detail) {
    return (
      <section className="panel wide">
        <p className="eyebrow">Marksheet</p>
        <p role="status">{error || "Loading this marksheet…"}</p>
      </section>
    );
  }

  const canAddStudent = detail.status === "draft" || detail.status === "submitted";
  const facts = [
    ["Branch", optionLabel("branch", detail.branch_id) || "—"],
    ["Course", optionLabel("course", detail.course_id) || "—"],
    ["Batch", (detail.batch_ids || []).map((id) => optionLabel("batch", id)).filter(Boolean).join(", ") || "—"],
    ["Subject", optionLabel("subject", detail.subject_id) || "—"],
    ["Paper", optionLabel("paper", detail.paper_id) || "—"],
    ["Type", optionLabel("exam_type", detail.exam_type) || detail.exam_type || "—"],
    ["Attempt", detail.attempt_kind === "retest" ? "Retest" : "Original"],
    ["Maximum", detail.maximum ?? "—"],
    ["Revision", detail.revision ?? "—"],
    ["Source", detail.source_file || detail.source_sheet || "Entered here"],
  ];
  return (
    <section className="panel wide">
      <Link className="quiet back-link" to={back} onClick={(event) => { if (editing && !window.confirm("Leave without saving these edits?")) event.preventDefault(); }}>{backLabel}</Link>
      <div className="title-row">
        <h1>{detail.title}</h1>
        <div className="actions">
          {!editing && canAddStudent ? (
            <div className="icon-actions">
              <button type="button" onClick={() => setPanel("student")} aria-label="Add a student" title="Add a student"><Icon name="add" /></button>
            </div>
          ) : null}
          {!editing && (detail.status === "draft" || detail.status === "published") ? <button type="button" className="text-button" onClick={startEdit}>Edit scores</button> : null}
          {editing ? <button type="button" onClick={saveEdits} disabled={saveState === "saving"}>{saveState === "saving" ? "Saving…" : "Save"}</button> : null}
          {editing ? <button type="button" className="text-button" onClick={cancelEdit}>Cancel</button> : null}
          {!editing && detail.status !== "published" && detail.status !== "withdrawn" ? <button type="button" className="text-button" onClick={() => publish(detail)}>Publish</button> : null}
          {!editing && detail.status === "published" ? <button type="button" className="text-button" onClick={() => setPanel("withdraw")}>Withdraw</button> : null}
        </div>
      </div>
      <div className="page-tabs" role="tablist" aria-label="Marksheet sections">
        <button type="button" role="tab" aria-selected={tab === "results"} onClick={() => setTab("results")}>Results</button>
        <button type="button" role="tab" aria-selected={tab === "details"} onClick={() => setTab("details")}>Details</button>
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {message ? <p className="ok" role="status">{message}</p> : null}
      {tab === "details" ? (
      <>
      <dl className="facts">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{label === "Source" && detail.file_id ? <a href={`/api/v1/files/${detail.file_id}`}>{value}</a> : value}</dd>
          </div>
        ))}
        <div>
          <dt>Status</dt>
          <dd><span className={statusClass(detail.status)}>{statusLabel}</span></dd>
        </div>
        <div className={detail.exam_date || detail.status !== "draft" ? undefined : "span-2"}>
          <dt>Exam date</dt>
          <dd>
            {detail.exam_date ? formatDate(detail.exam_date) : detail.status === "draft" ? (
              <form className="inline-date" onSubmit={(event) => saveDate(event, detail)}>
                <input name="exam_date" type="date" aria-label="Exam date" required />
                <button type="submit">Save</button>
              </form>
            ) : "—"}
          </dd>
        </div>
      </dl>
      <div className="title-row">
        <h2>Bands</h2>
        {canSetBands ? (
          <div className="icon-actions">
            <button type="button" onClick={() => setBandEditor(true)} aria-label="Edit bands" title="Edit"><Icon name="edit" /></button>
          </div>
        ) : null}
      </div>
      {detail.bands?.length ? (
        <dl className="facts">
          {detail.bands.map((item) => (
            <div key={item.key || item.name}>
              <dt>{item.name}</dt>
              <dd>{item.phrase}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <>
          <p className="meta">This marksheet uses the bands in Settings.</p>
          {defaults?.length ? (
            <dl className="facts">
              {defaults.map((item) => (
                <div key={item.key || item.name}>
                  <dt>{item.name}</dt>
                  <dd>{item.phrase}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </>
      )}
      </>
      ) : (
      <>
      <div className="stat-line">
        <span><strong>{detail.results.length}</strong> Students</span>
        <span><strong>{counts.scored}</strong> Scored</span>
        <span><strong>{counts.missing}</strong> Missing</span>
        <span><strong>{counts.absent}</strong> Absent</span>
      </div>
      {editing && detail.status === "published" ? (
        <label>Reason for this revision<input value={reason} onChange={(event) => setReason(event.target.value)} required /></label>
      ) : null}
      {editing && changed.length ? (
        <div className="table-wrap">
          <table>
            <caption>Before and after</caption>
            <thead><tr><th>Student</th><th>Before</th><th>After</th></tr></thead>
            <tbody>
              {changed.map((result) => (
                <tr key={result.id}>
                  <td>{result.display_name || "Student"}</td>
                  <td>{result.score ?? "—"} · {({ scored: "Scored", absent: "Absent", missing: "Missing" }[result.status] || result.status)}</td>
                  <td>{drafts[result.id].status === "scored" ? drafts[result.id].score || "—" : "—"} · {({ scored: "Scored", absent: "Absent", missing: "Missing" }[drafts[result.id].status] || drafts[result.id].status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {detail.results.length === 0 ? <p>No students are on this marksheet yet.</p> : null}
      <div className="table-wrap">
        <table>
          <caption className="sr-only">Results on {detail.title}. Maximum {detail.maximum ?? "—"}, revision {detail.revision}.</caption>
          <thead><tr><th>Student</th><th>ID</th><th>Row</th><th>Status</th><th>Score</th><th>Previous</th><th>%</th><th>Rank</th></tr></thead>
              <tbody>
                {detail.results.map((result) => (
                  <tr key={result.id}>
                    <td>{result.display_name || "Student"}</td>
                    <td>{result.student_code || "—"}</td>
                    <td>{result.source?.row ?? "—"}</td>
                    <td>
                      {editing ? (
                        <select aria-label={`Status for ${result.display_name || "student"}`} value={drafts[result.id]?.status || result.status} onChange={(event) => updateDraft(result, { status: event.target.value })}>
                          <option value="scored">Scored</option>
                          <option value="absent">Absent</option>
                          <option value="missing">Missing</option>
                        </select>
                      ) : ({ scored: "Scored", absent: "Absent", missing: "Missing" }[result.status] || result.status)}
                    </td>
                    <td>
                      {editing && (drafts[result.id]?.status || result.status) === "scored" ? (
                        <input
                          aria-label={`Score for ${result.display_name || "student"}`}
                          aria-invalid={Boolean(scoreProblem(drafts[result.id], detail.maximum))}
                          className={scoreProblem(drafts[result.id], detail.maximum) ? "invalid" : undefined}
                          value={drafts[result.id]?.score ?? ""}
                          onChange={(event) => updateDraft(result, { score: event.target.value, status: event.target.value.trim() === "" ? "missing" : "scored" })}
                        />
                      ) : (editing ? "—" : result.score ?? "—")}
                      {editing && scoreProblem(drafts[result.id], detail.maximum) ? <span className="field-error">{scoreProblem(drafts[result.id], detail.maximum)}</span> : null}
                    </td>
                    <td>{result.previous_score ?? "—"}</td>
                    <td>{result.percentage == null ? "—" : result.percentage.toFixed(2)}</td>
                    <td>{result.rank ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      </>
      )}
      {panel === "student" ? (
        <Dialog title="Add a student" onClose={() => setPanel(null)}>
          <form onSubmit={async (event) => { if (await addStudent(event)) setPanel(null); }}>
            {(detail.available_students || []).length === 0 ? <p>Every enrolled student in this batch is already on the sheet.</p> : (
              <div className="form-grid">
                <label className="span-2">
                  Student
                  <select required value={studentId} autoFocus onChange={(event) => setStudentId(event.target.value)}>
                    <option value="">Choose</option>
                    {(detail.available_students || []).map((person) => (
                      <option key={person.id} value={person.id}>{person.student_code} · {person.display_name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Status
                  <select value={rowStatus} onChange={(event) => setRowStatus(event.target.value)}>
                    <option value="scored">Scored</option>
                    <option value="absent">Absent</option>
                    <option value="missing">Missing</option>
                  </select>
                </label>
                {rowStatus === "scored" ? <label>Score<input value={rowScore} onChange={(event) => setRowScore(event.target.value)} type="number" min="0" max={detail.maximum ?? undefined} step="0.01" required /></label> : null}
              </div>
            )}
            {error ? <p className="error" role="alert">{error}</p> : null}
            <div className="dialog-actions">
              <button type="button" className="text-button" onClick={() => setPanel(null)}>Cancel</button>
              {(detail.available_students || []).length ? (
                <div className="icon-actions">
                  <button type="submit" aria-label="Add to marksheet" title="Add to marksheet"><Icon name="add" /></button>
                </div>
              ) : null}
            </div>
          </form>
        </Dialog>
      ) : null}
      {panel === "withdraw" ? (
        <Dialog title="Withdraw this marksheet" onClose={() => setPanel(null)}>
          <form onSubmit={async (event) => { if (await withdraw(event, detail)) setPanel(null); }}>
            <label>Reason<input name="reason" required autoFocus /></label>
            {error ? <p className="error" role="alert">{error}</p> : null}
            <div className="dialog-actions">
              <button type="button" className="text-button" onClick={() => setPanel(null)}>Cancel</button>
              <button type="submit">Withdraw</button>
            </div>
          </form>
        </Dialog>
      ) : null}
      {bandEditor ? (
        <SheetBands
          bands={detail.bands}
          fallback={defaults}
          onClose={() => setBandEditor(false)}
          onSaved={async (messageText) => {
            setBandEditor(false);
            setMessage(messageText);
            await reload();
          }}
        />
      ) : null}
    </section>
  );
}

function SheetBands({ bands, fallback, onClose, onSaved }: { bands?: Band[] | null; fallback: Band[] | null; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const { marksheetId = "" } = useParams();
  const [rows, setRows] = useState(draftsFrom(bands?.length ? bands : fallback));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const ready = bandsReady(rows);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(`/api/v1/marksheets/${marksheetId}`, { method: "PATCH", body: JSON.stringify({ bands: bandsPayload(rows) }) });
      await onSaved("These bands apply to this marksheet.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the bands.");
      setSaving(false);
    }
  }

  async function useSettings() {
    setSaving(true);
    setError("");
    try {
      await api(`/api/v1/marksheets/${marksheetId}`, { method: "PATCH", body: JSON.stringify({ bands: null }) });
      await onSaved("This marksheet uses the bands in Settings.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the bands.");
      setSaving(false);
    }
  }

  return (
    <StudentDialog title="Bands for this marksheet" onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <p className="meta span-2">Scores on this marksheet use these bands. Leave them on Settings when this sheet should follow the institute bands. Totals that mix marksheets still use Settings.</p>
        <BandFields rows={rows} onChange={setRows} />
        {error ? <p className="error span-2" role="alert">{error}</p> : null}
        <div className="dialog-actions span-2">
          <button type="button" className="quiet" onClick={onClose}>Cancel</button>
          <button type="button" className="quiet" disabled={saving || !bands?.length} onClick={() => void useSettings()}>Use settings</button>
          <button type="submit" disabled={saving || !ready}>Save</button>
        </div>
      </form>
    </StudentDialog>
  );
}
