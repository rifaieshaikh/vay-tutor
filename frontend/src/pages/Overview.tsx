import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { formatDisplayDate } from "../format";
import { clearIncompatible, Option, optionFits } from "../filters";
import { StudentDialog } from "../ui";

const FILTER_KEYS = ["branch_id", "course_id", "batch_id"] as const;

type Figure = { key: string; label: string; count: number; href: string; scope?: string };
type Queue = Figure & { oldest?: string };
type Activity = { id: string; action: string; record: string; context: string; at: string; href: string };
type Action = { key: string; label: string; href: string };
type Dashboard = {
  institute: { name: string; timezone: string; today: string };
  applied: Record<string, string>;
  rejected: string[];
  message: string;
  metrics: Figure[];
  queues: Queue[];
  activity: Activity[];
  activity_scope: string;
  actions: Action[];
};

export function OverviewPage() {
  const [params, setParams] = useSearchParams();
  const [board, setBoard] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [options, setOptions] = useState<Record<string, Option[]>>({});
  const [optionsError, setOptionsError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const requestId = useRef(0);
  const loadedView = useRef("");
  const branchId = params.get("branch_id") || "";
  const courseId = params.get("course_id") || "";
  const batchId = params.get("batch_id") || "";
  const key = `${branchId}|${courseId}|${batchId}|${attempt}`;

  useEffect(() => {
    if (!params.get("period")) return;
    const next = new URLSearchParams(params);
    next.delete("period");
    setParams(next, { replace: true });
  }, [params, setParams]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      ["branch", "course", "batch"].map(async (dimension) => {
        const page = await api<{ items: Option[] }>(`/api/v1/context/options?dimension=${dimension}`);
        return [dimension, page.items] as const;
      }),
    )
      .then((pairs) => {
        if (!cancelled) {
          setOptions(Object.fromEntries(pairs));
          setOptionsError("");
        }
      })
      .catch((reason: Error) => {
        if (!cancelled) setOptionsError(reason.message || "The filter choices could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    const search = new URLSearchParams();
    if (branchId) search.set("branch_id", branchId);
    if (courseId) search.set("course_id", courseId);
    if (batchId) search.set("batch_id", batchId);
    const view = `${branchId}|${courseId}|${batchId}`;
    const current = ++requestId.current;
    setLoading(true);
    api<Dashboard>(`/api/v1/dashboard?${search.toString()}`)
      .then((result) => {
        if (current !== requestId.current) return;
        loadedView.current = view;
        setBoard(result);
        setError("");
        setStale(false);
      })
      .catch((reason: Error) => {
        if (current !== requestId.current) return;
        setError(reason.message);
        if (loadedView.current === view) setStale(true);
        else {
          setBoard(null);
          setStale(false);
        }
      })
      .finally(() => {
        if (current === requestId.current) setLoading(false);
      });
  }, [key, branchId, courseId, batchId]);

  function writeFilters(next: Record<string, string>) {
    const paramsNext = new URLSearchParams(params);
    for (const name of FILTER_KEYS) {
      if (next[name]) paramsNext.set(name, next[name]);
      else paramsNext.delete(name);
    }
    paramsNext.delete("period");
    setParams(paramsNext);
  }

  function removeChip(field: (typeof FILTER_KEYS)[number]) {
    const next = { branch_id: branchId, course_id: courseId, batch_id: batchId, [field]: "" };
    writeFilters(clearIncompatible(next, options, field).filters);
  }

  const labelFor = (field: string, id: string) => {
    const dimension = field === "branch_id" ? "branch" : field === "course_id" ? "course" : "batch";
    return options[dimension]?.find((item) => item.id === id)?.label || id;
  };
  const chips = [
    branchId ? ["branch_id", "Branch", branchId] : null,
    courseId ? ["course_id", "Course", courseId] : null,
    batchId ? ["batch_id", "Batch", batchId] : null,
  ].filter(Boolean) as [typeof FILTER_KEYS[number], string, string][];
  const rejected = board?.rejected || [];
  const ready = !loading && rejected.length === 0 && board?.metrics && board.queues ? board : null;
  const waiting = (ready?.queues || []).reduce((sum, item) => sum + item.count, 0);
  const figuresAreZero = Boolean(ready && ready.metrics.length > 0 && ready.metrics.every((item) => item.count === 0));
  const queuesAreClear = Boolean(ready && ready.queues.length > 0 && waiting === 0);
  const noAccess = Boolean(ready && ready.metrics.length === 0 && ready.queues.length === 0);
  const emptyInstitute = Boolean(ready && chips.length === 0 && figuresAreZero && queuesAreClear && ready.activity.length === 0);
  const noMatch = Boolean(ready && chips.length > 0 && figuresAreZero && waiting === 0 && ready.activity.length === 0);
  const instituteName = board?.institute?.name || "";
  const today = board?.institute?.today || "";
  const quickActions = board?.actions || [];

  return (
    <section className="panel wide overview" aria-busy={loading && !board}>
      <header className="overview-head">
        <div>
          <p className="eyebrow">Overview</p>
          <h1>{instituteName || "Overview"}</h1>
          {today ? <p className="meta">{formatDisplayDate(today)}</p> : null}
        </div>
        <div className="actions">
          <button type="button" onClick={() => setFiltersOpen(true)}>Filters</button>
          {quickActions.length > 0 ? (
            <button type="button" className="secondary" onClick={() => setActionsOpen(true)}>Quick actions</button>
          ) : null}
        </div>
      </header>
      {chips.length > 0 ? (
        <div className="chip-row" aria-label="Applied filters">
          {chips.map(([field, name, id]) => (
            <button key={field} type="button" className="chip" onClick={() => removeChip(field)}>
              {name}: {labelFor(field, id)} <span aria-hidden="true">×</span>
              <span className="sr-only">Remove {name}</span>
            </button>
          ))}
          <button type="button" className="text-button" onClick={() => writeFilters({ branch_id: "", course_id: "", batch_id: "" })}>Clear all</button>
        </div>
      ) : null}
      {stale && error ? <p className="error" role="alert">{error} The figures below may be out of date.</p> : null}
      {!stale && error ? <p className="error" role="alert">{error}</p> : null}
      {error ? <button type="button" className="secondary" onClick={() => setAttempt((value) => value + 1)}>Try again</button> : null}
      {rejected.length > 0 ? (
        <p className="error" role="alert">
          {board?.message}{" "}
          <button type="button" className="text-button" onClick={() => writeFilters({ branch_id: "", course_id: "", batch_id: "" })}>Clear filters</button>
        </p>
      ) : null}
      {loading ? <OverviewSkeleton /> : null}
      {noAccess ? <p>Nothing on this overview is available to you.</p> : null}
      {emptyInstitute ? <p>This institute has no students, admissions, or batches yet.</p> : null}
      {noMatch ? <p>Nothing matches these filters.</p> : null}
      {ready && ready.metrics.length > 0 ? (
        <div className="overview-figures">
          {ready.metrics.map((item) => (
            <Link key={item.key} className="overview-figure" to={item.href}>
              <span>{item.label}</span>
              <strong>{item.count}</strong>
              {item.scope ? <small>{item.scope}</small> : null}
            </Link>
          ))}
        </div>
      ) : null}
      {ready && ready.queues.length > 0 ? (
        <section className="overview-section" aria-labelledby="needs-attention">
          <h2 id="needs-attention">Needs attention</h2>
          {waiting === 0 && !emptyInstitute && !noMatch ? <p>Nothing needs attention.</p> : null}
          {waiting > 0 ? (
            <ul className="overview-list">
              {ready.queues.map((item) => (
                <li key={item.key}>
                  <Link to={item.href}>{item.label}</Link>
                  <strong>{item.count}</strong>
                  {item.oldest ? <span>Oldest {formatDisplayDate(item.oldest)}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      {ready && (!noAccess || ready.activity.length > 0) ? (
        <section className="overview-section" aria-labelledby="recent-activity">
          <h2 id="recent-activity">Recent activity</h2>
          {ready.activity_scope ? <p className="meta">{ready.activity_scope}</p> : null}
          {ready.activity.length === 0 && !emptyInstitute && !noAccess ? <p>No recent activity.</p> : null}
          {ready.activity.length > 0 ? (
            <ul className="overview-list">
              {ready.activity.map((item) => (
                <li key={item.id}>
                  {item.href ? <Link to={item.href}>{item.record}</Link> : <span>{item.record}</span>}
                  <span>{item.action}</span>
                  {item.context ? <span>{item.context}</span> : null}
                  <time>{item.at}</time>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      {filtersOpen ? (
        <FilterPanel
          applied={{ branch_id: branchId, course_id: courseId, batch_id: batchId }}
          options={options}
          optionsError={optionsError}
          onRetry={() => setAttempt((value) => value + 1)}
          onClose={() => setFiltersOpen(false)}
          onApply={(draft) => {
            writeFilters(draft);
            setFiltersOpen(false);
          }}
        />
      ) : null}
      {actionsOpen && quickActions.length > 0 ? (
        <StudentDialog title="Quick actions" onClose={() => setActionsOpen(false)}>
          <div className="actions">
            {quickActions.map((item) => (
              <Link key={item.key} to={item.href} onClick={() => setActionsOpen(false)}>{item.label}</Link>
            ))}
          </div>
        </StudentDialog>
      ) : null}
    </section>
  );
}

function OverviewSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="overview-figures">
        <div className="overview-figure is-loading" />
        <div className="overview-figure is-loading" />
        <div className="overview-figure is-loading" />
        <div className="overview-figure is-loading" />
      </div>
      <div className="overview-section is-loading" />
      <div className="overview-section is-loading" />
    </div>
  );
}

function FilterPanel({
  applied,
  options,
  optionsError,
  onRetry,
  onClose,
  onApply,
}: {
  applied: Record<string, string>;
  options: Record<string, Option[]>;
  optionsError: string;
  onRetry: () => void;
  onClose: () => void;
  onApply: (draft: Record<string, string>) => void;
}) {
  const [draft, setDraft] = useState(applied);

  function change(field: string, value: string) {
    setDraft((current) => clearIncompatible({ ...current, [field]: value }, options, field).filters);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    onApply(draft);
  }

  const courses = (options.course || []).filter((item) => optionFits(item, { branch_id: draft.branch_id }));
  const batches = (options.batch || []).filter((item) => optionFits(item, draft));

  return (
    <StudentDialog title="Filters" onClose={onClose}>
      <form onSubmit={submit}>
        {optionsError ? (
          <p className="error" role="alert">
            {optionsError}{" "}
            <button type="button" className="text-button" onClick={onRetry}>Try again</button>
          </p>
        ) : (
        <div className="form-grid">
          <label>
            Branch
            <select value={draft.branch_id || ""} onChange={(event) => change("branch_id", event.target.value)}>
              <option value="">All authorized</option>
              {(options.branch || []).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label>
            Course
            <select value={draft.course_id || ""} onChange={(event) => change("course_id", event.target.value)}>
              <option value="">All authorized</option>
              {courses.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label>
            Batch
            <select value={draft.batch_id || ""} onChange={(event) => change("batch_id", event.target.value)}>
              <option value="">All authorized</option>
              {batches.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
        </div>
        )}
        <div className="actions">
          <button type="submit">Apply</button>
          <button type="button" className="secondary" onClick={() => setDraft({ branch_id: "", course_id: "", batch_id: "" })}>Reset</button>
          <button type="button" className="text-button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </StudentDialog>
  );
}
