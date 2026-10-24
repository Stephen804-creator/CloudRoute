"use client";

import { useCallback, useEffect, useState } from "react";

interface Finding {
  id: string; ruleKey: string; severity: string; title: string; description: string;
  evidence: Record<string, unknown>; estimatedMonthlySaving: string | null; currency: string | null;
  status: string; snoozedUntil: string | null; firstDetectedAt: string; resourceName: string | null;
  resourceExternalId: string | null; provider: string | null; resourceType: string | null; region: string | null; accountName: string;
}
const pretty = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
export default function SavingsPage() {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [status, setStatus] = useState("open");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/v1/findings?status=" + status + "&limit=100", { credentials: "include", cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not load savings findings.");
      setFindings(body.findings as Finding[]);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load savings findings."); }
    finally { setLoading(false); }
  }, [status]);
  useEffect(() => { void load(); }, [load]);
  async function update(finding: Finding, nextStatus: "open" | "dismissed" | "snoozed") {
    setBusyId(finding.id); setError("");
    try {
      const response = await fetch("/v1/findings/" + finding.id, { method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: nextStatus, ...(nextStatus === "snoozed" ? { snoozeDays: 7 } : {}) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not update finding.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update finding."); }
    finally { setBusyId(""); }
  }
  return <div className="page-content">
    <header className="page-header"><div><p className="eyebrow">OPTIMIZATION OPPORTUNITIES</p><h1>Savings findings</h1><p>Evidence-based signals from resource metadata and explicitly available metrics.</p></div>
      <label className="inline-select">Finding status<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="open">Open</option><option value="snoozed">Snoozed</option><option value="dismissed">Dismissed</option><option value="resolved">Resolved</option><option value="all">All findings</option></select></label>
    </header>
    {error && <div className="inline-alert" role="alert">{error}</div>}
    <div className="inline-alert cost-note" role="note">Findings are recommendations, not commands. Estimated savings are left blank when CloudRoute has no reliable cost evidence. CloudRoute never changes provider resources.</div>
    {loading ? <section className="content-panel"><p className="empty-copy">Loading findings…</p></section> : !findings.length ? <section className="content-panel"><div className="empty-state"><span className="empty-symbol">✓</span><h3>No findings in this view</h3><p>Findings are evaluated after a complete inventory sync. Some rules require optional provider metrics and will not run without them.</p><a className="text-link" href="/app/accounts">Review account sync status →</a></div></section> : <div className="finding-list">{findings.map((finding) => <article className="content-panel finding-card" key={finding.id}>
      <div className="finding-top"><span className={"severity-pill " + finding.severity}>{pretty(finding.severity)}</span><span className={"provider-icon " + (finding.provider ?? "aws")}>{finding.provider === "gcp" ? "G" : "A"}</span><span className="finding-provider">{finding.provider?.toUpperCase() ?? "Provider"} · {pretty(finding.resourceType ?? "resource")}</span><span className={"status-pill " + finding.status}>{pretty(finding.status)}</span></div>
      <h2>{finding.title}</h2><p>{finding.description}</p>
      <div className="finding-resource"><strong>{finding.resourceName || finding.resourceExternalId || "Resource unavailable"}</strong><small>{finding.accountName}{finding.region ? " · " + finding.region : ""}</small></div>
      <details className="finding-evidence"><summary>View evidence</summary><pre>{JSON.stringify(finding.evidence, null, 2)}</pre></details>
      <div className="finding-bottom"><span>{finding.estimatedMonthlySaving && finding.currency ? "Potential monthly saving: " + new Intl.NumberFormat(undefined, { style: "currency", currency: finding.currency }).format(Number(finding.estimatedMonthlySaving)) : "Savings estimate unavailable"}</span><div className="finding-actions">{finding.status !== "open" && <button className="secondary-button" disabled={busyId === finding.id} onClick={() => void update(finding, "open")}>Reopen</button>}{finding.status === "open" && <><button className="secondary-button" disabled={busyId === finding.id} onClick={() => void update(finding, "snoozed")}>Snooze 7 days</button><button className="secondary-button" disabled={busyId === finding.id} onClick={() => void update(finding, "dismissed")}>Dismiss</button></>}</div></div>
    </article>)}</div>}
  </div>;
}
