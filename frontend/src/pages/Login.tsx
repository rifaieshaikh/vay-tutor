import { FormEvent, useState } from "react";
import { api } from "../api";

export function LoginPage({ onReady }: { onReady: () => Promise<void> }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
          totp: form.get("totp") || null,
        }),
      });
      await onReady();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign-in failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel narrow">
      <p className="eyebrow">Vay Tutor</p>
      <h1>Sign in</h1>
      <form onSubmit={submit}>
        <label>
          Email
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <label>
          Authentication code
          <input name="totp" inputMode="numeric" autoComplete="one-time-code" placeholder="Only for cloud administrators" />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </section>
  );
}
