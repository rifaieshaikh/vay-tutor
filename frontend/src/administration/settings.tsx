import { FormEvent, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api, Session } from "../api";
import { CurriculumKind, ExamType } from "../academics/kinds";
import { notify } from "../notify";
import { Band, BandFields, bandsPayload, bandsReady, draftsFrom } from "../bands";
import { Icon, moveTab, StudentDialog } from "../ui";

type Policy = {
  version: number;
  ranking?: string;
  aggregate?: string;
  self_publication?: boolean;
  passing_threshold?: number | null;
  bands?: Band[];
  published_on_earlier_version?: number;
};

const AGGREGATE_LABELS: Record<string, string> = {
  "maximum-marks-weighted": "Maximum marks weighted",
};

function aggregateLabel(value: string | undefined) {
  if (!value) return "Maximum marks weighted";
  return AGGREGATE_LABELS[value] || value.replaceAll("-", " ");
}

function rankingLabel(value: string | undefined) {
  if (!value || value === "dense") return "Dense rank";
  return value.replaceAll("-", " ");
}

function percentText(value: number) {
  return String(Math.round(value * 100) / 100);
}

export function SettingsPage({ session }: { session: Session }) {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [tab, setTab] = useState<"preferences" | "policy" | "curriculum" | "operations">("preferences");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [loading, setLoading] = useState(true);
  const canEdit = session.actions.includes("grant.manage");
  const bands = policy?.bands && policy.bands.length >= 2 ? policy.bands : null;

  useEffect(() => {
    api<Policy>("/api/v1/policies/active")
      .then(setPolicy)
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="panel wide">
      <div className="page-title">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Settings</h1>
        </div>
        {canEdit && policy ? (
          <div className="icon-actions">
            <button type="button" onClick={() => setEditing(true)} aria-label="Edit settings" title="Edit"><Icon name="edit" /></button>
          </div>
        ) : null}
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {loading ? <p>Loading settings…</p> : null}
      <div className="page-tabs" role="tablist" aria-label="Settings" onKeyDown={(event) => moveTab(event, ["preferences", "policy", "curriculum", "operations"] as const, tab, setTab)}>
        <button type="button" role="tab" aria-selected={tab === "preferences"} onClick={() => setTab("preferences")}>Preferences</button>
        <button type="button" role="tab" aria-selected={tab === "policy"} onClick={() => setTab("policy")}>Academic policy</button>
        <button type="button" role="tab" aria-selected={tab === "curriculum"} onClick={() => setTab("curriculum")}>Curriculum</button>
        <button type="button" role="tab" aria-selected={tab === "operations"} onClick={() => setTab("operations")}>Operations</button>
      </div>
      {tab === "preferences" ? (
        <dl className="facts">
          {(bands || []).map((item) => (
            <div key={item.key || item.name}>
              <dt>{item.color ? <span className="band-swatch" style={{ background: item.color }} aria-hidden="true" /> : null}{item.name}</dt>
              <dd>{item.phrase}</dd>
            </div>
          ))}
          <div>
            <dt>Ranking</dt>
            <dd>{rankingLabel(policy?.ranking)}</dd>
          </div>
          <div>
            <dt>Blank mark</dt>
            <dd>Missing, never zero</dd>
          </div>
          <div>
            <dt>Typed zero</dt>
            <dd>A real score</dd>
          </div>
          <div className="span-2">
            <dt>Absence</dt>
            <dd>No percentage and no rank</dd>
          </div>
          <div className="span-2">
            <dt>Timezone</dt>
            <dd><TimezoneField initial={session.institute.timezone || "Asia/Kolkata"} canEdit={canEdit} /></dd>
          </div>
          <div className="span-2">
            <dt>Enquiry import files</dt>
            <dd>Source files and error reports are kept for 30 days, then they expire. The enquiries created from them stay.</dd>
          </div>
        </dl>
      ) : null}
      {tab === "policy" && policy ? (
        <>
          <dl className="facts">
            <div>
              <dt>Policy version</dt>
              <dd>{policy.version}</dd>
            </div>
            <div>
              <dt>Percentage</dt>
              <dd>Score divided by maximum</dd>
            </div>
            <div>
              <dt>Display</dt>
              <dd>Two decimals</dd>
            </div>
            <div>
              <dt>Ranking value</dt>
              <dd>Unrounded</dd>
            </div>
            <div>
              <dt>Aggregate</dt>
              <dd>{aggregateLabel(policy.aggregate)}</dd>
            </div>
            <div>
              <dt>Attempts</dt>
              <dd>Latest published attempt</dd>
            </div>
            <div>
              <dt>Self-publication</dt>
              <dd>{policy.self_publication ? "On" : "Off"}</dd>
            </div>
            <div>
              <dt>Passing threshold</dt>
              <dd className={policy.passing_threshold == null ? "is-empty" : undefined}>
                {policy.passing_threshold == null ? "Not set" : `${percentText(policy.passing_threshold)}%`}
              </dd>
            </div>
          </dl>
          <p className="meta">The total adds the scores and divides by the sum of the maxima. Drafts stay off cards and academic views until they are published. A published correction keeps the earlier score.</p>
        </>
      ) : null}
      {tab === "curriculum" ? (
        <>
          <CurriculumKinds canEdit={session.actions.includes("catalog.manage")} />
          <ExamTypes canEdit={session.actions.includes("catalog.manage")} />
        </>
      ) : null}
      {tab === "operations" ? (
        <dl className="facts">
          <div>
            <dt>Deployment</dt>
            <dd>{session.deployment_mode === "cloud" ? "Cloud" : "Local"}</dd>
          </div>
          <div>
            <dt>Database</dt>
            <dd>This install only</dd>
          </div>
          <div className="span-2">
            <dt>Academic access</dt>
            <dd>These settings do not grant it</dd>
          </div>
          {session.actions.includes("audit.view") ? (
            <div className="span-2">
              <dt>History</dt>
              <dd><Link to="/audit">Audit</Link></dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {tab === "operations" && canEdit ? (
        <div className="title-row">
          <div>
            <h2>Factory reset</h2>
            <p>Remove the institute, people, courses, marks, and uploaded files. Setup starts again from the beginning.</p>
          </div>
          <button type="button" className="destructive" onClick={() => setResetting(true)}>Factory reset</button>
        </div>
      ) : null}
      {resetting ? <FactoryReset onClose={() => setResetting(false)} /> : null}
      {editing && policy ? (
        <PolicyForm
          policy={policy}
          onClose={() => setEditing(false)}
          onSaved={(next) => {
            const count = next.published_on_earlier_version ?? 0;
            const sheets = count === 1 ? "1 published marksheet stays" : `${count} published marksheets stay`;
            setPolicy(next);
            notify(`Saved as policy version ${next.version}. ${sheets} on an earlier version. Academic views use these rules.`);
            setEditing(false);
          }}
        />
      ) : null}
    </section>
  );
}

const TIMEZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo", "Europe/London", "America/New_York", "UTC"];

function TimezoneField({ initial, canEdit }: { initial: string; canEdit: boolean }) {
  const [zone, setZone] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const choices = TIMEZONES.includes(zone) ? TIMEZONES : [zone, ...TIMEZONES];

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const saved = await api<{ timezone: string }>("/api/v1/institute", {
        method: "PATCH",
        body: JSON.stringify({ timezone: draft }),
      });
      setZone(saved.timezone);
      setDraft(saved.timezone);
      notify("Saved the institute timezone. Follow-up dates use this calendar.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the timezone.");
    } finally {
      setSaving(false);
    }
  }

  if (!canEdit) return <>{zone}</>;
  return (
    <form onSubmit={save} className="inline-correct">
      <select aria-label="Institute timezone" value={draft} onChange={(event) => setDraft(event.target.value)}>
        {choices.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
      <button type="submit" disabled={saving || draft === zone}>Save</button>
      {error ? <span className="error" role="alert">{error}</span> : null}
    </form>
  );
}

function CurriculumKinds({ canEdit }: { canEdit: boolean }) {
  const [kinds, setKinds] = useState<CurriculumKind[]>([]);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CurriculumKind | null>(null);

  function load() {
    return api<{ items: CurriculumKind[] }>("/api/v1/curriculum-kinds")
      .then((body) => setKinds(body.items))
      .catch((reason: Error) => setError(reason.message));
  }

  useEffect(() => {
    void load();
  }, []);

  async function archive(kind: CurriculumKind, archived: boolean) {
    setError("");
    try {
      await api(`/api/v1/curriculum-kinds/${kind.key}`, { method: "PATCH", body: JSON.stringify({ archived }) });
      notify(archived ? `${kind.label} is hidden from new items.` : `${kind.label} can be used again.`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update that item.");
    }
  }

  return (
    <>
      <div className="title-row">
        <div>
          <h2>Subject partition types</h2>
          <p className="meta">Paper, part, chapter, and module divide a subject. Paper stays numbered. Archiving hides a partition from new items and leaves existing ones in place.</p>
        </div>
        {canEdit ? <button type="button" onClick={() => setAdding(true)}>Add subject partition</button> : null}
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {kinds.length === 0 ? <p>Loading subject partitions…</p> : (
        <div className="table-wrap">
          <table className="people-table">
            <caption className="sr-only">Subject partition types</caption>
            <thead><tr><th>Name</th><th>Status</th>{canEdit ? <th>Actions</th> : null}</tr></thead>
            <tbody>
              {kinds.map((kind) => (
                <tr key={kind.key}>
                  <td>{kind.label}</td>
                  <td>{kind.archived ? "Archived" : "Active"}{kind.locked ? " · Numbered" : ""}</td>
                  {canEdit ? (
                    <td>
                      <button type="button" className="quiet" onClick={() => setEditing(kind)}>Rename</button>
                      {kind.locked ? null : (
                        <button type="button" className="quiet" onClick={() => void archive(kind, !kind.archived)}>{kind.archived ? "Restore" : "Archive"}</button>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding ? (
        <KindDialog
          title="Add subject partition"
          submitLabel="Add subject partition"
          nameLabel="Subject partition type"
          onClose={() => setAdding(false)}
          onSubmit={async (label) => {
            await api("/api/v1/curriculum-kinds", { method: "POST", body: JSON.stringify({ label }) });
            notify(`Added ${label.trim()}.`);
            setAdding(false);
            await load();
          }}
        />
      ) : null}
      {editing ? (
        <KindDialog
          title="Rename subject partition"
          submitLabel="Save"
          nameLabel="Subject partition type"
          initial={editing.label}
          onClose={() => setEditing(null)}
          onSubmit={async (label) => {
            await api(`/api/v1/curriculum-kinds/${editing.key}`, { method: "PATCH", body: JSON.stringify({ label }) });
            notify(`Saved ${label.trim()}.`);
            setEditing(null);
            await load();
          }}
        />
      ) : null}
    </>
  );
}

function ExamTypes({ canEdit }: { canEdit: boolean }) {
  const [types, setTypes] = useState<ExamType[]>([]);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ExamType | null>(null);

  function load() {
    return api<{ items: ExamType[] }>("/api/v1/exam-types")
      .then((body) => setTypes(body.items))
      .catch((reason: Error) => setError(reason.message));
  }

  useEffect(() => {
    void load();
  }, []);

  async function archive(item: ExamType, archived: boolean) {
    setError("");
    try {
      await api(`/api/v1/exam-types/${item.key}`, { method: "PATCH", body: JSON.stringify({ archived }) });
      notify(archived ? `${item.label} is hidden from new exams.` : `${item.label} can be used again.`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update that exam type.");
    }
  }

  return (
    <>
      <div className="title-row">
        <div>
          <h2>Exam types</h2>
          <p className="meta">An exam type names the sitting, such as a test series or a module exam. It does not divide the subject. A lower weight is shown first on the progress card. The part heading is the column name on that exam type's tab and on import.</p>
        </div>
        {canEdit ? <button type="button" onClick={() => setAdding(true)}>Add exam type</button> : null}
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {types.length === 0 ? <p>Loading exam types…</p> : (
        <div className="table-wrap">
          <table className="people-table">
            <caption className="sr-only">Exam types</caption>
            <thead><tr><th>Name</th><th>Part heading</th><th>Weight</th><th>Status</th>{canEdit ? <th>Actions</th> : null}</tr></thead>
            <tbody>
              {[...types].sort((left, right) => (left.weight ?? 99) - (right.weight ?? 99) || left.label.localeCompare(right.label)).map((item) => (
                <tr key={item.key}>
                  <td>{item.label}</td>
                  <td>{item.part_heading || "Part"}</td>
                  <td>{item.weight ?? "—"}</td>
                  <td>{item.archived ? "Archived" : "Active"}</td>
                  {canEdit ? (
                    <td>
                      <button type="button" className="quiet" onClick={() => setEditing(item)}>Edit</button>
                      <button type="button" className="quiet" onClick={() => void archive(item, !item.archived)}>{item.archived ? "Restore" : "Archive"}</button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding ? (
        <ExamTypeDialog
          title="Add exam type"
          submitLabel="Add exam type"
          initialWeight={Math.max(0, ...types.map((item) => item.weight || 0)) + 1}
          onClose={() => setAdding(false)}
          onSubmit={async (label, weight, partHeading) => {
            await api("/api/v1/exam-types", { method: "POST", body: JSON.stringify({ label, weight, part_heading: partHeading }) });
            notify(`Added ${label.trim()}.`);
            setAdding(false);
            await load();
          }}
        />
      ) : null}
      {editing ? (
        <ExamTypeDialog
          title="Edit exam type"
          submitLabel="Save"
          initial={editing.label}
          initialWeight={editing.weight || 1}
          initialPartHeading={editing.part_heading || "Part"}
          onClose={() => setEditing(null)}
          onSubmit={async (label, weight, partHeading) => {
            await api(`/api/v1/exam-types/${editing.key}`, { method: "PATCH", body: JSON.stringify({ label, weight, part_heading: partHeading }) });
            notify(`Saved ${label.trim()}.`);
            setEditing(null);
            await load();
          }}
        />
      ) : null}
    </>
  );
}

function ExamTypeDialog({
  title,
  submitLabel,
  initial = "",
  initialWeight,
  initialPartHeading = "Part",
  onClose,
  onSubmit,
}: {
  title: string;
  submitLabel: string;
  initial?: string;
  initialWeight: number;
  initialPartHeading?: string;
  onClose: () => void;
  onSubmit: (label: string, weight: number, partHeading: string) => Promise<void>;
}) {
  const [label, setLabel] = useState(initial);
  const [weight, setWeight] = useState(String(initialWeight));
  const [partHeading, setPartHeading] = useState(initialPartHeading);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const parsed = Number(weight);
  const dirty = label.trim() !== initial.trim() || parsed !== initialWeight || partHeading.trim() !== initialPartHeading.trim();

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 99) {
      setError("Enter a weight from 1 to 99.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSubmit(label, parsed, partHeading.trim() || "Part");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save.");
      setSaving(false);
    }
  }

  return (
    <StudentDialog title={title} onClose={onClose} dirty={dirty}>
      <form className="form-grid" onSubmit={save}>
        <label>Name
          <input value={label} aria-label="Exam type" onChange={(event) => { setLabel(event.target.value); setError(""); }} />
        </label>
        <label>Part heading
          <input aria-label="Part heading" value={partHeading} onChange={(event) => { setPartHeading(event.target.value); setError(""); }} />
        </label>
        <label>Weight
          <input inputMode="numeric" aria-label="Weight" value={weight} onChange={(event) => { setWeight(event.target.value); setError(""); }} />
        </label>
        <p className="meta span-2">A lower weight is shown first on the progress card. The part heading names that column on the progress card and during import.</p>
        {error ? <p className="error span-2" role="alert">{error}</p> : null}
        <div className="dialog-actions span-2">
          <button type="button" className="text-button" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={saving}>{submitLabel}</button>
        </div>
      </form>
    </StudentDialog>
  );
}

function KindDialog({
  title,
  submitLabel,
  nameLabel,
  initial = "",
  onClose,
  onSubmit,
}: {
  title: string;
  submitLabel: string;
  nameLabel: string;
  initial?: string;
  onClose: () => void;
  onSubmit: (label: string) => Promise<void>;
}) {
  const [label, setLabel] = useState(initial);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSubmit(label);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save.");
      setSaving(false);
    }
  }

  return (
    <StudentDialog title={title} onClose={onClose} dirty={label.trim() !== initial.trim()}>
      <form onSubmit={save}>
        <label>Name
          <input value={label} aria-label={nameLabel} onChange={(event) => setLabel(event.target.value)} />
        </label>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="quiet" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={saving || !label.trim()}>{submitLabel}</button>
        </div>
      </form>
    </StudentDialog>
  );
}

function FactoryReset({ onClose }: { onClose: () => void }) {
  const [phrase, setPhrase] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function reset(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api("/api/v1/factory-reset", { method: "POST", body: JSON.stringify({ confirm: phrase }) });
      window.location.replace("/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The install was not reset.");
      setSaving(false);
    }
  }

  return (
    <StudentDialog title="Factory reset" onClose={onClose}>
      <form className="form-grid" onSubmit={reset}>
        <p className="span-2">This wipes every record and uploaded file on this install. The next screen asks you to create the institute again.</p>
        <label className="span-2">Type RESET
          <input value={phrase} aria-label="Type RESET" autoComplete="off" onChange={(event) => setPhrase(event.target.value)} />
        </label>
        {error ? <p className="error span-2" role="alert">{error}</p> : null}
        <div className="dialog-actions span-2">
          <button type="button" className="quiet" onClick={onClose}>Cancel</button>
          <button type="submit" className="destructive" disabled={saving || phrase !== "RESET"}>{saving ? "Wiping…" : "Wipe all data"}</button>
        </div>
      </form>
    </StudentDialog>
  );
}

function PolicyForm({ policy, onClose, onSaved }: { policy: Policy; onClose: () => void; onSaved: (policy: Policy) => void }) {
  const [rows, setRows] = useState(draftsFrom(policy.bands));
  const [threshold, setThreshold] = useState(policy.passing_threshold == null ? "" : String(policy.passing_threshold));
  const [publication, setPublication] = useState(Boolean(policy.self_publication));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const ready = bandsReady(rows);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const next = await api<Policy>("/api/v1/policies", {
        method: "POST",
        body: JSON.stringify({
          bands: bandsPayload(rows),
          passing_threshold: threshold.trim() === "" ? null : Number(threshold),
          self_publication: publication,
        }),
      });
      onSaved(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the settings.");
      setSaving(false);
    }
  }

  return (
    <StudentDialog title="Edit settings" onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <p className="meta span-2">Saving starts policy version {policy.version + 1}. A marksheet without its own bands uses these. A total across marksheets uses these too. The line belongs to the band below it, except the lowest band, which stays below its line.</p>
        <BandFields rows={rows} onChange={setRows} />
        <label>Passing threshold
          <input type="number" min={0} max={100} step="0.01" value={threshold} aria-label="Passing threshold" placeholder="Not set" onChange={(event) => setThreshold(event.target.value)} />
        </label>
        <label>Self-publication
          <select aria-label="Self-publication" value={publication ? "on" : "off"} onChange={(event) => setPublication(event.target.value === "on")}>
            <option value="off">Off</option>
            <option value="on">On</option>
          </select>
        </label>
        {error ? <p className="error span-2" role="alert">{error}</p> : null}
        <div className="dialog-actions span-2">
          <button type="button" className="quiet" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={saving || !ready}>Save</button>
        </div>
      </form>
    </StudentDialog>
  );
}
