import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { CostExplorerClient, GetCostAndUsageCommand } from "@aws-sdk/client-cost-explorer";
import { getImpersonatedAccessToken } from "@cloudroute/connector-gcp";
import { getPool, withOrgTransaction } from "@cloudroute/db";
import { queueConnectionFailure } from "./notifications.js";

interface CostJob { syncRunId: string; orgId: string; accountId: string }
interface CostRecord { date: string; service: string; currency: string; amount: string; region?: string | null }
interface Account {
  id: string; provider: string; external_account_id: string; role_arn: string | null; external_id: string | null;
  gcp_service_account_email: string | null; gcp_billing_project_id: string | null; gcp_billing_dataset: string | null; gcp_billing_table: string | null;
}
function dateString(date: Date): string { return date.toISOString().slice(0, 10); }
function dateMinus(days: number): Date { const date = new Date(); date.setUTCDate(date.getUTCDate() - days); return date; }
function validIdentifier(value: string | null): value is string { return Boolean(value && /^[A-Za-z0-9_-]{1,1024}$/.test(value)); }

async function fetchAwsCosts(account: Account): Promise<CostRecord[]> {
  if (!account.role_arn || !account.external_id) throw new Error("AWS_COST_ROLE_NOT_CONFIGURED");
  const sts = new STSClient({ region: process.env.AWS_STS_REGION ?? "us-east-1" });
  let credentials;
  try {
    const assumed = await sts.send(new AssumeRoleCommand({
      RoleArn: account.role_arn, ExternalId: account.external_id,
      RoleSessionName: "CloudRouteCostSync", DurationSeconds: 900,
    }));
    if (!assumed.Credentials?.AccessKeyId || !assumed.Credentials.SecretAccessKey || !assumed.Credentials.SessionToken) throw new Error("ASSUME_ROLE_FAILED");
    credentials = {
      accessKeyId: assumed.Credentials.AccessKeyId,
      secretAccessKey: assumed.Credentials.SecretAccessKey,
      sessionToken: assumed.Credentials.SessionToken,
    };
  } finally { sts.destroy(); }
  const client = new CostExplorerClient({ region: "us-east-1", credentials });
  try {
    const end = new Date(); end.setUTCHours(0, 0, 0, 0);
    const start = dateMinus(90); start.setUTCHours(0, 0, 0, 0);
    const response = await client.send(new GetCostAndUsageCommand({
      TimePeriod: { Start: dateString(start), End: dateString(end) },
      Granularity: "DAILY",
      Metrics: ["UnblendedCost"],
      GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }],
    }));
    const rows: CostRecord[] = [];
    for (const period of response.ResultsByTime ?? []) {
      const date = period.TimePeriod?.Start;
      if (!date) continue;
      for (const group of period.Groups ?? []) {
        const amount = group.Metrics?.UnblendedCost?.Amount;
        const currency = group.Metrics?.UnblendedCost?.Unit;
        if (typeof amount !== "string" || !currency) continue;
        rows.push({ date, service: group.Keys?.[0] ?? "Unknown service", currency, amount });
      }
    }
    return rows;
  } finally { client.destroy(); }
}

async function fetchGcpCosts(account: Account): Promise<CostRecord[]> {
  const serviceEmail = account.gcp_service_account_email;
  const billingProject = account.gcp_billing_project_id;
  const dataset = account.gcp_billing_dataset;
  const table = account.gcp_billing_table;
  if (!serviceEmail || !validIdentifier(billingProject) || !validIdentifier(dataset) || !validIdentifier(table)) {
    throw new Error("GCP_BILLING_EXPORT_NOT_CONFIGURED");
  }
  const token = await getImpersonatedAccessToken(serviceEmail, "https://www.googleapis.com/auth/bigquery.readonly");
  const end = new Date(); end.setUTCHours(0, 0, 0, 0);
  const start = dateMinus(90); start.setUTCHours(0, 0, 0, 0);
  const query = "SELECT DATE(usage_start_time) AS usage_date, service.description AS service, currency, " +
    "SUM(cost + IFNULL((SELECT SUM(credit.amount) FROM UNNEST(credits) AS credit), 0)) AS amount " +
    "FROM `" + billingProject + "." + dataset + "." + table + "` " +
    "WHERE usage_start_time >= TIMESTAMP(@startDate) AND usage_start_time < TIMESTAMP(@endDate) " +
    "GROUP BY usage_date, service, currency ORDER BY usage_date";
  const base = "https://bigquery.googleapis.com/bigquery/v2/projects/" + encodeURIComponent(billingProject);
  const response = await fetch(base + "/queries", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      query, useLegacySql: false, timeoutMs: 20000, maxResults: 1000,
      parameterMode: "NAMED",
      queryParameters: [
        { name: "startDate", parameterType: { type: "STRING" }, parameterValue: { value: dateString(start) } },
        { name: "endDate", parameterType: { type: "STRING" }, parameterValue: { value: dateString(end) } },
      ],
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("GCP_BILLING_PERMISSION_DENIED");
    throw new Error(response.status === 404 ? "GCP_BILLING_EXPORT_NOT_FOUND" : "GCP_BILLING_QUERY_FAILED");
  }
  let page = await response.json() as { jobComplete?: boolean; jobReference?: { projectId?: string; jobId?: string; location?: string }; schema?: { fields?: Array<{ name: string }> }; rows?: Array<{ f: Array<{ v: string | null }> }>; pageToken?: string; errors?: Array<{ reason?: string }> };
  const deadline = Date.now() + 20_000;
  while (!page.jobComplete && page.jobReference?.jobId && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const poll = new URL(base + "/queries/" + encodeURIComponent(page.jobReference.jobId));
    if (page.jobReference.location) poll.searchParams.set("location", page.jobReference.location);
    const polled = await fetch(poll, { headers: { authorization: "Bearer " + token, accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!polled.ok) throw new Error("GCP_BILLING_QUERY_FAILED");
    page = await polled.json() as typeof page;
  }
  if (!page.jobComplete || page.errors?.length) throw new Error("GCP_BILLING_QUERY_INCOMPLETE");
  const fields = (page.schema?.fields ?? []).map((field) => field.name);
  const rows: CostRecord[] = [];
  const append = (resultRows: Array<{ f: Array<{ v: string | null }> }> | undefined) => {
    for (const row of resultRows ?? []) {
      const values = Object.fromEntries(fields.map((name, index) => [name, row.f[index]?.v ?? null]));
      if (typeof values.usage_date === "string" && typeof values.service === "string" && typeof values.currency === "string" && typeof values.amount === "string") {
        rows.push({ date: values.usage_date, service: values.service, currency: values.currency, amount: values.amount });
      }
    }
  };
  append(page.rows);
  let pageToken = page.pageToken;
  while (pageToken) {
    const next = new URL(base + "/queries/" + encodeURIComponent(page.jobReference?.jobId ?? ""));
    if (page.jobReference?.location) next.searchParams.set("location", page.jobReference.location); next.searchParams.set("pageToken", pageToken); next.searchParams.set("maxResults", "1000");
    const nextResponse = await fetch(next, { headers: { authorization: "Bearer " + token, accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!nextResponse.ok) throw new Error("GCP_BILLING_QUERY_FAILED");
    const nextPage = await nextResponse.json() as typeof page;
    append(nextPage.rows); pageToken = nextPage.pageToken;
  }
  return rows;
}

export async function processCostSync(job: CostJob): Promise<void> {
  const claimed = await withOrgTransaction(job.orgId, (client) => client.query(
    "UPDATE sync_runs SET status='running',started_at=now(),finished_at=NULL,error_code=NULL,error_message=NULL " +
    "WHERE id=$1 AND org_id=$2 AND cloud_account_id=$3 AND job_type='cost_sync' AND status IN ('queued','failed') RETURNING id",
    [job.syncRunId, job.orgId, job.accountId],
  ));
  if (!claimed.rows[0]) return;
  try {
    const result = await withOrgTransaction(job.orgId, (client) => client.query(
      "SELECT id,provider,external_account_id,role_arn,external_id,gcp_service_account_email,gcp_billing_project_id,gcp_billing_dataset,gcp_billing_table " +
      "FROM cloud_accounts WHERE id=$1 AND org_id=$2 AND disconnected_at IS NULL",
      [job.accountId, job.orgId],
    ));
    const account = result.rows[0] as Account | undefined;
    if (!account) throw new Error("ACCOUNT_UNAVAILABLE");
    const rows = account.provider === "aws" ? await fetchAwsCosts(account) : account.provider === "gcp" ? await fetchGcpCosts(account) : (() => { throw new Error("UNSUPPORTED_PROVIDER"); })();
    await withOrgTransaction(job.orgId, async (client) => {
      for (const row of rows) {
        const day = row.date.slice(0, 10);
        const next = new Date(day + "T00:00:00.000Z"); next.setUTCDate(next.getUTCDate() + 1);
        await client.query(
          "INSERT INTO cost_records(org_id,cloud_account_id,provider,period_start,period_end,service,region,amount,currency,attribution,source_updated_at) " +
          "VALUES ($1,$2,$3,$4::date,$5::date,$6,$7,$8::numeric,$9,'provider_reported',now()) " +
          "ON CONFLICT (cloud_account_id,period_start,period_end,service,region,currency) DO UPDATE SET amount=EXCLUDED.amount,attribution='provider_reported',source_updated_at=now()",
          [job.orgId, account.id, account.provider, day, dateString(next), row.service.slice(0, 240), row.region ?? "", row.amount, row.currency.slice(0, 3)],
        );
      }
      await client.query("UPDATE sync_runs SET status='succeeded',finished_at=now(),resources_seen=$3,is_complete=true WHERE id=$1 AND org_id=$2", [job.syncRunId, job.orgId, rows.length]);
      await client.query("UPDATE cloud_accounts SET last_cost_sync_at=now(),last_cost_sync_status='succeeded',updated_at=now() WHERE id=$1 AND org_id=$2", [account.id, job.orgId]);
    });
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_:-]{1,80}$/.test(error.message) ? error.message : "COST_SYNC_FAILED";
    await withOrgTransaction(job.orgId, async (client) => {
      await client.query("UPDATE sync_runs SET status='failed',finished_at=now(),error_code=$3,error_message='Cost sync failed. Check billing permissions and export configuration.',is_complete=false WHERE id=$1 AND org_id=$2", [job.syncRunId, job.orgId, code]);
      await client.query("UPDATE cloud_accounts SET last_cost_sync_status='failed',last_error_code=$3,updated_at=now() WHERE id=$1 AND org_id=$2", [job.accountId, job.orgId, code]);
    });
    await queueConnectionFailure(job.orgId, job.accountId, code).catch(() => undefined);
    throw error;
  }
}

export async function scheduleCostSyncRunsOnce(): Promise<number> {
  const organizations = await getPool().query<{ id: string }>("SELECT id FROM organizations ORDER BY created_at ASC");
  let queued = 0;
  for (const organization of organizations.rows) {
    const result = await withOrgTransaction(organization.id, (client) => client.query(
      "INSERT INTO sync_runs(org_id,cloud_account_id,job_type,status) " +
      "SELECT $1,a.id,'cost_sync','queued' FROM cloud_accounts a WHERE a.org_id=$1 AND a.status IN ('connected','degraded') " +
      "AND a.disconnected_at IS NULL AND (a.provider='aws' OR (a.provider='gcp' AND a.gcp_billing_dataset IS NOT NULL AND a.gcp_billing_table IS NOT NULL)) " +
      "AND (a.last_cost_sync_at IS NULL OR a.last_cost_sync_at < now()-interval '6 hours') " +
      "AND NOT EXISTS (SELECT 1 FROM sync_runs r WHERE r.cloud_account_id=a.id AND r.job_type='cost_sync' AND r.status IN ('queued','running')) " +
      "RETURNING id",
      [organization.id],
    ));
    queued += result.rowCount ?? 0;
  }
  return queued;
}
