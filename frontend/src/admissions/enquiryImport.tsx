import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, Session } from "../api";
import { notify } from "../notify";

type Column = { id: string; sheet: string; label: string; samples: string[]; suggestion: string; target: string };
type Target = { id: string; label: string };
type Sheet = { name: string; index?: number; row_count: number; selected: boolean; header_row: number; cells?: string[][] };
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
  originals?: Record<string, string>;
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
  branch_id?: string;
  course_id?: string;
  batch_id?: string;
  identity_mode?: "manual" | "automatic";
  result?: { created: { id: string; name: string; sheet: string; row: number; student_id?: string; enrollment_id?: string; student_created?: boolean }[]; skipped: { sheet: string; row: number }[] } | null;
};
type CourseOption = { id: string; name: string; archived?: boolean };
type BranchOption = { id: string; name: string; archived?: boolean };
type OfferingOption = { id?: string; branch_id?: string; course_id?: string };
type BatchOption = { id: string; name: string; archived?: boolean; closed?: boolean; branch_id?: string; course_id?: string; offering_id?: string; ended_on?: string };
type ImportHistory = {
  id: string;
  filename: string;
  status: string;
  created_at: string | null;
  branch_id: string;
  course_id: string;
  created_count: number;
};

const STEPS = ["Upload", "Source", "Map columns", "Resolve values", "Review", "Confirm", "Results"];
const STUDENT_FIELDS = [
  ["name", "Name"],
  ["phone", "Contact number"],
  ["email", "Email"],
  ["date_of_birth", "Date of birth"],
  ["gender", "Gender"],
  ["guardian_name", "Guardian"],
  ["guardian_phone", "Guardian phone"],
  ["street", "Street"],
  ["place", "Place"],
  ["district", "District"],
  ["state", "State"],
  ["pin", "PIN"],
] as const;
const STATUS_LABEL: Record<string, string> = {
  open: "In progress",
  committed: "Imported",
  failed: "Failed",
  committing: "Importing",
};

function statusChip(status: string) {
  if (status === "committed") return "committed";
  if (status === "failed") return "needs_resolution";
  if (status === "committing") return "update";
  return "ready";
}

function landingStep(next: Operation) {
  if (next.status === "committed") return 6;
  if (next.phase === "review") return next.counts.blocked === 0 ? 5 : 4;
  if (next.phase === "mapping") return 2;
  return 1;
}

function reachedStep(next: Operation | null) {
  if (!next) return 0;
  if (next.status === "committed") return 6;
  if (next.phase === "review") return 5;
  if (next.phase === "mapping") return 2;
  return 1;
}

function columnLetter(index: number) {
  let value = index + 1;
  let letters = "";
  while (value > 0) {
    value -= 1;
    letters = String.fromCharCode(65 + (value % 26)) + letters;
    value = Math.floor(value / 26);
  }
  return letters;
}

function activeSheetName(sheets: Sheet[], active: string) {
  return sheets.some((sheet) => sheet.name === active) ? active : sheets[0]?.name || "";
}

function IntakeGrid({
  sheets,
  activeName,
  onActive,
  include,
  selected,
  onToggle,
  headerRow,
  onHeader,
  columns = [],
  mappings = {},
  targets = [],
  onMap,
}: {
  sheets: Sheet[];
  activeName: string;
  onActive: (name: string) => void;
  include: boolean;
  selected: Record<string, boolean>;
  onToggle: (name: string) => void;
  headerRow: number;
  onHeader?: (row: number) => void;
  columns?: Column[];
  mappings?: Record<string, string>;
  targets?: Target[];
  onMap?: (columnId: string, target: string) => void;
}) {
  const shown = sheets.find((sheet) => sheet.name === activeName) || sheets[0];
  const shownName = shown?.name || "";
  const cells = shown?.cells || [];
  const width = Math.max(1, ...cells.map((row) => row.length), ...columns.filter((column) => column.sheet === shownName).map((column) => Number(column.id.split(":")[1]) + 1));
  const headerIndex = Math.max(0, headerRow - 1);
  const showTabs = include || sheets.length > 1;
  return (
    <div className="excel">
      <div className="table-wrap">
        <table className="sheet-grid">
          <caption>{shownName || "Sheet"}. {onMap ? "Choose a field for each column." : "Click a row number to mark the header."}</caption>
          <thead>
            <tr>
              <th className="col-letter" />
              {Array.from({ length: width }, (_, index) => <th key={index} className="col-letter">{columnLetter(index)}</th>)}
            </tr>
            {onMap ? (
              <tr>
                <th className="col-letter" />
                {Array.from({ length: width }, (_, index) => {
                  const column = columns.find((item) => item.sheet === shownName && Number(item.id.split(":")[1]) === index);
                  if (!column) return <th key={index} />;
                  const value = mappings[column.id] || "";
                  return (
                    <th key={column.id} className={value ? undefined : "bad"}>
                      <select aria-label={`Map ${column.label}`} value={value} onChange={(event) => onMap(column.id, event.target.value)}>
                        <option value="">Choose</option>
                        <option value="ignore">Ignore</option>
                        {targets.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
                      </select>
                    </th>
                  );
                })}
              </tr>
            ) : null}
          </thead>
          <tbody>
            {cells.map((row, rowIndex) => (
              <tr key={rowIndex} className={rowIndex === headerIndex ? "source-row" : undefined}>
                <th className="row-no">
                  {onHeader ? (
                    <button type="button" aria-pressed={rowIndex === headerIndex} aria-label={`Use row ${rowIndex + 1} as the header`} onClick={() => onHeader(rowIndex + 1)}>{rowIndex + 1}</button>
                  ) : rowIndex + 1}
                </th>
                {Array.from({ length: width }, (_, index) => (
                  <td key={index} className="cell-text">{row[index] || ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showTabs ? (
        <div className="sheet-tabs excel-tabs" role="tablist" aria-label="Sheets">
          {sheets.map((sheet) => (
            <span key={sheet.name} className={include && !selected[sheet.name] ? "tab excluded" : "tab"}>
              {include ? <input type="checkbox" checked={Boolean(selected[sheet.name])} aria-label={`Include ${sheet.name}`} onChange={() => onToggle(sheet.name)} /> : null}
              <button type="button" role="tab" aria-selected={sheet.name === shownName} onClick={() => onActive(sheet.name)}>{sheet.name}</button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type ReviewColumn = { field: string; label: string; kind?: "text" | "gender" | "interest" | "readonly" };

function reviewColumns(admission: boolean): ReviewColumn[] {
  if (admission) {
    return [
      ...STUDENT_FIELDS.map(([field, label]) => ({ field, label, kind: field === "gender" ? "gender" as const : "text" as const })),
      { field: "course_name", label: "Course", kind: "readonly" },
    ];
  }
  return [
    { field: "name", label: "Name" },
    { field: "whatsapp", label: "Contact number" },
    { field: "email", label: "Email" },
    { field: "present_institution", label: "Present institution" },
    { field: "course_name", label: "Course", kind: "readonly" },
    { field: "interest", label: "Interest", kind: "interest" },
    { field: "references", label: "References" },
    { field: "details", label: "Details" },
  ];
}

function ReviewGrid({
  rows,
  admission,
  rowFilter,
  activeSheet,
  onActive,
  edits,
  onEdit,
  decisions,
  onDecision,
  formulas,
  onFormula,
}: {
  rows: ImportRow[];
  admission: boolean;
  rowFilter: string;
  activeSheet: string;
  onActive: (name: string) => void;
  edits: Record<string, Record<string, string>>;
  onEdit: (key: string, field: string, value: string) => void;
  decisions: Record<string, { action: string; prospect_id: string; episode_note: string }>;
  onDecision: (key: string, patch: Partial<{ action: string; prospect_id: string; episode_note: string }>) => void;
  formulas: Record<string, { use: string; value: string }>;
  onFormula: (key: string, patch: { use: string; value: string }) => void;
}) {
  const columns = reviewColumns(admission);
  const names = [...new Set(rows.map((row) => row.sheet))];
  const shownName = names.includes(activeSheet) ? activeSheet : names[0] || "";
  const visible = rows.filter((row) => row.sheet === shownName && (rowFilter === "all" || row.status === rowFilter));
  const width = columns.length + 3;
  return (
    <div className="excel">
      <div className="table-wrap">
        <table className="sheet-grid">
          <caption>{shownName || "Sheet"}. Edit a cell to change the imported value.</caption>
          <thead>
            <tr>
              <th className="col-letter" />
              {Array.from({ length: width }, (_, index) => <th key={index} className="col-letter">{columnLetter(index)}</th>)}
            </tr>
            <tr>
              <th className="col-letter" />
              {columns.map((column) => <th key={column.field}>{column.label}</th>)}
              <th>Status</th>
              <th>Action</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const action = decisions[row.key]?.action || (row.candidates.length ? "" : "create");
              const message = row.errors.map((item) => item.message).join(" ") || row.warnings.map((item) => item.message).join(" ");
              return (
                <tr key={row.key}>
                  <th className="row-no">{row.row}</th>
                  {columns.map((column) => {
                    const bad = row.errors.some((item) => item.field === column.field || (column.field === "course_name" && item.field === "course"));
                    const value = edits[row.key]?.[column.field] ?? row.values[column.field] ?? "";
                    if (column.kind === "readonly") return <td key={column.field} className={bad ? "cell-text bad" : "cell-text"}>{value || "—"}</td>;
                    return (
                      <td key={column.field} className={bad ? "bad" : undefined}>
                        {column.kind === "gender" || column.kind === "interest" ? (
                          <select aria-label={`${column.label} for row ${row.row}`} value={value} onChange={(event) => onEdit(row.key, column.field, event.target.value)}>
                            <option value="">Choose</option>
                            {(column.kind === "gender" ? ["Female", "Male", "Other"] : ["High", "Medium", "Low"]).map((option) => <option key={option}>{option}</option>)}
                          </select>
                        ) : (
                          <input aria-label={`${column.label} for row ${row.row}`} value={value} onChange={(event) => onEdit(row.key, column.field, event.target.value)} />
                        )}
                      </td>
                    );
                  })}
                  <td className={row.status === "blocked" ? "status bad" : "status"} title={message}>{row.status === "skipped" ? "Skipped" : message || "Ready"}</td>
                  <td className={row.errors.some((item) => item.field === "action" || item.field === "student_id") ? "bad" : undefined}>
                    <select aria-label={`Action for row ${row.row}`} value={action} onChange={(event) => onDecision(row.key, { action: event.target.value, prospect_id: "" })}>
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
                        <select aria-label={`Formula ${formula.label} on row ${row.row}`} value={formulas[formula.key]?.use || ""} onChange={(event) => onFormula(formula.key, { use: event.target.value, value: formulas[formula.key]?.value || "" })}>
                          <option value="">Choose</option>
                          {formula.cached ? <option value="cached">Use cached value {formula.cached}</option> : null}
                          <option value="plain">Enter a plain value</option>
                        </select>
                        {formulas[formula.key]?.use === "plain" ? (
                          <input aria-label={`Plain value for ${formula.label} on row ${row.row}`} value={formulas[formula.key]?.value || ""} onChange={(event) => onFormula(formula.key, { use: "plain", value: event.target.value })} />
                        ) : null}
                      </label>
                    ))}
                  </td>
                  <td className={row.errors.some((item) => item.field === "episode_note") ? "note bad" : "note"}>
                    <input aria-label={`Explanation for row ${row.row}`} placeholder={admission ? "Why this is another application" : "Why this is a new enquiry"} value={decisions[row.key]?.episode_note || ""} onChange={(event) => onDecision(row.key, { episode_note: event.target.value })} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {names.length > 1 ? (
        <div className="sheet-tabs excel-tabs" role="tablist" aria-label="Sheets">
          {names.map((name) => (
            <button key={name} type="button" role="tab" aria-selected={name === shownName} onClick={() => onActive(name)}>{name}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
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
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const [identityMode, setIdentityMode] = useState<"manual" | "automatic">("manual");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [step, setStep] = useState(0);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [delimiter, setDelimiter] = useState("");
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<ImportHistory[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [batches, setBatches] = useState<BatchOption[]>([]);
  const [offerings, setOfferings] = useState<OfferingOption[]>([]);
  const [branchId, setBranchId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [mappingName, setMappingName] = useState("");
  const [activeSheet, setActiveSheet] = useState("");
  const [params] = useSearchParams();
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const offeredCourses = courses.filter((course) => (
    !course.archived && offerings.some((item) => item.branch_id === branchId && item.course_id === course.id)
  ));
  const openBatches = batches.filter((batch) => {
    if (batch.archived || batch.closed) return false;
    const offering = offerings.find((item) => item.id && item.id === batch.offering_id);
    const batchBranch = batch.branch_id || offering?.branch_id || "";
    const batchCourse = batch.course_id || offering?.course_id || "";
    return batchBranch === branchId && batchCourse === defaultCourse;
  });
  const batchReady = openBatches.some((batch) => batch.id === batchId);

  async function loadHistory() {
    try {
      const listed = await api<{ items: ImportHistory[] }>(base);
      setHistory(listed.items || []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The import history was not loaded.");
    }
  }

  function closeWizard() {
    setOpen(false);
    void loadHistory();
  }

  useEffect(() => {
    if (!open) return;
    const node = dialogRef.current;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : openerRef.current;
    const hidden: HTMLElement[] = [];
    let parentNode: HTMLElement | null = node;
    while (parentNode && parentNode !== document.body) {
      const parent = parentNode.parentElement;
      if (!parent) break;
      for (const child of parent.children) {
        if (child !== parentNode && child instanceof HTMLElement && !child.hasAttribute("inert")) {
          child.setAttribute("inert", "");
          hidden.push(child);
        }
      }
      parentNode = parent;
    }
    const fields = node ? [...node.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href]")].filter((item) => !item.hasAttribute("disabled")) : [];
    (fields.find((item) => item.matches("input, select, textarea")) || fields[0] || node)?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeWizard();
        return;
      }
      if (event.key !== "Tab" || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href]")].filter((item) => !item.hasAttribute("disabled"));
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
      hidden.forEach((item) => item.removeAttribute("inert"));
      openerRef.current?.focus();
    };
  }, [open]);

  function openNew() {
    setOperation(null);
    setStep(0);
    setError("");
    setBranchId("");
    setDefaultCourse("");
    setBatchId("");
    setOpen(true);
  }

  function openExisting(fresh: Operation) {
    absorb(fresh);
    setBranchId(fresh.branch_id || "");
    setDefaultCourse(fresh.course_id || fresh.defaults?.course_id || "");
    setBatchId(fresh.batch_id || "");
    setStep(landingStep(fresh));
    setOpen(true);
  }

  async function removeHistory(item: ImportHistory) {
    if (item.status === "committed") return;
    const label = item.filename || "this import";
    if (!window.confirm(`Delete ${label} from the import history?`)) return;
    try {
      await api(`${base}/${item.id}`, { method: "DELETE" });
      if (operation?.id === item.id) {
        setOpen(false);
        setOperation(null);
      }
      notify("Import removed from the history.");
      await loadHistory();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The import was not deleted.");
    }
  }

  useEffect(() => {
    loadHistory();
    api<{ branches: BranchOption[]; courses: CourseOption[]; offerings: OfferingOption[]; batches: BatchOption[] }>("/api/v1/catalog")
      .then((catalog) => {
        setBranches([...(catalog.branches || [])].filter((item) => !item.archived).sort((left, right) => left.name.localeCompare(right.name)));
        setCourses([...(catalog.courses || [])].sort((left, right) => left.name.localeCompare(right.name)));
        setBatches([...(catalog.batches || [])].sort((left, right) => left.name.localeCompare(right.name)));
        setOfferings(catalog.offerings || []);
      })
      .catch(() => setError("The branch and course list was not loaded."));
  }, [base]);

  useEffect(() => {
    if (params.get("new") === "1") setOpen(true);
  }, [params]);

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
    setIdentityMode(next.identity_mode === "automatic" ? "automatic" : "manual");
    const editState: Record<string, Record<string, string>> = {};
    next.rows.forEach((row) => {
      const changed = row.originals || {};
      if (!Object.keys(changed).length) return;
      editState[row.key] = {};
      Object.keys(changed).forEach((field) => { editState[row.key][field] = row.values[field] || ""; });
    });
    setEdits(editState);
    if (next.status === "committed") setStep(6);
  }

  async function upload(file: File) {
    setPending(true);
    setError("");
    const body = new FormData();
    body.set("file", file);
    body.set("branch_id", branchId);
    body.set("course_id", defaultCourse);
    if (admission) body.set("batch_id", batchId);
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
      ...(admission ? { identity_mode: identityMode } : {}),
      decisions: [...new Set([...Object.keys(decisions), ...Object.keys(edits)])].map((rowKey) => {
        const decision = decisions[rowKey] || { action: "", prospect_id: "", episode_note: "" };
        const action = decision.action;
        const link = action.startsWith("link:");
        const prospect = action.startsWith("prospect:");
        return {
          key: rowKey,
          action: link ? "link" : prospect ? "prospect" : action,
          prospect_id: prospect ? action.slice(9) : link && !admission ? action.slice(5) : decision.prospect_id,
          student_id: link && admission ? action.slice(5) : "",
          episode_note: decision.episode_note,
          values: edits[rowKey] || {},
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
        loadHistory();
      } else {
        setError(message);
        if (fresh) absorb(fresh);
      }
    } finally {
      setPending(false);
    }
  }

  const reached = reachedStep(operation);

  return (
    <section className="panel wide">
      <div className="page-title">
        <div>
          <p className="eyebrow">Admissions</p>
          <h1>{admission ? "Import applications" : "Import enquiries"}</h1>
        </div>
        <div className="actions">
          <button type="button" onClick={openNew}>{admission ? "Import applications" : "Import enquiries"}</button>
          <Link className="button secondary" to={backTo}>{admission ? "Back to admissions" : "Back to enquiries"}</Link>
        </div>
      </div>
      <p>A saved import stays in this list. You can delete an import that has not been saved.</p>
      {history.length ? (
        <div className="table-wrap">
          <table className="history">
            <caption>{admission ? "Application files uploaded for this institute" : "Enquiry files uploaded for this institute"}</caption>
            <thead>
              <tr>
                <th>File</th>
                <th>When</th>
                <th>Branch</th>
                <th>Course</th>
                <th>Status</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {history.map((item) => (
                <tr key={item.id}>
                  <td>{item.filename}</td>
                  <td>{item.created_at ? new Date(item.created_at).toLocaleString() : "—"}</td>
                  <td>{branches.find((branch) => branch.id === item.branch_id)?.name || "—"}</td>
                  <td>{courses.find((course) => course.id === item.course_id)?.name || "—"}</td>
                  <td><span className={`chip ${statusChip(item.status)}`}>{STATUS_LABEL[item.status] || item.status}</span></td>
                  <td>{item.status === "committed" ? item.created_count : "—"}</td>
                  <td>
                    <div className="row-actions">
                      <button type="button" onClick={() => {
                        api<Operation>(`${base}/${item.id}`).then(openExisting).catch((reason: Error) => setError(reason.message));
                      }}>{item.status === "committed" ? "View" : "Continue"}</button>
                      {item.status === "committed" ? null : <button type="button" className="quiet" onClick={() => removeHistory(item)}>Delete</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p>No imports yet.</p>}
      {!open && error ? <p className="error" role="alert">{error}</p> : null}

      {open ? (
      <div className="modal-backdrop">
      <div ref={dialogRef} className={step === 1 || step === 2 || step === 4 || step === 6 ? "modal sheet-view" : "modal"} role="dialog" aria-modal="true" aria-labelledby="intake-import-title" tabIndex={-1}>
      <div className="modal-head">
        <h2 id="intake-import-title">{operation?.filename || (admission ? "Import applications" : "Import enquiries")}</h2>
        <button type="button" className="text-button" onClick={closeWizard}>Close</button>
      </div>
      <ol className="wizard">
        {STEPS.map((label, index) => (
          <li key={label}>
            <button type="button" aria-current={step === index ? "step" : undefined} disabled={index > reached} onClick={() => setStep(index)}>
              {index + 1}. {label}
            </button>
          </li>
        ))}
      </ol>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {step === 0 ? (
        <>
          <p>Supported files: .xlsx and UTF-8 CSV, up to 10 MB, 10,000 data rows, and 20 sheets. <a href={`${base}/template`}>Download a sample template</a>.{operation?.expires_at ? ` This upload expires ${operation.expires_at.slice(0, 10)}.` : ""}</p>
          <div className="stack">
            <label>Branch
              <select aria-label="Branch" value={branchId} onChange={(event) => { setBranchId(event.target.value); setDefaultCourse(""); setBatchId(""); }}>
                <option value="">Choose a branch</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </label>
            <label>Course
              <select aria-label="Course" value={defaultCourse} disabled={!branchId} onChange={(event) => { setDefaultCourse(event.target.value); setBatchId(""); }}>
                <option value="">Choose a course</option>
                {offeredCourses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
              </select>
            </label>
            {admission ? (
              <label>Batch
                <select aria-label="Batch" value={batchId} disabled={!defaultCourse} onChange={(event) => setBatchId(event.target.value)}>
                  <option value="">Choose a batch</option>
                  {openBatches.map((batch) => <option key={batch.id} value={batch.id}>{batch.name}</option>)}
                </select>
              </label>
            ) : null}
          </div>
          {admission && defaultCourse && openBatches.length === 0 ? <p>This course has no open batch at this branch.</p> : null}
          <form onSubmit={(event) => {
            event.preventDefault();
            const file = new FormData(event.currentTarget).get("file");
            if (file instanceof File) void upload(file);
          }}>
            <label>Spreadsheet
              <input name="file" type="file" accept=".xlsx,.csv,text/csv" aria-label="Spreadsheet" required disabled={pending} />
            </label>
            <button type="submit" disabled={pending || !branchId || !defaultCourse || (admission && !batchReady)}>{pending ? "Reading…" : "Upload and continue"}</button>
          </form>
        </>
      ) : null}
      {operation && step === 1 ? (
        <form className="excel-step" onSubmit={async (event) => { event.preventDefault(); const saved = await savePlan(); if (saved) setStep(2); }}>
          <p>{operation.format === "csv" ? "This file has one sheet. Click a row number to mark the titles." : "Tick a sheet tab to include it. Click a row number to mark the titles."}</p>
          {operation.format === "csv" ? (
            <label>Delimiter
              <select aria-label="Delimiter" value={delimiter || operation.delimiter} onChange={(event) => setDelimiter(event.target.value)}>
                <option value=",">Comma</option>
                <option value=";">Semicolon</option>
                <option value={"\t"}>Tab</option>
              </select>
            </label>
          ) : null}
          <IntakeGrid
            sheets={operation.sheets}
            activeName={activeSheetName(operation.sheets, activeSheet)}
            onActive={setActiveSheet}
            include={operation.format === "xlsx"}
            selected={selected}
            onToggle={(name) => setSelected({ ...selected, [name]: !selected[name] })}
            headerRow={headers[activeSheetName(operation.sheets, activeSheet)] || 1}
            onHeader={(row) => {
              const name = activeSheetName(operation.sheets, activeSheet);
              if (name) setHeaders({ ...headers, [name]: row });
            }}
          />
          <div className="actions">
            <button type="button" className="text-button" onClick={() => setStep(0)}>Back</button>
            <button type="submit" disabled={pending || (operation.format === "xlsx" && !operation.sheets.some((sheet) => selected[sheet.name]))}>{pending ? "Saving…" : "Next"}</button>
          </div>
        </form>
      ) : null}
      {operation && step === 2 ? (
        <form className="excel-step" onSubmit={async (event) => { event.preventDefault(); const saved = await savePlan(); if (saved) setStep(saved.phase === "mapping" ? 2 : 3); }}>
          <p>Choose a field in the row above the sheet. A suggested match is already filled in.</p>
          {operation.issues.filter((issue) => {
            const choose = /^Choose a field or Ignore for (.+)\.$/i.exec(issue);
            if (choose) {
              const column = operation.columns.find((item) => item.label === choose[1]);
              return !column || !mappings[column.id];
            }
            if (issue === "Map a column to Name.") return !operation.columns.some((column) => mappings[column.id] === "name");
            return true;
          }).map((issue) => <p key={issue} className="error" role="alert">{issue}</p>)}
          <IntakeGrid
            sheets={operation.sheets.filter((sheet) => selected[sheet.name])}
            activeName={activeSheetName(operation.sheets.filter((sheet) => selected[sheet.name]), activeSheet)}
            onActive={setActiveSheet}
            include={false}
            selected={selected}
            onToggle={() => undefined}
            headerRow={headers[activeSheetName(operation.sheets.filter((sheet) => selected[sheet.name]), activeSheet)] || 1}
            columns={operation.columns}
            mappings={mappings}
            targets={operation.targets}
            onMap={(columnId, target) => setMappings({ ...mappings, [columnId]: target })}
          />
          {operation.saved_mappings && operation.saved_mappings.length ? (
            <div className="stack">
              <label>Saved mapping
                <select name="saved-mapping" aria-label="Saved mapping" defaultValue="">
                  <option value="">Choose</option>
                  {operation.saved_mappings.map((item) => <option key={item.id} value={item.id}>{item.name}{item.shared ? " (shared)" : ""}</option>)}
                </select>
              </label>
              <div className="actions">
                <button type="button" className="secondary" disabled={pending} onClick={async (event) => {
                  const form = event.currentTarget.form;
                  const mappingId = form ? new FormData(form).get("saved-mapping") : "";
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
                }}>Apply mapping</button>
                {session.actions.includes("user.manage") ? (
                  <button type="button" className="quiet" disabled={pending} onClick={async (event) => {
                    const form = event.currentTarget.form;
                    const mappingId = form ? new FormData(form).get("saved-mapping") : "";
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
              </div>
            </div>
          ) : null}
          <div className="actions">
            <button type="button" className="text-button" onClick={() => setStep(1)}>Back</button>
            <button type="submit" disabled={pending}>{pending ? "Saving…" : "Next"}</button>
          </div>
        </form>
      ) : null}
      {operation && step === 3 ? (
        <form onSubmit={async (event: FormEvent) => {
          event.preventDefault();
          const saved = await savePlan();
          if (saved) setStep(saved.phase === "review" ? 4 : saved.phase === "mapping" ? 2 : 3);
        }}>
          <p>Choose how blank or unknown values are filled before the rows are reviewed.</p>
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
          <div className="actions">
            <button type="button" className="text-button" onClick={() => setStep(2)}>Back</button>
            <button type="submit" disabled={pending}>{pending ? "Saving…" : "Next"}</button>
          </div>
        </form>
      ) : null}
      {operation && step === 4 ? (
        <form className="excel-step" onSubmit={async (event: FormEvent) => {
          event.preventDefault();
          const saved = await savePlan();
          if (!saved) return;
          if (saved.counts.blocked > 0) {
            setError("Blocked rows need a decision before you can continue.");
            return;
          }
          setStep(5);
        }}>
          <p>{operation.counts.valid} ready, {operation.counts.blocked} blocked, {operation.counts.skipped} skipped.</p>
          {admission ? (
            <fieldset>
              <legend>Identity</legend>
              <label>
                <input type="radio" name="identity-mode" checked={identityMode === "manual"} onChange={() => setIdentityMode("manual")} />
                Confirm each person
              </label>
              <label>
                <input type="radio" name="identity-mode" checked={identityMode === "automatic"} onChange={() => setIdentityMode("automatic")} />
                Match on contact number and name
              </label>
              <p>{identityMode === "automatic" ? "One matching student is enrolled in the selected batch. A new name and contact number creates the student and the enrollment. More than one match still needs a choice." : "Applications are saved. Staff confirm identity before anyone is enrolled."}</p>
            </fieldset>
          ) : null}
          <label>Show rows
            <select aria-label="Show rows" value={rowFilter} onChange={(event) => setRowFilter(event.target.value)}>
              <option value="all">All</option>
              <option value="blocked">Blocked</option>
              <option value="valid">Ready</option>
              <option value="skipped">Skipped</option>
            </select>
          </label>
          <p><a href={`${base}/${operation.id}/errors`}>Download the error report</a></p>
          <ReviewGrid
            rows={operation.rows}
            admission={admission}
            rowFilter={rowFilter}
            activeSheet={activeSheet}
            onActive={setActiveSheet}
            edits={edits}
            onEdit={(key, field, value) => setEdits({ ...edits, [key]: { ...(edits[key] || {}), [field]: value } })}
            decisions={decisions}
            onDecision={(key, patch) => setDecisions({
              ...decisions,
              [key]: {
                action: patch.action ?? decisions[key]?.action ?? "",
                prospect_id: patch.prospect_id ?? decisions[key]?.prospect_id ?? "",
                episode_note: patch.episode_note ?? decisions[key]?.episode_note ?? "",
              },
            })}
            formulas={formulas}
            onFormula={(key, patch) => setFormulas({ ...formulas, [key]: patch })}
          />
          {operation.phase === "review" && operation.status !== "committed" ? (
            <div className="stack">
              <label>Save this mapping
                <input aria-label="Mapping name" value={mappingName} onChange={(event) => setMappingName(event.target.value)} />
              </label>
              <button type="button" className="secondary" disabled={pending || !mappingName.trim()} onClick={async () => {
                if (!operation || !mappingName.trim()) return;
                try {
                  await api(mappingBase, { method: "POST", body: JSON.stringify({ import_id: operation.id, name: mappingName.trim() }) });
                  notify("Saved the mapping. The next import still needs a review.");
                  setMappingName("");
                  const fresh = await api<Operation>(`${base}/${operation.id}`);
                  absorb(fresh);
                } catch (reason) {
                  setError(reason instanceof Error ? reason.message : "The mapping was not saved.");
                }
              }}>Save mapping</button>
            </div>
          ) : null}
          <div className="actions">
            <button type="button" className="text-button" onClick={() => setStep(3)}>Back</button>
            <button type="submit" disabled={pending}>{pending ? "Saving…" : "Next"}</button>
          </div>
        </form>
      ) : null}
      {operation && step === 5 ? (
        <>
          <h3>Confirm import</h3>
          <p>Create {operation.counts.valid} {noun}. Skip {operation.counts.skipped}. Blocked rows: {operation.counts.blocked}. Source: {operation.filename}.{admission ? (identityMode === "automatic" ? " A new person is created and enrolled in the selected batch. An existing person with the same contact number and name is enrolled only." : " Rows become applications and are not enrolled.") : ""}</p>
          <div className="actions">
            <button type="button" className="text-button" onClick={() => setStep(4)}>Back</button>
            <button type="button" disabled={pending || operation.counts.blocked > 0} onClick={() => void commit()}>{pending ? "Saving…" : admission ? (identityMode === "automatic" ? "Import and enroll" : "Import applications") : "Import enquiries"}</button>
          </div>
        </>
      ) : null}
      {step === 6 && operation?.status === "committed" && operation.result ? (
        <div className="excel-step">
          <h3>Import results</h3>
          <p>Created {operation.result.created.length}. Skipped {operation.result.skipped.length}.</p>
          <div className="excel">
            <div className="table-wrap">
              <table className="sheet-grid">
                <caption>Imported rows</caption>
                <thead>
                  <tr>
                    <th className="col-letter" />
                    {["A", "B", "C", "D"].map((letter) => <th key={letter} className="col-letter">{letter}</th>)}
                  </tr>
                  <tr>
                    <th className="col-letter" />
                    <th>Name</th>
                    <th>Sheet</th>
                    <th>Row</th>
                    <th>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {operation.result.created.map((item, index) => (
                    <tr key={item.id}>
                      <th className="row-no">{index + 1}</th>
                      <td className="cell-text"><Link to={`${backTo}/${item.id}`}>{item.name}</Link></td>
                      <td className="cell-text">{item.sheet}</td>
                      <td className="cell-text">{item.row}</td>
                      <td className="cell-text">{item.student_id ? <Link to={`/students/${item.student_id}`}>{item.student_created ? "New student" : "Existing student"}</Link> : "Application"}</td>
                    </tr>
                  ))}
                  {operation.result.skipped.map((item, index) => (
                    <tr key={`${item.sheet}-${item.row}`}>
                      <th className="row-no">{operation.result!.created.length + index + 1}</th>
                      <td className="cell-text">—</td>
                      <td className="cell-text">{item.sheet}</td>
                      <td className="cell-text">{item.row}</td>
                      <td className="cell-text">Skipped</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <button type="button" onClick={closeWizard}>Close</button>
        </div>
      ) : null}
      </div>
      </div>
      ) : null}
    </section>
  );
}
