import { FormEvent, useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { Option, optionFits } from "../filters";

type User = { id: string; name: string; email: string; active: boolean };
type Role = { name: string; actions?: string[] };
type Grant = { id: string; role: string; actions: string[]; scope: Record<string, string | null>; consequence: string };
type AccessView = { user: User; grants: Grant[] };

const SCOPE_FIELDS = [
  ["branch_id", "Branch", "branch"],
  ["course_id", "Course", "course"],
  ["batch_id", "Batch", "batch"],
  ["subject_id", "Subject", "subject"],
  ["paper_id", "Paper", "paper"],
] as const;

export function AccessPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [options, setOptions] = useState<Record<string, Option[]>>({});
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [scope, setScope] = useState<Record<string, string>>({});
  const [role, setRole] = useState("teacher");
  const [preview, setPreview] = useState<AccessView | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [acknowledge, setAcknowledge] = useState(false);

  async function load() {
    const [userPage, rolePage] = await Promise.all([
      api<{ items: User[] }>("/api/v1/users"),
      api<{ items: Role[] }>("/api/v1/roles"),
    ]);
    setUsers(userPage.items);
    setRoles(rolePage.items);
  }

  useEffect(() => {
    load().catch((reason: Error) => setError(reason.message));
    Promise.all(
      SCOPE_FIELDS.map(async ([, , dimension]) => {
        const page = await api<{ items: Option[] }>(`/api/v1/context/options?dimension=${dimension}`);
        return [dimension, page.items] as const;
      }),
    ).then((pairs) => setOptions(Object.fromEntries(pairs))).catch(() => undefined);
  }, []);

  function scopeBody() {
    return Object.fromEntries(SCOPE_FIELDS.map(([key]) => [key, scope[key] || null]));
  }

  function summary(nextRole: string, nextScope: Record<string, string>) {
    const where = SCOPE_FIELDS.map(([key, label, dimension]) => {
      const value = nextScope[key];
      if (!value) return `all ${label.toLowerCase()}s`;
      return options[dimension]?.find((option) => option.id === value)?.label || label;
    }).join(", ");
    return `${nextRole} on ${where}. A blank level includes everything inside the levels you did choose.`;
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const created = await api<{ consequence: string }>("/api/v1/users", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email"),
          password: form.get("password"),
          role,
          scope: scopeBody(),
          acknowledge_scope: acknowledge,
        }),
      });
      setMessage(`Added. ${created.consequence} Before: no account. After: ${summary(role, scope)}`);
      setAcknowledge(false);
      setScope({});
      formElement.reset();
      await load();
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "grant.acknowledge_scope") {
        setAcknowledge(true);
        setError(`${reason.message} Confirm the form to save this grant.`);
        return;
      }
      setError(reason instanceof Error ? reason.message : "Could not add the user.");
    }
  }

  async function deactivate(user: User) {
    setError("");
    const next = !user.active;
    try {
      await api(`/api/v1/users/${user.id}`, { method: "PATCH", body: JSON.stringify({ active: next }) });
      setMessage(`${user.name} was ${user.active ? "active" : "inactive"} and is now ${next ? "active" : "inactive"}.`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the user.");
    }
  }

  async function showAccess(user: User) {
    setError("");
    try {
      setPreview(await api<AccessView>(`/api/v1/users/${user.id}/effective-access`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load access.");
    }
  }

  async function addGrant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview) return;
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const created = await api<{ consequence: string }>("/api/v1/grants", {
        method: "POST",
        body: JSON.stringify({
          user_id: preview.user.id,
          role: form.get("grant_role"),
          scope: scopeBody(),
          acknowledge_scope: acknowledge,
        }),
      });
      setMessage(`Grant added. ${created.consequence}`);
      setAcknowledge(false);
      setPreview(await api<AccessView>(`/api/v1/users/${preview.user.id}/effective-access`));
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "grant.acknowledge_scope") {
        setAcknowledge(true);
        setError(`${reason.message} Confirm to add this grant.`);
        return;
      }
      setError(reason instanceof Error ? reason.message : "Could not add the grant.");
    }
  }

  const shown = users.filter((user) => {
    const text = `${user.name} ${user.email}`.toLowerCase().includes(query.toLowerCase());
    const state = !status || (status === "active" ? user.active : !user.active);
    return text && state;
  });

  return (
    <section className="panel wide">
      <p className="eyebrow">Administration</p>
      <h1>Users and access</h1>
      <p>An account is the person. A role is what they can do. A grant is that role on one scope. Grants do not combine across different branches or subjects.</p>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {message ? <p className="ok" role="status">{message}</p> : null}
      <div className="filter-grid">
        <label>Search<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or email" /></label>
        <label>
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
      </div>
      <p>{shown.length} user{shown.length === 1 ? "" : "s"}</p>
      <ul className="people">
        {shown.map((user) => (
          <li key={user.id}>
            <span>{user.name} · {user.email} · {user.active ? "Active" : "Inactive"}</span>
            <button type="button" onClick={() => showAccess(user)}>Effective access</button>
            <button type="button" onClick={() => deactivate(user)}>{user.active ? "Deactivate" : "Activate"}</button>
          </li>
        ))}
      </ul>
      {preview ? (
        <section>
          <h2>{preview.user.name}</h2>
          <p>{preview.user.email} · {preview.user.active ? "Active" : "Inactive"}</p>
          {preview.grants.length === 0 ? <p>No grants.</p> : preview.grants.map((grant) => (
            <article key={grant.id}>
              <p>{grant.role}. {grant.consequence}</p>
              <p>Can: {grant.actions.join(", ") || "nothing"}.</p>
            </article>
          ))}
          <form onSubmit={addGrant} className="stack">
            <h3>Add a grant</h3>
            <label>
              Role
              <select name="grant_role" defaultValue="teacher">
                {roles.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
              </select>
            </label>
            <button type="submit">{acknowledge ? "Confirm this grant" : "Add grant"}</button>
          </form>
        </section>
      ) : null}
      <form onSubmit={create} className="stack">
        <h2>Add a user</h2>
        <p>This creates the account and one grant. You cannot give someone more access than you have.</p>
        <label>Name<input name="name" required /></label>
        <label>Email<input name="email" type="email" required /></label>
        <label>Password<input name="password" type="password" minLength={10} required /></label>
        <label>
          Role
          <select value={role} onChange={(event) => setRole(event.target.value)}>
            {roles.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
          </select>
        </label>
        {SCOPE_FIELDS.map(([key, label, dimension]) => (
          <label key={key}>
            {label}
            <select value={scope[key] || ""} onChange={(event) => setScope((current) => ({ ...current, [key]: event.target.value }))}>
              <option value="">All {label.toLowerCase()}s</option>
              {(options[dimension] || []).filter((option) => optionFits(option, scope)).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
        ))}
        <p>Before saving: {summary(role, scope)}</p>
        <button type="submit">{acknowledge ? "Confirm this scope" : "Add user"}</button>
      </form>
    </section>
  );
}
