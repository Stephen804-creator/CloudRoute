"use client";

import { useEffect, useState } from "react";

interface CostSummary {
  totals: Array<{ provider: string; currency: string; month_to_date: string; previous_month: string }>;
  daily: Array<{ date: string; provider: string; currency: string; amount: string }>;
  freshness: Array<{ provider: string; last_success_at: string | null; last_status: string | null }>;
  windowDays: number;
  note: string;
}
interface Breakdown { groupBy: string; rows: Array<{ label: string; provider: string; currency: string; amount: string }> }
const money = (value: string | number, currency: string) => new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value || 0));
const pretty = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function CostsPage() {
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [groupBy, setGroupBy] = useState("provider");
  const [days, setDays] = useState("90");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    Promise.all([
      fetch("/v1/costs/summary?days=" + days, { credentials: "include", cache: "no-store" }).then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b.error?.message ?? "Could not load costs."); return b as CostSummary; }),
      fetch("/v1/costs/breakdown?group_by=" + groupBy + "&days=" + days, { credentials: "include", cache: "no-store" }).then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b.error?.message ?? "Could not load breakdown."); return b as Breakdown; }),
    ]).then(([s, b]) => { if (active) { setSummary(s); setBreakdown(b); } })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : "Could not load cost data."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [days, groupBy]);

  const currencies = [...new Set(summary?.totals.map((item) => item.currency.trim()) ?? [])];
  const monthTotal = summary?.totals.reduce((sum, item) => sum + Number(item.month_to_date), 0) ?? 0;
  const previousTotal = summary?.totals.reduce((sum, item) => sum + Number(item.previous_month), 0) ?? 0;

  return <div className="page-content">
    <header className="page-header"><div><p className="eyebrow">CLOUD SPEND</p><h1>Cost explorer</h1><p>Understand reported spend across connected cloud providers.</p></div>
      <label className="inline-select">Time window<select value={days} onChange={(e) => setDays(e.target.value)}><option value="30">Last 30 days</option><option value="90">Last 3 months</option><option value="180">Last 6 months</option><option value="365">Last 12 months</option></select></label>
    </header>
    {error && <div className="inline-alert" role="alert">{error}</div>}
    <section className="metric-grid" aria-label="Cost metrics">
      <article className="metric-card"><span className="metric-label">Month to date</span><strong>{loading ? "—" : currencies.length > 1 ? "Multiple" : money(monthTotal, currencies[0] || "USD")}</strong><span className="metric-foot">Reported billing records only</span></article>
      <article className="metric-card"><span className="metric-label">Previous month</span><strong>{loading ? "—" : currencies.length > 1 ? "Multiple" : money(previousTotal, currencies[0] || "USD")}</strong><span className="metric-foot">Compared with current month</span></article>
      <article className="metric-card"><span className="metric-label">Providers reporting</span><strong>{loading ? "—" : new Set(summary?.totals.map((x) => x.provider) ?? []).size}</strong><span className="metric-foot">Providers with cost records</span></article>
      <article className="metric-card"><span className="metric-label">History window</span><strong>{days} days</strong><span className="metric-foot">Billing records available in CloudRoute</span></article>
    </section>
    <div className="inline-alert cost-note" role="note">{summary?.note ?? "Cost records appear after billing ingestion is configured. CloudRoute does not fabricate cost totals."}</div>
    <section className="content-panel">
      <div className="panel-heading"><div><h2>Spend breakdown</h2><p>Grouped by provider, service, or connected account.</p></div>
        <label className="inline-select">Group by<select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}><option value="provider">Provider</option><option value="service">Service</option><option value="account">Account</option></select></label>
      </div>
      {!loading && !breakdown?.rows.length ? <div className="empty-state compact-empty"><span className="empty-symbol">$</span><h3>No cost records yet</h3><p>Inventory can work without billing access. Configure the provider's read-only cost permissions or billing export to populate this view.</p><a className="text-link" href="/app/accounts">Review cloud connections →</a></div> : <div className="table-scroll"><table className="inventory-table"><thead><tr><th>{pretty(groupBy)}</th><th>Provider</th><th>Currency</th><th>Reported spend</th></tr></thead><tbody>{(breakdown?.rows ?? []).map((row, index) => <tr key={row.label + row.provider + row.currency + index}><td><strong>{row.label}</strong></td><td>{row.provider.toUpperCase()}</td><td>{row.currency}</td><td><strong>{money(row.amount, row.currency.trim())}</strong></td></tr>)}</tbody></table></div>}
    </section>
    <section className="content-panel"><div className="panel-heading"><div><h2>Cost data freshness</h2><p>Last successful cost sync per provider.</p></div></div>
      {!summary?.freshness.length ? <p className="empty-copy">Connect a provider to track billing freshness.</p> : <div className="account-list">{summary.freshness.map((item) => <div className="account-row" key={item.provider}><span className={"provider-icon " + item.provider}>{item.provider === "aws" ? "A" : "G"}</span><div className="account-main"><strong>{item.provider === "aws" ? "Amazon Web Services" : "Google Cloud"}</strong><small>{item.last_success_at ? "Last cost sync " + new Date(item.last_success_at).toLocaleString() : "No successful cost sync yet"}</small></div><span className={"status-pill " + (item.last_status ?? "pending")}>{pretty(item.last_status ?? "not synced")}</span></div>)}</div>}
    </section>
  </div>;
}
