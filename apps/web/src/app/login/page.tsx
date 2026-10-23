"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const errorCode = new URLSearchParams(window.location.search).get("error");
    if (errorCode === "google-not-configured") setError("Google sign-in is not configured on this deployment yet. Use email and password for now.");
    else if (errorCode === "google-auth-failed") setError("Google sign-in could not be completed. Please try again.");
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const response = await fetch("/v1/auth/login", {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Sign-in failed.");
      router.replace("/app");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not sign in."); }
    finally { setBusy(false); }
  }

  return <main className="auth-page"><a className="brand auth-brand" href="/"><span className="brand-mark">C</span><span>CloudRoute</span></a>
    <section className="auth-card"><p className="eyebrow">WELCOME BACK</p><h1>Sign in to your workspace.</h1><p className="auth-subtitle">One clear view of your cloud landscape.</p>
      <form onSubmit={submit} className="auth-form">
        <label>Email address<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<input type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button auth-submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"} <span aria-hidden="true">→</span></button>
      </form>
      <div className="auth-divider"><span>or</span></div>
      <a className="google-button" href="/v1/auth/google"><span aria-hidden="true">G</span> Continue with Google</a>
      <p className="auth-switch">New to CloudRoute? <a href="/signup">Create an account</a></p>
    </section><p className="auth-footnote">Your cloud credentials are never requested as long-lived AWS access keys.</p>
  </main>;
}
