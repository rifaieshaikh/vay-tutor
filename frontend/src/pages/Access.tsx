import { FormEvent, useEffect, useState } from "react";
import { api, ApiError } from "../api";

type User = { id: string; name: string; email: string; active: boolean };
type Role = { name: string };

export function AccessPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
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
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const scope = {
      branch_id: String(form.get("branch_id") || "") || null,
      course_id: String(form.get("course_id") || "") || null,
      subject_id: String(form.get("subject_id") || "") || null,
    };
    try {
      const created = await api<{ consequence: string }>("/api/v1/users", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email"),
          password: form.get("password"),
          role: form.get("role"),
          scope,
          acknowledge_scope: acknowledge,
        }),
      });
      setMessage(created.consequence);
      setAcknowledge(false);
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
    try {
      await api(`/api/v1/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !user.active }),
      });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the user.");
    }
  }

  return (
    <section className="panel">
      <h1>Users and access</h1>
      <p>A grant is one role plus one scope. It does not combine with a different branch or subject.</p>
      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="ok">{message}</p> : null}
      <ul className="people">
        {users.map((user) => (
          <li key={user.id}>
            <span>
              {user.name} · {user.email} · {user.active ? "Active" : "Inactive"}
            </span>
            <button type="button" onClick={() => deactivate(user)}>
              {user.active ? "Deactivate" : "Activate"}
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={create} className="stack">
        <h2>Add a user</h2>
        <label>
          Name
          <input name="name" required />
        </label>
        <label>
          Email
          <input name="email" type="email" required />
        </label>
        <label>
          Password
          <input name="password" type="password" minLength={10} required />
        </label>
        <label>
          Role
          <select name="role" defaultValue="teacher">
            {roles.map((role) => (
              <option key={role.name} value={role.name}>
                {role.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Branch id
          <input name="branch_id" placeholder="Blank means all branches" />
        </label>
        <label>
          Course id
          <input name="course_id" placeholder="Blank means all courses" />
        </label>
        <label>
          Subject id
          <input name="subject_id" placeholder="Blank means all subjects" />
        </label>
        <button type="submit">{acknowledge ? "Confirm this scope" : "Add user"}</button>
      </form>
    </section>
  );
}
