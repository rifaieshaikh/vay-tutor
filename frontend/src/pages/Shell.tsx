import { ReactNode, useState } from "react";
import { NavLink } from "react-router-dom";
import { api, Session } from "../api";

const LINKS = [
  { to: "/", label: "Overview", action: "dashboard.view" },
  { to: "/import", label: "Import Marklist", action: "marksheet.upload" },
  { to: "/marksheets", label: "Marksheets", action: "marksheet.view" },
  { to: "/cards", label: "Progress Cards", action: "progress_card.view" },
  { to: "/views", label: "Academic Views", action: "dashboard.view" },
  { to: "/students", label: "Students", action: "student.lookup" },
  { to: "/institute", label: "Institute", action: "student.lookup" },
  { to: "/courses", label: "Courses", action: "student.lookup" },
  { to: "/batches", label: "Batches", action: "student.lookup" },
  { to: "/access", label: "Users and Access", action: "user.manage" },
  { to: "/audit", label: "Audit", action: "audit.view" },
  { to: "/settings", label: "Settings", action: "dashboard.view" },
];

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
  const visible = LINKS.filter((link) => session.actions.includes(link.action));

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
          {visible.map((link) => (
            <NavLink key={link.to} to={link.to} end={link.to === "/"} className={link.to === "/import" ? "import-link" : undefined} onClick={() => setOpen(false)}>
              {link.label}
            </NavLink>
          ))}
        </nav>
        <main>{children}</main>
      </div>
    </div>
  );
}
