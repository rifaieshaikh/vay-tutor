import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { api, Session } from "../api";
import { ContextBar, contextSearch, showsContext } from "../context";
import { Breadcrumbs, pageOrientation, useRecordTitle } from "../orientation";

type Item = { to: string; label: string; action: string; end?: boolean };

const GROUPS: { label: string; items: Item[] }[] = [
  { label: "Dashboard", items: [{ to: "/", label: "Dashboard", action: "dashboard.view", end: true }] },
  {
    label: "Admissions",
    items: [
      { to: "/students/enquiries", label: "Enquiries", action: "student.lookup" },
      { to: "/students/admissions", label: "Admissions", action: "student.lookup" },
    ],
  },
  { label: "Students", items: [{ to: "/students", label: "Students", action: "student.lookup", end: true }] },
  {
    label: "Academics",
    items: [
      { to: "/institute", label: "Institute", action: "student.lookup" },
      { to: "/courses", label: "Courses", action: "student.lookup" },
      { to: "/batches", label: "Batches", action: "student.lookup" },
    ],
  },
  { label: "Staff", items: [{ to: "/teachers", label: "Teachers", action: "user.manage" }] },
  {
    label: "Assessments",
    items: [
      { to: "/import", label: "Import Marklist", action: "marksheet.upload", end: true },
      { to: "/marksheets", label: "Marksheets", action: "marksheet.view" },
    ],
  },
  {
    label: "Reports",
    items: [
      { to: "/cards", label: "Progress Cards", action: "progress_card.view", end: true },
      { to: "/views", label: "Academic Views", action: "dashboard.view", end: true },
    ],
  },
  {
    label: "Administration",
    items: [
      { to: "/access", label: "Users and Access", action: "user.manage" },
      { to: "/audit", label: "Audit", action: "audit.view", end: true },
      { to: "/settings", label: "Settings", action: "dashboard.view", end: true },
      { to: "/forms", label: "Forms", action: "catalog.edit", end: true },
    ],
  },
];

function ownsStudentRecord(pathname: string) {
  return pathname === "/students" || /^\/students\/(?!enquiries(?:\/|$)|admissions(?:\/|$))[^/]+$/.test(pathname);
}

function itemActive(pathname: string, item: Item) {
  if (item.to === "/students") return ownsStudentRecord(pathname);
  if (item.end || item.to === "/") return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

export function Shell({
  session,
  onChange,
  children,
}: {
  session: Session;
  onChange: () => Promise<void>;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const record = useRecordTitle();
  const search = contextSearch(params).toString();
  const groups = GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => (
      item.action === "catalog.edit"
        ? session.actions.includes("catalog.correct") || session.actions.includes("catalog.manage")
        : session.actions.includes(item.action)
    )),
  })).filter((group) => group.items.length > 0);

  useEffect(() => {
    document.title = `${pageOrientation(pathname, record).title} · Vay Tutor`;
  }, [pathname, record]);

  async function logout() {
    await api("/api/v1/auth/logout", { method: "POST" });
    await onChange();
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="menu" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          Menu
        </button>
        <div>
          <p className="eyebrow">Vay Tutor</p>
          <strong>{session.institute.name}</strong>
        </div>
        <button className="text-button" type="button" onClick={logout}>
          Sign out
        </button>
      </header>
      <div className="frame">
        <nav className={open ? "nav open" : "nav"} aria-label="Primary">
          {groups.map((group) => (
            <div className="nav-group" key={group.label}>
              <p className="nav-label">{group.label}</p>
              {group.items.map((item) => (
                <Link
                  key={item.to}
                  to={{ pathname: item.to, search }}
                  aria-current={itemActive(pathname, item) ? "page" : undefined}
                  className={itemActive(pathname, item) ? "active" : undefined}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <main>
          <Breadcrumbs />
          {showsContext(pathname) ? <ContextBar /> : null}
          {children}
        </main>
      </div>
    </div>
  );
}
