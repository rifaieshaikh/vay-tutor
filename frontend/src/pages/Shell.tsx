import { ReactNode, useEffect, useRef } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { api, Session } from "../api";
import { contextSearch } from "../context";
import { PrimaryNav, QuickNav } from "../navigation";
import { Breadcrumbs, pageOrientation, useRecordTitle } from "../orientation";

export function Shell({
  session,
  onChange,
  children,
}: {
  session: Session;
  onChange: () => Promise<void>;
  children: ReactNode;
}) {
  const headerRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const record = useRecordTitle();
  const search = contextSearch(params).toString();

  useEffect(() => {
    document.title = `${pageOrientation(pathname, record).title} · Vay Tutor`;
  }, [pathname, record]);

  async function logout() {
    await api("/api/v1/auth/logout", { method: "POST" });
    await onChange();
  }

  return (
    <div className="app">
      <header className="topbar" ref={headerRef}>
        <button ref={menuRef} className="menu" type="button" aria-controls="primary-nav">
          Menu
        </button>
        <div className="topbar-title">
          <p className="eyebrow">Vay Tutor</p>
          <strong>{session.institute.name}</strong>
        </div>
        <div className="topbar-actions">
          <QuickNav session={session} search={search} />
          <button className="text-button" type="button" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>
      <div className="frame">
        <PrimaryNav session={session} search={search} headerRef={headerRef} mainRef={mainRef} menuRef={menuRef} />
        <main ref={mainRef}>
          <Breadcrumbs />
          {children}
        </main>
      </div>
    </div>
  );
}
