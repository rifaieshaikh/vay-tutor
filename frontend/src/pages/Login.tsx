import { FormEvent, useState } from "react";
import { api } from "../api";
import { Icon } from "../ui";

type LoginResult = { verification?: string; challenge?: string };

export function LoginPage({ onReady }: { onReady: () => Promise<void> }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [challenge, setChallenge] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [recovery, setRecovery] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<LoginResult>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
        }),
      });
      if (result.verification === "totp" && result.challenge) {
        setChallenge(result.challenge);
        return;
      }
      await onReady();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign-in failed.");
    } finally {
      setPending(false);
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/v1/auth/login/verify", {
        method: "POST",
        body: JSON.stringify({ challenge, code: form.get("code") }),
      });
      await onReady();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Sign-in failed.";
      if (message.includes("expired") || message.includes("later")) setChallenge("");
      setError(message);
    } finally {
      setPending(false);
    }
  }

  async function back() {
    const current = challenge;
    setChallenge("");
    setError("");
    if (current) {
      await api("/api/v1/auth/login/cancel", { method: "POST", body: JSON.stringify({ challenge: current }) }).catch(() => undefined);
    }
  }

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/v1/auth/recovery/redeem", {
        method: "POST",
        body: JSON.stringify({
          email: form.get("email"),
          recovery_code: form.get("recovery_code"),
          new_password: form.get("new_password"),
        }),
      });
      await onReady();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not use that recovery code.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel narrow">
      <p className="eyebrow">Vay Tutor</p>
      <h1>Sign in</h1>
      {challenge ? (
        <form onSubmit={verify}>
          <p>Enter the current authentication code for this account.</p>
          <label>
            Authentication code
            <input name="code" inputMode="numeric" autoComplete="one-time-code" required autoFocus />
          </label>
          {error ? <p className="error" role="alert">{error}</p> : null}
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={back}>Back</button>
            <button type="submit" disabled={pending}>{pending ? "Checking…" : "Continue"}</button>
          </div>
        </form>
      ) : recovery ? (
        <form onSubmit={redeem}>
          <p>A recovery code replaces the password and signs you in. Ask an administrator if you do not have one.</p>
          <label>
            Username
            <input name="email" type="text" autoComplete="username" required />
          </label>
          <label>
            Recovery code
            <input name="recovery_code" autoComplete="one-time-code" required />
          </label>
          <label>
            New password
            <input name="new_password" type="password" autoComplete="new-password" required />
          </label>
          {error ? <p className="error" role="alert">{error}</p> : null}
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={() => { setRecovery(false); setError(""); }}>Back</button>
            <button type="submit" disabled={pending}>{pending ? "Saving…" : "Set password"}</button>
          </div>
        </form>
      ) : (
        <form onSubmit={submit}>
          <label>
            Username
            <input name="email" type="text" autoComplete="username" required autoFocus />
          </label>
          <label>
            Password
            <span className="password-field">
              <input name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required />
              <button type="button" className="password-toggle" aria-pressed={showPassword} aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)}>
                <Icon name={showPassword ? "view-off" : "view"} />
              </button>
            </span>
          </label>
          {error ? <p className="error" role="alert">{error}</p> : null}
          <button type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
          <p><button type="button" className="quiet" onClick={() => { setRecovery(true); setError(""); }}>Use a recovery code</button></p>
        </form>
      )}
    </section>
  );
}
