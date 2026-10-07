import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api, Health, Session } from "./api";
import { AccessPage } from "./pages/Access";
import { AuditPage } from "./pages/Audit";
import { CatalogPage } from "./pages/Catalog";
import { ImportPage } from "./pages/Import";
import { LoginPage } from "./pages/Login";
import { OverviewPage } from "./pages/Overview";
import { MarksheetsPage } from "./pages/Marksheets";
import { PlaceholderPage } from "./pages/Placeholder";
import { SettingsPage } from "./pages/Settings";
import { SetupPage } from "./pages/Setup";
import { Shell } from "./pages/Shell";

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    const nextHealth = await api<Health>("/api/v1/health");
    setHealth(nextHealth);
    if (!nextHealth.bootstrapped) {
      setSession(null);
      return;
    }
    try {
      setSession(await api<Session>("/api/v1/auth/session"));
    } catch {
      setSession(null);
    }
  }

  useEffect(() => {
    refresh()
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setReady(true));
  }, []);

  if (!ready) {
    return <p className="status">Loading Vay Tutor…</p>;
  }
  if (error) {
    return <p className="status error">{error}</p>;
  }
  if (!health?.bootstrapped) {
    return <SetupPage onReady={refresh} />;
  }
  if (!session) {
    return <LoginPage onReady={refresh} />;
  }

  const can = (action: string) => session.actions.includes(action);

  return (
    <Shell session={session} onChange={refresh}>
      <Routes>
        <Route path="/" element={<OverviewPage canImport={can("marksheet.upload")} />} />
        <Route path="/import" element={can("marksheet.upload") ? <ImportPage /> : <Navigate to="/" replace />} />
        <Route path="/marksheets" element={can("marksheet.view") ? <MarksheetsPage /> : <Navigate to="/" replace />} />
        <Route path="/cards" element={can("progress_card.view") ? <PlaceholderPage title="Progress cards" body="Student cards appear after results are published." /> : <Navigate to="/" replace />} />
        <Route path="/views" element={can("dashboard.view") ? <PlaceholderPage title="Academic views" body="Institute, branch, course, batch, subject, and paper views use the same filters once results are published." /> : <Navigate to="/" replace />} />
        <Route path="/students" element={can("student.lookup") ? <CatalogPage /> : <Navigate to="/" replace />} />
        <Route path="/access" element={can("user.manage") ? <AccessPage /> : <Navigate to="/" replace />} />
        <Route path="/audit" element={can("audit.view") ? <AuditPage /> : <Navigate to="/" replace />} />
        <Route path="/settings" element={can("dashboard.view") ? <SettingsPage /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
