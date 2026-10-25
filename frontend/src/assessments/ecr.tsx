import { FormEvent, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { kindLabel, useCurriculumKinds, useExamTypes } from "../academics/kinds";
import { batchState, compareOptional, compareText, FilterActions, ListToolbar } from "../academics/lists";
import { formatDisplayDate } from "../format";
import { notify } from "../notify";
import { useRecordLabel } from "../orientation";
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
  exam_count: number;
};

type ScopeItem = { id: string; name: string; kind?: string };
type SubjectOption = { id: string; name: string; papers: ScopeItem[]; units: ScopeItem[] };
type BatchOption = { id: string; name: string; branch_name: string };
type ExamRow = {
  id: string;
  title: string;
  exam_date: string;
  subject_id: string;
  subject_name: string;
  scope_kind: string;
  scope_label: string;
  exam_kind?: string;
  marksheet_id: string;
  marksheet_status: string;
  other_batches: BatchOption[];
};
type Register = {
  batch: { id: string; name: string; course_id: string; course_name: string; branch_id?: string; branch_name: string };
  subjects: SubjectOption[];
  course_batches: BatchOption[];
  items: ExamRow[];
};

const BATCH_SORT = [
  ["batch", "Batch"],
  ["branch", "Branch"],
  ["course", "Course"],
  ["exams", "Exams"],
] as const;
const EXAM_SORT = [
  ["date", "Exam date"],
  ["date_asc", "Exam date, oldest"],
  ["title", "Exam"],
  ["subject", "Subject"],
  ["status", "Marklist"],
] as const;
const STATE_OPTIONS = [
  ["current", "Current"],
  ["closed", "Closed"],
  ["archived", "Archived"],
] as const;
const STATUS_OPTIONS = [
  ["draft", "Draft"],
  ["submitted", "Submitted"],
  ["published", "Published"],
  ["withdrawn", "Withdrawn"],
] as const;

function readParam(params: URLSearchParams, key: string) {
  return params.get(key) || "";
}

function writeParams(current: Record<string, string>) {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(current)) {
    if (value) next.set(key, value);
  }
  return next;
}

function namedChoices(rows: { id: string; name: string }[]) {
  const seen = new Map<string, string>();
  for (const row of rows) {
    if (row.id) seen.set(row.id, row.name || "Not recorded");
  }
  return [...seen].sort((left, right) => left[1].localeCompare(right[1], undefined, { sensitivity: "base" }));
}

function stateLabel(value: string) {
  return STATE_OPTIONS.find(([id]) => id === value)?.[1] || value;
}

function matchesState(row: { archived: boolean; closed: boolean }, state: string) {
  if (state === "archived") return row.archived;
  if (state === "closed") return row.closed;
  if (state === "current") return !row.archived && !row.closed;
  return true;
}

function statusLabel(value: string) {
  return STATUS_OPTIONS.find(([id]) => id === value)?.[1] || value || "Draft";
}

function dateRangeError(from: string, to: string) {
  if (from && to && from > to) return "The start date must be on or before the end date.";
  return "";
}

export function ExamRegistersPage({ canImport = false }: { canImport?: boolean }) {
  const [params, setParams] = useSearchParams();
  const filters = {
    q: readParam(params, "q"),
    branch_id: readParam(params, "branch_id"),
    course_id: readParam(params, "course_id"),
    batch_id: readParam(params, "batch_id"),
    state: readParam(params, "state"),
    sort: readParam(params, "sort") || "batch",
  };
  const [draftQuery, setDraftQuery] = useState(filters.q);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draft, setDraft] = useState({ branch_id: filters.branch_id, course_id: filters.course_id, batch_id: filters.batch_id, state: filters.state });
  const [rows, setRows] = useState<BatchRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api<{ items: BatchRow[] }>("/api/v1/exams/batches")
      .then((body) => {
        if (!cancelled) setRows(body.items);
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setDraftQuery(filters.q);
  }, [filters.q]);

  function write(next: Record<string, string>) {
    setParams(writeParams(next));
  }

  function openFilters() {
    setDraft({ branch_id: filters.branch_id, course_id: filters.course_id, batch_id: filters.batch_id, state: filters.state });
    setFiltersOpen(true);
  }

  function keepBatch(branchId: string, courseId: string, batchId: string) {
    if (!batchId) return "";
    const match = (rows || []).find((row) => row.id === batchId);
    if (!match) return "";
    if (branchId && match.branch_id !== branchId) return "";
    if (courseId && match.course_id !== courseId) return "";
    return batchId;
  }

  const branches = namedChoices((rows || []).map((row) => ({ id: row.branch_id, name: row.branch_name })));
  const courses = namedChoices(
    (rows || [])
      .filter((row) => !draft.branch_id || row.branch_id === draft.branch_id)
      .map((row) => ({ id: row.course_id, name: row.course_name })),
  );
  const batches = namedChoices(
    (rows || [])
      .filter((row) => (!draft.branch_id || row.branch_id === draft.branch_id) && (!draft.course_id || row.course_id === draft.course_id))
      .map((row) => ({ id: row.id, name: row.name })),
  );
  const needle = filters.q.trim().toLowerCase();
  const visible = (rows || []).filter((row) => {
    if (filters.branch_id && row.branch_id !== filters.branch_id) return false;
    if (filters.course_id && row.course_id !== filters.course_id) return false;
    if (filters.batch_id && row.id !== filters.batch_id) return false;
    if (!matchesState(row, filters.state)) return false;
    if (needle && !`${row.name} ${row.branch_name} ${row.course_name}`.toLowerCase().includes(needle)) return false;
    return true;
  }).sort((left, right) => {
    if (filters.sort === "branch") return compareText(left.branch_name, right.branch_name, "asc") || compareText(left.name, right.name, "asc");
    if (filters.sort === "course") return compareText(left.course_name, right.course_name, "asc") || compareText(left.name, right.name, "asc");
    if (filters.sort === "exams") return right.exam_count - left.exam_count || compareText(left.name, right.name, "asc");
    return compareText(left.name, right.name, "asc");
  });
  const branchName = branches.find(([id]) => id === filters.branch_id)?.[1] || "Branch";
  const courseName = namedChoices((rows || []).map((row) => ({ id: row.course_id, name: row.course_name }))).find(([id]) => id === filters.course_id)?.[1] || "Course";
  const batchName = (rows || []).find((row) => row.id === filters.batch_id)?.name || "Batch";
  const chips = [
    filters.q ? { key: "q", label: `Search: ${filters.q}` } : null,
    filters.branch_id ? { key: "branch_id", label: `Branch: ${branchName}` } : null,
    filters.course_id ? { key: "course_id", label: `Course: ${courseName}` } : null,
    filters.batch_id ? { key: "batch_id", label: `Batch: ${batchName}` } : null,
    filters.state ? { key: "state", label: `State: ${stateLabel(filters.state)}` } : null,
  ].filter((item): item is { key: string; label: string } => item !== null);
  const filtered = chips.length > 0;

  return (
    <section className="panel wide">
      <div className="page-title">
        <div>
          <p className="eyebrow">Assessments</p>
          <h1>ECR</h1>
          <p className="page-lead">Each batch has an exam conduct register. Open a batch to record an exam, then upload its marklist.</p>
        </div>
        {canImport ? <div className="actions"><Link className="button" to="/ecr/import">Import</Link></div> : null}
      </div>
      <ListToolbar
        searchLabel="Search batches"
        placeholder="Batch, branch, or course"
        query={draftQuery}
        onQuery={setDraftQuery}
        onSearch={() => write({ ...filters, q: draftQuery.trim(), sort: filters.sort === "batch" ? "" : filters.sort })}
        sort={filters.sort}
        sortOptions={BATCH_SORT}
        onSort={(value) => write({ ...filters, sort: value === "batch" ? "" : value })}
        onOpenFilters={openFilters}
        summary={rows === null ? "Loading batches…" : error ? "Batches could not be loaded." : visible.length === 1 ? "1 batch" : `${visible.length} batches`}
        chips={chips}
        onRemove={(key) => {
          if (key === "q") setDraftQuery("");
          const next = { ...filters, [key]: "", sort: filters.sort === "batch" ? "" : filters.sort };
          if (key === "branch_id") {
            next.course_id = "";
            next.batch_id = "";
          }
          if (key === "course_id") next.batch_id = "";
          write(next);
        }}
        onClear={() => {
          setDraftQuery("");
          write({ sort: filters.sort === "batch" ? "" : filters.sort });
        }}
        filtered={filtered}
      />
      {error ? <p className="error" role="alert">{error}</p> : null}
      {rows === null ? null : visible.length === 0 ? <p>{filtered ? "No batches match." : "No batches are available."}</p> : (
        <div className="table-wrap">
          <table className="people-table">
            <caption className="sr-only">Batches and their exam registers</caption>
            <thead><tr><th>Batch</th><th>Branch</th><th>Course</th><th>State</th><th>Exams</th></tr></thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id}>
                  <td><Link to={`/ecr/${row.id}`}>{row.name}</Link></td>
                  <td>{row.branch_name || "Not recorded"}</td>
                  <td>{row.course_name || "Not recorded"}</td>
                  <td>{batchState(row)}</td>
                  <td>{row.exam_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {filtersOpen ? (
        <StudentDialog title="Filters" onClose={() => setFiltersOpen(false)}>
          <form className="form-grid" onSubmit={(event) => {
            event.preventDefault();
            write({ ...filters, branch_id: draft.branch_id, course_id: draft.course_id, batch_id: draft.batch_id, state: draft.state, sort: filters.sort === "batch" ? "" : filters.sort });
            setFiltersOpen(false);
          }}>
            <label>Branch
              <select aria-label="Branch" value={draft.branch_id} onChange={(event) => {
                const branchId = event.target.value;
                const courseId = branchId && draft.course_id && !(rows || []).some((row) => row.branch_id === branchId && row.course_id === draft.course_id) ? "" : draft.course_id;
                setDraft({ branch_id: branchId, course_id: courseId, batch_id: keepBatch(branchId, courseId, draft.batch_id), state: draft.state });
              }}>
                <option value="">Any branch</option>
                {branches.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label>Course
              <select aria-label="Course" value={draft.course_id} onChange={(event) => {
                const courseId = event.target.value;
                setDraft((current) => ({ ...current, course_id: courseId, batch_id: keepBatch(current.branch_id, courseId, current.batch_id) }));
              }}>
                <option value="">Any course</option>
                {courses.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label>Batch
              <select aria-label="Batch" value={draft.batch_id} onChange={(event) => setDraft((current) => ({ ...current, batch_id: event.target.value }))}>
                <option value="">Any batch</option>
                {batches.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label>State
              <select aria-label="Batch state" value={draft.state} onChange={(event) => setDraft((current) => ({ ...current, state: event.target.value }))}>
                <option value="">Any state</option>
                {STATE_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <FilterActions onReset={() => setDraft({ branch_id: "", course_id: "", batch_id: "", state: "" })} onClose={() => setFiltersOpen(false)} />
          </form>
        </StudentDialog>
      ) : null}
    </section>
  );
}

export function ExamRegisterPage({ canAdd }: { canAdd: boolean }) {
  const { batchId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const filters = {
    q: readParam(params, "q"),
    subject_id: readParam(params, "subject_id"),
    status: readParam(params, "status"),
    scope: readParam(params, "scope"),
    from: readParam(params, "from"),
    to: readParam(params, "to"),
    sort: readParam(params, "sort") || "date",
  };
  const [draftQuery, setDraftQuery] = useState(filters.q);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draft, setDraft] = useState({ subject_id: filters.subject_id, status: filters.status, scope: filters.scope, from: filters.from, to: filters.to });
  const [dateError, setDateError] = useState("");
  const [register, setRegister] = useState<Register | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const kinds = useCurriculumKinds();
  const examTypes = useExamTypes();
  useRecordLabel(register?.batch.name || "");

  function load() {
    return api<Register>(`/api/v1/exams?batch_id=${batchId}`)
      .then(setRegister)
      .catch((reason: Error) => setError(reason.message));
  }

  useEffect(() => {
    setRegister(null);
    void load();
  }, [batchId]);

  useEffect(() => {
    setDraftQuery(filters.q);
  }, [filters.q]);

  function write(next: Record<string, string>) {
    setParams(writeParams(next));
  }

  function openFilters() {
    setDraft({ subject_id: filters.subject_id, status: filters.status, scope: filters.scope, from: filters.from, to: filters.to });
    setDateError("");
    setFiltersOpen(true);
  }

  const needle = filters.q.trim().toLowerCase();
  const visible = (register?.items || []).filter((row) => {
    if (filters.subject_id && row.subject_id !== filters.subject_id) return false;
    if (filters.status && row.marksheet_status !== filters.status) return false;
    if (filters.scope && row.scope_kind !== filters.scope) return false;
    if (filters.from && (!row.exam_date || row.exam_date < filters.from)) return false;
    if (filters.to && (!row.exam_date || row.exam_date > filters.to)) return false;
    if (needle && !`${row.title} ${row.subject_name} ${row.scope_label}`.toLowerCase().includes(needle)) return false;
    return true;
  }).sort((left, right) => {
    if (filters.sort === "title") return compareText(left.title, right.title, "asc");
    if (filters.sort === "subject") return compareText(left.subject_name, right.subject_name, "asc") || compareText(left.title, right.title, "asc");
    if (filters.sort === "status") return compareText(left.marksheet_status, right.marksheet_status, "asc") || compareText(left.title, right.title, "asc");
    if (filters.sort === "date_asc") return compareOptional(left.exam_date, right.exam_date, "asc") || compareText(left.title, right.title, "asc");
    return compareOptional(left.exam_date, right.exam_date, "desc") || compareText(left.title, right.title, "asc");
  });
  const scopeChoices = [
    ["subject", "Whole subject"],
    ...kinds.map((item) => [item.key, item.label] as [string, string]),
  ];
  const subjectName = register?.subjects.find((item) => item.id === filters.subject_id)?.name || "Subject";
  const scopeName = scopeChoices.find(([id]) => id === filters.scope)?.[1] || filters.scope;
  const keptSort = filters.sort === "date" ? "" : filters.sort;
  const chips = [
    filters.q ? { key: "q", label: `Search: ${filters.q}` } : null,
    filters.subject_id ? { key: "subject_id", label: `Subject: ${subjectName}` } : null,
    filters.status ? { key: "status", label: `Marklist: ${statusLabel(filters.status)}` } : null,
    filters.scope ? { key: "scope", label: `Subject partition: ${scopeName}` } : null,
    filters.from ? { key: "from", label: `From: ${formatDisplayDate(filters.from)}` } : null,
    filters.to ? { key: "to", label: `To: ${formatDisplayDate(filters.to)}` } : null,
  ].filter((item): item is { key: string; label: string } => item !== null);

  return (
    <section className="panel wide">
      <p className="meta"><Link to="/ecr">ECR</Link></p>
      <div className="page-title">
        <div>
          <p className="eyebrow">Exam conduct register</p>
          <h1>{register?.batch.name || "Batch"}</h1>
          <p className="page-lead">{register ? `${register.batch.branch_name} · ${register.batch.course_name}` : "Loading this register…"}</p>
        </div>
        {canAdd && register ? (
          <div className="actions">
            <Link className="button" to={`/ecr/import?branch_id=${register.batch.branch_id || ""}&course_id=${register.batch.course_id}&batch_id=${register.batch.id}`}>Import</Link>
            <button type="button" onClick={() => setAdding(true)}>Add exam</button>
          </div>
        ) : null}
      </div>
      <ListToolbar
        searchLabel="Search exams"
        placeholder="Exam, subject, or scope"
        query={draftQuery}
        onQuery={setDraftQuery}
        onSearch={() => write({ ...filters, q: draftQuery.trim(), sort: keptSort })}
        sort={filters.sort}
        sortOptions={EXAM_SORT}
        onSort={(value) => write({ ...filters, sort: value === "date" ? "" : value })}
        onOpenFilters={openFilters}
        summary={!register ? "Loading exams…" : error ? "Exams could not be loaded." : visible.length === 1 ? "1 exam" : `${visible.length} exams`}
        chips={chips}
        onRemove={(key) => {
          if (key === "q") setDraftQuery("");
          write({ ...filters, [key]: "", sort: keptSort });
        }}
        onClear={() => {
          setDraftQuery("");
          write({ sort: keptSort });
        }}
        filtered={chips.length > 0}
      />
      {error ? <p className="error" role="alert">{error}</p> : null}
      {register && visible.length === 0 ? <p>{chips.length ? "No exams match." : "No exams are recorded for this batch yet."}</p> : null}
      {register && visible.length > 0 ? (
        <div className="table-wrap">
          <table className="people-table">
            <caption className="sr-only">Exams for {register.batch.name}</caption>
            <thead><tr><th>Exam</th><th>Exam type</th><th>Subject</th><th>Subject partition</th><th>Date</th><th>Marklist</th><th>Other batches</th></tr></thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id}>
                  <td><Link to={`/marksheets/${row.marksheet_id}`}>{row.title}</Link></td>
                  <td>{examTypes.find((item) => item.key === row.exam_kind)?.label || "—"}</td>
                  <td>{row.subject_name || "Not recorded"}</td>
                  <td>{row.scope_label}</td>
                  <td>{formatDisplayDate(row.exam_date)}</td>
                  <td>
                    {statusLabel(row.marksheet_status)}
                    {canAdd ? <>{" · "}<Link to={`/ecr/import?branch_id=${register.batch.branch_id || ""}&course_id=${register.batch.course_id}&batch_id=${register.batch.id}`}>Import</Link></> : null}
                  </td>
                  <td>{row.other_batches.length ? row.other_batches.map((item) => item.name).join(", ") : "This batch"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {filtersOpen && register ? (
        <StudentDialog title="Filters" onClose={() => setFiltersOpen(false)}>
          <form className="form-grid" onSubmit={(event) => {
            event.preventDefault();
            const problem = dateRangeError(draft.from, draft.to);
            if (problem) {
              setDateError(problem);
              return;
            }
            write({ ...filters, ...draft, sort: keptSort });
            setFiltersOpen(false);
          }}>
            <label>Subject
              <select aria-label="Subject" value={draft.subject_id} onChange={(event) => setDraft((current) => ({ ...current, subject_id: event.target.value }))}>
                <option value="">Any subject</option>
                {register.subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label>Marklist
              <select aria-label="Marklist status" value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}>
                <option value="">Any status</option>
                {STATUS_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <label>Subject partition
              <select aria-label="Subject partition" value={draft.scope} onChange={(event) => setDraft((current) => ({ ...current, scope: event.target.value }))}>
                <option value="">Any scope</option>
                {scopeChoices.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <label>From
              <input type="date" aria-label="From" value={draft.from} onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))} />
            </label>
            <label>To
              <input type="date" aria-label="To" value={draft.to} onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))} />
            </label>
            {dateError ? <p className="error span-2" role="alert">{dateError}</p> : null}
            <FilterActions onReset={() => { setDraft({ subject_id: "", status: "", scope: "", from: "", to: "" }); setDateError(""); }} onClose={() => setFiltersOpen(false)} />
          </form>
        </StudentDialog>
      ) : null}
      {adding && register ? (
        <ExamForm
          register={register}
          kinds={kinds}
          examTypes={examTypes}
          onClose={() => setAdding(false)}
          onSaved={async (title) => {
            setAdding(false);
            notify(`Recorded ${title}.`);
            await load();
          }}
        />
      ) : null}
    </section>
  );
}

function ExamForm({
  register,
  kinds,
  examTypes,
  onClose,
  onSaved,
}: {
  register: Register;
  kinds: ReturnType<typeof useCurriculumKinds>;
  examTypes: ReturnType<typeof useExamTypes>;
  onClose: () => void;
  onSaved: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [examDate, setExamDate] = useState("");
  const [maximum, setMaximum] = useState("");
  const [examKind, setExamKind] = useState("");
  const [subjectId, setSubjectId] = useState(register.subjects[0]?.id || "");
  const [scopeKind, setScopeKind] = useState("subject");
  const [itemIds, setItemIds] = useState<string[]>([]);
  const [batchIds, setBatchIds] = useState<string[]>([register.batch.id]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const subject = register.subjects.find((item) => item.id === subjectId);
  const activeKinds = kinds.filter((item) => !item.archived);
  const activeTypes = examTypes.filter((item) => !item.archived);
  const items = !subject || scopeKind === "subject"
    ? []
    : scopeKind === "paper"
      ? subject.papers
      : subject.units.filter((item) => item.kind === scopeKind);

  function toggle(list: string[], id: string, setList: (next: string[]) => void) {
    setList(list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api("/api/v1/exams", {
        method: "POST",
        body: JSON.stringify({
          title,
          exam_date: examDate,
          maximum: Number(maximum),
          subject_id: subjectId,
          scope: { kind: scopeKind, item_ids: scopeKind === "subject" ? [] : itemIds },
          exam_kind: examKind,
          batch_ids: batchIds,
        }),
      });
      await onSaved(title.trim());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not record the exam.");
      setSaving(false);
    }
  }

  return (
    <StudentDialog title="Add exam" onClose={onClose} dirty={Boolean(title.trim() || examDate || maximum)}>
      <form className="form-grid" onSubmit={save}>
        <p className="meta span-2">This exam is listed on every batch you include. Upload the marklist after it is recorded.</p>
        <label className="span-2">Title
          <input value={title} aria-label="Exam title" onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>Exam date
          <input type="date" value={examDate} aria-label="Exam date" onChange={(event) => setExamDate(event.target.value)} />
        </label>
        <label>Maximum
          <input inputMode="decimal" value={maximum} aria-label="Maximum" onChange={(event) => setMaximum(event.target.value)} />
        </label>
        <label>Subject
          <select aria-label="Subject" value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setItemIds([]); }}>
            {register.subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>Exam type
          <select aria-label="Exam type" value={examKind} onChange={(event) => setExamKind(event.target.value)}>
            <option value="">Choose an exam type</option>
            {activeTypes.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </label>
        <label>Subject partition
          <select aria-label="Subject partition" value={scopeKind} onChange={(event) => { setScopeKind(event.target.value); setItemIds([]); }}>
            <option value="subject">Whole subject</option>
            {activeKinds.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </label>
        {scopeKind !== "subject" ? (
          <div className="span-2">
            <p className="meta">{kindLabel(kinds, scopeKind)}</p>
            {items.length === 0 ? <p>This subject has no {kindLabel(kinds, scopeKind).toLowerCase()} items yet.</p> : (
              <div className="permission-picks">
                {items.map((item) => (
                  <button key={item.id} type="button" className={itemIds.includes(item.id) ? "permission is-selected" : "permission"} aria-pressed={itemIds.includes(item.id)} onClick={() => toggle(itemIds, item.id, setItemIds)}>
                    {item.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
        <div className="span-2">
          <p className="meta">Batches on {register.batch.course_name}</p>
          <div className="permission-picks">
            {register.course_batches.map((item) => (
              <button key={item.id} type="button" className={batchIds.includes(item.id) ? "permission is-selected" : "permission"} aria-pressed={batchIds.includes(item.id)} onClick={() => toggle(batchIds, item.id, setBatchIds)}>
                {item.name}{item.branch_name ? ` · ${item.branch_name}` : ""}
              </button>
            ))}
          </div>
        </div>
        {error ? <p className="error span-2" role="alert">{error}</p> : null}
        <div className="dialog-actions span-2">
          <button type="button" className="quiet" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={saving || !title.trim() || !examDate || !maximum || !examKind || !subjectId || (scopeKind !== "subject" && itemIds.length === 0) || batchIds.length === 0}>Add exam</button>
        </div>
      </form>
    </StudentDialog>
  );
}
