import { FormEvent, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { Option, clearIncompatible, optionFits } from "../filters";
import { Icon, StudentDialog } from "./Catalog";

type User = { id: string; name: string; email: string; active: boolean };
type Role = { id: string; name: string; actions: string[] };
type Grant = { id: string; role: string; actions: string[]; scope: Record<string, string | null>; consequence: string };
type AccessView = { user: User; grants: Grant[] };

const SCOPE_FIELDS = [
  ["branch_id", "Branch", "branch", "branches"],
  ["course_id", "Course", "course", "courses"],
  ["batch_id", "Batch", "batch", "batches"],
  ["subject_id", "Subject", "subject", "subjects"],
  ["paper_id", "Paper", "paper", "papers"],
] as const;

const ROLE_LABELS: Record<string, string> = {
  institute_admin: "Institute admin",
  branch_admin: "Branch admin",
  academic_coordinator: "Academic coordinator",
  teacher: "Teacher",
  viewer: "Viewer",
};

const ACTION_LABELS: Record<string, string> = {
  "dashboard.view": "Overview",
  "student.lookup": "Look up students",
  "student.manage": "Manage students",
  "marksheet.view": "View marksheets",
  "marksheet.upload": "Upload marksheets",
  "marksheet.edit_draft": "Edit drafts",
  "marksheet.submit": "Submit marksheets",
  "marksheet.publish": "Publish marksheets",
  "marksheet.correct": "Correct results",
  "marksheet.withdraw": "Withdraw publication",
  "import.create_scope": "Create branches, courses, and subjects",
  "progress_card.view": "View progress cards",
  "export.pdf": "Export PDF",
  "export.xlsx": "Export a spreadsheet",
  "catalog.correct": "Correct the catalog",
  "catalog.manage": "Manage the catalog",
  "user.manage": "Manage users",
  "grant.manage": "Manage access",
  "audit.view": "View the audit",
  "backup.admin": "Back up and restore",
};

const PERMISSION_GROUPS = [
  { label: "People", actions: ["dashboard.view", "student.lookup", "student.manage", "progress_card.view"] },
  { label: "Marksheets", actions: ["marksheet.view", "marksheet.upload", "marksheet.edit_draft", "marksheet.submit", "marksheet.publish", "marksheet.correct", "marksheet.withdraw"] },
  { label: "Export", actions: ["export.pdf", "export.xlsx"] },
  { label: "Catalog", actions: ["catalog.correct", "catalog.manage", "import.create_scope"] },
  { label: "Administration", actions: ["user.manage", "grant.manage", "audit.view", "backup.admin"] },
] as const;

const PERMISSIONS = PERMISSION_GROUPS.flatMap((group) => group.actions);

function PermissionGroups({ selected, onToggle }: { selected: readonly string[]; onToggle?: (action: string) => void }) {
  return (
    <div className="permission-groups">
      {PERMISSION_GROUPS.map((group) => {
        const actions = onToggle ? group.actions : group.actions.filter((action) => selected.includes(action));
        if (actions.length === 0) return null;
        return (
          <div key={group.label}>
            <h3>{group.label}</h3>
            <div className="permission-picks">
              {actions.map((action) => {
                const on = selected.includes(action);
                if (!onToggle) return <span key={action} className="permission is-selected">{actionLabel(action)}</span>;
                return (
                  <button key={action} type="button" className={on ? "permission is-selected" : "permission"} aria-pressed={on} onClick={() => onToggle(action)}>
                    {actionLabel(action)}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function roleLabel(name: string) {
  return ROLE_LABELS[name] || name.replaceAll("_", " ");
}

function actionLabel(name: string) {
  return ACTION_LABELS[name] || name.replaceAll("_", " ").replaceAll(".", " ");
}

function scopeBody(scope: Record<string, string>) {
  return Object.fromEntries(SCOPE_FIELDS.map(([key]) => [key, scope[key] || null]));
}

function scopePlace(scope: Record<string, string | null>, options: Record<string, Option[]>) {
  const chosen = SCOPE_FIELDS.map(([key, label, dimension]) => {
    const value = scope[key];
    if (!value) return "";
    return options[dimension]?.find((option) => option.id === value)?.label || label;
  }).filter(Boolean);
  return chosen.length ? chosen.join(", ") : "Whole institute";
}

function scopeSummary(nextRole: string, nextScope: Record<string, string>, options: Record<string, Option[]>) {
  const where = SCOPE_FIELDS.map(([key, label, dimension, plural]) => {
    const value = nextScope[key];
    if (!value) return `all ${plural}`;
    return options[dimension]?.find((option) => option.id === value)?.label || label;
  }).join(", ");
  return `${roleLabel(nextRole)} on ${where}. A blank level includes everything inside the levels you did choose.`;
}

function useAccessOptions() {
  const [options, setOptions] = useState<Record<string, Option[]>>({});
  useEffect(() => {
    Promise.all(
      SCOPE_FIELDS.map(async ([, , dimension]) => {
        const page = await api<{ items: Option[] }>(`/api/v1/context/options?dimension=${dimension}`);
        return [dimension, page.items] as const;
      }),
    ).then((pairs) => setOptions(Object.fromEntries(pairs))).catch(() => undefined);
  }, []);
  return options;
}

export function AccessPage() {
  const options = useAccessOptions();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") || "";
  const status = params.get("status") || "";
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftQuery, setDraftQuery] = useState(query);
  const [draftStatus, setDraftStatus] = useState(status);
  const [adding, setAdding] = useState(false);
  const [addingRole, setAddingRole] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    const [userPage, rolePage] = await Promise.all([
      api<{ items: User[] }>("/api/v1/users"),
      api<{ items: Role[] }>("/api/v1/roles"),
    ]);
    setUsers(userPage.items);
    setRoles(rolePage.items);
  }

  useEffect(() => {
    load().catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false));
  }, []);

  const shown = users
    .filter((user) => {
      const text = `${user.name} ${user.email}`.toLowerCase().includes(query.toLowerCase());
      const state = !status || (status === "active" ? user.active : !user.active);
      return text && state;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
  const active = [query ? "q" : "", status ? "status" : ""].filter(Boolean);

  const tab = params.get("tab") === "roles" ? "roles" : "users";
  const roleRows = [...roles].sort((left, right) => roleLabel(left.name).localeCompare(roleLabel(right.name)));

  function writeFilters(nextQuery: string, nextStatus: string) {
    const next = new URLSearchParams();
    if (params.get("tab") === "roles") next.set("tab", "roles");
    if (nextQuery.trim()) next.set("q", nextQuery.trim());
    if (nextStatus) next.set("status", nextStatus);
    setParams(next);
  }

  function openTab(nextTab: "users" | "roles") {
    const next = new URLSearchParams(params);
    if (nextTab === "roles") next.set("tab", "roles");
    else next.delete("tab");
    setParams(next);
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    writeFilters(draftQuery, draftStatus);
    setFiltersOpen(false);
  }

  return (
    <section className="panel wide">
      <div className="page-title">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Users and access</h1>
        </div>
        <div className="actions">
          {tab === "users" && query ? <button type="button" className="chip-button" onClick={() => writeFilters("", status)}>Search: {query}</button> : null}
          {tab === "users" && status ? <button type="button" className="chip-button" onClick={() => writeFilters(query, "")}>Status: {status === "active" ? "Active" : "Inactive"}</button> : null}
          <div className="icon-actions">
            {tab === "users" && active.length ? <button type="button" onClick={() => writeFilters("", "")} aria-label="Clear filters" title="Clear filters"><Icon name="clear" /></button> : null}
            {tab === "users" ? <button type="button" onClick={() => { setDraftQuery(query); setDraftStatus(status); setFiltersOpen(true); }} aria-label={active.length ? `Filters, ${active.length} applied` : "Filters"} title="Filters"><Icon name="filter" /></button> : null}
            {tab === "users" ? <button type="button" onClick={() => { setAdding(true); setError(""); }} aria-label="Add user" title="Add user"><Icon name="add" /></button> : null}
            {tab === "roles" ? <button type="button" onClick={() => { setAddingRole(true); setError(""); }} aria-label="Add role" title="Add role"><Icon name="add" /></button> : null}
          </div>
        </div>
      </div>
      <div className="page-tabs" role="tablist" aria-label="Users and access">
        <button type="button" role="tab" aria-selected={tab === "users"} onClick={() => openTab("users")}>Users</button>
        <button type="button" role="tab" aria-selected={tab === "roles"} onClick={() => openTab("roles")}>Roles</button>
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {message ? <p className="ok" role="status">{message}</p> : null}
      {tab === "roles" ? (
        <>
          <p className="filter-row"><span>{loading ? "Loading roles…" : `${roleRows.length} role${roleRows.length === 1 ? "" : "s"}`}</span></p>
          <p className="meta">A role is the set of permissions. A grant gives that role to one person, in one place. Changing a role does not change grants already given.</p>
          {roleRows.length === 0 && !loading ? <p>No roles yet.</p> : null}
          {roleRows.length > 0 ? (
            <div className="table-wrap">
              <table className="people-table">
                <caption className="sr-only">Roles.</caption>
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Permissions</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {roleRows.map((role) => (
                    <tr key={role.id}>
                      <td>{roleLabel(role.name)}</td>
                      <td>{role.actions.length ? <PermissionGroups selected={role.actions} /> : "None"}</td>
                      <td>
                        <div className="icon-actions">
                          <button type="button" onClick={() => setEditingRole(role)} aria-label={`Edit ${roleLabel(role.name)}`} title="Edit role"><Icon name="edit" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}
      {tab === "users" ? <p className="filter-row"><span>{loading ? "Loading users…" : `${shown.length} user${shown.length === 1 ? "" : "s"}`}</span></p> : null}
      {tab === "users" && !loading && shown.length === 0 ? <p>{users.length === 0 ? "No users yet." : "No users match these filters."}</p> : null}
      {tab === "users" && shown.length > 0 ? (
        <div className="table-wrap">
          <table className="people-table">
            <caption className="sr-only">Users.</caption>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((user) => (
                <tr key={user.id}>
                  <td><Link to={`/access/${user.id}`}>{user.name}</Link></td>
                  <td>{user.email}</td>
                  <td>{user.active ? "Active" : "Inactive"}</td>
                  <td>
                    <div className="icon-actions">
                      <Link to={`/access/${user.id}`} aria-label={`Open ${user.name}`} title="Open user"><Icon name="edit" /></Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {filtersOpen ? (
        <StudentDialog title="Filters" onClose={() => setFiltersOpen(false)}>
          <form className="form-grid" onSubmit={applyFilters}>
            <label className="span-2">Search
              <input value={draftQuery} aria-label="Search" placeholder="Name or email" onChange={(event) => setDraftQuery(event.target.value)} />
            </label>
            <label className="span-2">Status
              <select value={draftStatus} aria-label="Status" onChange={(event) => setDraftStatus(event.target.value)}>
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <div className="dialog-actions span-2">
              <button type="button" className="quiet" onClick={() => { writeFilters("", ""); setDraftQuery(""); setDraftStatus(""); setFiltersOpen(false); }}>Reset</button>
              <button type="submit">Apply</button>
            </div>
          </form>
        </StudentDialog>
      ) : null}
      {adding ? (
        <UserForm
          roles={roles}
          options={options}
          onClose={() => setAdding(false)}
          onSaved={async (user, consequence) => {
            setAdding(false);
            setMessage(`Added ${user.name}. ${consequence}`);
            await load();
          }}
        />
      ) : null}
      {addingRole ? (
        <RoleForm
          onClose={() => setAddingRole(false)}
          onSaved={async (name) => {
            setAddingRole(false);
            setMessage(`Added ${name}. Use it when you add a user or a grant.`);
            await load();
          }}
        />
      ) : null}
      {editingRole ? (
        <RoleForm
          role={editingRole}
          onClose={() => setEditingRole(null)}
          onSaved={async (name) => {
            setEditingRole(null);
            setMessage(`Saved ${name}. New grants use this list. Grants already given stay as they are.`);
            await load();
          }}
        />
      ) : null}
    </section>
  );
}

export function UserAccessPage() {
  const { userId = "" } = useParams();
  const options = useAccessOptions();
  const [roles, setRoles] = useState<Role[]>([]);
  const [preview, setPreview] = useState<AccessView | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Grant | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    const [access, rolePage] = await Promise.all([
      api<AccessView>(`/api/v1/users/${userId}/effective-access`),
      api<{ items: Role[] }>("/api/v1/roles"),
    ]);
    setPreview(access);
    setRoles(rolePage.items);
  }

  useEffect(() => {
    setLoading(true);
    setPreview(null);
    load().catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false));
  }, [userId]);

  async function toggleActive() {
    if (!preview) return;
    setError("");
    const next = !preview.user.active;
    try {
      await api(`/api/v1/users/${preview.user.id}`, { method: "PATCH", body: JSON.stringify({ active: next }) });
      setMessage(`${preview.user.name} is now ${next ? "active" : "inactive"}.`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the user.");
    }
  }

  async function removeGrant() {
    if (!removing) return;
    setError("");
    try {
      await api(`/api/v1/grants/${removing.id}`, { method: "DELETE" });
      setMessage(`Removed the ${roleLabel(removing.role)} grant.`);
      setRemoving(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not remove the grant.");
      setRemoving(null);
    }
  }

  if (loading) {
    return <section className="panel"><p>Loading user…</p></section>;
  }
  if (!preview) {
    return (
      <section className="panel">
        <p className="meta"><Link to="/access">Users and access</Link></p>
        {error ? <p className="error" role="alert">{error}</p> : <p>This user was not found.</p>}
      </section>
    );
  }

  return (
    <section className="panel wide">
      <p className="meta"><Link to="/access">Users and access</Link></p>
      <div className="title-row">
        <div>
          <p className="eyebrow">User</p>
          <h1>{preview.user.name}</h1>
          <p className="meta">{preview.user.email}</p>
          <p className="meta">{preview.user.active ? "Active" : "Inactive"}</p>
        </div>
        <button type="button" className="quiet" onClick={toggleActive}>{preview.user.active ? "Deactivate" : "Activate"}</button>
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {message ? <p className="ok" role="status">{message}</p> : null}
      <div className="title-row">
        <h2>Grants</h2>
        <div className="icon-actions">
          <button type="button" onClick={() => { setAdding(true); setError(""); }} aria-label="Add grant" title="Add grant"><Icon name="add" /></button>
        </div>
      </div>
      <p className="meta">A grant is one role on one scope. Grants do not combine across different branches or subjects.</p>
      {preview.grants.length === 0 ? <p>No grants yet.</p> : (
        <div className="table-wrap">
          <table className="people-table">
            <caption className="sr-only">Grants for {preview.user.name}.</caption>
            <thead>
              <tr>
                <th>Role</th>
                <th>Scope</th>
                <th>Can</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {preview.grants.map((grant) => (
                <tr key={grant.id}>
                  <td>{roleLabel(grant.role)}</td>
                  <td>
                    {scopePlace(grant.scope, options)}
                    <p className="meta">{grant.consequence}</p>
                  </td>
                  <td>{grant.actions.length ? grant.actions.map(actionLabel).join(", ") : "Nothing"}</td>
                  <td>
                    <div className="icon-actions">
                      <button type="button" onClick={() => setRemoving(grant)} aria-label={`Remove ${roleLabel(grant.role)}`} title="Remove grant"><Icon name="clear" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding ? (
        <GrantForm
          userId={preview.user.id}
          roles={roles}
          options={options}
          onClose={() => setAdding(false)}
          onSaved={async (consequence) => {
            setAdding(false);
            setMessage(`Grant added. ${consequence}`);
            await load();
          }}
        />
      ) : null}
      {removing ? (
        <StudentDialog title="Remove grant" onClose={() => setRemoving(null)}>
          <p>Remove the {roleLabel(removing.role)} grant for {preview.user.name}? {removing.consequence}</p>
          {error ? <p className="error" role="alert">{error}</p> : null}
          <div className="dialog-actions">
            <button type="button" className="quiet" onClick={() => setRemoving(null)}>Cancel</button>
            <button type="button" onClick={removeGrant}>Remove</button>
          </div>
        </StudentDialog>
      ) : null}
    </section>
  );
}

function ScopeFields({ scope, options, onChange }: { scope: Record<string, string>; options: Record<string, Option[]>; onChange: (key: string, value: string) => void }) {
  return (
    <>
      {SCOPE_FIELDS.map(([key, label, dimension, plural]) => (
        <label key={key}>
          {label}
          <select value={scope[key] || ""} aria-label={label} onChange={(event) => onChange(key, event.target.value)}>
            <option value="">All {plural}</option>
            {(options[dimension] || []).filter((option) => optionFits(option, scope)).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
      ))}
    </>
  );
}

function UserForm({ roles, options, onClose, onSaved }: { roles: Role[]; options: Record<string, Option[]>; onClose: () => void; onSaved: (user: User, consequence: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("teacher");
  const [scope, setScope] = useState<Record<string, string>>({});
  const [acknowledge, setAcknowledge] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const ready = Boolean(name.trim() && email.trim() && password.length >= 10);

  function choose(key: string, value: string) {
    setScope(clearIncompatible({ ...scope, [key]: value }, options, key).filters);
    setAcknowledge(false);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const created = await api<{ user: User; consequence: string }>("/api/v1/users", {
        method: "POST",
        body: JSON.stringify({ name, email, password, role, scope: scopeBody(scope), acknowledge_scope: acknowledge }),
      });
      await onSaved(created.user, created.consequence);
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "grant.acknowledge_scope") {
        setAcknowledge(true);
        setError(`${reason.message} Confirm the form to save this grant.`);
      } else {
        setError(reason instanceof Error ? reason.message : "Could not add the user.");
      }
      setSaving(false);
    }
  }

  return (
    <StudentDialog title="Add user" onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <p className="meta span-2">This creates the account and one grant. You cannot give someone more access than you have.</p>
        <label>Name
          <input value={name} aria-label="Name" onChange={(event) => setName(event.target.value)} />
        </label>
        <label>Email
          <input type="email" value={email} aria-label="Email" onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="span-2">Password
          <input type="password" value={password} minLength={10} aria-label="Password" onChange={(event) => setPassword(event.target.value)} />
        </label>
        <label className="span-2">Role
          <select value={role} aria-label="Role" onChange={(event) => { setRole(event.target.value); setAcknowledge(false); }}>
            {roles.map((item) => <option key={item.name} value={item.name}>{roleLabel(item.name)}</option>)}
          </select>
        </label>
        <ScopeFields scope={scope} options={options} onChange={choose} />
        <p className="meta span-2">{scopeSummary(role, scope, options)}</p>
        {error ? <p className="error span-2" role="alert">{error}</p> : null}
        <div className="dialog-actions span-2">
          <button type="button" className="quiet" onClick={onClose}>Cancel</button>
          {acknowledge ? <button type="submit" disabled={saving || !ready}>Confirm this scope</button> : (
            <div className="icon-actions">
              <button type="submit" disabled={saving || !ready} aria-label="Add user" title="Add user"><Icon name="add" /></button>
            </div>
          )}
        </div>
      </form>
    </StudentDialog>
  );
}

function GrantForm({ userId, roles, options, onClose, onSaved }: { userId: string; roles: Role[]; options: Record<string, Option[]>; onClose: () => void; onSaved: (consequence: string) => Promise<void> }) {
  const [role, setRole] = useState("teacher");
  const [scope, setScope] = useState<Record<string, string>>({});
  const [acknowledge, setAcknowledge] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function choose(key: string, value: string) {
    setScope(clearIncompatible({ ...scope, [key]: value }, options, key).filters);
    setAcknowledge(false);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const created = await api<{ consequence: string }>("/api/v1/grants", {
        method: "POST",
        body: JSON.stringify({ user_id: userId, role, scope: scopeBody(scope), acknowledge_scope: acknowledge }),
      });
      await onSaved(created.consequence);
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "grant.acknowledge_scope") {
        setAcknowledge(true);
        setError(`${reason.message} Confirm to add this grant.`);
      } else {
        setError(reason instanceof Error ? reason.message : "Could not add the grant.");
      }
      setSaving(false);
    }
  }

  return (
    <StudentDialog title="Add grant" onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <label className="span-2">Role
          <select value={role} aria-label="Role" onChange={(event) => { setRole(event.target.value); setAcknowledge(false); }}>
            {roles.map((item) => <option key={item.name} value={item.name}>{roleLabel(item.name)}</option>)}
          </select>
        </label>
        <ScopeFields scope={scope} options={options} onChange={choose} />
        <p className="meta span-2">{scopeSummary(role, scope, options)}</p>
        {error ? <p className="error span-2" role="alert">{error}</p> : null}
        <div className="dialog-actions span-2">
          <button type="button" className="quiet" onClick={onClose}>Cancel</button>
          {acknowledge ? <button type="submit" disabled={saving}>Confirm this grant</button> : (
            <div className="icon-actions">
              <button type="submit" disabled={saving} aria-label="Add grant" title="Add grant"><Icon name="add" /></button>
            </div>
          )}
        </div>
      </form>
    </StudentDialog>
  );
}

function RoleForm({ role, onClose, onSaved }: { role?: Role; onClose: () => void; onSaved: (name: string) => Promise<void> }) {
  const [name, setName] = useState(role?.name || "");
  const [actions, setActions] = useState<string[]>(role?.actions || []);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const chosen = PERMISSIONS.filter((action) => actions.includes(action));
  const ready = Boolean((role || name.trim()) && chosen.length);

  function toggle(action: string) {
    setActions((current) => current.includes(action) ? current.filter((item) => item !== action) : [...current, action]);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (role) {
        await api(`/api/v1/roles/${role.id}`, { method: "PATCH", body: JSON.stringify({ actions: chosen }) });
        await onSaved(roleLabel(role.name));
      } else {
        const created = await api<{ name: string }>("/api/v1/roles", { method: "POST", body: JSON.stringify({ name: name.trim(), actions: chosen }) });
        await onSaved(created.name);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the role.");
      setSaving(false);
    }
  }

  return (
    <StudentDialog title={role ? `Edit ${roleLabel(role.name)}` : "Add role"} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <p className="meta span-2">Choose what this role can do. A grant still decides where. People who already have this role keep the permissions on their grants.</p>
        {role ? <p className="span-2">{roleLabel(role.name)}</p> : (
          <label className="span-2">Name
            <input value={name} aria-label="Role name" onChange={(event) => setName(event.target.value)} />
          </label>
        )}
        <div className="span-2">
          <PermissionGroups selected={actions} onToggle={toggle} />
        </div>
        {error ? <p className="error span-2" role="alert">{error}</p> : null}
        <div className="dialog-actions span-2">
          <button type="button" className="quiet" onClick={onClose}>Cancel</button>
          {role ? <button type="submit" disabled={saving || !ready}>Save</button> : (
            <div className="icon-actions">
              <button type="submit" disabled={saving || !ready} aria-label="Add role" title="Add role"><Icon name="add" /></button>
            </div>
          )}
        </div>
      </form>
    </StudentDialog>
  );
}
