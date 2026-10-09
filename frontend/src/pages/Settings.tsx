import { FormEvent, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api, Session } from "../api";
import { Band, BandFields, bandsPayload, bandsReady, draftsFrom } from "../bands";
import { Icon, StudentDialog } from "./Catalog";

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
  const [tab, setTab] = useState<"preferences" | "policy" | "operations">("preferences");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(false);
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
      {notice ? <p className="ok" role="status">{notice}</p> : null}
      {loading ? <p>Loading settings…</p> : null}
      <div className="page-tabs" role="tablist" aria-label="Settings">
        <button type="button" role="tab" aria-selected={tab === "preferences"} onClick={() => setTab("preferences")}>Preferences</button>
        <button type="button" role="tab" aria-selected={tab === "policy"} onClick={() => setTab("policy")}>Academic policy</button>
        <button type="button" role="tab" aria-selected={tab === "operations"} onClick={() => setTab("operations")}>Operations</button>
      </div>
      {tab === "preferences" ? (
        <dl className="facts">
          {(bands || []).map((item) => (
            <div key={item.key || item.name}>
              <dt>{item.name}</dt>
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
      {editing && policy ? (
        <PolicyForm
          policy={policy}
          onClose={() => setEditing(false)}
          onSaved={(next) => {
            const count = next.published_on_earlier_version ?? 0;
            const sheets = count === 1 ? "1 published marksheet stays" : `${count} published marksheets stay`;
            setPolicy(next);
            setNotice(`Saved as policy version ${next.version}. ${sheets} on an earlier version. Academic views use these rules.`);
            setEditing(false);
          }}
        />
      ) : null}
    </section>
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
