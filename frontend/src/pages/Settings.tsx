import { useEffect, useState } from "react";
import { api } from "../api";

type Policy = {
  version: number;
  ranking: string;
  aggregate: string;
  self_publication: boolean;
  passing_threshold: number | null;
};

export function SettingsPage() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Policy>("/api/v1/policies/active")
      .then(setPolicy)
      .catch((reason: Error) => setError(reason.message));
  }, []);

  return (
    <section className="panel">
      <p className="eyebrow">Administration</p>
      <h1>Settings</h1>
      <p>This policy is the one used for percentages, bands, and weighted totals.</p>
      {error ? <p className="error">{error}</p> : null}
      {policy ? (
        <dl>
          <div>
            <dt>Policy version</dt>
            <dd>{policy.version}</dd>
          </div>
          <div>
            <dt>Ranking</dt>
            <dd>{policy.ranking}</dd>
          </div>
          <div>
            <dt>Aggregate</dt>
            <dd>{policy.aggregate}</dd>
          </div>
          <div>
            <dt>Self-publication</dt>
            <dd>{policy.self_publication ? "On" : "Off"}</dd>
          </div>
          <div>
            <dt>Passing threshold</dt>
            <dd>{policy.passing_threshold ?? "Not set"}</dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}
