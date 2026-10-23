"use client";

import { useEffect, useState } from "react";

interface Overview {
  resources: Array<{ provider: string; resource_type: string; count: number }>;
  accounts: Array<{ id: string; provider: string; name: string; status: string; lastSyncAt: string | null; lastSyncStatus: string | null }>;
  findings: Array<{ id: string; title: string; severity: string; estimatedMonthlySaving: string | null; currency: string | null }>;
  recentSyncRuns: Array<{ id: string; status: string; jobType: string; startedAt: string | null; finishedAt: string | null; errorCode: string | null }>;
  generatedAt: string;
}

function nice(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function relativeDate(value: string | null) {
  if (!value) return "Not synced yet";
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return minutes + "m ago";
  if (minutes < 1440) return Math.floor(minutes / 60) + "h ago";
  return Math.floor(minutes / 1440) + "d ago";
}

export default function OverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("/v1/overview", { credentials: "include", cache: "no-store" })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "Could not load overview."); return body as Overview; })
      .then(setData).catch((err) => setError(err instanceof Error ? err.message : "Could not load overview."))
      .finally(() => setLoading(false));
  }, []);

  const resourceCount = data?.resources.reduce((total, item) => total + item.count, 0) ?? 0;
  const connectedCount = data?.accounts.filter((item) => item.status === "connected").length ?? 0;
  const degradedCount = data?.accounts.filter((item) => item.status === "degraded" || item.status === "error").length ?? 0;

  return <div className="page-content">
    <header className="page-header"><div><p className="eyebrow">WORKSPACE OVERVIEW</p><h1>Good to see you.</h1><p>Here is the current picture of your cloud environment.</p></div><a className="primary-button" href="/app/accounts">Connect a cloud <span aria-hidden="true">+</span></a></header>
    {error && <div className="inline-alert" role="alert">{error}</div>}
    <section className="metric-grid" aria-label="Cloud overview metrics">
      <article className="metric-card"><span className="metric-label">Tracked resources</span><strong>{loading ? "—" : resourceCount.toLocaleString()}</strong><span className="metric-foot">{loading ? "Loading" : "Across connected accounts"}</span></article>
      <article className="metric-card"><span className="metric-label">Connected accounts</span><strong>{loading ? "—" : connectedCount}</strong><span className="metric-foot">{degradedCount ? degradedCount + " need attention" : "Connection health"}</span></article>
      <article className="metric-card"><span className="metric-label">Open findings</span><strong>{loading ? "—" : data?.findings.length ?? 0}</strong><span className="metric-foot">Potential savings signals</span></article>
      <article className="metric-card"><span className="metric-label">Inventory freshness</span><strong className="metric-word">{loading ? "—" : data?.accounts.some((a) => a.lastSyncAt) ? "Tracked" : "Waiting"}</strong><span className="metric-foot">Last successful sync shown below</span></article>
    </section>

    <section className="content-panel">
      <div className="panel-heading"><div><h2>Cloud accounts</h2><p>Connection state and latest synchronization.</p></div><a className="text-link" href="/app/accounts">Manage accounts →</a></div>
      {loading ? <p className="empty-copy">Loading account status…</p> : !data?.accounts.length ? <div className="empty-state"><span className="empty-symbol">⌘</span><h3>Your cloud view starts here.</h3><p>Connect an AWS account using a read-only role. CloudRoute will collect resource metadata only.</p><a className="primary-button" href="/app/accounts">Connect AWS account <span aria-hidden="true">→</span></a></div> : <div className="account-list">{data.accounts.map((account) => <div className="account-row" key={account.id}><span className={"provider-icon " + account.provider}>{account.provider === "aws" ? "A" : "G"}</span><div className="account-main"><strong>{account.name}</strong><small>{account.provider.toUpperCase()} · {account.lastSyncAt ? "Last sync " + relativeDate(account.lastSyncAt) : "No inventory yet"}</small></div><span className={"status-pill " + account.status}>{nice(account.status)}</span></div>)}</div>}
    </section>

    <div className="lower-grid">
      <section className="content-panel"><div className="panel-heading"><div><h2>Inventory by type</h2><p>Resources seen in completed or partial syncs.</p></div><a className="text-link" href="/app/inventory">View inventory →</a></div>
        {!data?.resources.length ? <p className="empty-copy">Resource counts will appear after the first successful inventory sync.</p> : <div className="breakdown-list">{data.resources.map((item) => <div className="breakdown-row" key={item.provider + item.resource_type}><span>{nice(item.resource_type)} <small>{item.provider.toUpperCase()}</small></span><strong>{item.count}</strong></div>)}</div>}
      </section>
      <section className="content-panel"><div className="panel-heading"><div><h2>Recent sync runs</h2><p>Partial runs never mark resources as deleted.</p></div></div>
        {!data?.recentSyncRuns.length ? <p className="empty-copy">No sync activity yet.</p> : <div className="sync-list">{data.recentSyncRuns.slice(0, 5).map((run) => <div className="sync-row" key={run.id}><span className={"sync-indicator " + run.status} /><div><strong>{nice(run.jobType)}</strong><small>{run.startedAt ? relativeDate(run.startedAt) : "Queued"}</small></div><span className={"status-pill " + run.status}>{nice(run.status)}</span></div>)}</div>}
      </section>
    </div>
    <p className="data-footnote">Data is shown as returned by connected providers. This overview does not invent cost estimates or claim that missing resources were deleted after an incomplete sync.</p>
  </div>;
}
