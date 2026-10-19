import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { api, Session } from "../api";
import { notify } from "../notify";

type Column = { id: string; sheet: string; label: string; samples: string[]; suggestion: string; target: string };
type Target = { id: string; label: string };
type Sheet = { name: string; row_count: number; selected: boolean; header_row: number };
type Candidate = { kind: string; id: string; name: string; whatsapp: string; attributes: string[]; linkable?: boolean; code?: string };
type ImportRow = {
  key: string;
  sheet: string;
  row: number;
  status: string;
  action: string;
  prospect_id: string;
  episode_note: string;
  readiness?: string;
  values: Record<string, string>;
  errors: { column: string; field: string; message: string }[];
  warnings: { message: string }[];
  formulas?: { key: string; label: string; cached: string; use: string; value: string }[];
  candidates: Candidate[];
};
type Operation = {
  id: string;
  revision: number;
  filename: string;
  format: string;
  delimiter: string;
  detected_delimiter: string;
  expires_at: string;
  expired: boolean;
  status: string;
  phase: string;
  sheets: Sheet[];
  columns: Column[];
  rows: ImportRow[];
  issues: string[];
  counts: { valid: number; blocked: number; skipped: number; total: number };
  targets: Target[];
  defaults: { course_id: string; interest: string; mode: string };
  date_format: string;
  mappings: { column_id: string; target: string }[];
  unresolved_courses?: string[];
  unresolved_interests?: string[];
  saved_mappings?: { id: string; name: string; shared: boolean }[];
  stale?: string[];
  result?: { created: { id: string; name: string; sheet: string; row: number }[]; skipped: { sheet: string; row: number }[] } | null;
};
type CourseOption = { id: string; name: string };

const STEPS = ["Upload", "Source", "Map columns", "Resolve values", "Review", "Confirm", "Results"];

function readinessLabel(value = "") {
  if (value === "needs_information") return "Needs information";
  if (value === "needs_identity") return "Needs identity review";
  if (value === "needs_batch") return "Choose a batch";
  if (value === "ready") return "Ready for enrollment";
  if (value === "enrolled") return "Enrolled";
  if (value === "closed") return "Closed";
  if (value === "unavailable") return "Unavailable";
  return value || "Not recorded";
}

export function AdmissionImportPage({ session }: { session: Session }) {
  return <EnquiryImportPage session={session} kind="admission" />;
}

export function EnquiryImportPage({ session, kind = "enquiry" }: { session: Session; kind?: "enquiry" | "admission" }) {
  const admission = kind === "admission";
  const base = admission ? "/api/v1/admission-imports" : "/api/v1/enquiry-imports";
  const mappingBase = admission ? "/api/v1/admission-mappings" : "/api/v1/enquiry-mappings";
  const noun = admission ? "applications" : "enquiries";
  const backTo = admission ? "/students/admissions" : "/students/enquiries";
  const [operation, setOperation] = useState<Operation | null>(null);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [headers, setHeaders] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [courseMap, setCourseMap] = useState<Record<string, string>>({});
  const [interestMap, setInterestMap] = useState<Record<string, string>>({});
  const [dateFormat, setDateFormat] = useState("");
  const [defaultCourse, setDefaultCourse] = useState("");
  const [defaultInterest, setDefaultInterest] = useState("");
  const [defaultMode, setDefaultMode] = useState("blanks");
  const [formulas, setFormulas] = useState<Record<string, { use: string; value: string }>>({});
  const [rowFilter, setRowFilter] = useState("all");
  const [decisions, setDecisions] = useState<Record<string, { action: string; prospect_id: string; episode_note: string }>>({});
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [step, setStep] = useState(0);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [delimiter, setDelimiter] = useState("");

  function absorb(next: Operation) {
    setOperation(next);
    setError("");
    const headerState: Record<string, number> = {};
    const selectedState: Record<string, boolean> = {};
    next.sheets.forEach((sheet) => {
      headerState[sheet.name] = sheet.header_row || 1;
      selectedState[sheet.name] = sheet.selected || next.format === "csv";
    });
    setHeaders(headerState);
    setSelected(selectedState);
    const mapped: Record<string, string> = {};
    next.columns.forEach((column) => { mapped[column.id] = column.target || column.suggestion || ""; });
    setMappings(mapped);
    setDelimiter(next.delimiter || "");
    setDateFormat(next.date_format || "");
    setDefaultCourse(next.defaults?.course_id || "");
    setDefaultInterest(next.defaults?.interest || "");
    setDefaultMode(next.defaults?.mode || "blanks");
    const formulaState: Record<string, { use: string; value: string }> = {};
    next.rows.forEach((row) => (row.formulas || []).forEach((item) => {
      formulaState[item.key] = { use: item.use || "", value: item.value || "" };
    }));
    setFormulas(formulaState);
    if (next.status === "committed") setStep(6);
  }

  async function upload(file: File) {
    setPending(true);
    setError("");
    const body = new FormData();
    body.set("file", file);
    try {
      const result = await api<Operation>(base, { method: "POST", body });
      const catalog = await api<{ courses: CourseOption[] }>("/api/v1/catalog");
      setCourses([...(catalog.courses || [])].sort((left, right) => left.name.localeCompare(right.name)));
      absorb(result);
      setStep(result.format === "csv" ? 1 : 1);
      setKey(crypto.randomUUID());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The file was not read.");
    } finally {
      setPending(false);
    }
  }

  function planBody(extra: Record<string, unknown> = {}) {
    if (!operation) return {};
    const sources = operation.sheets
      .filter((sheet) => selected[sheet.name])
      .map((sheet) => ({ sheet: sheet.name, header_row: headers[sheet.name] || 1 }));
    return {
      revision: operation.revision,
      delimiter: delimiter || operation.delimiter || "",
      sources,
      mappings: Object.entries(mappings).filter(([, target]) => target).map(([column_id, target]) => ({ column_id, target })),
      defaults: { course_id: defaultCourse, interest: defaultInterest, mode: defaultMode },
      formulas,
      courses: courseMap,
      interests: interestMap,
      date_format: dateFormat,
      decisions: Object.entries(decisions).map(([rowKey, decision]) => {
        const action = decision.action;
        const link = action.startsWith("link:");
        const prospect = action.startsWith("prospect:");
        return {
          key: rowKey,
          action: link ? "link" : prospect ? "prospect" : action,
          prospect_id: prospect ? action.slice(9) : link && !admission ? action.slice(5) : decision.prospect_id,
          student_id: link && admission ? action.slice(5) : "",
          episode_note: decision.episode_note,
        };
      }),
      ...extra,
    };
  }

  async function savePlan(extra: Record<string, unknown> = {}) {
    if (!operation) return null;
    setPending(true);
    setError("");
    try {
      const result = await api<Operation>(`${base}/${operation.id}`, {
        method: "PUT",
        body: JSON.stringify(planBody(extra)),
      });
      absorb(result);
      return result;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The preview was not updated.");
      const fresh = await api<Operation>(`${base}/${operation.id}`).catch(() => null);
      if (fresh) absorb(fresh);
      return null;
    } finally {
      setPending(false);
    }
  }

  async function commit() {
    if (!operation || pending) return;
    setPending(true);
    setError("");
    try {
      const result = await api<Operation>(`${base}/${operation.id}/commit`, {
        method: "POST",
        body: JSON.stringify({ revision: operation.revision, idempotency_key: key }),
      });
      absorb(result);
      notify(`Imported ${result.result?.created.length || 0} ${noun}.`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "The import was not saved.";
      const fresh = await api<Operation>(`${base}/${operation.id}`).catch(() => null);
      if (fresh?.status === "committed") {
        absorb(fresh);
        notify(`Imported ${fresh.result?.created.length || 0} ${noun}.`);
      } else {
        setError(message);
        if (fresh) absorb(fresh);
      }
    } finally {
      setPending(false);
    }
  }

  const current = operation?.status === "committed" ? 6 : step;

  return (
    <section className="panel wide">
      <div className="page-title">
        <div>
          <p className="eyebrow">Admissions</p>
          <h1>{admission ? "Import applications" : "Import enquiries"}</h1>
          <p className="page-lead">Use an existing .xlsx or CSV file. Nothing is saved until you confirm the reviewed rows.</p>
        </div>
        <Link className="button secondary" to={backTo}>{admission ? "Back to admissions" : "Back to enquiries"}</Link>
      </div>
      <p className="steps" aria-label="Import steps">
        {STEPS.map((label, index) => <span key={label} className={index === current ? "is-current" : undefined}>{label}</span>)}
      </p>
      <p>Supported files: .xlsx and UTF-8 CSV, up to 10 MB, 10,000 data rows, and 20 sheets. A sample file is optional. {operation?.expires_at ? `This upload expires ${operation.expires_at.slice(0, 10)}.` : null}</p>
      <p><a href={`${base}/template`}>Download a sample template</a></p>
      <label>Spreadsheet
        <input type="file" accept=".xlsx,.csv,text/csv" aria-label="Spreadsheet" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }} />
      </label>
      {pending ? <p role="status">Working on the import…</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {operation && current === 1 ? (
        <form onSubmit={async (event) => { event.preventDefault(); const saved = await savePlan(); if (saved) setStep(2); }}>
          {operation.format === "csv" ? <p>CSV files have one source. Choose the header row if the titles are not on the first row.</p> : <p>Select every sheet to include. There is no automatic first-sheet import.</p>}
          {operation.format === "csv" ? (
            <label>Delimiter
              <select aria-label="Delimiter" value={delimiter || operation.delimiter} onChange={(event) => setDelimiter(event.target.value)}>
                <option value=",">Comma</option>
                <option value=";">Semicolon</option>
                <option value={"\t"}>Tab</option>
              </select>
            </label>
          ) : null}
          {operation.sheets.map((sheet) => (
            <div key={sheet.name} className="filter-row">
              {operation.format === "xlsx" ? (
                <label><input type="checkbox" checked={Boolean(selected[sheet.name])} onChange={(event) => setSelected({ ...selected, [sheet.name]: event.target.checked })} /> {sheet.name}</label>
              ) : <strong>{sheet.name}</strong>}
              <label>Header row
                <input type="number" min={1} aria-label={`Header row for ${sheet.name}`} value={headers[sheet.name] || 1} onChange={(event) => setHeaders({ ...headers, [sheet.name]: Number(event.target.value) })} />
              </label>
              <span>{sheet.row_count} rows</span>
            </div>
          ))}
          <button type="submit" disabled={pending}>Continue</button>
        </form>
      ) : null}
      {operation && current === 2 ? (
        <form onSubmit={async (event) => { event.preventDefault(); const saved = await savePlan(); if (saved) setStep(saved.phase === "mapping" ? 2 : 3); }}>
          {operation.issues.map((issue) => <p key={issue} className="error" role="alert">{issue}</p>)}
          <div className="table-wrap">
            <table className="people-table">
              <caption>Column mapping</caption>
              <thead><tr><th>Column</th><th>Sample</th><th>Field</th></tr></thead>
              <tbody>
                {operation.columns.map((column) => (
                  <tr key={column.id}>
                    <td>{column.label}{column.sheet ? ` · ${column.sheet}` : ""}{column.suggestion && mappings[column.id] === column.suggestion ? " · Suggested" : ""}</td>
                    <td>{column.samples.join(", ") || "—"}</td>
                    <td>
                      <select aria-label={`Map ${column.label}`} value={mappings[column.id] || ""} onChange={(event) => setMappings({ ...mappings, [column.id]: event.target.value })}>
                        <option value="">Choose</option>
                        <option value="ignore">Ignore</option>
                        {operation.targets.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={() => setStep(1)}>Back</button>
            <button type="submit" disabled={pending}>Continue</button>
          </div>
        </form>
      ) : null}
      {operation && (current === 3 || current === 4) ? (
        <form onSubmit={async (event: FormEvent) => {
          event.preventDefault();
          const saved = await savePlan();
          if (!saved) return;
          if (saved.counts.blocked === 0) setStep(5);
          else setStep(4);
        }}>
          <h2>Resolve values</h2>
          <label>Default course, optional
            <select aria-label="Default course" value={defaultCourse} onChange={(event) => setDefaultCourse(event.target.value)}>
              <option value="">No default</option>
              {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
            </select>
          </label>
          {admission ? null : <label>Default interest, optional
            <select aria-label="Default interest" value={defaultInterest} onChange={(event) => setDefaultInterest(event.target.value)}>
              <option value="">No default</option>
              <option>High</option>
              <option>Medium</option>
              <option>Low</option>
            </select>
          </label>}
          <label>Default applies to
            <select aria-label="Default mode" value={defaultMode} onChange={(event) => setDefaultMode(event.target.value)}>
              <option value="blanks">Blank course cells</option>
              <option value="override">Every row, replacing the source course</option>
            </select>
          </label>
          <label>Date format
            <select aria-label="Date format" value={dateFormat} onChange={(event) => setDateFormat(event.target.value)}>
              <option value="">Only when a date is ambiguous</option>
              <option value="DMY">Day/month/year</option>
              <option value="MDY">Month/day/year</option>
              <option value="YMD">Year/month/day</option>
            </select>
          </label>
          {(operation.unresolved_courses || []).map((raw) => (
            <label key={raw}>Course for {raw}
              <select aria-label={`Course for ${raw}`} value={courseMap[raw] || ""} onChange={(event) => setCourseMap({ ...courseMap, [raw]: event.target.value })}>
                <option value="">Choose</option>
                {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
              </select>
            </label>
          ))}
          {admission ? null : (operation.unresolved_interests || []).map((raw) => (
            <label key={raw}>Interest for {raw}
              <select aria-label={`Interest for ${raw}`} value={interestMap[raw] || ""} onChange={(event) => setInterestMap({ ...interestMap, [raw]: event.target.value })}>
                <option value="">Choose</option>
                <option>High</option>
                <option>Medium</option>
                <option>Low</option>
              </select>
            </label>
          ))}
          <h2>Review</h2>
          <p>{operation.counts.valid} ready, {operation.counts.blocked} blocked, {operation.counts.skipped} skipped.</p>
          <label>Show rows
            <select aria-label="Show rows" value={rowFilter} onChange={(event) => setRowFilter(event.target.value)}>
              <option value="all">All</option>
              <option value="blocked">Blocked</option>
              <option value="valid">Ready</option>
              <option value="skipped">Skipped</option>
            </select>
          </label>
          <p><a href={`${base}/${operation.id}/errors`}>Download the error report</a></p>
          <div className="table-wrap">
            <table className="people-table">
              <caption>Reviewed rows</caption>
              <thead><tr><th>Row</th><th>Name</th><th>Contact</th><th>Course</th>{admission ? <th>Readiness</th> : <th>Interest</th>}<th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {operation.rows.filter((row) => rowFilter === "all" || row.status === rowFilter).map((row) => (
                  <tr key={row.key} className={row.status === "blocked" ? "row-error" : undefined}>
                    <td>{row.sheet} {row.row}</td>
                    <td>{row.values.name || "Not recorded"}</td>
                    <td>{row.values.phone || row.values.whatsapp || "Not recorded"}</td>
                    <td>{row.values.course_name || row.values.course_raw || "Not recorded"}</td>
                    <td>{admission ? readinessLabel(row.readiness) : (row.values.interest || "Not recorded")}</td>
                    <td>{row.errors.map((item) => item.message).join(" ") || row.warnings.map((item) => item.message).join(" ") || "Ready"}</td>
                    <td>
                      <select aria-label={`Action for row ${row.row}`} value={decisions[row.key]?.action || (row.candidates.length ? "" : "create")} onChange={(event) => {
                        const action = event.target.value;
                        setDecisions({ ...decisions, [row.key]: { action, prospect_id: "", episode_note: decisions[row.key]?.episode_note || "" } });
                      }}>
                        <option value="">Choose</option>
                        <option value="create">{admission ? "Create a separate application" : "Create a new person"}</option>
                        {row.candidates.filter((candidate) => candidate.linkable !== false).map((candidate) => (
                          <option key={candidate.id} value={candidate.kind === "prospect" && admission ? `prospect:${candidate.id}` : `link:${candidate.id}`}>
                            {candidate.kind === "prospect" ? `Use prospect ${candidate.name}` : admission ? `Use student ${candidate.name}${candidate.code ? ` (${candidate.code})` : ""}` : `Link ${candidate.name} (${candidate.attributes.join(", ")})`}
                          </option>
                        ))}
                        <option value="skip">Skip</option>
                      </select>
                      {(row.formulas || []).map((formula) => (
                        <label key={formula.key}>{formula.label} is a formula
                          <select aria-label={`Formula ${formula.label} on row ${row.row}`} value={formulas[formula.key]?.use || ""} onChange={(event) => setFormulas({ ...formulas, [formula.key]: { use: event.target.value, value: formulas[formula.key]?.value || "" } })}>
                            <option value="">Choose</option>
                            {formula.cached ? <option value="cached">Use cached value {formula.cached}</option> : null}
                            <option value="plain">Enter a plain value</option>
                          </select>
                          {formulas[formula.key]?.use === "plain" ? (
                            <input aria-label={`Plain value for ${formula.label} on row ${row.row}`} value={formulas[formula.key]?.value || ""} onChange={(event) => setFormulas({ ...formulas, [formula.key]: { use: "plain", value: event.target.value } })} />
                          ) : null}
                        </label>
                      ))}
                      {(decisions[row.key]?.action || "").startsWith("link:") || (row.candidates.length > 0 && decisions[row.key]?.action === "create") ? (
                        <input aria-label={`Explanation for row ${row.row}`} placeholder={admission ? "Why this is another application" : "Why this is a new enquiry"} value={decisions[row.key]?.episode_note || ""} onChange={(event) => setDecisions({ ...decisions, [row.key]: { ...(decisions[row.key] || { action: "create", prospect_id: "" }), episode_note: event.target.value } })} />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={() => setStep(2)}>Back</button>
            <button type="submit" disabled={pending}>Update review</button>
            <button type="button" disabled={pending} onClick={async () => {
              const saved = await savePlan();
              if (saved && saved.counts.blocked === 0) setStep(5);
            }}>Continue</button>
          </div>
        </form>
      ) : null}
      {operation && current === 5 ? (
        <div>
          <h2>Confirm</h2>
          <p>Create {operation.counts.valid} {noun}. Skip {operation.counts.skipped}. Blocked rows: {operation.counts.blocked}. Source: {operation.filename}.{admission ? " Rows become applications and are not enrolled." : ""}</p>
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={() => setStep(4)}>Back</button>
            <button type="button" disabled={pending || operation.counts.blocked > 0} onClick={() => void commit()}>{pending ? "Saving…" : "Save import"}</button>
          </div>
        </div>
      ) : null}
      {operation?.status === "committed" && operation.result ? (
        <div>
          <h2>Results</h2>
          <p>Created {operation.result.created.length}. Skipped {operation.result.skipped.length}.</p>
          <ul>
            {operation.result.created.map((item) => <li key={item.id}><Link to={`${backTo}/${item.id}`}>{item.name}</Link> · {item.sheet} row {item.row}</li>)}
          </ul>
          {operation.result.skipped.length ? <p>Skipped rows: {operation.result.skipped.map((item) => `${item.sheet} ${item.row}`).join(", ")}.</p> : null}
        </div>
      ) : null}
      {operation && operation.saved_mappings && operation.saved_mappings.length ? (
        <form onSubmit={async (event) => {
          event.preventDefault();
          const mappingId = new FormData(event.currentTarget).get("mapping");
          if (!mappingId || !operation) return;
          setPending(true);
          try {
            const result = await api<Operation>(`${base}/${operation.id}/mapping`, { method: "POST", body: JSON.stringify({ mapping_id: mappingId }) });
            absorb(result);
            if (result.stale?.length) setError(result.stale.join(" "));
            setStep(3);
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : "The mapping was not applied.");
          } finally {
            setPending(false);
          }
        }}>
          <label>Saved mapping
            <select name="mapping" aria-label="Saved mapping" defaultValue="">
              <option value="">Choose</option>
              {operation.saved_mappings.map((item) => <option key={item.id} value={item.id}>{item.name}{item.shared ? " (shared)" : ""}</option>)}
            </select>
          </label>
          <button type="submit" className="secondary" disabled={pending}>Apply mapping</button>
          {session.actions.includes("user.manage") ? (
            <button type="button" className="quiet" disabled={pending} onClick={async (event) => {
              const form = event.currentTarget.form;
              const mappingId = form ? new FormData(form).get("mapping") : "";
              if (!mappingId || !operation) return;
              setPending(true);
              try {
                await api(`${mappingBase}/${mappingId}/publish`, { method: "POST" });
                notify("Shared the mapping with the institute.");
                const fresh = await api<Operation>(`${base}/${operation.id}`);
                absorb(fresh);
              } catch (reason) {
                setError(reason instanceof Error ? reason.message : "The mapping was not shared.");
              } finally {
                setPending(false);
              }
            }}>Share with the institute</button>
          ) : null}
        </form>
      ) : null}
      {operation && operation.phase === "review" && operation.status !== "committed" ? (
        <form onSubmit={async (event) => {
          event.preventDefault();
          const name = new FormData(event.currentTarget).get("name");
          if (!operation || !name) return;
          try {
            await api(mappingBase, { method: "POST", body: JSON.stringify({ import_id: operation.id, name }) });
            notify("Saved the mapping. The next import still needs a review.");
            const fresh = await api<Operation>(`${base}/${operation.id}`);
            absorb(fresh);
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : "The mapping was not saved.");
          }
        }}>
          <label>Save this mapping
            <input name="name" aria-label="Mapping name" />
          </label>
          <button type="submit" className="secondary">Save mapping</button>
        </form>
      ) : null}
    </section>
  );
}
