import { useEffect, useState } from "react";
import { api, Session } from "../api";

type Policy = {
  version: number;
  ranking?: string;
  aggregate?: string;
  self_publication?: boolean;
  passing_threshold?: number | null;
  bands?: { danger_below?: number; safe_above?: number };
};

export function SettingsPage({ session }: { session: Session }) {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Policy>("/api/v1/policies/active")
      .then(setPolicy)
      .catch((reason: Error) => setError(reason.message));
  }, []);

  return (
    <section className="panel wide">
      <p className="eyebrow">Administration</p>
      <h1>Settings</h1>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <h2>Preferences</h2>
      <p>Cards and views name the band next to the percentage. Danger is below {policy?.bands?.danger_below ?? 40}%. Fifty-fifty runs from {policy?.bands?.danger_below ?? 40}% through {policy?.bands?.safe_above ?? 60}% inclusive. Safe is above {policy?.bands?.safe_above ?? 60}%. Ranks use dense ranking, so two equal scores share a place and the next place follows immediately.</p>
      <p>A blank mark is missing. A typed zero is a real score. Absence has no percentage and no rank.</p>
      <h2>Academic policy</h2>
      {policy ? (
        <>
          <p>Policy version {policy.version} is the version on new publications. Percentages are score divided by maximum. The display uses two decimals. Ranking and totals use the unrounded value.</p>
          <dl>
            <div><dt>Policy version</dt><dd>{policy.version}</dd></div>
            <div><dt>Ranking</dt><dd>{policy.ranking || "dense"}</dd></div>
            <div><dt>Aggregate</dt><dd>{policy.aggregate || "maximum-marks-weighted"}</dd></div>
            <div><dt>Self-publication</dt><dd>{policy.self_publication ? "On" : "Off"}</dd></div>
            <div><dt>Passing threshold</dt><dd>{policy.passing_threshold ?? "Not set, so pass rate stays hidden"}</dd></div>
          </dl>
          <p>The total is {policy.aggregate || "maximum-marks-weighted"}. It adds the scores and divides by the sum of the maxima. It uses the latest published attempt inside the report. An earlier attempt outside the selected dates is labeled and kept out of the total.</p>
          <p>Drafts stay off cards and academic views until they are published. A published correction keeps the earlier score and makes a new revision.</p>
          <p>A progress card includes every subject you can view. When some subjects are hidden, the card says the coverage is partial and does not show a rank for the whole cohort.</p>
        </>
      ) : null}
      <h2>Operations</h2>
      <p>Deployment is {session.deployment_mode}. This install is the database for the institute. Phones and tablets use the browser. Signing in here does not open another institute’s records.</p>
      <p>Import, publication, and access changes are listed in Audit. Technical settings on this page do not add academic access.</p>
    </section>
  );
}
