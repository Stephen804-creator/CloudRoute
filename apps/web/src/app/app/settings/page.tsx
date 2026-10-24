"use client";

import { useEffect, useState, type FormEvent } from "react";

interface Preferences { weeklyDigestEnabled: boolean; connectionFailureEnabled: boolean; updatedAt: string | null }
export default function SettingsPage() {
  const [preferences, setPreferences] = useState<Preferences>({ weeklyDigestEnabled: true, connectionFailureEnabled: true, updatedAt: null });
  const [weekly, setWeekly] = useState(true);
  const [failures, setFailures] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    fetch("/v1/notification-preferences", { credentials: "include", cache: "no-store" })
      .then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b.error?.message ?? "Could not load settings."); return b.preferences as Preferences; })
      .then((p) => { setPreferences(p); setWeekly(p.weeklyDigestEnabled); setFailures(p.connectionFailureEnabled); })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load settings."))
      .finally(() => setLoading(false));
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/v1/notification-preferences", { method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ weeklyDigestEnabled: weekly, connectionFailureEnabled: failures }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not save settings.");
      setPreferences(body.preferences); setNotice("Notification preferences saved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save settings."); }
    finally { setSaving(false); }
  }
  return <div className="page-content">
    <header className="page-header"><div><p className="eyebrow">WORKSPACE PREFERENCES</p><h1>Settings</h1><p>Control the email updates CloudRoute is allowed to send to your workspace owner.</p></div></header>
    {error && <div className="inline-alert" role="alert">{error}</div>}
    {notice && <div className="inline-success" role="status">{notice}</div>}
    <section className="content-panel settings-panel">
      <div className="panel-heading"><div><h2>Email notifications</h2><p>Notifications use the owner email on the organization. Delivery requires email provider configuration.</p></div></div>
      {loading ? <p className="empty-copy">Loading preferences…</p> : <form onSubmit={save} className="settings-form">
        <label className="preference-row"><span><strong>Weekly cloud digest</strong><small>Summary of month-to-date spend, top idle findings, and account health.</small></span><input type="checkbox" checked={weekly} onChange={(e) => setWeekly(e.target.checked)} /></label>
        <label className="preference-row"><span><strong>Connection failure alerts</strong><small>Notify the owner when a provider connection or inventory sync fails.</small></span><input type="checkbox" checked={failures} onChange={(e) => setFailures(e.target.checked)} /></label>
        <button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save preferences"} <span aria-hidden="true">→</span></button>
        {preferences.updatedAt && <p className="settings-updated">Last updated {new Date(preferences.updatedAt).toLocaleString()}.</p>}
      </form>}
    </section>
    <section className="content-panel settings-panel"><div className="panel-heading"><div><h2>Read-only safety</h2><p>CloudRoute is an observation and recommendation product.</p></div></div><p className="settings-copy">CloudRoute does not create, modify, start, stop, or delete customer cloud resources. Review a finding's evidence and your provider's console before making any changes yourself. Disconnecting an account affects CloudRoute's collection, not the resources in your cloud account.</p><a className="text-link" href="/security">Review security and permissions →</a></section>
  </div>;
}
