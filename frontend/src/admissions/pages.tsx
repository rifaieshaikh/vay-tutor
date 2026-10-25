import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { EnquiriesPage, EnquiryPage } from "./enquiries";
import { EnquiryImportPage } from "./enquiryImport";
import { ApiError, api, Session } from "../api";
import { Option } from "../filters";
import { formatDisplayDate } from "../format";
import { useUnsaved } from "../guard";
import { notify } from "../notify";
import { useRecordLabel } from "../orientation";
import { AcademicRecord, BLOOD_GROUPS, EMPTY_RECORD, GENDERS } from "../records";
import { confirmDiscard, StudentDialog } from "../ui";
import { AnswerFields, Question } from "./questions";

type CourseOption = { id: string; name: string };
type Answer = { question_id: string; label?: string; value: string };
type Difference = { field: string; label: string; application: string; student: string };
type Match = { id: string; display_name: string; student_code: string; phone: string; email?: string; differences?: Difference[] };
type Repeat = { id: string; reference: string; name: string };
type Prospect = { id: string; name: string; whatsapp: string };
type BatchChoice = { id: string; branch_id: string; branch_name: string; name: string; started_on: string; ended_on: string; open: boolean };
type Requirement = { key: string; state: string; section: string; field: string; label: string; message: string };
type Activity = { id: string; kind: string; at: string; note: string; actor?: string };
type Admission = {
  id: string;
  reference?: string;
  course_id: string;
  course_name: string;
  name: string;
  phone: string;
  date_of_birth: string;
  gender: string;
  blood_group: string;
  email: string;
  street: string;
  address_line_2: string;
  place: string;
  district: string;
  state: string;
  pin: string;
  guardian_name: string;
  guardian_phone: string;
  academic_records: AcademicRecord[];
  course_answers: Answer[];
  business_answers?: Answer[];
  questions: Question[];
  status: string;
  lifecycle?: string;
  readiness?: string;
  requirements?: Requirement[];
  student_id: string | null;
  enrollment_id?: string | null;
  branch_id?: string | null;
  branch_name?: string;
  batch_id?: string | null;
  batch_name?: string;
  enquiry_id: string | null;
  stage?: string;
  next_action?: string;
  blockers?: string[];
  match_decision: string;
  match_student_id: string;
  matches: Match[];
  closure_reason?: string;
  activity?: Activity[];
  created_at?: string;
  updated_at?: string;
  episode_note?: string;
  prospect?: Prospect | null;
  repeats?: Repeat[];
  batches?: BatchChoice[];
};

const BLOOD = BLOOD_GROUPS;
const CLOSURE_REASONS = ["Not interested", "Joined elsewhere", "Unable to contact", "Duplicate entry", "Created by mistake", "Other"];
const ADMISSION_SORTS = [
  { value: "created:desc", label: "Newest" },
  { value: "created:asc", label: "Oldest" },
  { value: "name:asc", label: "Name A to Z" },
  { value: "name:desc", label: "Name Z to A" },
  { value: "updated:desc", label: "Recently updated" },
  { value: "updated:asc", label: "Least recently updated" },
];

function readinessLabel(value = "") {
  if (value === "needs_information") return "Needs information";
  if (value === "needs_identity") return "Needs identity review";
  if (value === "needs_batch") return "Choose a batch";
  if (value === "ready") return "Ready for enrollment";
  if (value === "enrolled") return "Enrolled";
  if (value === "closed") return "Closed";
  if (value === "unavailable") return "Unavailable";
  return "Open";
}

function lifecycleLabel(item: Admission) {
  if (item.lifecycle === "enrolled" || item.status === "converted") return "Enrolled";
  if (item.lifecycle === "closed" || item.status === "closed") return "Closed";
  return "Open";
}

function sortToken(params: URLSearchParams) {
  const sort = params.get("sort") || "created";
  const direction = params.get("direction") || "desc";
  return `${sort}:${direction}`;
}

function withParam(params: URLSearchParams, key: string, value: string) {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value);
  else next.delete(key);
  if (key !== "page") next.delete("page");
  return next;
}

function coursesOf(catalog: { courses: CourseOption[] } | null) {
  return [...(catalog?.courses || [])].sort((left, right) => left.name.localeCompare(right.name));
}

export function AdmissionsPage({ session }: { session: Session }) {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") || "";
  const courseId = params.get("course_id") || "";
  const readiness = params.get("readiness") || "";
  const createdFrom = params.get("created_from") || "";
  const createdTo = params.get("created_to") || "";
  const branchId = params.get("branch_id") || "";
  const batchId = params.get("batch_id") || "";
  const query = params.get("q") || "";
  const sort = params.get("sort") || "";
  const direction = params.get("direction") || "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const canManage = session.actions.includes("student.manage");
  const [items, setItems] = useState<Admission[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [draft, setDraft] = useState(query);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState({ courseId: "", status: "", readiness: "", createdFrom: "", createdTo: "", branchId: "", batchId: "" });
  const [places, setPlaces] = useState<{ branches: Option[]; batches: Option[] }>({ branches: [], batches: [] });
  const filtered = Boolean(query || status || courseId || readiness || createdFrom || createdTo || branchId || batchId);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const preset = !courseId && !createdFrom && !createdTo && !branchId && !batchId
    ? (readiness === "needs_information" || readiness === "needs_identity" || readiness === "ready") && !status
      ? readiness
      : status === "converted" && !readiness
        ? "enrolled"
        : status === "closed" && !readiness
          ? "closed"
          : !status && !readiness
            ? "all"
            : ""
    : "";

  useEffect(() => { setDraft(query); }, [query]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (draft === query) return;
      setParams(withParam(params, "q", draft.trim()));
    }, 300);
    return () => window.clearTimeout(handle);
  }, [draft, query, params, setParams]);

  useEffect(() => {
    const searchParams = new URLSearchParams();
    if (query) searchParams.set("q", query);
    if (status) searchParams.set("status", status);
    if (courseId) searchParams.set("course_id", courseId);
    if (readiness) searchParams.set("readiness", readiness);
    if (createdFrom) searchParams.set("created_from", createdFrom);
    if (createdTo) searchParams.set("created_to", createdTo);
    if (branchId) searchParams.set("branch_id", branchId);
    if (batchId) searchParams.set("batch_id", batchId);
    if (sort) searchParams.set("sort", sort);
    if (direction) searchParams.set("direction", direction);
    searchParams.set("page", String(page));
    let cancelled = false;
    setLoading(true);
    api<{ items: Admission[]; total: number; pages: number }>(`/api/v1/admissions?${searchParams.toString()}`)
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        setTotal(result.total);
        setPages(result.pages);
        setError("");
      })
      .catch((reason: Error) => { if (!cancelled) setError(reason.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    api<{ courses: CourseOption[] }>("/api/v1/catalog").then((catalog) => { if (!cancelled) setCourses(coursesOf(catalog)); }).catch(() => undefined);
    api<{ branches: Option[]; batches: Option[] }>("/api/v1/students/options").then((result) => { if (!cancelled) setPlaces(result); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [status, courseId, readiness, createdFrom, createdTo, branchId, batchId, sort, direction, query, page, revision]);

  function applyView(value: string) {
    const next = new URLSearchParams();
    if (query) next.set("q", query);
    if (value === "needs_information" || value === "needs_identity" || value === "ready") next.set("readiness", value);
    if (value === "enrolled") next.set("status", "converted");
    if (value === "closed") next.set("status", "closed");
    setParams(next);
  }

  function applySort(value: string) {
    const next = new URLSearchParams(params);
    next.delete("page");
    const [field, way] = value.split(":");
    if (field === "created" && way === "desc") {
      next.delete("sort");
      next.delete("direction");
    } else {
      next.set("sort", field);
      next.set("direction", way);
    }
    setParams(next);
  }

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    const next = new URLSearchParams(params);
    next.delete("page");
    const write = (key: string, value: string) => { if (value) next.set(key, value); else next.delete(key); };
    write("course_id", filterDraft.courseId);
    write("status", filterDraft.status);
    write("readiness", filterDraft.readiness);
    write("created_from", filterDraft.createdFrom);
    write("created_to", filterDraft.createdTo);
    write("branch_id", filterDraft.branchId);
    write("batch_id", filterDraft.batchId);
    setParams(next);
    setFiltersOpen(false);
  }

  const chips: { key: string; label: string }[] = [];
  if (branchId) chips.push({ key: "branch_id", label: places.branches.find((item) => item.id === branchId)?.label || "Branch" });
  if (courseId) chips.push({ key: "course_id", label: courses.find((item) => item.id === courseId)?.name || "Course" });
  if (batchId) chips.push({ key: "batch_id", label: places.batches.find((item) => item.id === batchId)?.label || "Batch" });
  if (status) chips.push({ key: "status", label: status === "converted" ? "Enrolled" : status === "closed" ? "Closed" : "Open" });
  if (readiness) chips.push({ key: "readiness", label: readinessLabel(readiness) });
  if (createdFrom || createdTo) chips.push({ key: "created", label: `Created ${createdFrom || "…"} to ${createdTo || "…"}` });
  if (query) chips.push({ key: "q", label: query });
  const start = total === 0 ? 0 : (page - 1) * 20 + 1;
  const end = Math.min(page * 20, total);

  return (
    <section className="panel wide">
      <div className="page-title">
        <div>
          <p className="eyebrow">Admissions</p>
          <h1>Admissions</h1>
        </div>
        {canManage ? (
          <div className="actions">
            <Link className="button secondary" to="/students/admissions/import?new=1">Import</Link>
            <Link className="button" to="/students/admissions/new">Add admission</Link>
          </div>
        ) : null}
      </div>
      <div className="preset-row" role="group" aria-label="Views">
        <button type="button" className="secondary" aria-pressed={preset === "all"} onClick={() => applyView("all")}>All</button>
        <button type="button" className="secondary" aria-pressed={preset === "needs_information"} onClick={() => applyView("needs_information")}>Needs information</button>
        <button type="button" className="secondary" aria-pressed={preset === "needs_identity"} onClick={() => applyView("needs_identity")}>Needs identity review</button>
        <button type="button" className="secondary" aria-pressed={preset === "ready"} onClick={() => applyView("ready")}>Ready for enrollment</button>
        <button type="button" className="secondary" aria-pressed={preset === "enrolled"} onClick={() => applyView("enrolled")}>Enrolled</button>
        <button type="button" className="secondary" aria-pressed={preset === "closed"} onClick={() => applyView("closed")}>Closed</button>
        {filtered && !preset ? <span className="chip-button">Custom</span> : null}
      </div>
      <form className="toolbar" onSubmit={(event) => { event.preventDefault(); setParams(withParam(params, "q", draft.trim())); }}>
        <label>Search
          <input value={draft} aria-label="Search admissions" placeholder="Name, contact, email, or reference" onChange={(event) => setDraft(event.target.value)} />
        </label>
        <label>Sort
          <select aria-label="Sort" value={sortToken(params)} onChange={(event) => applySort(event.target.value)}>
            {ADMISSION_SORTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <button type="button" className="secondary" onClick={() => { setFilterDraft({ courseId, status, readiness, createdFrom, createdTo, branchId, batchId }); setFiltersOpen(true); }}>Filters</button>
      </form>
      <p className="filter-row">
        <span role="status">{loading ? "Loading admissions…" : error ? "Admissions could not be loaded." : `${start}–${end} of ${total}`}</span>
        {chips.map((chip) => (
          <button key={chip.key} type="button" className="chip-button" onClick={() => {
            const next = new URLSearchParams(params);
            next.delete("page");
            if (chip.key === "created") { next.delete("created_from"); next.delete("created_to"); }
            else next.delete(chip.key);
            setParams(next);
          }}>{chip.label}</button>
        ))}
        {filtered ? <button type="button" className="quiet" onClick={() => setParams(new URLSearchParams())}>Clear filters</button> : null}
      </p>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {error ? <button type="button" className="secondary" onClick={() => setRevision((value) => value + 1)}>Retry</button> : null}
      {!error && items.length === 0 && !loading ? <p>{filtered ? "No admissions match." : "No admissions yet."}</p> : null}
      {items.length > 0 ? (
        <div className="table-wrap">
          <table className="people-table">
            <caption className="sr-only">Admissions</caption>
            <thead><tr><th>Applicant</th><th>Reference</th><th>Course</th><th>Status</th><th>Readiness</th><th>Created</th><th>Next</th></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="person-cell">
                      <Link to={`/students/admissions/${item.id}`}>{item.name}</Link>
                      <span className="meta">{item.phone || item.email || "No contact"}</span>
                    </div>
                  </td>
                  <td>{item.reference || "Not recorded"}</td>
                  <td>{item.course_name || "Not recorded"}</td>
                  <td>{lifecycleLabel(item)}</td>
                  <td>{readinessLabel(item.readiness)}</td>
                  <td>{formatDisplayDate(item.created_at)}</td>
                  <td>{item.student_id ? <Link to={`/students/${item.student_id}`}>Open student</Link> : (item.next_action || "Complete the application")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {total > 0 ? (
        <p className="actions">
          <button type="button" className="secondary" disabled={page <= 1} onClick={() => setParams(withParam(params, "page", String(page - 1)))}>Previous</button>
          <span>Page {page} of {pages}</span>
          <button type="button" className="secondary" disabled={page >= pages} onClick={() => setParams(withParam(params, "page", String(page + 1)))}>Next</button>
        </p>
      ) : null}
      {filtersOpen ? (
        <StudentDialog title="Filters" onClose={() => setFiltersOpen(false)}>
          <form className="form-grid" onSubmit={applyFilters}>
            <label>Branch
              <select aria-label="Branch" value={filterDraft.branchId} onChange={(event) => setFilterDraft({ ...filterDraft, branchId: event.target.value })}>
                <option value="">Any branch</option>
                {places.branches.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label>Course
              <select aria-label="Course" value={filterDraft.courseId} onChange={(event) => setFilterDraft({ ...filterDraft, courseId: event.target.value })}>
                <option value="">Any course</option>
                {courses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label>Batch
              <select aria-label="Batch" value={filterDraft.batchId} onChange={(event) => setFilterDraft({ ...filterDraft, batchId: event.target.value })}>
                <option value="">Any batch</option>
                {places.batches.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label>Status
              <select aria-label="Status" value={filterDraft.status} onChange={(event) => setFilterDraft({ ...filterDraft, status: event.target.value })}>
                <option value="">Any</option>
                <option value="open">Open</option>
                <option value="converted">Enrolled</option>
                <option value="closed">Closed</option>
              </select>
            </label>
            <label className="span-2">Readiness
              <select aria-label="Readiness" value={filterDraft.readiness} onChange={(event) => setFilterDraft({ ...filterDraft, readiness: event.target.value })}>
                <option value="">Any</option>
                <option value="needs_information">Needs information</option>
                <option value="needs_identity">Needs identity review</option>
                <option value="needs_batch">Choose a batch</option>
                <option value="ready">Ready for enrollment</option>
                <option value="enrolled">Enrolled</option>
                <option value="closed">Closed</option>
              </select>
            </label>
            <label>Created from
              <input type="date" aria-label="Created from" value={filterDraft.createdFrom} onChange={(event) => setFilterDraft({ ...filterDraft, createdFrom: event.target.value })} />
            </label>
            <label>Created to
              <input type="date" aria-label="Created to" value={filterDraft.createdTo} onChange={(event) => setFilterDraft({ ...filterDraft, createdTo: event.target.value })} />
            </label>
            <div className="dialog-actions span-2">
              <button type="button" className="quiet" onClick={() => setFilterDraft({ courseId: "", status: "", readiness: "", createdFrom: "", createdTo: "", branchId: "", batchId: "" })}>Reset</button>
              <button type="button" className="secondary" onClick={() => setFiltersOpen(false)}>Cancel</button>
              <button type="submit">Apply</button>
            </div>
          </form>
        </StudentDialog>
      ) : null}
    </section>
  );
}

export function AdmissionPage({ session }: { session: Session }) {
  const { admissionId = "" } = useParams();
  const navigate = useNavigate();
  const canManage = session.actions.includes("student.manage");
  const [admission, setAdmission] = useState<Admission | null>(null);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [options, setOptions] = useState<{ branches: Option[]; batches: Option[] }>({ branches: [], batches: [] });
  const [editing, setEditing] = useState(false);
  const [branchId, setBranchId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [error, setError] = useState("");
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeReason, setCloseReason] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [reopening, setReopening] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [focusField, setFocusField] = useState("");
  const [correcting, setCorrecting] = useState(false);
  const enrollKey = useRef("");
  useRecordLabel(admission?.name || "");
  useUnsaved(!editing && !saving && (branchId !== (admission?.branch_id || "") || batchId !== (admission?.batch_id || "")));

  function load() {
    api<Admission>(`/api/v1/admissions/${admissionId}`).then((result) => {
      setAdmission(result);
      setBranchId(result.branch_id || "");
      setBatchId(result.batch_id || "");
    }).catch((reason: Error) => setError(reason.message));
  }

  useEffect(() => {
    load();
    api<{ courses: CourseOption[] }>("/api/v1/catalog").then((catalog) => setCourses(coursesOf(catalog))).catch(() => undefined);
    if (canManage) {
      api<{ branches: Option[]; batches: Option[] }>("/api/v1/students/options?manage=true").then(setOptions).catch((reason: Error) => setError(reason.message || "Branches could not be loaded."));
    }
    api<{ items: Question[] }>("/api/v1/form-questions?form=admission").then(() => undefined).catch((reason: Error) => setError(reason.message || "Questions could not be loaded."));
  }, [admissionId]);

  async function confirmIdentity(decision: string, studentId = "") {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await api(`/api/v1/admissions/${admissionId}/identity`, {
        method: "POST",
        body: JSON.stringify({ decision, student_id: studentId, expected_updated_at: admission?.updated_at || "" }),
      });
      setMatches(null);
      notify(decision === "create" ? "Confirmed a new student." : "Confirmed the existing student.");
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Identity was not confirmed.");
    } finally {
      setSaving(false);
    }
  }

  async function saveSelection(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await api(`/api/v1/admissions/${admissionId}/selection`, {
        method: "POST",
        body: JSON.stringify({ branch_id: branchId, batch_id: batchId, expected_updated_at: admission?.updated_at || "" }),
      });
      const batch = options.batches.find((item) => item.id === batchId);
      notify(batch ? `Selected ${batch.label}.` : "Saved the batch.");
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The batch was not saved.");
    } finally {
      setSaving(false);
    }
  }

  async function convert() {
    if (saving || !admission) return;
    setSaving(true);
    setError("");
    try {
      if (!enrollKey.current) enrollKey.current = crypto.randomUUID();
      const result = await api<{ id: string }>(`/api/v1/admissions/${admissionId}/convert`, {
        method: "POST",
        headers: { "Idempotency-Key": enrollKey.current },
        body: JSON.stringify({
          branch_id: admission.branch_id,
          batch_id: admission.batch_id,
          decision: admission.match_decision,
          student_id: admission.match_student_id,
          expected_updated_at: admission.updated_at || "",
        }),
      });
      notify(`Enrolled ${admission.name} in ${admission.batch_name || "the batch"}.`);
      navigate(`/students/${result.id}`);
    } catch (reason) {
      setSaving(false);
      if (reason instanceof ApiError && (reason.code === "admission.match" || reason.code === "admission.identity")) {
        setMatches(admission.matches || []);
        return;
      }
      setError(reason instanceof Error ? reason.message : "The student was not enrolled.");
    }
  }

  async function closeApplication(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(`/api/v1/admissions/${admissionId}/close`, {
        method: "POST",
        body: JSON.stringify({ reason: closeReason, note: closeNote, expected_updated_at: admission?.updated_at || "" }),
      });
      setClosing(false);
      notify("Closed the application.");
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The application was not closed.");
    } finally {
      setSaving(false);
    }
  }

  async function reopenApplication(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(`/api/v1/admissions/${admissionId}/reopen`, {
        method: "POST",
        body: JSON.stringify({ reason: reopenReason.trim(), expected_updated_at: admission?.updated_at || "" }),
      });
      setReopening(false);
      notify("Reopened the application.");
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The application was not reopened.");
    } finally {
      setSaving(false);
    }
  }

  if (!admission) {
    return <section className="panel">{error ? <p className="error" role="alert">{error}</p> : <p>Loading admission…</p>}</section>;
  }
  const batches = (admission.batches || []).filter((item) => item.open && (!branchId || item.branch_id === branchId));
  const open = admission.status !== "converted" && admission.status !== "closed";
  const readiness = admission.readiness || "";
  const selectionDirty = branchId !== (admission.branch_id || "") || batchId !== (admission.batch_id || "");
  const selectedBatch = options.batches.find((item) => item.id === (admission.batch_id || ""));
  return (
    <section className="panel wide">
      <div className="title-row">
        <div>
          <p className="eyebrow">Admission {admission.reference || ""}</p>
          <h1>{admission.name}</h1>
          <p className="meta">{admission.course_name || "Course not recorded"} · {lifecycleLabel(admission)} · {readinessLabel(readiness)} · {admission.next_action || "Complete the application"}</p>
        </div>
        <div className="actions">
          {readiness === "needs_information" && canManage ? <button type="button" onClick={() => setEditing(true)}>Complete details</button> : null}
          {readiness === "needs_identity" && canManage ? <button type="button" onClick={() => setMatches(admission.matches || [])}>Confirm identity</button> : null}
          {readiness === "ready" && canManage ? <button type="button" disabled={saving} onClick={() => void convert()}>{saving ? "Enrolling…" : `Enroll in ${admission.batch_name || selectedBatch?.label || "batch"}`}</button> : null}
          {admission.enquiry_id ? <Link to={`/students/enquiries/${admission.enquiry_id}`}>Open enquiry</Link> : null}
          {canManage && open && !editing ? <button type="button" className="secondary" onClick={() => setEditing(true)}>Edit</button> : null}
          {canManage && open ? <button type="button" className="secondary" onClick={() => setClosing(true)}>Close</button> : null}
          {canManage && admission.status === "closed" ? <button type="button" onClick={() => setReopening(true)}>Reopen</button> : null}
          {canManage && admission.status === "converted" ? <button type="button" className="secondary" onClick={() => { setCorrecting(true); setEditing(true); }}>Correct source record</button> : null}
          {admission.student_id ? <Link to={`/students/${admission.student_id}`}>Open student</Link> : null}
          {admission.batch_id ? <Link to={`/batches/${admission.batch_id}?branch_id=${admission.branch_id || ""}&course_id=${admission.course_id}&batch_id=${admission.batch_id}`}>Open batch</Link> : null}
        </div>
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {open ? (
        <div>
          <h2>Checklist</h2>
          {readiness === "unavailable" ? <p>Requirements could not be loaded. <button type="button" onClick={() => load()}>Retry</button> before treating this application as ready.</p> : null}
          {(admission.requirements || []).length ? (
            <ul>
              {(admission.requirements || []).map((item) => (
                <li key={item.key}>
                  {canManage ? <button type="button" className="quiet" onClick={() => { setFocusField(item.field); setEditing(true); }}>{item.message}</button> : item.message}
                </li>
              ))}
            </ul>
          ) : null}
          {(admission.repeats || []).length ? <p>Another open application exists for this person and course: {(admission.repeats || []).map((item) => <Link key={item.id} to={`/students/admissions/${item.id}`}>{item.reference || item.name}</Link>)}.</p> : null}
          {admission.prospect ? <p>Confirmed prospect from enquiries: {admission.prospect.name}{admission.prospect.whatsapp ? ` · ${admission.prospect.whatsapp}` : ""}. This still needs an identity decision.</p> : null}
          {readiness === "needs_identity" ? <p>Information is complete. Confirm whether this is an existing student or a new student. A shared name or phone number is not enough on its own.</p> : null}
          {readiness === "needs_batch" ? <p>Identity is confirmed. Choose an open batch for this course.</p> : null}
          {readiness === "ready" ? <p>Ready to enroll in {admission.batch_name || "the selected batch"}.</p> : null}
        </div>
      ) : admission.status === "closed" ? <p>Closed: {admission.closure_reason || "Closed"}.</p> : <p>This application is the historical source for the enrollment. Correcting it does not change the student profile. Use the student record for later edits.</p>}
      {editing ? (
        <AdmissionForm
          courses={courses}
          initial={admission}
          focusField={focusField}
          correction={correcting}
          onCancel={() => { setEditing(false); setCorrecting(false); setFocusField(""); }}
          onSaved={() => { setEditing(false); setCorrecting(false); setFocusField(""); load(); }}
        />
      ) : (
      <>
      <dl className="facts">
        <div><dt>Contact number</dt><dd>{admission.phone}</dd></div>
        <div><dt>Date of birth</dt><dd className={admission.date_of_birth ? undefined : "is-empty"}>{formatDisplayDate(admission.date_of_birth)}</dd></div>
        <div><dt>Gender</dt><dd className={admission.gender ? undefined : "is-empty"}>{admission.gender || "Not recorded"}</dd></div>
        <div><dt>Blood group</dt><dd className={admission.blood_group ? undefined : "is-empty"}>{admission.blood_group || "Not recorded"}</dd></div>
        <div className="span-2"><dt>Email</dt><dd className={admission.email ? undefined : "is-empty"}>{admission.email || "Not recorded"}</dd></div>
        <div className="span-2"><dt>Address</dt><dd className={admission.street ? undefined : "is-empty"}>{[admission.street, admission.address_line_2, admission.place, admission.district, admission.state, admission.pin].filter(Boolean).join(", ") || "Not recorded"}</dd></div>
        <div><dt>Parent or guardian</dt><dd className={admission.guardian_name ? undefined : "is-empty"}>{admission.guardian_name || "Not recorded"}</dd></div>
        <div><dt>Parent contact</dt><dd className={admission.guardian_phone ? undefined : "is-empty"}>{admission.guardian_phone || "Not recorded"}</dd></div>
      </dl>
      <h2>Previous education</h2>
      {admission.academic_records.length === 0 ? <p>No academic records yet.</p> : <RecordTable records={admission.academic_records} />}
      {admission.course_answers.length ? (
        <>
          <h2>Course requirements</h2>
          <dl className="facts">
            {admission.course_answers.map((item) => (
              <div key={item.question_id} className="span-2"><dt>{item.label || "Question"}</dt><dd className={item.value ? undefined : "is-empty"}>{item.value || "Not recorded"}</dd></div>
            ))}
          </dl>
        </>
      ) : null}
      {(admission.business_answers || []).length ? (
        <>
          <h2>Additional information</h2>
          <dl className="facts">
            {(admission.business_answers || []).map((item) => (
              <div key={item.question_id} className="span-2"><dt>{item.label || "Question"}</dt><dd className={item.value ? undefined : "is-empty"}>{item.value || "Not recorded"}</dd></div>
            ))}
          </dl>
        </>
      ) : null}
      {canManage && (readiness === "needs_batch" || readiness === "ready") ? (
        <form className="form-grid" id="batch" onSubmit={(event) => void saveSelection(event)}>
          <h2 className="span-2">Batch</h2>
          {admission.match_decision === "attach" ? <p className="span-2">This application will enroll the confirmed existing student. Their current profile is left unchanged.</p> : null}
          {admission.match_decision === "create" ? <p className="span-2">This application will create a new student.</p> : null}
          <label>Branch
            <select value={branchId} onChange={(event) => { setBranchId(event.target.value); setBatchId(""); setError(""); }}>
              <option value="">Choose</option>
              {options.branches.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label>Batch
            <select value={batchId} onChange={(event) => { setBatchId(event.target.value); setError(""); }}>
              <option value="">Choose</option>
              {batches.map((item) => <option key={item.id} value={item.id} disabled={!item.open}>{[item.name, [item.started_on, item.ended_on].filter(Boolean).join(" – "), item.open ? "" : "Closed"].filter(Boolean).join(" · ")}</option>)}
            </select>
          </label>
          <div className="dialog-actions span-2">
            <button type="submit" className="secondary" disabled={saving || !branchId || !batchId || !selectionDirty}>{saving ? "Saving…" : "Save batch"}</button>
          </div>
        </form>
      ) : null}
      {(admission.activity || []).length ? (
        <>
          <h2>Activity</h2>
          <ul>
            {(admission.activity || []).map((item) => (
              <li key={item.id}>{item.note || item.kind}{item.actor ? ` · ${item.actor}` : ""}{item.at ? ` · ${formatDisplayDate(item.at)}` : ""}</li>
            ))}
          </ul>
        </>
      ) : null}
      </>
      )}
      {matches ? (
        <StudentDialog title="Confirm identity" onClose={() => setMatches(null)}>
          <p>Choose an existing student when the details identify the same person, or create a separate student. A shared name or phone number is not proof.</p>
          {matches.length === 0 ? <p>No existing student matches this name and contact number.</p> : null}
          {matches.map((item) => (
            <div className="title-row" key={item.id}>
              <div>
                <p>{item.display_name} · {item.student_code} · {item.phone}</p>
                {(item.differences || []).length ? <ul>{item.differences?.map((difference) => <li key={difference.field}>{difference.label}: application {difference.application}, student {difference.student}. The student profile stays as it is.</li>)}</ul> : <p>No differing profile fields are recorded.</p>}
              </div>
              <button type="button" disabled={saving} onClick={() => void confirmIdentity("attach", item.id)}>Use this student</button>
            </div>
          ))}
          <div className="dialog-actions">
            <button type="button" className="quiet" onClick={() => setMatches(null)}>Cancel</button>
            <button type="button" disabled={saving} onClick={() => void confirmIdentity("create")}>Create a separate student</button>
          </div>
        </StudentDialog>
      ) : null}
      {closing ? (
        <StudentDialog title="Close application" dirty={Boolean(closeReason || closeNote)} onClose={() => setClosing(false)}>
          <form className="form-grid" onSubmit={(event) => void closeApplication(event)}>
            <label className="span-2">Reason
              <select aria-label="Closure reason" value={closeReason} required onChange={(event) => setCloseReason(event.target.value)}>
                <option value="">Choose</option>
                {CLOSURE_REASONS.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label className="span-2">Note
              <textarea aria-label="Closure note" value={closeNote} onChange={(event) => setCloseNote(event.target.value)} />
            </label>
            <div className="dialog-actions span-2">
              <button type="button" className="secondary" onClick={() => setClosing(false)}>Cancel</button>
              <button type="submit" disabled={saving || !closeReason}>{saving ? "Closing…" : "Close application"}</button>
            </div>
          </form>
        </StudentDialog>
      ) : null}
      {reopening ? (
        <StudentDialog title="Reopen application" dirty={Boolean(reopenReason)} onClose={() => setReopening(false)}>
          <form className="form-grid" onSubmit={(event) => void reopenApplication(event)}>
            <label className="span-2">Reason
              <textarea aria-label="Reopen reason" required value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} />
            </label>
            <div className="dialog-actions span-2">
              <button type="button" className="secondary" onClick={() => setReopening(false)}>Cancel</button>
              <button type="submit" disabled={saving || !reopenReason.trim()}>{saving ? "Reopening…" : "Reopen"}</button>
            </div>
          </form>
        </StudentDialog>
      ) : null}
    </section>
  );
}

export function AdmissionCreatePage() {
  const navigate = useNavigate();
  const [courses, setCourses] = useState<CourseOption[]>([]);
  useEffect(() => {
    api<{ courses: CourseOption[] }>("/api/v1/catalog").then((catalog) => setCourses(coursesOf(catalog))).catch(() => undefined);
  }, []);
  return (
    <section className="panel wide">
      <div className="page-title">
        <div>
          <p className="eyebrow">Admissions</p>
          <h1>New admission</h1>
        </div>
      </div>
      <AdmissionForm courses={courses} onSaved={(id) => navigate(`/students/admissions/${id}`)} />
    </section>
  );
}

function RecordTable({ records }: { records: AcademicRecord[] }) {
  return (
    <div className="table-wrap">
      <table className="people-table">
        <caption className="sr-only">Academic records</caption>
        <thead><tr><th>Qualification</th><th>Stream</th><th>Institution</th><th>Mark</th><th>Year</th><th>Board</th></tr></thead>
        <tbody>
          {records.map((item, index) => (
            <tr key={`${item.qualification}-${index}`}>
              <td>{item.qualification || "Not recorded"}</td>
              <td>{item.stream || "Not recorded"}</td>
              <td>{item.institution || "Not recorded"}</td>
              <td>{item.mark || "Not recorded"}</td>
              <td>{item.year_of_passing || "Not recorded"}</td>
              <td>{item.board || "Not recorded"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdmissionForm({ courses, initial, onSaved, onCancel, focusField = "", correction = false }: { courses: CourseOption[]; initial?: Admission; onSaved: (id: string) => void; onCancel?: () => void; focusField?: string; correction?: boolean }) {
  const [courseId, setCourseId] = useState(initial?.course_id || "");
  const [questions, setQuestions] = useState<Question[]>(initial?.questions || []);
  const [questionsFailed, setQuestionsFailed] = useState(false);
  const [businessFailed, setBusinessFailed] = useState(false);
  const [questionAttempt, setQuestionAttempt] = useState(0);
  const [courseNote, setCourseNote] = useState("");
  const [episodeNote, setEpisodeNote] = useState("");
  const [correctionNote, setCorrectionNote] = useState("");
  const [name, setName] = useState(initial?.name || "");
  const [phone, setPhone] = useState(initial?.phone || "");
  const [dob, setDob] = useState(initial?.date_of_birth || "");
  const [gender, setGender] = useState(initial?.gender || "");
  const [blood, setBlood] = useState(initial?.blood_group || "");
  const [email, setEmail] = useState(initial?.email || "");
  const [street, setStreet] = useState(initial?.street || "");
  const [line2, setLine2] = useState(initial?.address_line_2 || "");
  const [place, setPlace] = useState(initial?.place || "");
  const [district, setDistrict] = useState(initial?.district || "");
  const [stateName, setStateName] = useState(initial?.state || "");
  const [pin, setPin] = useState(initial?.pin || "");
  const [guardian, setGuardian] = useState(initial?.guardian_name || "");
  const [guardianPhone, setGuardianPhone] = useState(initial?.guardian_phone || "");
  const [records, setRecords] = useState<AcademicRecord[]>(initial?.academic_records.length ? initial.academic_records : [{ ...EMPTY_RECORD }]);
  const [answers, setAnswers] = useState<Record<string, string>>(Object.fromEntries((initial?.course_answers || []).map((item) => [item.question_id, item.value])));
  const [businessQuestions, setBusinessQuestions] = useState<Question[]>([]);
  const [business, setBusiness] = useState<Record<string, string>>(Object.fromEntries((initial?.business_answers || []).map((item) => [item.question_id, item.value])));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const stored = (list: Answer[] | undefined, id: string) => list?.find((item) => item.question_id === id)?.value || "";
  const dirty = !saving && (
    name !== (initial?.name || "")
    || phone !== (initial?.phone || "")
    || courseId !== (initial?.course_id || "")
    || dob !== (initial?.date_of_birth || "")
    || gender !== (initial?.gender || "")
    || blood !== (initial?.blood_group || "")
    || email !== (initial?.email || "")
    || street !== (initial?.street || "")
    || line2 !== (initial?.address_line_2 || "")
    || place !== (initial?.place || "")
    || district !== (initial?.district || "")
    || stateName !== (initial?.state || "")
    || pin !== (initial?.pin || "")
    || guardian !== (initial?.guardian_name || "")
    || guardianPhone !== (initial?.guardian_phone || "")
    || questions.some((item) => (answers[item.id] || "") !== stored(initial?.course_answers, item.id))
    || businessQuestions.some((item) => (business[item.id] || "") !== stored(initial?.business_answers, item.id))
    || JSON.stringify(records) !== JSON.stringify(initial?.academic_records?.length ? initial.academic_records : [{ ...EMPTY_RECORD }])
  );
  useUnsaved(dirty);

  useEffect(() => {
    if (!focusField) return;
    document.getElementById(`field-${focusField}`)?.focus();
  }, [focusField, questions, businessQuestions]);

  useEffect(() => {
    if (!courseId) {
      setQuestions([]);
      setQuestionsFailed(false);
      return;
    }
    api<{ items: Question[] }>(`/api/v1/courses/${courseId}/questions`)
      .then((result) => { setQuestions(result.items); setQuestionsFailed(false); })
      .catch(() => { setQuestions([]); setQuestionsFailed(true); });
  }, [courseId, questionAttempt]);

  useEffect(() => {
    if (!initial?.id || !courseId || courseId === initial.course_id) {
      setCourseNote("");
      return;
    }
    api<{ message: string }>(`/api/v1/admissions/${initial.id}/course-change?course_id=${courseId}`)
      .then((result) => setCourseNote(result.message))
      .catch((reason: Error) => setCourseNote(reason.message || "The course change could not be reviewed."));
  }, [courseId, initial]);

  useEffect(() => {
    api<{ items: Question[] }>("/api/v1/form-questions?form=admission")
      .then((result) => { setBusinessQuestions(result.items); setBusinessFailed(false); })
      .catch(() => { setBusinessQuestions([]); setBusinessFailed(true); setError("Questions could not be loaded."); });
  }, [questionAttempt]);

  function updateRecord(index: number, key: keyof AcademicRecord, value: string) {
    setRecords((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const body = {
      course_id: courseId,
      name,
      phone,
      date_of_birth: dob,
      gender,
      blood_group: blood,
      email,
      street,
      address_line_2: line2,
      place,
      district,
      state: stateName,
      pin,
      guardian_name: guardian,
      guardian_phone: guardianPhone,
      academic_records: records,
      course_answers: questions.map((item) => ({ question_id: item.id, value: answers[item.id] || "" })),
      business_answers: businessQuestions.map((item) => ({ question_id: item.id, value: business[item.id] || "" })),
      episode_note: episodeNote,
      confirm_course_change: Boolean(initial && courseId !== initial.course_id),
      expected_updated_at: initial?.updated_at || "",
    };
    try {
      const saved = correction && initial
        ? await api<{ id: string }>(`/api/v1/admissions/${initial.id}/correction`, { method: "POST", body: JSON.stringify({ ...body, note: correctionNote }) })
        : initial
        ? await api<{ id: string }>(`/api/v1/admissions/${initial.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : await api<{ id: string }>("/api/v1/admissions", { method: "POST", body: JSON.stringify(body) });
      notify(`Saved ${name}.`);
      onSaved(saved.id || initial?.id || "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The admission was not saved.");
      setSaving(false);
    }
  }

  return (
      <form className="form-grid" onSubmit={save}>
        <h2 className="span-2">Contact</h2>
        <label>Name
          <input value={name} required onChange={(event) => setName(event.target.value)} />
        </label>
        <label>Contact number
          <input id="field-phone" value={phone} onChange={(event) => setPhone(event.target.value)} />
        </label>
        <h2 className="span-2">Course</h2>
        <label className="span-2">Course
          <select id="field-course_id" value={courseId} required onChange={(event) => setCourseId(event.target.value)}>
            <option value="">Choose</option>
            {courses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        {courseNote ? <p className="span-2" role="status">{courseNote}</p> : null}
        {questionsFailed ? <p className="span-2 error" role="alert">Course questions could not be loaded. <button type="button" onClick={() => setQuestionAttempt((value) => value + 1)}>Retry</button></p> : null}
        {businessFailed ? <p className="span-2 error" role="alert">Additional questions could not be loaded. <button type="button" onClick={() => setQuestionAttempt((value) => value + 1)}>Retry</button></p> : null}
        <h2 className="span-2">Course requirements</h2>
        <AnswerFields questions={questions} answers={answers} onChange={(id, value) => setAnswers({ ...answers, [id]: value })} requiredNote="required to enroll" />
        <h2 className="span-2">Additional information</h2>
        <AnswerFields questions={businessQuestions} answers={business} onChange={(id, value) => setBusiness({ ...business, [id]: value })} requiredNote="required to enroll" />
        <h2 className="span-2">Optional details</h2>
        <label>Date of birth
          <input type="date" value={dob} onChange={(event) => setDob(event.target.value)} />
        </label>
        <label>Gender
          <select value={gender} onChange={(event) => setGender(event.target.value)}>
            <option value="">Not recorded</option>
            {GENDERS.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label>Blood group
          <select value={blood} onChange={(event) => setBlood(event.target.value)}>
            <option value="">Not recorded</option>
            {BLOOD.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label>Email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="span-2">Address line 1
          <input value={street} onChange={(event) => setStreet(event.target.value)} />
        </label>
        <label className="span-2">Address line 2
          <input value={line2} onChange={(event) => setLine2(event.target.value)} />
        </label>
        <label>City
          <input value={place} onChange={(event) => setPlace(event.target.value)} />
        </label>
        <label>District
          <input value={district} onChange={(event) => setDistrict(event.target.value)} />
        </label>
        <label>State
          <input value={stateName} onChange={(event) => setStateName(event.target.value)} />
        </label>
        <label>PIN
          <input value={pin} inputMode="numeric" maxLength={6} onChange={(event) => setPin(event.target.value)} />
        </label>
        <label>Parent or guardian
          <input value={guardian} onChange={(event) => setGuardian(event.target.value)} />
        </label>
        <label>Parent contact
          <input value={guardianPhone} onChange={(event) => setGuardianPhone(event.target.value)} />
        </label>
        <h2 className="span-2">Previous education</h2>
        {records.map((record, index) => (
          <div className="span-2 form-grid" key={index}>
            <label>Qualification
              <input value={record.qualification} aria-label={`Qualification ${index + 1}`} onChange={(event) => updateRecord(index, "qualification", event.target.value)} />
            </label>
            <label>Stream or department
              <input value={record.stream} aria-label={`Stream ${index + 1}`} onChange={(event) => updateRecord(index, "stream", event.target.value)} />
            </label>
            <label className="span-2">Institution
              <input value={record.institution} aria-label={`Institution ${index + 1}`} onChange={(event) => updateRecord(index, "institution", event.target.value)} />
            </label>
            <label>Mark
              <input value={record.mark} aria-label={`Mark ${index + 1}`} onChange={(event) => updateRecord(index, "mark", event.target.value)} />
            </label>
            <label>Year of passing
              <input value={record.year_of_passing} inputMode="numeric" maxLength={4} aria-label={`Year ${index + 1}`} onChange={(event) => updateRecord(index, "year_of_passing", event.target.value)} />
            </label>
          </div>
        ))}
        <div className="span-2">
          <button type="button" className="quiet" onClick={() => setRecords((current) => [...current, { ...EMPTY_RECORD }])}>Add academic record</button>
        </div>
        {correction ? <label className="span-2">What this correction changes
          <textarea id="field-note" required value={correctionNote} onChange={(event) => setCorrectionNote(event.target.value)} />
        </label> : null}
        <label className="span-2">Why this is another application
          <input id="field-episode_note" value={episodeNote} onChange={(event) => setEpisodeNote(event.target.value)} />
        </label>
        {error ? <p className="error span-2" role="alert">{error}</p> : null}
        <div className="dialog-actions span-2">
          {onCancel ? <button type="button" className="secondary" onClick={() => { if (confirmDiscard(dirty)) onCancel(); }}>Cancel</button> : <Link className="secondary" to="/students/admissions">Cancel</Link>}
          <button type="submit" disabled={saving || !name.trim() || !courseId || questionsFailed || businessFailed || (correction && !correctionNote.trim())}>{saving ? "Saving…" : correction ? "Save correction" : "Save"}</button>
        </div>
      </form>
  );
}

export { EnquiriesPage, EnquiryPage, EnquiryImportPage };
