"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

interface Resource {
  id: string; provider: string; externalId: string; resourceType: string; displayName: string | null;
  region: string | null; status: string | null; migrationLabel: string; lastSeenAt: string;
  accountName: string; accountId: string;
}
interface InventoryResponse { resources: Resource[]; page: { limit: number; hasMore: boolean; nextCursor: string | null } }
interface ResourceDetail { resource: Record<string, unknown> }
interface HistoryResponse { history: Array<{ id: string; changeType: string; changedFields: string[]; snapshot: Record<string, unknown>; observedAt: string }> }
const labels = ["unclassified", "retain", "migrate", "retire", "review"];
const pretty = (value: string | null) => value ? value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "—";

export default function InventoryPage() {
  const [items, setItems] = useState<Resource[]>([]);
  const [provider, setProvider] = useState("");
  const [type, setType] = useState("");
  const [region, setRegion] = useState("");
  const [migrationLabel, setMigrationLabel] = useState("");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [history, setHistory] = useState<HistoryResponse["history"]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async (nextCursor?: string | null) => {
    setLoading(true); setError("");
    const params = new URLSearchParams({ limit: "50" });
    if (provider) params.set("provider", provider);
    if (type) params.set("type", type);
    if (region) params.set("region", region);
    if (migrationLabel) params.set("migrationLabel", migrationLabel);
    if (search.trim()) params.set("q", search.trim());
    if (nextCursor) params.set("cursor", nextCursor);
    try {
      const response = await fetch("/v1/resources?" + params.toString(), { credentials: "include", cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not load inventory.");
      const result = body as InventoryResponse;
      setItems((previous) => nextCursor ? [...previous, ...result.resources] : result.resources);
      setCursor(result.page.nextCursor); setHasMore(result.page.hasMore);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not load inventory."); }
    finally { setLoading(false); }
  }, [provider, type, region, migrationLabel, search]);

  useEffect(() => { void load(null); }, [load]);

  async function openDetails(item: Resource) {
    if (selectedId === item.id) { setSelectedId(""); setDetail(null); setHistory([]); return; }
    setSelectedId(item.id); setDetail(null); setHistory([]); setDetailLoading(true); setError("");
    try {
      const [resourceResponse, historyResponse] = await Promise.all([
        fetch("/v1/resources/" + item.id, { credentials: "include", cache: "no-store" }),
        fetch("/v1/resources/" + item.id + "/history", { credentials: "include", cache: "no-store" }),
      ]);
      const resourceBody = await resourceResponse.json();
      const historyBody = await historyResponse.json();
      if (!resourceResponse.ok) throw new Error(resourceBody.error?.message ?? "Could not load resource details.");
      if (!historyResponse.ok) throw new Error(historyBody.error?.message ?? "Could not load resource history.");
      setDetail((resourceBody as ResourceDetail).resource);
      setHistory((historyBody as HistoryResponse).history);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not load resource details."); }
    finally { setDetailLoading(false); }
  }

  async function updateLabel(id: string, label: string) {
    setError("");
    try {
      const response = await fetch("/v1/resources/" + id + "/migration-label", {
        method: "PATCH", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ migrationLabel: label }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not update label.");
      setItems((previous) => previous.map((item) => item.id === id ? { ...item, migrationLabel: label } : item));
    } catch (err) { setError(err instanceof Error ? err.message : "Could not update label."); }
  }

  function submit(event: FormEvent) { event.preventDefault(); void load(null); }

  return <div className="page-content">
    <header className="page-header"><div><p className="eyebrow">RESOURCE EXPLORER</p><h1>Cloud inventory</h1><p>Search and classify resources across connected cloud accounts.</p></div><a className="secondary-button" href="/v1/resources/export.csv">Export CSV <span aria-hidden="true">↓</span></a></header>
    <form className="filter-panel" onSubmit={submit}>
      <label className="search-field">Search resources<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or resource identifier" /></label>
      <label>Provider<select value={provider} onChange={(event) => setProvider(event.target.value)}><option value="">All providers</option><option value="aws">AWS</option><option value="gcp">Google Cloud</option></select></label>
      <label>Resource type<select value={type} onChange={(event) => setType(event.target.value)}><option value="">All types</option>{["compute_instance","block_volume","object_bucket","database","function","load_balancer","static_ip","snapshot"].map((value) => <option key={value} value={value}>{pretty(value)}</option>)}</select></label>
      <label>Region<input value={region} onChange={(event) => setRegion(event.target.value)} placeholder="e.g. us-east-1" /></label>
      <label>Migration label<select value={migrationLabel} onChange={(event) => setMigrationLabel(event.target.value)}><option value="">All labels</option>{labels.map((value) => <option key={value} value={value}>{pretty(value)}</option>)}</select></label>
      <button className="primary-button filter-button">Apply filters <span aria-hidden="true">→</span></button>
    </form>
    {error && <div className="inline-alert" role="alert">{error}</div>}
    <section className="content-panel inventory-panel">
      <div className="panel-heading"><div><h2>Resources <span className="count-chip">{items.length}{hasMore ? "+" : ""}</span></h2><p>Metadata only. Resource state may be stale; check last-seen timestamps.</p></div><span className="freshness-label"><span /> Freshness visible</span></div>
      {loading && !items.length ? <p className="empty-copy">Loading resources…</p> : !items.length ? <div className="empty-state compact-empty"><span className="empty-symbol">▦</span><h3>No resources to show yet.</h3><p>Connect and validate an AWS account, then wait for its first inventory sync. Filters may also be hiding results.</p><a className="text-link" href="/app/accounts">Manage cloud accounts →</a></div> : <div className="table-scroll"><table className="inventory-table"><thead><tr><th>Resource</th><th>Provider</th><th>Region</th><th>Status</th><th>Migration label</th><th>Last seen</th><th>Details</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.displayName || item.externalId}</strong><small>{pretty(item.resourceType)} · {item.accountName}</small><code>{item.externalId}</code></td><td><span className={"provider-badge " + item.provider}>{item.provider.toUpperCase()}</span></td><td>{item.region || "Global"}</td><td><span className="table-status">{pretty(item.status)}</span></td><td><select aria-label={"Migration label for " + (item.displayName || item.externalId)} className="label-select" value={item.migrationLabel} onChange={(event) => void updateLabel(item.id, event.target.value)}>{labels.map((value) => <option key={value} value={value}>{pretty(value)}</option>)}</select></td><td>{new Date(item.lastSeenAt).toLocaleString()}</td><td><button type="button" className="secondary-button details-button" aria-expanded={selectedId === item.id} onClick={() => void openDetails(item)}>{selectedId === item.id ? "Close" : "Details"}</button></td></tr>)}</tbody></table></div>}
      {selectedId && <section className="resource-detail-panel" aria-live="polite">
        <div className="panel-heading"><div><h2>Resource details</h2><p>Provider metadata and recorded state changes.</p></div><button type="button" className="secondary-button" onClick={() => { setSelectedId(""); setDetail(null); setHistory([]); }}>Close</button></div>
        {detailLoading ? <p className="empty-copy">Loading details and history…</p> : detail && <><h3>Normalized record</h3><pre className="detail-json">{JSON.stringify({ id: detail.id, provider: detail.provider, external_id: detail.external_id, resource_type: detail.resource_type, display_name: detail.display_name, region: detail.region, resource_status: detail.resource_status, tags: detail.tags, metadata: detail.metadata, migration_label: detail.migration_label, first_seen_at: detail.first_seen_at, last_seen_at: detail.last_seen_at }, null, 2)}</pre><h3>Change history</h3>{!history.length ? <p className="empty-copy">No meaningful changes recorded yet.</p> : <div className="history-list">{history.map((entry) => <div className="history-row" key={entry.id}><span className="status-pill">{pretty(entry.changeType)}</span><div><strong>{entry.changedFields.map(pretty).join(", ")}</strong><small>{new Date(entry.observedAt).toLocaleString()}</small></div><details><summary>Snapshot</summary><pre className="detail-json">{JSON.stringify(entry.snapshot, null, 2)}</pre></details></div>)}</div>}</>}
      </section>}
      {hasMore && <div className="pagination-row"><span>Showing {items.length} resources</span><button className="secondary-button" disabled={loading || !cursor} onClick={() => void load(cursor)}>Load more <span aria-hidden="true">↓</span></button></div>}
    </section>
    <p className="data-footnote">Migration labels classify your plan; they do not perform cloud actions. CloudRoute MVP cannot provision, modify, or delete cloud resources.</p>
  </div>;
}
