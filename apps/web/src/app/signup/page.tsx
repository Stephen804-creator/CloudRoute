"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const response = await fetch("/v1/auth/signup", {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName, organizationName: organizationName || undefined, email, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Account creation failed.");
      router.replace("/app");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not create your account."); }
    finally { setBusy(false); }
  }

  return <main className="auth-page"><a className="brand auth-brand" href="/"><span className="brand-mark">C</span><span>CloudRoute</span></a>
    <section className="auth-card"><p className="eyebrow">GET STARTED</p><h1>Set up your workspace.</h1><p className="auth-subtitle">Start with visibility. Connect cloud accounts when you are ready.</p>
      <form onSubmit={submit} className="auth-form">
        <label>Full name<input autoComplete="name" required maxLength={120} value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
        <label>Workspace name <span className="optional">(optional)</span><input maxLength={120} value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder="Your team's workspace" /></label>
        <label>Email address<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password <span className="optional">(12 characters minimum)</span><input type="password" autoComplete="new-password" minLength={12} required maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button auth-submit" disabled={busy}>{busy ? "Creating workspace…" : "Create account"} <span aria-hidden="true">→</span></button>
      </form>
      <div className="auth-divider"><span>or</span></div>
      <a className="google-button" href="/v1/auth/google"><span aria-hidden="true">G</span> Continue with Google</a>
      <p className="auth-switch">Already have an account? <a href="/login">Sign in</a></p>
    </section><p className="auth-footnote">No cloud resources are changed by CloudRoute's MVP.</p>
  </main>;
}
