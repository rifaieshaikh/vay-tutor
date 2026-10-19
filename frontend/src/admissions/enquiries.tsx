import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError, api, Session } from "../api";
import { formatDisplayDate } from "../format";
import { useUnsaved } from "../guard";
import { notify } from "../notify";
import { useRecordLabel } from "../orientation";
import { confirmDiscard, StudentDialog } from "../ui";
import { AnswerFields, Question } from "./questions";

type CourseOption = { id: string; name: string };
type Answer = { question_id: string; label?: string; value: string };
type FollowUp = { id: string; at: string; note: string; interest: string; next_on: string; actor?: string };
type Activity = { id: string; kind: string; at: string; note: string; actor?: string };
type Enquiry = {
  id: string;
  reference?: string;
  prospect_id?: string;
  name: string;
  whatsapp: string;
  email?: string;
  present_institution: string;
  course_id: string;
  course_name: string;
  interest: string;
  references: string;
  details: string;
  status?: string;
  stage?: string;
  next_action?: string;
  next_on?: string;
  follow_up_state?: string;
  last_contact_on?: string;
  closure_reason?: string;
  closure_note?: string;
  questions?: Question[];
  answers?: Answer[];
  follow_ups: FollowUp[];
  activity?: Activity[];
  admission_id: string | null;
  related_count?: number;
  today?: string;
};
type Prospect = {
  id: string;
  name: string;
  whatsapp: string;
  email: string;
  enquiries: { id: string; course_id: string; status: string; reference: string }[];
};

const INTERESTS = ["High", "Medium", "Low"];
const CLOSURE_REASONS = ["Not interested", "Joined elsewhere", "Unable to contact", "Duplicate entry", "Created by mistake", "Other"];
const SORTS = [
  { value: "created:desc", label: "Newest" },
  { value: "created:asc", label: "Oldest" },
  { value: "name:asc", label: "Name A to Z" },
  { value: "name:desc", label: "Name Z to A" },
  { value: "next_on:asc", label: "Next follow-up, earliest" },
  { value: "next_on:desc", label: "Next follow-up, latest" },
  { value: "last_contact:desc", label: "Last contact, newest" },
  { value: "last_contact:asc", label: "Last contact, oldest" },
];

function coursesOf(catalog: { courses: CourseOption[] } | null) {
  return [...(catalog?.courses || [])].sort((left, right) => left.name.localeCompare(right.name));
}

function withParam(params: URLSearchParams, key: string, value: string) {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value);
  else next.delete(key);
  if (key !== "page") next.delete("page");
  return next;
}

function followUpWhen(item: Enquiry) {
  if (item.status === "converted" || item.admission_id) return "Converted";
  if (item.status === "closed") return "Closed";
  if (!item.next_on) return "Unscheduled";
  const timing = item.follow_up_state === "overdue" ? "Overdue" : item.follow_up_state === "today" ? "Today" : "Upcoming";
  return `${formatDisplayDate(item.next_on)} · ${timing}`;
}

function sortToken(params: URLSearchParams) {
  if ((params.get("view") || "") === "needs" || params.get("sort") === "needs") return "needs";
  const sort = params.get("sort") || "created";
  const direction = params.get("direction") || (sort === "name" || sort === "next_on" ? "asc" : "desc");
  return `${sort}:${direction}`;
}

export function EnquiriesPage({ session }: { session: Session }) {
  const [params, setParams] = useSearchParams();
  const view = params.get("view") || "";
  const followUp = params.get("follow_up") || "";
  const courseId = params.get("course_id") || "";
  const stage = params.get("stage") || "";
  const interest = params.get("interest") || "";
  const closure = params.get("closure_reason") || "";
  const createdFrom = params.get("created_from") || "";
  const createdTo = params.get("created_to") || "";
  const nextFrom = params.get("next_from") || "";
  const nextTo = params.get("next_to") || "";
  const query = params.get("q") || "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const canManage = session.actions.includes("student.manage");
  const [items, setItems] = useState<Enquiry[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [draft, setDraft] = useState(query);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [adding, setAdding] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState({ courseId, interest, stage, followUp, createdFrom, createdTo, nextFrom, nextTo, closure });
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const filtered = Boolean(query || followUp || courseId || stage || interest || closure || createdFrom || createdTo || nextFrom || nextTo || (params.get("sort") && params.get("sort") !== "needs"));

  useEffect(() => { setDraft(query); }, [query]);
  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (draft === query) return;
      const next = withParam(params, "q", draft.trim());
      next.delete("view");
      setParams(next);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [draft, query, params, setParams]);

  useEffect(() => {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (followUp) search.set("follow_up", followUp);
    if (courseId) search.set("course_id", courseId);
    if (stage) search.set("stage", stage);
    if (interest) search.set("interest", interest);
    if (closure) search.set("closure_reason", closure);
    if (createdFrom) search.set("created_from", createdFrom);
    if (createdTo) search.set("created_to", createdTo);
    if (nextFrom) search.set("next_from", nextFrom);
    if (nextTo) search.set("next_to", nextTo);
    const sort = params.get("sort") || "";
    const direction = params.get("direction") || "";
    if (sort) search.set("sort", sort);
    if (direction) search.set("direction", direction);
    search.set("page", String(page));
    let cancelled = false;
    setLoading(true);
    api<{ items: Enquiry[]; total: number; pages: number }>(`/api/v1/enquiries?${search.toString()}`)
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
    return () => { cancelled = true; };
  }, [followUp, courseId, stage, interest, closure, createdFrom, createdTo, nextFrom, nextTo, query, page, revision, params]);

  function applyView(name: "all" | "needs" | "converted") {
    const next = new URLSearchParams();
    if (name === "needs") {
      next.set("view", "needs");
      next.set("follow_up", "due");
      next.set("sort", "needs");
    } else if (name === "converted") {
      next.set("view", "converted");
      next.set("stage", "converted");
    }
    setParams(next);
  }

  function applySort(value: string) {
    const next = new URLSearchParams(params);
    next.delete("page");
    next.delete("view");
    if (value === "needs") {
      next.set("view", "needs");
      next.set("follow_up", "due");
      next.set("sort", "needs");
      next.delete("direction");
    } else {
      const [sort, direction] = value.split(":");
      if (sort === "created" && direction === "desc") {
        next.delete("sort");
        next.delete("direction");
      } else {
        next.set("sort", sort);
        next.set("direction", direction);
      }
    }
    setParams(next);
  }

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    const next = new URLSearchParams(params);
    next.delete("page");
    next.delete("view");
    const write = (key: string, value: string) => { if (value) next.set(key, value); else next.delete(key); };
    write("course_id", filterDraft.courseId);
    write("interest", filterDraft.interest);
    write("stage", filterDraft.stage);
    write("follow_up", filterDraft.followUp);
    write("created_from", filterDraft.createdFrom);
    write("created_to", filterDraft.createdTo);
    write("next_from", filterDraft.nextFrom);
    write("next_to", filterDraft.nextTo);
    write("closure_reason", filterDraft.closure);
    setParams(next);
    setFiltersOpen(false);
  }

  const chips: { key: string; label: string }[] = [];
  if (followUp) chips.push({ key: "follow_up", label: followUp === "due" ? "Needs follow-up" : followUp === "admitted" ? "Converted" : followUp[0].toUpperCase() + followUp.slice(1) });
  if (courseId) chips.push({ key: "course_id", label: courses.find((item) => item.id === courseId)?.name || "Course" });
  if (stage) chips.push({ key: "stage", label: stage[0].toUpperCase() + stage.slice(1) });
  if (interest) chips.push({ key: "interest", label: interest });
  if (closure) chips.push({ key: "closure_reason", label: closure });
  if (createdFrom || createdTo) chips.push({ key: "created", label: `Created ${createdFrom || "…"} to ${createdTo || "…"}` });
  if (nextFrom || nextTo) chips.push({ key: "next", label: `Next follow-up ${nextFrom || "…"} to ${nextTo || "…"}` });
  if (query) chips.push({ key: "q", label: query });
  const start = total === 0 ? 0 : (page - 1) * 20 + 1;
  const end = Math.min(page * 20, total);

  return (
    <section className="panel wide">
      <div className="page-title">
        <div>
          <p className="eyebrow">Admissions</p>
          <h1>Enquiries</h1>
        </div>
        {canManage ? (
          <div className="actions">
            <Link className="button secondary" to="/students/enquiries/import">Import</Link>
            <button type="button" onClick={() => setAdding(true)}>Add enquiry</button>
          </div>
        ) : null}
      </div>
      <div className="preset-row" role="group" aria-label="Views">
        <button type="button" className="secondary" aria-pressed={view === "" && !filtered} onClick={() => applyView("all")}>All enquiries</button>
        <button type="button" className="secondary" aria-pressed={view === "needs"} onClick={() => applyView("needs")}>Needs follow-up</button>
        <button type="button" className="secondary" aria-pressed={view === "converted"} onClick={() => applyView("converted")}>Converted</button>
      </div>
      <form className="toolbar" onSubmit={(event) => { event.preventDefault(); const next = withParam(params, "q", draft.trim()); next.delete("view"); setParams(next); }}>
        <label>Search
          <input value={draft} aria-label="Search enquiries" placeholder="Name, contact, email, or reference" onChange={(event) => setDraft(event.target.value)} />
        </label>
        <label>Sort
          <select aria-label="Sort" value={sortToken(params)} onChange={(event) => applySort(event.target.value)}>
            {view === "needs" ? <option value="needs">Needs follow-up order</option> : null}
            {SORTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <button type="button" className="secondary" onClick={() => { setFilterDraft({ courseId, interest, stage, followUp, createdFrom, createdTo, nextFrom, nextTo, closure }); setFiltersOpen(true); }}>Filters</button>
      </form>
      <p className="filter-row">
        <span role="status">{loading ? "Loading enquiries…" : error ? "Enquiries could not be loaded." : `${start}–${end} of ${total}`}</span>
        {chips.map((chip) => (
          <button key={chip.key} type="button" className="chip-button" onClick={() => {
            const next = new URLSearchParams(params);
            next.delete("view");
            next.delete("page");
            if (chip.key === "created") { next.delete("created_from"); next.delete("created_to"); }
            else if (chip.key === "next") { next.delete("next_from"); next.delete("next_to"); }
            else next.delete(chip.key);
            setParams(next);
          }}>{chip.label}</button>
        ))}
        {filtered || view ? <button type="button" className="quiet" onClick={() => setParams(new URLSearchParams())}>Clear filters</button> : null}
      </p>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {error ? <button type="button" className="secondary" onClick={() => setRevision((value) => value + 1)}>Retry</button> : null}
      {!error && items.length === 0 && !loading ? <p>{filtered || view === "needs" || view === "converted" ? "No enquiries match." : "No enquiries yet."}</p> : null}
      {items.length > 0 ? (
        <div className="table-wrap">
          <table className="people-table">
            <caption className="sr-only">Enquiries</caption>
            <thead>
              <tr><th>Name</th><th>Course</th><th>Interest</th><th>Next follow-up</th><th>Stage</th></tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="person-cell">
                      <Link to={`/students/enquiries/${item.id}`}>{item.name}</Link>
                      <span className="meta">{item.whatsapp || item.email || "No contact"}</span>
                    </div>
                  </td>
                  <td>{item.course_name || "Not recorded"}</td>
                  <td>{item.interest || "Not recorded"}</td>
                  <td>{followUpWhen(item)}</td>
                  <td>{item.status === "converted" && item.admission_id ? <Link to={`/students/admissions/${item.admission_id}`}>Converted</Link> : (item.stage || "Open")}</td>
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
            <label>Course
              <select aria-label="Course" value={filterDraft.courseId} onChange={(event) => setFilterDraft({ ...filterDraft, courseId: event.target.value })}>
                <option value="">Any course</option>
                {courses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label>Interest
              <select aria-label="Interest" value={filterDraft.interest} onChange={(event) => setFilterDraft({ ...filterDraft, interest: event.target.value })}>
                <option value="">Any</option>
                {INTERESTS.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Stage
              <select aria-label="Stage" value={filterDraft.stage} onChange={(event) => setFilterDraft({ ...filterDraft, stage: event.target.value })}>
                <option value="">Any</option>
                <option value="open">Open</option>
                <option value="converted">Converted</option>
                <option value="closed">Closed</option>
              </select>
            </label>
            <label>Follow-up
              <select aria-label="Follow-up" value={filterDraft.followUp} onChange={(event) => setFilterDraft({ ...filterDraft, followUp: event.target.value })}>
                <option value="">Any</option>
                <option value="due">Needs follow-up</option>
                <option value="overdue">Overdue</option>
                <option value="today">Today</option>
                <option value="upcoming">Upcoming</option>
                <option value="unscheduled">Unscheduled</option>
                <option value="admitted">Converted</option>
              </select>
            </label>
            <label>Created from
              <input type="date" aria-label="Created from" value={filterDraft.createdFrom} onChange={(event) => setFilterDraft({ ...filterDraft, createdFrom: event.target.value })} />
            </label>
            <label>Created to
              <input type="date" aria-label="Created to" value={filterDraft.createdTo} onChange={(event) => setFilterDraft({ ...filterDraft, createdTo: event.target.value })} />
            </label>
            <label>Next follow-up from
              <input type="date" aria-label="Next follow-up from" value={filterDraft.nextFrom} onChange={(event) => setFilterDraft({ ...filterDraft, nextFrom: event.target.value })} />
            </label>
            <label>Next follow-up to
              <input type="date" aria-label="Next follow-up to" value={filterDraft.nextTo} onChange={(event) => setFilterDraft({ ...filterDraft, nextTo: event.target.value })} />
            </label>
            <label className="span-2">Closure reason
              <select aria-label="Closure reason" value={filterDraft.closure} onChange={(event) => setFilterDraft({ ...filterDraft, closure: event.target.value })}>
                <option value="">Any</option>
                {CLOSURE_REASONS.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <div className="dialog-actions span-2">
              <button type="button" className="quiet" onClick={() => setFilterDraft({ courseId: "", interest: "", stage: "", followUp: "", createdFrom: "", createdTo: "", nextFrom: "", nextTo: "", closure: "" })}>Reset</button>
              <button type="button" className="secondary" onClick={() => setFiltersOpen(false)}>Cancel</button>
              <button type="submit">Apply</button>
            </div>
          </form>
        </StudentDialog>
      ) : null}
      {adding ? <CaptureDialog courses={courses} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); setRevision((value) => value + 1); }} /> : null}
    </section>
  );
}

export function EnquiryPage({ session }: { session: Session }) {
  const { enquiryId = "" } = useParams();
  const navigate = useNavigate();
  const canManage = session.actions.includes("student.manage");
  const [enquiry, setEnquiry] = useState<Enquiry | null>(null);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [admitting, setAdmitting] = useState(false);
  const [following, setFollowing] = useState(false);
  const [closing, setClosing] = useState(false);
  useRecordLabel(enquiry?.name || "");

  function load() {
    setLoading(true);
    api<Enquiry>(`/api/v1/enquiries/${enquiryId}`)
      .then((result) => { setEnquiry(result); setError(""); })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    api<{ courses: CourseOption[] }>("/api/v1/catalog").then((catalog) => setCourses(coursesOf(catalog))).catch(() => undefined);
  }, [enquiryId]);

  async function convert() {
    if (admitting) return;
    setAdmitting(true);
    setError("");
    try {
      const result = await api<{ id: string }>(`/api/v1/enquiries/${enquiryId}/convert`, { method: "POST" });
      notify("Created the admission.");
      navigate(`/students/admissions/${result.id}`);
    } catch (reason) {
      setAdmitting(false);
      setError(reason instanceof Error ? reason.message : "The enquiry was not admitted.");
    }
  }

  if (!enquiry && loading) return <section className="panel"><p>Loading enquiry…</p></section>;
  if (!enquiry) {
    return (
      <section className="panel">
        <p className="error" role="alert">{error || "That enquiry was not found."}</p>
        <button type="button" className="secondary" onClick={load}>Retry</button>
      </section>
    );
  }
  const open = enquiry.status !== "converted" && enquiry.status !== "closed" && !enquiry.admission_id;
  const missing: string[] = [];
  if (!enquiry.whatsapp) missing.push("a WhatsApp number");
  if (!enquiry.course_id) missing.push("an interested course");
  return (
    <section className="panel wide">
      <div className="title-row">
        <div>
          <p className="eyebrow">{enquiry.reference || "Enquiry"}</p>
          <h1>{enquiry.name}</h1>
          <p className="meta">{enquiry.status === "closed" || enquiry.status === "converted" ? (enquiry.stage || followUpWhen(enquiry)) : `${enquiry.stage || "Open"} · ${followUpWhen(enquiry)}`}</p>
          <p className="meta">{enquiry.whatsapp || "No contact"}{enquiry.email ? ` · ${enquiry.email}` : ""} · {enquiry.course_name || "Course not recorded"}</p>
        </div>
        <div className="actions">
          {canManage && open ? <button type="button" onClick={() => setFollowing(true)}>Add follow-up</button> : null}
          {canManage && enquiry.status !== "converted" ? <button type="button" className="secondary" onClick={() => setEditing(true)}>Edit</button> : null}
          {enquiry.admission_id ? <Link className="button" to={`/students/admissions/${enquiry.admission_id}`}>Open admission</Link> : canManage ? (
            <button type="button" disabled={admitting || missing.length > 0} onClick={() => void convert()}>{admitting ? "Creating…" : "Create admission"}</button>
          ) : null}
          {canManage && open ? <button type="button" className="quiet" onClick={() => setClosing(true)}>Close enquiry</button> : null}
        </div>
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {enquiry.status === "converted" ? <p>This enquiry was converted. Its history stays here, and new follow-ups are recorded on the admission.</p> : null}
      {enquiry.status === "closed" ? (
        <p>Closed{enquiry.closure_reason ? `: ${enquiry.closure_reason}` : ""}{enquiry.closure_note ? `. ${enquiry.closure_note.replace(/\.+$/, "")}` : ""}. Reopening does not restore the old follow-up.</p>
      ) : null}
      {canManage && enquiry.status === "closed" ? <ReopenButton enquiryId={enquiry.id} onDone={load} /> : null}
      {missing.length > 0 && canManage && open ? <p>Add {missing.join(" and ")} before creating an admission.</p> : null}
      {editing ? (
        <EditForm enquiry={enquiry} courses={courses} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />
      ) : (
        <>
          <h2>Contact</h2>
          <dl className="facts">
            <div><dt>WhatsApp</dt><dd className={enquiry.whatsapp ? undefined : "is-empty"}>{enquiry.whatsapp || "Not recorded"}</dd></div>
            <div><dt>Email</dt><dd className={enquiry.email ? undefined : "is-empty"}>{enquiry.email || "Not recorded"}</dd></div>
            <div className="span-2"><dt>Present institution</dt><dd className={enquiry.present_institution ? undefined : "is-empty"}>{enquiry.present_institution || "Not recorded"}</dd></div>
          </dl>
          <h2>Interest</h2>
          <dl className="facts">
            <div><dt>Course</dt><dd className={enquiry.course_name ? undefined : "is-empty"}>{enquiry.course_name || "Not recorded"}</dd></div>
            <div><dt>Level of interest</dt><dd className={enquiry.interest ? undefined : "is-empty"}>{enquiry.interest || "Not recorded"}</dd></div>
          </dl>
          <h2>Referral and notes</h2>
          <dl className="facts">
            <div className="span-2"><dt>References</dt><dd className={enquiry.references ? undefined : "is-empty"}>{enquiry.references || "Not recorded"}</dd></div>
            <div className="span-2"><dt>Other details</dt><dd className={enquiry.details ? undefined : "is-empty"}>{enquiry.details || "Not recorded"}</dd></div>
          </dl>
          {(enquiry.answers || []).length ? (
            <>
              <h2>Additional answers</h2>
              <dl className="facts">
                {(enquiry.answers || []).map((item) => (
                  <div key={item.question_id} className="span-2"><dt>{item.label || "Question"}</dt><dd className={item.value ? undefined : "is-empty"}>{item.value || "Not recorded"}</dd></div>
                ))}
              </dl>
            </>
          ) : null}
          <h2>Activity</h2>
          {(enquiry.activity || []).length === 0 ? <p>No activity yet.</p> : (
            <ol className="timeline">
              {(enquiry.activity || []).map((item) => (
                <li key={item.id}>
                  <strong>{activityLabel(item.kind)}</strong>
                  <div className="meta">{formatDisplayDate(item.at)}{item.actor ? ` · ${item.actor}` : ""}</div>
                  <p>{item.note}</p>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      {following ? <FollowDialog enquiry={enquiry} onClose={() => setFollowing(false)} onSaved={load} /> : null}
      {closing ? <CloseDialog enquiryId={enquiry.id} onClose={() => setClosing(false)} onSaved={load} /> : null}
    </section>
  );
}

function activityLabel(kind: string) {
  if (kind === "contact") return "Contact recorded";
  if (kind === "scheduled") return "Follow-up scheduled";
  if (kind === "closed") return "Closed";
  if (kind === "reopened") return "Reopened";
  if (kind === "converted") return "Converted";
  if (kind === "task_cancelled") return "Follow-up cancelled";
  return kind || "Activity";
}

function CaptureDialog({ courses, onClose, onSaved }: { courses: CourseOption[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [courseId, setCourseId] = useState("");
  const [interest, setInterest] = useState("");
  const [choice, setChoice] = useState("");
  const [episode, setEpisode] = useState("");
  const [matches, setMatches] = useState<Prospect[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  const dirty = Boolean(name || whatsapp || email || courseId || interest || episode);
  useUnsaved(dirty && !saving);
  useEffect(() => {
    const needle = name.trim();
    if (needle.length < 2) { setMatches([]); return; }
    const handle = window.setTimeout(() => {
      api<{ items: Prospect[] }>(`/api/v1/prospects?q=${encodeURIComponent(needle)}`).then((result) => setMatches(result.items)).catch(() => setMatches([]));
    }, 300);
    return () => window.clearTimeout(handle);
  }, [name]);
  const selected = matches.find((item) => item.id === choice);
  const sameCourse = selected?.enquiries.some((item) => item.status === "open" && item.course_id === courseId);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const saved = await api<{ id: string }>("/api/v1/enquiries", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify({
          name,
          whatsapp,
          email,
          course_id: courseId,
          interest,
          prospect_id: choice && choice !== "new" ? choice : "",
          episode_note: episode,
        }),
      });
      notify(`Added ${name}.`, "success", { label: "Open enquiry", to: `/students/enquiries/${saved.id}` });
      onSaved();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "The enquiry was not saved.");
      setSaving(false);
    }
  }

  return (
    <StudentDialog title="Add enquiry" dirty={dirty && !saving} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <label className="span-2">Name
          <input value={name} required onChange={(event) => { setName(event.target.value); setChoice(""); }} />
        </label>
        {matches.length ? (
          <fieldset className="span-2">
            <legend>Possible existing people</legend>
            <label><input type="radio" name="person" checked={choice === "new"} onChange={() => setChoice("new")} /> Create a new person</label>
            {matches.map((item) => (
              <label key={item.id}><input type="radio" name="person" checked={choice === item.id} onChange={() => setChoice(item.id)} /> {item.name}{item.whatsapp ? ` · ${item.whatsapp}` : ""}</label>
            ))}
          </fieldset>
        ) : null}
        {sameCourse ? (
          <label className="span-2">Why is this a new enquiry for the same course?
            <textarea rows={2} value={episode} required onChange={(event) => setEpisode(event.target.value)} />
          </label>
        ) : null}
        <label>WhatsApp number
          <input value={whatsapp} onChange={(event) => setWhatsapp(event.target.value)} />
        </label>
        <label>Email
          <input value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label>Interested course
          <select value={courseId} onChange={(event) => setCourseId(event.target.value)}>
            <option value="">Not recorded</option>
            {courses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>Level of interest
          <select value={interest} onChange={(event) => setInterest(event.target.value)}>
            <option value="">Not recorded</option>
            {INTERESTS.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        {error ? <p className="error span-2" role="alert">{error}</p> : null}
        <div className="dialog-actions span-2">
          <button type="button" className="quiet" onClick={() => { if (confirmDiscard(dirty && !saving)) onClose(); }}>Cancel</button>
          <button type="submit" disabled={saving || !name.trim() || (matches.length > 0 && !choice)}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </StudentDialog>
  );
}

function EditForm({ enquiry, courses, onClose, onSaved }: { enquiry: Enquiry; courses: CourseOption[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(enquiry.name);
  const [whatsapp, setWhatsapp] = useState(enquiry.whatsapp || "");
  const [email, setEmail] = useState(enquiry.email || "");
  const [institution, setInstitution] = useState(enquiry.present_institution || "");
  const [courseId, setCourseId] = useState(enquiry.course_id || "");
  const [interest, setInterest] = useState(enquiry.interest || "");
  const [references, setReferences] = useState(enquiry.references || "");
  const [details, setDetails] = useState(enquiry.details || "");
  const [questions, setQuestions] = useState<Question[]>(enquiry.questions || []);
  const [answers, setAnswers] = useState<Record<string, string>>(Object.fromEntries((enquiry.answers || []).map((item) => [item.question_id, item.value])));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const dirty = !saving && (
    name !== enquiry.name || whatsapp !== (enquiry.whatsapp || "") || email !== (enquiry.email || "")
    || institution !== (enquiry.present_institution || "") || courseId !== (enquiry.course_id || "")
    || interest !== (enquiry.interest || "") || references !== (enquiry.references || "") || details !== (enquiry.details || "")
    || questions.some((item) => (answers[item.id] || "") !== ((enquiry.answers || []).find((answer) => answer.question_id === item.id)?.value || ""))
  );
  useUnsaved(dirty);
  useEffect(() => {
    if (enquiry.questions?.length) return;
    api<{ items: Question[] }>("/api/v1/form-questions?form=enquiry").then((result) => setQuestions(result.items)).catch((reason: Error) => setError(reason.message));
  }, [enquiry.questions]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await api(`/api/v1/enquiries/${enquiry.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name, whatsapp, email, present_institution: institution, course_id: courseId, interest, references, details,
          answers: questions.map((item) => ({ question_id: item.id, value: answers[item.id] || "" })),
        }),
      });
      notify(`Saved ${name}.`);
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The enquiry was not saved.");
      setSaving(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={save}>
      {(enquiry.related_count || 0) > 1 ? <p className="span-2">Name, contact, email, and institution are shared with {(enquiry.related_count || 1) - 1} other enquir{(enquiry.related_count || 1) - 1 === 1 ? "y" : "ies"} for this person. Course, interest, and follow-ups stay on this enquiry.</p> : null}
      <label className="span-2">Name
        <input value={name} required onChange={(event) => setName(event.target.value)} />
      </label>
      <label>WhatsApp number
        <input value={whatsapp} onChange={(event) => setWhatsapp(event.target.value)} />
      </label>
      <label>Email
        <input value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label className="span-2">Present institution
        <input value={institution} onChange={(event) => setInstitution(event.target.value)} />
      </label>
      <label>Interested course
        <select value={courseId} onChange={(event) => setCourseId(event.target.value)}>
          <option value="">Not recorded</option>
          {courses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label>Level of interest
        <select value={interest} onChange={(event) => setInterest(event.target.value)}>
          <option value="">Not recorded</option>
          {INTERESTS.map((item) => <option key={item}>{item}</option>)}
        </select>
      </label>
      <label className="span-2">References
        <textarea rows={2} value={references} onChange={(event) => setReferences(event.target.value)} />
      </label>
      <label className="span-2">Other details
        <textarea rows={3} value={details} onChange={(event) => setDetails(event.target.value)} />
      </label>
      <AnswerFields questions={questions} answers={answers} onChange={(id, value) => setAnswers({ ...answers, [id]: value })} requiredNote="required to admit" />
      {error ? <p className="error span-2" role="alert">{error}</p> : null}
      <div className="dialog-actions span-2">
        <button type="button" className="quiet" onClick={() => { if (confirmDiscard(dirty)) onClose(); }}>Cancel</button>
        <button type="submit" disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </form>
  );
}

function FollowDialog({ enquiry, onClose, onSaved }: { enquiry: Enquiry; onClose: () => void; onSaved: () => void }) {
  const today = enquiry.today || "";
  const [mode, setMode] = useState<"record" | "schedule">("record");
  const [at, setAt] = useState(today);
  const [note, setNote] = useState("");
  const [interest, setInterest] = useState("");
  const [nextOn, setNextOn] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  const dirty = Boolean(note || interest || nextOn || (mode === "record" && at !== today));
  useUnsaved(dirty && !saving);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    const body = mode === "schedule"
      ? { kind: "schedule", next_on: nextOn, note }
      : { kind: "record", at, note, interest, next_on: nextOn };
    try {
      await api(`/api/v1/enquiries/${enquiry.id}/follow-ups`, {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify(body),
      });
      notify(mode === "schedule" ? "Scheduled the follow-up." : "Recorded the contact.");
      onSaved();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The follow-up was not saved.");
      setSaving(false);
    }
  }

  return (
    <StudentDialog title="Add follow-up" dirty={dirty && !saving} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <fieldset className="span-2">
          <legend>What are you doing?</legend>
          <label><input type="radio" name="mode" checked={mode === "record"} onChange={() => setMode("record")} /> Record contact already made</label>
          <label><input type="radio" name="mode" checked={mode === "schedule"} onChange={() => setMode("schedule")} /> Schedule a future follow-up</label>
        </fieldset>
        {mode === "record" ? (
          <label>Contact date
            <input type="date" value={at} required max={today || undefined} onChange={(event) => setAt(event.target.value)} />
          </label>
        ) : (
          <label>Follow-up date
            <input type="date" value={nextOn} required min={today || undefined} onChange={(event) => setNextOn(event.target.value)} />
          </label>
        )}
        {mode === "record" ? (
          <label>Interest after this contact
            <select value={interest} onChange={(event) => setInterest(event.target.value)}>
              <option value="">Leave unchanged</option>
              {INTERESTS.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
        ) : null}
        <label className="span-2">{mode === "record" ? "What was discussed" : "Note, optional"}
          <textarea rows={3} value={note} required={mode === "record"} onChange={(event) => setNote(event.target.value)} />
        </label>
        {mode === "record" ? (
          <label>Next follow-up, optional
            <input type="date" value={nextOn} min={today || undefined} onChange={(event) => setNextOn(event.target.value)} />
          </label>
        ) : null}
        {error ? <p className="error span-2" role="alert">{error}</p> : null}
        <div className="dialog-actions span-2">
          <button type="button" className="quiet" onClick={() => { if (confirmDiscard(dirty && !saving)) onClose(); }}>Cancel</button>
          <button type="submit" disabled={saving}>{saving ? "Saving…" : mode === "schedule" ? "Schedule follow-up" : "Record contact"}</button>
        </div>
      </form>
    </StudentDialog>
  );
}

function CloseDialog({ enquiryId, onClose, onSaved }: { enquiryId: string; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const dirty = Boolean(reason || note);
  useUnsaved(dirty && !saving);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await api(`/api/v1/enquiries/${enquiryId}/close`, { method: "POST", body: JSON.stringify({ reason, note }) });
      notify("Closed the enquiry.");
      onSaved();
      onClose();
    } catch (reasonError) {
      setError(reasonError instanceof Error ? reasonError.message : "The enquiry was not closed.");
      setSaving(false);
    }
  }

  return (
    <StudentDialog title="Close enquiry" dirty={dirty && !saving} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <p className="span-2">Closing keeps the history and cancels a pending follow-up. It does not delete the person.</p>
        <label className="span-2">Reason
          <select value={reason} required onChange={(event) => setReason(event.target.value)}>
            <option value="">Choose</option>
            {CLOSURE_REASONS.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="span-2">Note{reason === "Other" ? "" : ", optional"}
          <textarea rows={3} value={note} required={reason === "Other"} onChange={(event) => setNote(event.target.value)} />
        </label>
        {error ? <p className="error span-2" role="alert">{error}</p> : null}
        <div className="dialog-actions span-2">
          <button type="button" className="quiet" onClick={() => { if (confirmDiscard(dirty && !saving)) onClose(); }}>Cancel</button>
          <button type="submit" disabled={saving || !reason}>{saving ? "Closing…" : "Close enquiry"}</button>
        </div>
      </form>
    </StudentDialog>
  );
}

function ReopenButton({ enquiryId, onDone }: { enquiryId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  if (!open) return <p className="actions"><button type="button" onClick={() => setOpen(true)}>Reopen enquiry</button></p>;
  return (
    <form className="form-grid" onSubmit={async (event) => {
      event.preventDefault();
      setSaving(true);
      setError("");
      try {
        await api(`/api/v1/enquiries/${enquiryId}/reopen`, { method: "POST", body: JSON.stringify({ reason }) });
        notify("Reopened the enquiry.");
        setOpen(false);
        onDone();
      } catch (reasonError) {
        setError(reasonError instanceof Error ? reasonError.message : "The enquiry was not reopened.");
        setSaving(false);
      }
    }}>
      <label className="span-2">Reason for reopening
        <input value={reason} required onChange={(event) => setReason(event.target.value)} />
      </label>
      {error ? <p className="error span-2" role="alert">{error}</p> : null}
      <div className="dialog-actions span-2">
        <button type="button" className="quiet" onClick={() => setOpen(false)}>Cancel</button>
        <button type="submit" disabled={saving || !reason.trim()}>{saving ? "Reopening…" : "Reopen"}</button>
      </div>
    </form>
  );
}
