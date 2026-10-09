import { ChangeEvent, FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ApiError, api } from "../api";
import { Option, optionFits } from "../filters";
import { BandMark } from "../bands";
import { StudentEnrollment, recordedDate, recordedName, recordedStatus, safeStudentList } from "../students";

type Alias = { id: string; display_name: string };
type StudentActions = { edit: boolean; card: boolean; enroll: boolean };
type StudentDetail = {
  id: string;
  student_code: string;
  display_name: string;
  archived: boolean;
  edit_version: number;
  photo_id: string | null;
  date_of_birth: string | null;
  blood_group: string | null;
  phone: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  notes: string | null;
  street: string | null;
  place: string | null;
  district: string | null;
  state: string | null;
  pin: string | null;
  qualification: string | null;
  institution: string | null;
  board: string | null;
  passing_year: string | null;
  enrollments: StudentEnrollment[];
  aliases: Alias[];
  actions: StudentActions;
};
type ProfileValues = {
  display_name: string;
  date_of_birth: string;
  blood_group: string;
  phone: string;
  guardian_name: string;
  guardian_phone: string;
  notes: string;
  street: string;
  place: string;
  district: string;
  state: string;
  pin: string;
  qualification: string;
  institution: string;
  board: string;
  passing_year: string;
};
type StudentTab = "personal" | "academics" | "history";
type Conflict = { proposed: ProfileValues; current: ProfileValues; version: number };
type Performance = { percentage: number | null; band: string | null; band_name?: string | null; band_place?: string | null };
type ProgressCard = { empty_reason: string | null; performance: Performance };
type HistorySide = {
  display_name?: string;
  photo?: string;
  alias?: string;
  batch_name?: string;
  started_on?: string;
  ended_on?: string;
  date_of_birth?: string;
  blood_group?: string;
  phone?: string;
  guardian_name?: string;
  guardian_phone?: string;
  notes?: string;
  street?: string;
  place?: string;
  district?: string;
  state?: string;
  pin?: string;
  qualification?: string;
  institution?: string;
  board?: string;
  passing_year?: string;
};
type HistoryEvent = { id: string; action: string; at: string; actor_name: string; before: HistorySide | null; after: HistorySide | null };
type StudentOptions = { branches: Option[]; courses: Option[]; batches: Option[] };

const EMPTY_REASONS: Record<string, string> = {
  enrollment: "This student is not enrolled in the selected branch, course, or batch.",
  filters: "No published results match these filters.",
  unpublished: "No published results yet.",
  restricted: "No authorized results are available for this student.",
};
const PROFILE_FIELDS = [
  ["date_of_birth", "Date of birth"],
  ["blood_group", "Blood group"],
  ["phone", "Student phone"],
  ["guardian_phone", "Parent or guardian phone"],
  ["guardian_name", "Parent or guardian"],
  ["notes", "Notes"],
  ["street", "House and street"],
  ["place", "Place"],
  ["district", "District"],
  ["state", "State"],
  ["pin", "PIN"],
  ["qualification", "Qualification"],
  ["passing_year", "Year of passing"],
  ["institution", "School or college"],
  ["board", "Board or university"],
] as const;
const CONTACT_ORDER = ["date_of_birth", "blood_group", "phone", "guardian_phone", "guardian_name", "notes"] as const;
const ADDRESS_ORDER = ["street", "place", "district", "state", "pin"] as const;
const ACADEMIC_ORDER = ["qualification", "passing_year", "institution", "board"] as const;
const WIDE_FACTS = new Set<string>(["guardian_name", "notes", "street", "institution", "board"]);
const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"];
const EMPTY_PROFILE: ProfileValues = {
  display_name: "",
  date_of_birth: "",
  blood_group: "",
  phone: "",
  guardian_name: "",
  guardian_phone: "",
  notes: "",
  street: "",
  place: "",
  district: "",
  state: "",
  pin: "",
  qualification: "",
  institution: "",
  board: "",
  passing_year: "",
};

function profileFrom(record: StudentDetail): ProfileValues {
  const next = { ...EMPTY_PROFILE, display_name: record.display_name || "" };
  for (const [key] of PROFILE_FIELDS) next[key] = record[key] || "";
  return next;
}

function FactGrid({ order, values }: { order: readonly string[]; values: StudentDetail }) {
  return (
    <dl className="facts">
      {order.map((key) => {
        const value = values[key as keyof StudentDetail];
        const text = typeof value === "string" ? value : "";
        return (
          <div key={key} className={WIDE_FACTS.has(key) ? "span-2" : undefined}>
            <dt>{PROFILE_FIELDS.find(([field]) => field === key)?.[1]}</dt>
            <dd className={text ? undefined : "is-empty"}>{text || "Not recorded"}</dd>
          </div>
        );
      })}
    </dl>
  );
}

const CHANGES: Record<string, string> = {
  "student.update": "Details",
  "student.photo": "Photo",
  "student.alias": "Previous name",
  "student.merge": "Merge",
  "enrollment.update": "Enrollment dates",
  "enrollment.create": "Enrollment",
  "catalog.correct": "Correction",
};

function initials(name: string) {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("");
}

function historyText(value: HistorySide | null) {
  if (!value) return "Not recorded";
  const parts: string[] = [];
  if (value.display_name) parts.push(value.display_name);
  if (value.photo) parts.push(value.photo);
  if (value.alias) parts.push(value.alias);
  for (const [key, label] of PROFILE_FIELDS) {
    if (value[key]) parts.push(`${label}: ${value[key]}`);
  }
  const when = [value.started_on, value.ended_on].filter(Boolean).join(" – ");
  const enrollment = [value.batch_name, when].filter(Boolean).join(", ");
  if (enrollment) parts.push(enrollment);
  return parts.join("; ") || "Not recorded";
}

function Portrait({ name, studentId, photoId }: { name: string; studentId: string; photoId: string | null }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [studentId, photoId]);
  const shown = Boolean(photoId) && !failed;
  return (
    <div className="student-photo" role="img" aria-label={shown ? `Photo of ${name}` : `Photo space for ${name}`}>
      {shown && photoId ? <img src={`/api/v1/students/${studentId}/photo?v=${photoId}`} alt="" onError={() => setFailed(true)} /> : initials(name)}
    </div>
  );
}

function Icon({ name }: { name: "edit" | "card" | "add" }) {
  const common = { viewBox: "0 0 24 24", width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "edit") {
    return (
      <svg {...common}>
        <path d="M4 20h4l10-10-4-4L4 16v4z" />
        <path d="M13 7l4 4" />
      </svg>
    );
  }
  if (name === "add") {
    return (
      <svg {...common}>
        <path d="M12 5v14M5 12h14" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  );
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = panelRef.current;
    const fields = node ? [...node.querySelectorAll<HTMLElement>("button, input, select")].filter((item) => !item.hasAttribute("disabled")) : [];
    (fields.find((item) => item.matches("input:not([type=file])")) || fields[0] || node)?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal compact" role="dialog" aria-modal="true" aria-label={title} ref={panelRef} tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head"><h2>{title}</h2><button type="button" className="quiet" onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>
  );
}

export function StudentPage() {
  const { studentId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const branch = params.get("branch_id") || "";
  const course = params.get("course_id") || "";
  const batch = params.get("batch_id") || "";
  const back = safeStudentList(params.get("returnTo")) || "/students";
  const [record, setRecord] = useState<StudentDetail | null>(null);
  const [loadedFor, setLoadedFor] = useState("");
  const [phase, setPhase] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<StudentTab>("personal");
  const [draft, setDraft] = useState<ProfileValues>(EMPTY_PROFILE);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [aliasName, setAliasName] = useState("");
  const [photoError, setPhotoError] = useState("");
  const [progress, setProgress] = useState<ProgressCard | null>(null);
  const [progressState, setProgressState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [progressError, setProgressError] = useState("");
  const [progressAttempt, setProgressAttempt] = useState(0);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [historyPermitted, setHistoryPermitted] = useState<boolean | null>(null);
  const [historyState, setHistoryState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [historyError, setHistoryError] = useState("");
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const [dateTarget, setDateTarget] = useState<StudentEnrollment | null>(null);
  const [startedOn, setStartedOn] = useState("");
  const [endedOn, setEndedOn] = useState("");
  const [dateError, setDateError] = useState("");
  const [dateSaving, setDateSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [options, setOptions] = useState<StudentOptions>({ branches: [], courses: [], batches: [] });
  const [addBranch, setAddBranch] = useState("");
  const [addCourse, setAddCourse] = useState("");
  const [addBatch, setAddBatch] = useState("");
  const [addStarted, setAddStarted] = useState("");
  const [addError, setAddError] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  const openedEdit = useRef("");

  if (loadedFor !== studentId) {
    setLoadedFor(studentId);
    setRecord(null);
    setPhase("loading");
    setLoadError("");
    setEditing(false);
    setTab("personal");
    setDraft(EMPTY_PROFILE);
    setDirty(false);
    setSaveState("idle");
    setMessage("");
    setError("");
    setConflict(null);
    setAliasName("");
    setPhotoError("");
    setProgress(null);
    setProgressState("idle");
    setProgressError("");
    setProgressAttempt(0);
    setHistory([]);
    setHistoryPermitted(null);
    setHistoryState("idle");
    setHistoryError("");
    setHistoryAttempt(0);
    setDateTarget(null);
    setAdding(false);
    openedEdit.current = "";
  }

  useEffect(() => {
    let active = true;
    setPhase("loading");
    api<StudentDetail>(`/api/v1/students/${studentId}/enrollments`)
      .then((result) => {
        if (!active) return;
        setRecord(result);
        setPhase("ready");
      })
      .catch((reason: ApiError) => {
        if (!active) return;
        setRecord(null);
        setPhase(reason.status === 403 || reason.status === 404 ? "unavailable" : "error");
        setLoadError(reason.message || "Could not load this student.");
      });
    return () => {
      active = false;
    };
  }, [studentId, attempt]);

  useEffect(() => {
    if (params.get("edit") !== "1" || !record?.actions.edit || record.id !== studentId) return;
    if (openedEdit.current === studentId) return;
    openedEdit.current = studentId;
    setEditing(true);
    setDraft(profileFrom(record));
    setDirty(false);
    setConflict(null);
  }, [params, record, studentId]);

  useEffect(() => {
    if (!record || record.id !== studentId || !record.actions.card) return;
    let active = true;
    setProgress(null);
    setProgressState("loading");
    setProgressError("");
    const search = new URLSearchParams();
    if (branch) search.set("branch_id", branch);
    if (course) search.set("course_id", course);
    if (batch) search.set("batch_id", batch);
    const query = search.toString();
    api<ProgressCard>(`/api/v1/students/${studentId}/card${query ? `?${query}` : ""}`)
      .then((result) => {
        if (!active) return;
        setProgress(result);
        setProgressState("ready");
      })
      .catch((reason: Error) => {
        if (!active) return;
        setProgress(null);
        setProgressState("error");
        setProgressError(reason.message || "Could not load progress.");
      });
    return () => {
      active = false;
    };
  }, [studentId, record, branch, course, batch, progressAttempt]);

  useEffect(() => {
    if (phase !== "ready" || !record || record.id !== studentId) return;
    let active = true;
    setHistory([]);
    setHistoryPermitted(null);
    setHistoryState("loading");
    setHistoryError("");
    api<{ permitted: boolean; items: HistoryEvent[] }>(`/api/v1/students/${studentId}/history`)
      .then((result) => {
        if (!active) return;
        setHistoryPermitted(result.permitted);
        setHistory(result.permitted ? result.items : []);
        setHistoryState("ready");
      })
      .catch((reason: Error) => {
        if (!active) return;
        setHistoryState("error");
        setHistoryError(reason.message || "Could not load history.");
      });
    return () => {
      active = false;
    };
  }, [studentId, phase, record, historyAttempt]);

  useEffect(() => {
    if (!editing || !dirty) return;
    function onLeave(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [editing, dirty]);

  useEffect(() => {
    if (editing) nameRef.current?.focus();
  }, [editing]);

  function discardPrompt() {
    return !dirty || window.confirm("Discard the unsaved changes?");
  }

  function closeEditor() {
    setEditing(false);
    setDirty(false);
    setConflict(null);
    setError("");
    setSaveState("idle");
    setAliasName("");
    setPhotoError("");
    if (params.get("edit") === "1") {
      const query = new URLSearchParams(params);
      query.delete("edit");
      setParams(query, { replace: true });
    }
  }

  function chooseTab(next: StudentTab) {
    if (next === tab) return;
    if (!discardPrompt()) return;
    if (editing) closeEditor();
    setTab(next);
  }

  function change(key: keyof ProfileValues) {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const value = event.target.value;
      setDraft((current) => ({ ...current, [key]: value }));
      setDirty(true);
      setSaveState("idle");
    };
  }

  function startEdit() {
    if (!record?.actions.edit) return;
    openedEdit.current = studentId;
    setDraft(profileFrom(record));
    setDirty(false);
    setConflict(null);
    setError("");
    setSaveState("idle");
    setPhotoError("");
    setEditing(true);
  }

  function cancelEdit() {
    if (!discardPrompt()) return;
    closeEditor();
  }

  async function reload() {
    const refreshed = await api<StudentDetail>(`/api/v1/students/${studentId}/enrollments`);
    setRecord(refreshed);
    setPhase("ready");
    return refreshed;
  }

  function savedProfile(details: Record<string, string>, fallback: ProfileValues): ProfileValues {
    const next = { ...fallback, display_name: details.current_display_name ?? fallback.display_name };
    for (const [key] of PROFILE_FIELDS) {
      const value = details[`current_${key}`];
      if (value !== undefined) next[key] = value;
    }
    return next;
  }

  function applySaved(current: ProfileValues, version: number) {
    if (!record) return;
    const next = { ...record, display_name: current.display_name || record.display_name, edit_version: version };
    for (const [key] of PROFILE_FIELDS) next[key] = current[key] || null;
    setRecord(next);
  }

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!record || savingRef.current) return;
    const displayName = draft.display_name.trim();
    if (!displayName) {
      setError("Enter the student's name.");
      setSaveState("error");
      return;
    }
    savingRef.current = true;
    setSaveState("saving");
    setError("");
    setMessage("");
    const fields = tab === "academics" ? ACADEMIC_ORDER : [...CONTACT_ORDER, ...ADDRESS_ORDER];
    const body: Record<string, string | number> = { display_name: displayName, edit_version: record.edit_version };
    for (const key of fields) body[key] = draft[key];
    try {
      await api(`/api/v1/students/${record.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setDirty(false);
      setConflict(null);
      setSaveState("saved");
      setMessage(`Saved ${displayName}.`);
      closeEditor();
      await reload();
    } catch (reason) {
      setSaveState("error");
      if (reason instanceof ApiError && reason.status === 409 && reason.code === "student.conflict") {
        const version = Number(reason.details.edit_version);
        const current = savedProfile(reason.details, draft);
        const nextVersion = Number.isFinite(version) ? version : record.edit_version;
        setConflict({ proposed: { ...draft, display_name: displayName }, current, version: nextVersion });
        applySaved(current, nextVersion);
        setDirty(true);
        setError("Someone else saved this student. Your details are still here.");
        return;
      }
      setError(reason instanceof Error ? reason.message : "Could not save the student.");
    } finally {
      savingRef.current = false;
    }
  }

  function useSavedDetails() {
    if (!conflict) return;
    setDraft(conflict.current);
    setDirty(false);
    setConflict(null);
    setError("");
    setSaveState("idle");
  }

  async function uploadPhoto(file: File) {
    if (!record) return;
    setPhotoError("");
    const body = new FormData();
    body.append("photo", file);
    try {
      await api(`/api/v1/students/${record.id}/photo`, { method: "POST", body });
      await reload();
    } catch (reason) {
      setPhotoError(reason instanceof Error ? reason.message : "Could not save the photo.");
    }
  }

  async function removePhoto() {
    if (!record) return;
    setPhotoError("");
    try {
      await api(`/api/v1/students/${record.id}/photo`, { method: "DELETE" });
      await reload();
    } catch (reason) {
      setPhotoError(reason instanceof Error ? reason.message : "Could not remove the photo.");
    }
  }

  async function addAlias(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!record || !aliasName.trim()) return;
    setPhotoError("");
    setError("");
    try {
      await api(`/api/v1/students/${record.id}/aliases`, {
        method: "POST",
        body: JSON.stringify({ display_name: aliasName.trim() }),
      });
      setAliasName("");
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add that name.");
    }
  }

  async function removeAlias(aliasId: string) {
    if (!record) return;
    setError("");
    try {
      await api(`/api/v1/students/${record.id}/aliases/${aliasId}`, { method: "DELETE" });
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not remove that name.");
    }
  }

  function openDates(item: StudentEnrollment) {
    setDateTarget(item);
    setStartedOn(item.started_on || "");
    setEndedOn(item.ended_on || "");
    setDateError("");
  }

  async function saveDates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!record || !dateTarget?.id || dateSaving) return;
    setDateSaving(true);
    setDateError("");
    try {
      await api(`/api/v1/students/${record.id}/enrollments/${dateTarget.id}`, {
        method: "PATCH",
        body: JSON.stringify({ started_on: startedOn, ended_on: endedOn }),
      });
      setDateTarget(null);
      await reload();
    } catch (reason) {
      setDateError(reason instanceof Error ? reason.message : "Could not save these dates.");
    } finally {
      setDateSaving(false);
    }
  }

  function openAdd() {
    setAdding(true);
    setAddBranch("");
    setAddCourse("");
    setAddBatch("");
    setAddStarted("");
    setAddError("");
    api<StudentOptions>("/api/v1/students/options?manage=true").then(setOptions).catch((reason: Error) => setAddError(reason.message));
  }

  function chooseAdd(field: "branch_id" | "course_id" | "batch_id", value: string) {
    if (field === "branch_id") {
      setAddBranch(value);
      setAddCourse("");
      setAddBatch("");
    } else if (field === "course_id") {
      setAddCourse(value);
      setAddBatch("");
    } else {
      setAddBatch(value);
    }
  }

  async function saveEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!record || addSaving) return;
    if (!addBranch || !addCourse || !addBatch) {
      setAddError("Choose a branch, course, and batch.");
      return;
    }
    setAddSaving(true);
    setAddError("");
    try {
      await api(`/api/v1/students/${record.id}/enrollments`, {
        method: "POST",
        body: JSON.stringify({ branch_id: addBranch, course_id: addCourse, batch_id: addBatch, started_on: addStarted }),
      });
      setAdding(false);
      await reload();
    } catch (reason) {
      setAddError(reason instanceof Error ? reason.message : "Could not add this enrollment.");
    } finally {
      setAddSaving(false);
    }
  }

  function cardHref(enrollment?: StudentEnrollment) {
    const next = new URLSearchParams();
    next.set("student", studentId);
    const branchId = enrollment?.branch_id || branch;
    const courseId = enrollment?.course_id || course;
    const batchId = enrollment?.batch_id || batch;
    if (branchId) next.set("branch_id", branchId);
    if (courseId) next.set("course_id", courseId);
    if (batchId) next.set("batch_id", batchId);
    next.set("returnTo", back);
    return `/cards?${next.toString()}`;
  }

  const shown = record && record.id === studentId ? record : null;
  const chips = shown ? [
    branch ? shown.enrollments.find((item) => item.branch_id === branch)?.branch_name || "" : "",
    course ? shown.enrollments.find((item) => item.course_id === course)?.course_name || "" : "",
    batch ? shown.enrollments.find((item) => item.batch_id === batch)?.batch_name || "" : "",
  ].filter(Boolean) : [];
  const addFilters = { branch_id: addBranch, course_id: addCourse, batch_id: addBatch };
  const addCourses = options.courses.filter((item) => optionFits(item, addFilters));
  const enrolledBatches = new Set(shown?.enrollments.map((item) => item.batch_id) || []);
  const addBatches = options.batches.filter((item) => optionFits(item, addFilters) && !enrolledBatches.has(item.id));
  const visibleTab = tab === "history" && historyPermitted === false ? "personal" : tab;
  const editedFields = visibleTab === "academics" ? ACADEMIC_ORDER : [...CONTACT_ORDER, ...ADDRESS_ORDER];

  return (
    <section className="panel wide student-record" aria-busy={phase === "loading"}>
      <Link className="quiet back-link" to={back} onClick={(event) => { if (!discardPrompt()) event.preventDefault(); }}>← Students</Link>
      {phase === "loading" ? <h1>Loading this student…</h1> : null}
      {phase === "unavailable" ? (
        <>
          <h1>Student unavailable</h1>
          <p role="alert">{loadError || "This student is not available."}</p>
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button>
        </>
      ) : null}
      {phase === "error" ? (
        <>
          <h1>Student</h1>
          <p className="error" role="alert">{loadError || "Could not load this student."}</p>
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button>
        </>
      ) : null}
      {shown ? (
        <>
          <div className="student-head">
            <div className="student-identity">
              <Portrait name={shown.display_name} studentId={shown.id} photoId={shown.photo_id} />
              <div>
                <p className="eyebrow">Student</p>
                <h1>{shown.display_name}</h1>
                <p className="meta">{shown.student_code} · {shown.archived ? "Archived" : "Active"}</p>
                {chips.length ? <p className="context-chips">{chips.map((label) => <span key={label} className="chip">{label}</span>)}</p> : null}
                {shown.aliases.length ? <p className="meta">Previous names: {shown.aliases.map((item) => item.display_name).join(", ")}</p> : null}
              </div>
            </div>
            <div className="icon-actions">
              {shown.actions.edit && visibleTab !== "history" ? <button type="button" onClick={startEdit} aria-label="Edit student" title="Edit student"><Icon name="edit" /></button> : null}
              {shown.actions.card ? <Link to={cardHref()} aria-label="View progress card" title="View progress card"><Icon name="card" /></Link> : null}
            </div>
          </div>
          <div className="page-tabs" role="tablist" aria-label="Student">
            <button type="button" role="tab" aria-selected={visibleTab === "personal"} onClick={() => chooseTab("personal")}>Personal</button>
            <button type="button" role="tab" aria-selected={visibleTab === "academics"} onClick={() => chooseTab("academics")}>Academics</button>
            {historyPermitted ? <button type="button" role="tab" aria-selected={visibleTab === "history"} onClick={() => chooseTab("history")}>History</button> : null}
          </div>
          {message ? <p className="ok" role="status">{message}</p> : null}
          {visibleTab === "personal" ? (
            <>
              <FactGrid order={CONTACT_ORDER} values={shown} />
              <h2>Address</h2>
              <FactGrid order={ADDRESS_ORDER} values={shown} />
            </>
          ) : null}
          {visibleTab === "academics" ? (
            <>
              <FactGrid order={ACADEMIC_ORDER} values={shown} />
              <div className="title-row">
                <h2>Enrollments</h2>
                {shown.actions.enroll ? (
                  <div className="icon-actions">
                    <button type="button" onClick={openAdd} aria-label="Add enrollment" title="Add enrollment"><Icon name="add" /></button>
                  </div>
                ) : null}
              </div>
              {shown.enrollments.length === 0 ? <p>No enrollments in this view.</p> : (
                <div className="table-wrap">
                  <table className="people-table directory">
                    <caption className="sr-only">Enrollments for {shown.display_name}.</caption>
                    <thead>
                      <tr>
                        <th>Branch</th>
                        <th>Course</th>
                        <th>Batch</th>
                        <th>From</th>
                        <th>Until</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.enrollments.map((item) => (
                        <tr key={item.id || `${item.branch_id}-${item.batch_id}`}>
                          <td>{recordedName(item.branch_name)}</td>
                          <td>{recordedName(item.course_name)}</td>
                          <td>{recordedName(item.batch_name)}</td>
                          <td>{recordedDate(item.started_on)}</td>
                          <td>{recordedDate(item.ended_on)}</td>
                          <td>{recordedStatus(item.status)}</td>
                          <td>
                            <div className="icon-actions">
                              {item.manage ? <button type="button" onClick={() => openDates(item)} aria-label={`Edit dates for ${recordedName(item.batch_name)}`} title="Edit dates"><Icon name="edit" /></button> : null}
                              {shown.actions.card ? <Link to={cardHref(item)} aria-label={`View progress card for ${recordedName(item.batch_name)}`} title="View progress card"><Icon name="card" /></Link> : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {shown.actions.card ? (
                <>
                  <h2>Progress</h2>
                  {progressState === "loading" ? <p role="status">Loading progress…</p> : null}
                  {progressState === "error" ? (
                    <>
                      <p className="error" role="alert">{progressError}</p>
                      <button type="button" onClick={() => setProgressAttempt((value) => value + 1)}>Retry</button>
                    </>
                  ) : null}
                  {progress ? (
                    progress.empty_reason ? <p role="status">{EMPTY_REASONS[progress.empty_reason] || "Nothing matches this report."}</p> : (
                      <p>
                        {progress.performance.percentage == null ? "—" : `${progress.performance.percentage.toFixed(2)}%`}
                        {progress.performance.band ? <BandMark band={progress.performance.band} name={progress.performance.band_name} place={progress.performance.band_place} /> : null}
                      </p>
                    )
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}
          {visibleTab === "history" ? (
            <>
              {historyState === "error" ? (
                <>
                  <p className="error" role="alert">{historyError}</p>
                  <button type="button" onClick={() => setHistoryAttempt((value) => value + 1)}>Retry</button>
                </>
              ) : null}
              {historyState === "loading" ? <p role="status">Loading history…</p> : null}
              {history.length === 0 && historyState === "ready" ? <p>No recorded changes for this student.</p> : null}
              {history.length > 0 ? (
                <div className="table-wrap">
                  <table className="people-table">
                    <caption className="sr-only">Recorded changes for {shown.display_name}.</caption>
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Who</th>
                        <th>Change</th>
                        <th>Before</th>
                        <th>After</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((item) => (
                        <tr key={item.id}>
                          <td className="nowrap">{item.at ? new Date(item.at).toLocaleString() : "Not recorded"}</td>
                          <td>{item.actor_name || "Unknown"}</td>
                          <td>{CHANGES[item.action] || "Change"}</td>
                          <td>{historyText(item.before)}</td>
                          <td>{historyText(item.after)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          ) : null}
          {editing && visibleTab !== "history" ? (
            <Dialog title="Edit student" onClose={cancelEdit}>
              {visibleTab === "personal" ? (
                <form className="photo-field" onSubmit={(event) => event.preventDefault()}>
                  <div className="photo-row">
                    <Portrait name={shown.display_name} studentId={shown.id} photoId={shown.photo_id} />
                    <div className="photo-actions">
                      <input ref={photoRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Student photo" onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) void uploadPhoto(file);
                      }} />
                      <button type="button" onClick={() => photoRef.current?.click()}>Replace</button>
                      {shown.photo_id ? <button type="button" className="quiet" onClick={() => void removePhoto()}>Remove photo</button> : null}
                    </div>
                  </div>
                  {photoError ? <p className="error" role="alert">{photoError}</p> : null}
                </form>
              ) : null}
              <form className="form-grid" onSubmit={saveName}>
                {visibleTab === "personal" ? (
                  <>
                    <label className="span-2">Name
                      <input ref={nameRef} value={draft.display_name} aria-label="Student name" onChange={change("display_name")} />
                    </label>
                    <label>Date of birth
                      <input type="date" value={draft.date_of_birth} aria-label="Date of birth" onChange={change("date_of_birth")} />
                    </label>
                    <label>Blood group
                      <select value={draft.blood_group} aria-label="Blood group" onChange={change("blood_group")}>
                        <option value="">Not recorded</option>
                        {BLOOD_GROUPS.map((group) => <option key={group} value={group}>{group}</option>)}
                      </select>
                    </label>
                    <label>Student phone
                      <input value={draft.phone} aria-label="Student phone" onChange={change("phone")} />
                    </label>
                    <label>Parent or guardian phone
                      <input value={draft.guardian_phone} aria-label="Parent or guardian phone" onChange={change("guardian_phone")} />
                    </label>
                    <label className="span-2">Parent or guardian
                      <input value={draft.guardian_name} aria-label="Parent or guardian" onChange={change("guardian_name")} />
                    </label>
                    <label className="span-2">Notes
                      <textarea value={draft.notes} rows={3} aria-label="Notes" onChange={change("notes")} />
                    </label>
                    <p className="span-2 section-label">Address</p>
                    <label className="span-2">House and street
                      <textarea value={draft.street} rows={2} aria-label="House and street" onChange={change("street")} />
                    </label>
                    <label>Place
                      <input value={draft.place} aria-label="Place" onChange={change("place")} />
                    </label>
                    <label>District
                      <input value={draft.district} aria-label="District" onChange={change("district")} />
                    </label>
                    <label>State
                      <input value={draft.state} aria-label="State" onChange={change("state")} />
                    </label>
                    <label>PIN
                      <input value={draft.pin} inputMode="numeric" maxLength={6} aria-label="PIN" onChange={change("pin")} />
                    </label>
                  </>
                ) : (
                  <>
                    <label>Qualification
                      <input value={draft.qualification} aria-label="Qualification" onChange={change("qualification")} />
                    </label>
                    <label>Year of passing
                      <input value={draft.passing_year} inputMode="numeric" maxLength={4} aria-label="Year of passing" onChange={change("passing_year")} />
                    </label>
                    <label className="span-2">School or college
                      <input value={draft.institution} aria-label="School or college" onChange={change("institution")} />
                    </label>
                    <label className="span-2">Board or university
                      <input value={draft.board} aria-label="Board or university" onChange={change("board")} />
                    </label>
                  </>
                )}
                {conflict ? (
                  <div className="compare span-2">
                    {(["display_name", ...editedFields] as Array<keyof ProfileValues>).filter((key) => (conflict.proposed[key] || "") !== (conflict.current[key] || "")).map((key) => (
                      <p key={key}>
                        {key === "display_name" ? "Name" : PROFILE_FIELDS.find(([field]) => field === key)?.[1]}:
                        yours <strong>{conflict.proposed[key] || "Not recorded"}</strong>,
                        saved <strong>{conflict.current[key] || "Not recorded"}</strong>
                      </p>
                    ))}
                    <div className="row-actions">
                      <button type="submit" disabled={saveState === "saving"}>Save my details</button>
                      <button type="button" className="quiet" onClick={useSavedDetails}>Use the saved details</button>
                    </div>
                  </div>
                ) : null}
                {error ? <p className="error span-2" role="alert">{error}</p> : null}
                <div className="dialog-actions span-2">
                  <button type="button" className="quiet" onClick={cancelEdit}>Cancel</button>
                  <button type="submit" disabled={saveState === "saving" || !draft.display_name.trim()}>{saveState === "saving" ? "Saving…" : "Save"}</button>
                </div>
              </form>
              {visibleTab === "personal" ? (
                <form className="dialog-section" onSubmit={addAlias}>
                  <p>Previous names</p>
                  {shown.aliases.length === 0 ? <p className="meta">None recorded.</p> : (
                    <ul className="alias-list">
                      {shown.aliases.map((item) => (
                        <li key={item.id}>
                          <span>{item.display_name}</span>
                          <button type="button" className="quiet" onClick={() => void removeAlias(item.id)} aria-label={`Remove ${item.display_name}`}>Remove</button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <label>Add a previous name
                    <input value={aliasName} onChange={(event) => setAliasName(event.target.value)} aria-label="Previous name" />
                  </label>
                  <div className="dialog-actions">
                    <div className="icon-actions">
                      <button type="submit" disabled={!aliasName.trim()} aria-label="Add a previous name" title="Add a previous name"><Icon name="add" /></button>
                    </div>
                  </div>
                </form>
              ) : null}
            </Dialog>
          ) : null}
          {dateTarget ? (
            <Dialog title="Enrollment dates" onClose={() => setDateTarget(null)}>
              <form onSubmit={saveDates}>
                <p className="meta">{recordedName(dateTarget.branch_name)} · {recordedName(dateTarget.course_name)} · {recordedName(dateTarget.batch_name)}</p>
                <div className="form-grid">
                  <label>From
                    <input type="date" value={startedOn} onChange={(event) => setStartedOn(event.target.value)} />
                  </label>
                  <label>Until
                    <input type="date" value={endedOn} onChange={(event) => setEndedOn(event.target.value)} />
                  </label>
                </div>
                {dateError ? <p className="error" role="alert">{dateError}</p> : null}
                <div className="dialog-actions">
                  <button type="button" className="quiet" onClick={() => setDateTarget(null)}>Cancel</button>
                  <button type="submit" disabled={dateSaving}>{dateSaving ? "Saving…" : "Save"}</button>
                </div>
              </form>
            </Dialog>
          ) : null}
          {adding ? (
            <Dialog title="Add enrollment" onClose={() => setAdding(false)}>
              <form className="form-grid" onSubmit={saveEnrollment}>
                <label>Branch
                  <select value={addBranch} onChange={(event) => chooseAdd("branch_id", event.target.value)}>
                    <option value="">Choose</option>
                    {options.branches.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </label>
                <label>Course
                  <select value={addCourse} onChange={(event) => chooseAdd("course_id", event.target.value)}>
                    <option value="">Choose</option>
                    {addCourses.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </label>
                <label className="span-2">Batch
                  <select value={addBatch} onChange={(event) => chooseAdd("batch_id", event.target.value)}>
                    <option value="">Choose</option>
                    {addBatches.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </label>
                <label>From
                  <input type="date" value={addStarted} onChange={(event) => setAddStarted(event.target.value)} />
                </label>
                {addError ? <p className="error span-2" role="alert">{addError}</p> : null}
                <div className="dialog-actions span-2">
                  <button type="button" className="quiet" onClick={() => setAdding(false)}>Cancel</button>
                  <div className="icon-actions">
                    <button type="submit" disabled={addSaving} aria-label="Add enrollment" title="Add enrollment"><Icon name="add" /></button>
                  </div>
                </div>
              </form>
            </Dialog>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
