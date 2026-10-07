import { FormEvent, useState } from "react";
import { api } from "../api";

export function SetupPage({ onReady }: { onReady: () => Promise<void> }) {
  const [error, setError] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      const created = await api<{ recovery_codes: string[] }>("/api/v1/bootstrap", {
        method: "POST",
        body: JSON.stringify({
          institute_name: form.get("institute_name"),
          institute_code: form.get("institute_code"),
          admin_name: form.get("admin_name"),
          admin_email: form.get("admin_email"),
          admin_password: form.get("admin_password"),
        }),
      });
      setCodes(created.recovery_codes);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Setup failed.");
    } finally {
      setPending(false);
    }
  }

  if (codes.length) {
    return (
      <section className="panel narrow">
        <h1>Save these recovery codes</h1>
        <p>Each code works once if the administrator password is lost. They are not shown again.</p>
        <ul className="codes">
          {codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <button type="button" onClick={() => onReady()}>
          Continue
        </button>
      </section>
    );
  }

  return (
    <section className="panel narrow">
      <p className="eyebrow">First-time setup</p>
      <h1>Create the institute</h1>
      <p>No branches, courses, or students are required. Those come from a marklist.</p>
      <form onSubmit={submit}>
        <label>
          Institute name
          <input name="institute_name" defaultValue="IAM" required />
        </label>
        <label>
          Institute code
          <input name="institute_code" defaultValue="IAM" required />
        </label>
        <label>
          Administrator name
          <input name="admin_name" required />
        </label>
        <label>
          Email
          <input name="admin_email" type="email" autoComplete="username" required />
        </label>
        <label>
          Password
          <input name="admin_password" type="password" autoComplete="new-password" minLength={10} required />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create institute"}
        </button>
      </form>
    </section>
  );
}
