import { ReactNode, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import { Session } from "./api";

type IconName =
  | "dashboard" | "enquiry" | "admission" | "students" | "institute" | "course" | "batch"
  | "teacher" | "import" | "marksheet" | "card" | "views" | "access" | "audit" | "settings" | "forms"
  | "collapse" | "expand";

type Item = { to: string; label: string; action: string; end?: boolean; icon: IconName };
type Group = { id: string; label: string; icon: IconName; items: Item[] };
type Command = { id: string; label: string; hint: string; to: string };

const STORAGE_KEY = "vay.sidebar";
const GROUPS: Group[] = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard", items: [{ to: "/", label: "Dashboard", action: "dashboard.view", end: true, icon: "dashboard" }] },
  {
    id: "admissions",
    label: "Admissions",
    icon: "admission",
    items: [
      { to: "/students/enquiries", label: "Enquiries", action: "student.lookup", icon: "enquiry" },
      { to: "/students/admissions", label: "Admissions", action: "student.lookup", icon: "admission" },
    ],
  },
  { id: "students", label: "Students", icon: "students", items: [{ to: "/students", label: "Students", action: "student.lookup", end: true, icon: "students" }] },
  {
    id: "academics",
    label: "Academics",
    icon: "institute",
    items: [
      { to: "/institute", label: "Institute", action: "student.lookup", icon: "institute" },
      { to: "/courses", label: "Courses", action: "student.lookup", icon: "course" },
      { to: "/batches", label: "Batches", action: "student.lookup", icon: "batch" },
    ],
  },
  { id: "staff", label: "Staff", icon: "teacher", items: [{ to: "/teachers", label: "Teachers", action: "user.manage", icon: "teacher" }] },
  {
    id: "assessments",
    label: "Assessments",
    icon: "marksheet",
    items: [
      { to: "/import", label: "Import Marklist", action: "marksheet.upload", end: true, icon: "import" },
      { to: "/marksheets", label: "Marksheets", action: "marksheet.view", icon: "marksheet" },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    icon: "views",
    items: [
      { to: "/cards", label: "Progress Cards", action: "progress_card.view", end: true, icon: "card" },
      { to: "/views", label: "Academic Views", action: "dashboard.view", end: true, icon: "views" },
    ],
  },
  {
    id: "administration",
    label: "Administration",
    icon: "settings",
    items: [
      { to: "/access", label: "Users and Access", action: "user.manage", icon: "access" },
      { to: "/audit", label: "Audit", action: "audit.view", end: true, icon: "audit" },
      { to: "/settings", label: "Settings", action: "dashboard.view", end: true, icon: "settings" },
      { to: "/forms", label: "Forms", action: "catalog.edit", end: true, icon: "forms" },
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

function permitted(session: Session, item: Item) {
  if (item.action === "catalog.edit") return session.actions.includes("catalog.correct") || session.actions.includes("catalog.manage");
  return session.actions.includes(item.action);
}

function visibleGroups(session: Session) {
  return GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => permitted(session, item)) })).filter((group) => group.items.length > 0);
}

function readPrefs(): { collapsed: boolean; groups: string[] | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { collapsed: false, groups: null };
    const parsed = JSON.parse(raw) as { collapsed?: unknown; groups?: unknown };
    const groups = Array.isArray(parsed.groups) ? parsed.groups.filter((item): item is string => typeof item === "string") : null;
    return { collapsed: parsed.collapsed === true, groups: parsed.groups === undefined ? null : groups };
  } catch {
    return { collapsed: false, groups: null };
  }
}

function writePrefs(collapsed: boolean, groups: string[] | null) {
  try {
    const payload: { collapsed: boolean; groups?: string[] } = { collapsed };
    if (groups) payload.groups = groups;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // The in-memory choice still applies when storage is blocked.
  }
}

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 899px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 899px)");
    const onChange = () => setNarrow(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

function useContained(active: boolean, container: React.RefObject<HTMLElement | null>, onEscape: () => void) {
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const node = container.current;
    if (!node) return;
    function focusable() {
      return [...node!.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea")].filter((item) => !item.hasAttribute("disabled"));
    }
    const preferred = node.querySelector<HTMLElement>("input, [aria-current='page']");
    (preferred || focusable()[0] || node).focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (document.querySelector("[role='dialog']") && node?.getAttribute("role") !== "dialog") return;
        event.preventDefault();
        escapeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const focused = document.activeElement;
      const inside = focused instanceof Node && node!.contains(focused);
      if (event.shiftKey && (!inside || focused === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || focused === last)) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, container]);
}

function NavIcon({ name }: { name: IconName }) {
  const common = { viewBox: "0 0 24 24", width: 20, height: 20, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  const paths: Record<IconName, ReactNode> = {
    dashboard: <><rect x="3" y="3" width="8" height="8" rx="1" /><rect x="13" y="3" width="8" height="5" rx="1" /><rect x="13" y="10" width="8" height="11" rx="1" /><rect x="3" y="13" width="8" height="8" rx="1" /></>,
    enquiry: <><path d="M5 6h14v9H8l-3 3V6z" /><path d="M8 10h8M8 13h5" /></>,
    admission: <><path d="M8 4h7l4 4v12H8z" /><path d="M15 4v4h4M10 13h6M10 17h4" /></>,
    students: <><circle cx="9" cy="8" r="2.2" /><circle cx="16" cy="9" r="1.8" /><path d="M4.5 18c.6-2.4 2.4-3.5 4.5-3.5S13 15.6 13.6 18M14 14.6c1.4-.4 2.8.2 3.6 1.6" /></>,
    institute: <><path d="M4 20V9l8-5 8 5v11" /><path d="M9 20v-5h6v5M4 20h16" /></>,
    course: <><path d="M4 6.5 12 4l8 2.5V18l-8 2.5L4 18z" /><path d="M12 4v16.5" /></>,
    batch: <><path d="M12 4 4 8l8 4 8-4-8-4z" /><path d="M4 12l8 4 8-4M4 16l8 4 8-4" /></>,
    teacher: <><circle cx="12" cy="8" r="3" /><path d="M5 19c1.2-2.8 3.4-4 7-4s5.8 1.2 7 4" /></>,
    import: <><path d="M12 4v10" /><path d="M8 10l4 4 4-4" /><path d="M5 18h14" /></>,
    marksheet: <><rect x="4" y="4" width="16" height="16" rx="1.5" /><path d="M4 9h16M4 14h16M9 4v16M15 9v11" /></>,
    card: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8" cy="12" r="2" /><path d="M12 11h6M12 14h4" /></>,
    views: <><path d="M4 19V10M10 19V5M16 19v-7M22 19H2" /></>,
    access: <><circle cx="8" cy="12" r="3" /><path d="M11 12h9l-2 2 2 2h-3" /></>,
    audit: <><circle cx="12" cy="12" r="8" /><path d="M12 8v5l3 2" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M4.9 6.5l1.8 1.8M17.3 15.7l1.8 1.8M3 12h2.5M18.5 12H21M4.9 17.5l1.8-1.8M17.3 8.3l1.8-1.8" /></>,
    forms: <><path d="M7 3h8l4 4v14H7z" /><path d="M15 3v4h4M9 12h6M9 16h4" /></>,
    collapse: <path d="M14 6l-6 6 6 6" />,
    expand: <path d="M10 6l6 6-6 6" />,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function commandsFor(session: Session, groups: Group[]): Command[] {
  const pages = groups.flatMap((group) => group.items.map((item) => ({
    id: item.to,
    label: item.label,
    hint: group.label,
    to: item.to,
  })));
  const actions: Command[] = [];
  if (session.actions.includes("student.manage")) {
    actions.push({ id: "action-new-admission", label: "New admission", hint: "Action · Admissions", to: "/students/admissions/new" });
  }
  return [...pages, ...actions];
}

export function QuickNav({ session, search }: { session: Session; search: string }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const opened = useRef(false);
  const closedByNav = useRef(false);
  const titleId = useId();
  const groups = visibleGroups(session);
  const commands = useMemo(() => commandsFor(session, groups), [session, groups]);
  const filtered = commands.filter((command) => {
    const haystack = `${command.label} ${command.hint}`.toLowerCase();
    return query.trim().toLowerCase().split(/\s+/).filter(Boolean).every((part) => haystack.includes(part));
  });
  const safeActive = filtered.length ? Math.min(active, filtered.length - 1) : 0;

  function dismiss() {
    closedByNav.current = false;
    setOpen(false);
  }

  useContained(open, panelRef, dismiss);

  useEffect(() => {
    if (!open) return;
    const backdrop = panelRef.current?.parentElement;
    const hidden: HTMLElement[] = [];
    if (backdrop?.parentElement) {
      for (const child of backdrop.parentElement.children) {
        if (child !== backdrop && child instanceof HTMLElement) {
          child.inert = true;
          hidden.push(child);
        }
      }
    }
    return () => {
      for (const item of hidden) item.inert = false;
    };
  }, [open]);

  useEffect(() => {
    closedByNav.current = true;
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (open) {
      opened.current = true;
      return;
    }
    if (opened.current && !closedByNav.current) restoreRef.current?.focus();
  }, [open]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      const dialog = document.querySelector("[role='dialog']");
      if (dialog && !dialog.hasAttribute("data-quick-nav")) return;
      event.preventDefault();
      if (open) dismiss();
      else {
        closedByNav.current = false;
        restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : buttonRef.current;
        setQuery("");
        setActive(0);
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function launch() {
    closedByNav.current = false;
    restoreRef.current = buttonRef.current;
    setQuery("");
    setActive(0);
    setOpen(true);
  }

  function onInputKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(filtered.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter" && filtered[safeActive]) {
      event.preventDefault();
      document.getElementById(`jump-${filtered[safeActive].id}`)?.click();
    }
  }

  return (
    <>
      <button ref={buttonRef} type="button" className="secondary" aria-haspopup="dialog" aria-expanded={open} aria-keyshortcuts="Control+K Meta+K" onClick={launch}>
        Jump to
      </button>
      {open ? createPortal(
        <div className="modal-backdrop" onMouseDown={dismiss}>
          <div
            ref={panelRef}
            className="modal quick-nav"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            data-quick-nav=""
            tabIndex={-1}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <h2 id={titleId}>Jump to</h2>
              <button type="button" className="quiet" onClick={dismiss}>Close</button>
            </div>
            <input
              autoFocus
              aria-label="Filter pages and actions"
              aria-controls="jump-results"
              aria-activedescendant={filtered[safeActive] ? `jump-${filtered[safeActive].id}` : undefined}
              placeholder="Pages and actions"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setActive(0); }}
              onKeyDown={onInputKey}
            />
            {filtered.length === 0 ? <p>No matching pages.</p> : (
              <ul id="jump-results" className="quick-results" role="listbox" aria-label="Pages and actions">
                {filtered.map((command, index) => (
                  <li key={command.id} role="presentation">
                    <Link
                      id={`jump-${command.id}`}
                      role="option"
                      aria-selected={index === safeActive}
                      to={{ pathname: command.to, search }}
                    >
                      <span>{command.label}</span>
                      <span className="meta">{command.hint}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}

export function PrimaryNav({
  session,
  search,
  headerRef,
  mainRef,
  menuRef,
}: {
  session: Session;
  search: string;
  headerRef: React.RefObject<HTMLElement | null>;
  mainRef: React.RefObject<HTMLElement | null>;
  menuRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const { pathname } = useLocation();
  const narrow = useNarrow();
  const initial = useState(readPrefs)[0];
  const [collapsed, setCollapsed] = useState(initial.collapsed);
  const [openGroups, setOpenGroups] = useState<string[] | null>(initial.groups);
  const [drawer, setDrawer] = useState(false);
  const [flyoutId, setFlyoutId] = useState<string | null>(null);
  const [tip, setTip] = useState<{ text: string; top: number; left: number } | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const openers = useRef(new Map<string, HTMLButtonElement>());
  const restoreMenu = useRef(false);
  const restoreFlyout = useRef<string | null>(null);
  const groups = visibleGroups(session);
  const multiIds = groups.filter((group) => group.items.length > 1).map((group) => group.id);
  const rail = collapsed && !narrow;
  const ownerId = groups.find((group) => group.items.length > 1 && group.items.some((item) => itemActive(pathname, item)))?.id || "";
  const effectiveOpen = new Set(openGroups === null ? multiIds : openGroups.filter((id) => multiIds.includes(id)));

  useEffect(() => { writePrefs(collapsed, openGroups); }, [collapsed, openGroups]);

  useLayoutEffect(() => {
    document.querySelector(".app")?.classList.toggle("nav-collapsed", rail);
  });

  useEffect(() => {
    const button = menuRef.current;
    if (!button) return;
    button.setAttribute("aria-expanded", drawer ? "true" : "false");
    function open() { setDrawer(true); }
    button.addEventListener("click", open);
    return () => button.removeEventListener("click", open);
  }, [drawer, menuRef]);

  useEffect(() => {
    if (!ownerId) return;
    setOpenGroups((current) => {
      if (current === null || current.includes(ownerId)) return current;
      return [...current, ownerId];
    });
  }, [pathname, ownerId]);

  useEffect(() => {
    setDrawer(false);
    setFlyoutId(null);
    setTip(null);
  }, [pathname]);

  useEffect(() => {
    if (!narrow) setDrawer(false);
    if (!rail) setFlyoutId(null);
  }, [narrow, rail]);

  useEffect(() => {
    if (!drawer) {
      if (restoreMenu.current) {
        restoreMenu.current = false;
        menuRef.current?.focus();
      }
      return;
    }
    const header = headerRef.current;
    const main = mainRef.current;
    if (header) header.inert = true;
    if (main) main.inert = true;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      if (header) header.inert = false;
      if (main) main.inert = false;
      document.body.style.overflow = previous;
    };
  }, [drawer, headerRef, mainRef, menuRef]);

  function closeDrawer() {
    restoreMenu.current = true;
    setDrawer(false);
  }

  useContained(drawer, navRef, closeDrawer);

  useLayoutEffect(() => {
    if (!flyoutId) {
      const restore = restoreFlyout.current;
      restoreFlyout.current = null;
      if (restore) openers.current.get(restore)?.focus();
      return;
    }
    const opener = openers.current.get(flyoutId) || null;
    const node = flyoutRef.current;
    if (opener && node) {
      const rect = opener.getBoundingClientRect();
      const margin = 8;
      const height = Math.min(node.scrollHeight, window.innerHeight - margin * 2);
      const top = Math.max(margin, Math.min(rect.top, window.innerHeight - margin - height));
      node.style.top = `${top}px`;
      node.style.left = `${rect.right + margin}px`;
      node.style.maxHeight = `${window.innerHeight - margin * 2}px`;
    }
    node?.querySelector<HTMLElement>("a[href]")?.focus();
    function onPointer(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (flyoutRef.current?.contains(target)) return;
      if (opener?.contains(target)) return;
      restoreFlyout.current = flyoutId;
      setFlyoutId(null);
    }
    function onKey(event: KeyboardEvent) {
      if (document.querySelector("[role='dialog']")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        restoreFlyout.current = flyoutId;
        setFlyoutId(null);
        return;
      }
      if (event.key !== "Tab" || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>("a[href]")];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const focused = document.activeElement;
      if (event.shiftKey && focused === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && focused === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [flyoutId]);

  function showTip(event: React.MouseEvent<HTMLElement> | React.FocusEvent<HTMLElement>, text: string) {
    if (!rail || flyoutId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setTip({ text, top: rect.top + rect.height / 2, left: rect.right + 8 });
  }

  function toggleGroup(group: Group) {
    if (rail) {
      setTip(null);
      setFlyoutId((current) => {
        if (current === group.id) {
          restoreFlyout.current = group.id;
          return null;
        }
        restoreFlyout.current = null;
        return group.id;
      });
      return;
    }
    setOpenGroups((current) => {
      const base = current === null ? multiIds : current.filter((id) => multiIds.includes(id));
      return base.includes(group.id) ? base.filter((id) => id !== group.id) : [...base, group.id];
    });
  }

  function toggleCollapsed() {
    setFlyoutId(null);
    setTip(null);
    setCollapsed((value) => !value);
  }

  const flyout = groups.find((group) => group.id === flyoutId && group.items.length > 1) || null;

  return (
    <>
      {drawer ? createPortal(<div className="nav-backdrop" onMouseDown={closeDrawer} />, document.body) : null}
      <nav
        ref={navRef}
        id="primary-nav"
        className={drawer ? "nav open" : "nav"}
        aria-label="Primary"
        role={narrow && drawer ? "dialog" : undefined}
        aria-modal={narrow && drawer ? true : undefined}
      >
        {narrow ? (
          <button type="button" className="nav-close" onClick={closeDrawer}>Close</button>
        ) : (
          <button
            type="button"
            className="nav-toggle"
            aria-expanded={!collapsed}
            aria-controls="primary-nav"
            data-tip={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={toggleCollapsed}
            onMouseEnter={(event) => showTip(event, collapsed ? "Expand sidebar" : "Collapse sidebar")}
            onMouseLeave={() => setTip(null)}
            onFocus={(event) => showTip(event, collapsed ? "Expand sidebar" : "Collapse sidebar")}
            onBlur={() => setTip(null)}
          >
            <NavIcon name={collapsed ? "expand" : "collapse"} />
            <span className={rail ? "sr-only" : undefined}>{collapsed ? "Expand sidebar" : "Collapse sidebar"}</span>
          </button>
        )}
        {groups.map((group) => {
          const direct = group.items.length < 2;
          const childActive = group.items.some((item) => itemActive(pathname, item));
          if (direct) {
            const item = group.items[0];
            return (
              <Link
                key={item.to}
                to={{ pathname: item.to, search }}
                aria-current={itemActive(pathname, item) ? "page" : undefined}
                className={itemActive(pathname, item) ? "nav-link active" : "nav-link"}
                onMouseEnter={(event) => showTip(event, item.label)}
                onMouseLeave={() => setTip(null)}
                onFocus={(event) => showTip(event, item.label)}
                onBlur={() => setTip(null)}
              >
                <NavIcon name={item.icon} />
                <span className={rail ? "sr-only" : undefined}>{item.label}</span>
              </Link>
            );
          }
          const expanded = effectiveOpen.has(group.id);
          const panelId = `nav-group-${group.id}`;
          return (
            <div className="nav-group" key={group.id}>
              <button
                type="button"
                className={childActive ? "nav-disclosure active" : "nav-disclosure"}
                aria-expanded={rail ? flyoutId === group.id : expanded}
                aria-controls={rail ? `${panelId}-flyout` : panelId}
                aria-current={childActive ? "true" : undefined}
                ref={(node) => {
                  if (node) openers.current.set(group.id, node);
                  else openers.current.delete(group.id);
                }}
                onClick={() => toggleGroup(group)}
                onMouseEnter={(event) => showTip(event, group.label)}
                onMouseLeave={() => setTip(null)}
                onFocus={(event) => showTip(event, group.label)}
                onBlur={() => setTip(null)}
              >
                <NavIcon name={group.icon} />
                <span className={rail ? "sr-only" : undefined}>{group.label}</span>
                {rail ? null : <span className="nav-chevron" aria-hidden="true"><NavIcon name="expand" /></span>}
              </button>
              {rail || !expanded ? null : (
                <div id={panelId} className="nav-children">
                  {group.items.map((item) => (
                    <Link
                      key={item.to}
                      to={{ pathname: item.to, search }}
                      aria-current={itemActive(pathname, item) ? "page" : undefined}
                      className={itemActive(pathname, item) ? "nav-link active" : "nav-link"}
                    >
                      <NavIcon name={item.icon} />
                      <span>{item.label}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      {flyout ? createPortal(
        <div
          ref={flyoutRef}
          id={`nav-group-${flyout.id}-flyout`}
          className="nav-flyout"
          role="region"
          aria-label={flyout.label}
        >
          <p>{flyout.label}</p>
          {flyout.items.map((item) => (
            <Link
              key={item.to}
              to={{ pathname: item.to, search }}
              aria-current={itemActive(pathname, item) ? "page" : undefined}
              className={itemActive(pathname, item) ? "nav-link active" : "nav-link"}
              onClick={() => setFlyoutId(null)}
            >
              <NavIcon name={item.icon} />
              <span>{item.label}</span>
            </Link>
          ))}
        </div>,
        document.body,
      ) : null}
      {tip && rail ? createPortal(<div className="nav-tooltip" role="tooltip" style={{ top: tip.top, left: tip.left }}>{tip.text}</div>, document.body) : null}
    </>
  );
}
