"use client";

import { useEffect, useState, type FormEvent } from "react";

interface Account { id: string; provider: string; displayName: string; accountId: string; roleArn?: string | null; serviceAccountEmail?: string | null; status: string; permissionStatus: string; lastSyncAt: string | null; lastSyncStatus: string | null }
interface Setup { configured: boolean; principalArn: string | null }
interface AccountResponse { account: Account; externalId: string; nextStep: string }\ninterface GcpSetupResponse { account: Account; nextStep: string }

export default function AccountsPage() {
  const [accountId, setAccountId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [roleArn, setRoleArn] = useState("");\n  const [gcpProjectId, setGcpProjectId] = useState("");\n  const [gcpServiceAccountEmail, setGcpServiceAccountEmail] = useState("");\n  const [gcpSetup, setGcpSetup] = useState<GcpSetupResponse | null>(null);
  const [created, setCreated] = useState<AccountResponse | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [setup, setSetup] = useState<Setup>({ configured: false, principalArn: null });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function api(path: string, method = "GET", body?: unknown) {
    const response = await fetch(path, { method, credentials: "include", headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    const data = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(data?.error?.message ?? "Request failed.");
    return data;
  }
  async function refresh() {
    try {
      const [accountData, setupData] = await Promise.all([api("/v1/accounts"), api("/v1/security/aws-setup")]);
      setAccounts(accountData.accounts); setSetup(setupData);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not load accounts."); }
  }
  useEffect(() => { void refresh(); }, []);

  async function createAccount(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const data = await api("/v1/accounts/aws", "POST", { accountId, displayName: displayName || undefined });
      setCreated(data); setRoleArn(""); setNotice("Connection draft created. Configure the read-only IAM role before validating.");
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not start AWS connection."); }
    finally { setBusy(false); }
  }
  async function createGcpAccount(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const data = await api("/v1/accounts/gcp", "POST", {
        projectId: gcpProjectId.trim(),
        serviceAccountEmail: gcpServiceAccountEmail.trim(),
      });
      setGcpSetup(data);
      setNotice(data.nextStep);
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not start Google Cloud connection."); }
    finally { setBusy(false); }
  }

  async function saveRole(event: FormEvent) {
    event.preventDefault(); if (!created) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api("/v1/accounts/" + created.account.id + "/role", "POST", { roleArn });
      setNotice("Role ARN saved. Validate the connection when the AWS trust policy and read-only policy are in place.");
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save the role."); }
    finally { setBusy(false); }
  }
  async function resumeSetup(id: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await api("/v1/accounts/" + id + "/setup");
      setCreated(data); setAccountId(data.account.accountId); setDisplayName(data.account.displayName); setRoleArn(data.account.roleArn ?? "");
      setNotice("AWS setup restored. Continue with the external ID and role trust policy.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) { setError(err instanceof Error ? err.message : "Could not resume setup."); }
    finally { setBusy(false); }
  }

  async function validate(id: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await api("/v1/accounts/" + id + "/validate", "POST");
      setNotice(data.message ?? "AWS connection validated.");
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Connection validation failed."); await refresh(); }
    finally { setBusy(false); }
  }
  async function disconnect(id: string) {
    if (!window.confirm("Disconnect this AWS account? CloudRoute will stop future syncs. This does not change anything in AWS.")) return;
    setError(""); setNotice("");
    try { await api("/v1/accounts/" + id, "DELETE"); setNotice("Account disconnected. No AWS resources were changed."); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not disconnect account."); }
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setNotice("Copied to clipboard."); }
    catch { setNotice("Copy is unavailable in this browser. Select and copy the value manually."); }
  }
  const trustPolicy = created ? JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
      Sid: "CloudRouteReadOnlyAssumeRole",
      Effect: "Allow",
      Principal: { AWS: setup.principalArn ?? "<CLOUDROUTE_AWS_PRINCIPAL_ARN_CONFIGURE_DURING_DEPLOYMENT>" },
      Action: "sts:AssumeRole",
      Condition: { StringEquals: { "sts:ExternalId": created.externalId } },
    }],
  }, null, 2) : "";

  return <div className="page-content">
    <header className="page-header"><div><p className="eyebrow">CLOUD CONNECTIONS</p><h1>Cloud accounts</h1><p>Connect provider accounts with narrowly scoped, read-only permissions.</p></div><span className="mode-badge"><span /> No cloud write actions</span></header>
    {error && <div className="inline-alert" role="alert">{error}</div>}
    {notice && <div className="inline-success" role="status">{notice}</div>}
    <div className="connection-layout">
      <section className="content-panel connection-panel"><div className="panel-heading"><div><h2>Connect AWS</h2><p>Use a customer-created IAM role. Do not upload access keys.</p></div><span className="provider-icon aws">A</span></div>
        {!created ? <form className="auth-form connection-form" onSubmit={createAccount}>
          <label>AWS account ID<input inputMode="numeric" pattern="[0-9]{12}" maxLength={12} minLength={12} required value={accountId} onChange={(event) => setAccountId(event.target.value)} placeholder="12-digit account ID" /></label>
          <label>Display name <span className="optional">(optional)</span><input maxLength={120} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Production account" /></label>
          <button className="primary-button auth-submit" disabled={busy}>{busy ? "Preparing…" : "Start connection"} <span aria-hidden="true">→</span></button>
        </form> : <div className="setup-steps">
          <div className="step-row"><span className="step-number">1</span><div><h3>Copy the external ID</h3><p>This unique value prevents confused-deputy role assumptions. Add it to the IAM role trust policy.</p><div className="copy-field"><code>{created.externalId}</code><button className="secondary-button" type="button" onClick={() => void copy(created.externalId)}>Copy</button></div></div></div>
          <div className="step-row"><span className="step-number">2</span><div><h3>Configure the role trust</h3><p>Use the configured CloudRoute runtime principal and the external ID above. Never substitute a public or unrelated principal.</p>{!setup.configured && <div className="inline-alert small-alert">The CloudRoute AWS principal is not configured yet. This is expected before deployment. Set CLOUDROUTE_AWS_PRINCIPAL_ARN in the hosting environment before connecting a live account.</div>}<pre className="code-panel">{trustPolicy}</pre><button className="secondary-button" type="button" onClick={() => void copy(trustPolicy)}>Copy trust policy</button><p className="field-help">Read-only permissions: <a href="https://github.com/Stephen804-creator/CloudRoute/blob/main/docs/security/aws-read-only-policy.json" target="_blank" rel="noreferrer">view exact policy</a>.</p></div></div>
          <div className="step-row"><span className="step-number">3</span><div><h3>Save the role ARN</h3><p>After creating the IAM role in AWS, enter its ARN here.</p><form className="auth-form role-form" onSubmit={saveRole}><label>IAM role ARN<input required value={roleArn} onChange={(event) => setRoleArn(event.target.value)} placeholder={"arn:aws:iam::" + created.account.accountId + ":role/CloudRouteReadOnly"} /></label><button className="primary-button" disabled={busy}>Save role <span aria-hidden="true">→</span></button></form></div></div>
          <div className="step-row"><span className="step-number">4</span><div><h3>Validate and sync</h3><p>CloudRoute checks STS role assumption before scheduling the first inventory scan.</p><button className="primary-button" disabled={busy || !setup.configured || !roleArn.trim()} onClick={() => void validate(created.account.id)}>Validate connection <span aria-hidden="true">→</span></button><button className="text-button" type="button" onClick={() => { setCreated(null); setAccountId(""); setDisplayName(""); }}>Cancel setup</button></div></div>
        </div>}
      </section>
      <section className="content-panel connection-panel"><div className="panel-heading"><div><h2>Connect Google Cloud</h2><p>Use service-account impersonation. Do not upload service-account keys.</p></div><span className="provider-icon gcp">G</span></div>
        {!gcpSetup ? <form className="auth-form connection-form" onSubmit={createGcpAccount}>
          <label>Google Cloud project ID<input required minLength={6} maxLength={30} pattern="[a-z][a-z0-9-]{4,28}[a-z0-9]" value={gcpProjectId} onChange={(event) => setGcpProjectId(event.target.value)} placeholder="my-production-project" /></label>
          <label>Read-only service-account email<input required type="email" pattern="[^\s@]+@[^\s@]+\.iam\.gserviceaccount\\.com" value={gcpServiceAccountEmail} onChange={(event) => setGcpServiceAccountEmail(event.target.value)} placeholder="cloudroute-reader@project.iam.gserviceaccount.com" /></label>
          <button className="primary-button auth-submit" disabled={busy}>{busy ? "Preparing…" : "Start Google Cloud connection"} <span aria-hidden="true">→</span></button>
        </form> : <div className="setup-steps">
          <div className="step-row"><span className="step-number">1</span><div><h3>Configure Google Cloud permissions</h3><p>Enable the Cloud Asset API in the target project. Grant the target service account <code>roles/cloudasset.viewer</code> on that project. Grant the CloudRoute runtime identity <code>roles/iam.serviceAccountTokenCreator</code> on this service account. No service-account key is uploaded or stored.</p><p className="field-help">Project: <code>{gcpSetup.account.accountId}</code><br />Service account: <code>{gcpSetup.account.serviceAccountEmail}</code></p><p className="field-help"><a href="https://cloud.google.com/asset-inventory/docs" target="_blank" rel="noreferrer">Cloud Asset Inventory documentation</a></p></div></div>
          <div className="step-row"><span className="step-number">2</span><div><h3>Validate and sync</h3><p>CloudRoute requests a short-lived impersonated access token and makes read-only inventory requests.</p><button className="primary-button" disabled={busy} onClick={() => void validate(gcpSetup.account.id)}>Validate Google Cloud connection <span aria-hidden="true">→</span></button><button className="text-button" type="button" onClick={() => setGcpSetup(null)}>Close setup</button></div></div>
        </div>}
      </section>
      <aside className="content-panel permission-panel"><p className="eyebrow">PERMISSION PROMISE</p><h2>Observe, never operate.</h2><p>CloudRoute's MVP reads resource metadata only. It does not create, modify, or delete resources.</p><ul><li>Cross-account IAM role with an external ID</li><li>Temporary STS credentials only</li><li>No long-lived AWS keys accepted</li><li>No bucket contents, database contents, disk contents, or Lambda environment values collected</li><li>Partial syncs never mark resources deleted</li></ul><a className="text-link" href="https://github.com/Stephen804-creator/CloudRoute/blob/main/docs/security/SECURITY.md" target="_blank" rel="noreferrer">Read security baseline →</a></aside>
    </div>

    <section className="content-panel accounts-table-panel"><div className="panel-heading"><div><h2>Connected accounts</h2><p>Current state, permission validation, and sync status.</p></div><span className="count-chip">{accounts.length}</span></div>
      {!accounts.length ? <p className="empty-copy">No cloud accounts connected yet. Your workspace remains empty until a real provider connection is validated.</p> : <div className="account-list">{accounts.map((account) => <div className="account-row account-manage-row" key={account.id}><span className={"provider-icon " + account.provider}>{account.provider === "aws" ? "A" : "G"}</span><div className="account-main"><strong>{account.displayName}</strong><small>{account.provider.toUpperCase()} · {account.accountId} · Permission: {account.permissionStatus.replaceAll("_", " ")}</small><small>{account.lastSyncAt ? "Last sync " + new Date(account.lastSyncAt).toLocaleString() : "Inventory has not synced yet"}</small></div><span className={"status-pill " + account.status}>{account.status}</span><div className="account-actions">{account.provider === "aws" && account.permissionStatus !== "valid" && <button className="secondary-button" disabled={busy} onClick={() => void resumeSetup(account.id)}>Continue setup</button>}<button className="secondary-button" disabled={busy} onClick={() => void validate(account.id)}>Validate / sync</button><button className="text-button danger-text" onClick={() => void disconnect(account.id)}>Disconnect</button></div></div>)}</div>}
    </section>
    <p className="data-footnote">Google Cloud access uses short-lived service-account impersonation. No service-account key files are accepted.</p>
  </div>;
}
