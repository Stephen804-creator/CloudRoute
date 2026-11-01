import { randomUUID } from "node:crypto";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { fetchAwsInventory } from "@cloudroute/connector-aws/inventory";
import { GcpInventoryConnector } from "@cloudroute/connector-gcp";
import { getPool, withOrgTransaction } from "@cloudroute/db";
import { evaluateIdleFindings } from "./savings.js";
import { processCostSync } from "./cost-sync.js";
import { queueConnectionFailure } from "./notifications.js";

interface SyncJob { syncRunId: string; orgId: string; accountId: string }
interface NormalizedInventoryItem {
  externalId: string;
  resourceType: string;
  displayName: string | null;
  region: string | null;
  resourceStatus: string | null;
  tags: Record<string, string>;
  metadata: Record<string, unknown>;
}
interface InventoryResult { resources: NormalizedInventoryItem[]; complete: boolean; warnings: string[] }

async function fetchGcpInventory(projectId: string, serviceAccountEmail: string): Promise<InventoryResult> {
  const connector = new GcpInventoryConnector(serviceAccountEmail);
  const resources: NormalizedInventoryItem[] = [];
  const warnings: string[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    if (pages >= 500) {
      warnings.push("GCP_INVENTORY_PAGE_LIMIT_REACHED");
      return { resources, complete: false, warnings };
    }
    try {
      const page = await connector.listResources({ provider: "gcp", accountId: projectId }, pageToken);
      for (const resource of page.resources) {
        const payload = resource.rawPayload;
        const rawLabels = payload.labels;
        const rawData = payload.data;
        const tags = rawLabels !== null && typeof rawLabels === "object" && !Array.isArray(rawLabels)
          ? Object.fromEntries(Object.entries(rawLabels).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
          : {};
        const metadata = rawData !== null && typeof rawData === "object" && !Array.isArray(rawData)
          ? rawData as Record<string, unknown> : {};
        resources.push({
          externalId: resource.providerResourceId,
          resourceType: resource.resourceType,
          displayName: resource.displayName,
          region: resource.region,
          resourceStatus: typeof payload.status === "string" ? payload.status : null,
          tags,
          metadata: { assetType: payload.assetType ?? null, providerUpdateTime: payload.updateTime ?? null, ...metadata },
        });
      }
      pageToken = page.nextPageToken ?? undefined;
      pages++;
    } catch (error) {
      if (!resources.length) throw error;
      warnings.push(error instanceof Error && /^[A-Z0-9_:-]{1,80}$/.test(error.message) ? error.message : "GCP_INVENTORY_PAGE_FAILED");
      return { resources, complete: false, warnings };
    }
  } while (pageToken);
  return { resources, complete: true, warnings };
}


export async function processInventorySync(job: SyncJob): Promise<void> {
  const leaseToken = randomUUID();
  const claimed = await withOrgTransaction(job.orgId, (client) => client.query(
    "UPDATE sync_runs SET status='running', started_at=now(), finished_at=NULL, error_code=NULL, error_message=NULL, " +
    "lease_token=$4, lease_expires_at=now()+interval '15 minutes' " +
    "WHERE id=$1 AND org_id=$2 AND cloud_account_id=$3 AND job_type='inventory_sync' AND status IN ('queued','failed') RETURNING id, started_at",
    [job.syncRunId, job.orgId, job.accountId, leaseToken],
  ));
  if (!claimed.rows[0]) return;

  const heartbeat = setInterval(() => {
    void withOrgTransaction(job.orgId, (client) => client.query(
      "UPDATE sync_runs SET lease_expires_at=now()+interval '15 minutes' WHERE id=$1 AND org_id=$2 AND lease_token=$3 AND status='running'",
      [job.syncRunId, job.orgId, leaseToken],
    )).catch(() => undefined);
  }, 60_000);
  heartbeat.unref();

  try {
    const accountResult = await withOrgTransaction(job.orgId, (client) => client.query(
      "SELECT id, provider, external_account_id, role_arn, external_id, gcp_service_account_email FROM cloud_accounts " +
      "WHERE id=$1 AND org_id=$2 AND disconnected_at IS NULL",
      [job.accountId, job.orgId],
    ));
    const account = accountResult.rows[0] as { id: string; provider: string; external_account_id: string; role_arn: string | null; external_id: string | null; gcp_service_account_email: string | null } | undefined;
    if (!account) throw new Error("ACCOUNT_UNAVAILABLE");
    let inventory: InventoryResult;
    if (account.provider === "gcp") {
      if (!account.gcp_service_account_email) throw new Error("GCP_SERVICE_ACCOUNT_NOT_CONFIGURED");
      inventory = await fetchGcpInventory(account.external_account_id, account.gcp_service_account_email);
    } else if (account.provider === "aws") {
      if (!account.role_arn || !account.external_id) throw new Error("PROVIDER_NOT_READY");
      const sts = new STSClient({ region: process.env.AWS_STS_REGION ?? "us-east-1" });
    let credentials;
    try {
      const assumed = await sts.send(new AssumeRoleCommand({
        RoleArn: account.role_arn, ExternalId: account.external_id,
        RoleSessionName: "CloudRouteInventorySync", DurationSeconds: 900,
      }));
      if (!assumed.Credentials?.AccessKeyId || !assumed.Credentials.SecretAccessKey || !assumed.Credentials.SessionToken) throw new Error("ASSUME_ROLE_FAILED");
      credentials = {
        accessKeyId: assumed.Credentials.AccessKeyId,
        secretAccessKey: assumed.Credentials.SecretAccessKey,
        sessionToken: assumed.Credentials.SessionToken,
        ...(assumed.Credentials.Expiration ? { expiration: assumed.Credentials.Expiration } : {}),
      };
    } finally { sts.destroy(); }

      inventory = await fetchAwsInventory(credentials, account.external_account_id);
    } else {
      throw new Error("UNSUPPORTED_PROVIDER");
    }
    let created = 0;
    let updated = 0;
    let missing = 0;
    const startedAt = claimed.rows[0].started_at;
    const persisted = await withOrgTransaction(job.orgId, async (client) => {
      const activeRun = await client.query(
        "SELECT id FROM sync_runs WHERE id=$1 AND org_id=$2 AND status='running' AND lease_token=$3 AND lease_expires_at>now() FOR UPDATE",
        [job.syncRunId, job.orgId, leaseToken],
      );
      if (!activeRun.rowCount) return false;
      const activeAccount = await client.query(
        "SELECT id FROM cloud_accounts WHERE id=$1 AND org_id=$2 AND disconnected_at IS NULL FOR UPDATE",
        [account.id, job.orgId],
      );
      if (!activeAccount.rowCount) {
        await client.query(
          "UPDATE sync_runs SET status='cancelled', finished_at=now(), error_code='ACCOUNT_DISCONNECTED', is_complete=false, lease_token=NULL, lease_expires_at=NULL WHERE id=$1 AND org_id=$2 AND status='running' AND lease_token=$3",
          [job.syncRunId, job.orgId, leaseToken],
        );
        return false;
      }
      for (const item of inventory.resources) {
        const upsert = await client.query(
          "INSERT INTO resources(org_id, cloud_account_id, provider, external_id, resource_type, display_name, region, resource_status, tags, metadata, last_seen_at, deleted_detected_at, connector_version) " +
          "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,now(),NULL,'0.3.0') " +
          "ON CONFLICT (cloud_account_id, external_id) DO UPDATE SET resource_type=EXCLUDED.resource_type, display_name=EXCLUDED.display_name, region=EXCLUDED.region, resource_status=EXCLUDED.resource_status, tags=EXCLUDED.tags, metadata=EXCLUDED.metadata, last_seen_at=now(), deleted_detected_at=NULL, connector_version=EXCLUDED.connector_version, updated_at=now() " +
          "RETURNING (xmax = 0) AS inserted",
          [job.orgId, account.id, account.provider, item.externalId, item.resourceType, item.displayName, item.region, item.resourceStatus, JSON.stringify(item.tags), JSON.stringify(item.metadata)],
        );
        if (upsert.rows[0]?.inserted) created++; else updated++;
      }
      if (inventory.complete) {
        const markedMissing = await client.query(
          "UPDATE resources SET deleted_detected_at=now(), updated_at=now() WHERE org_id=$1 AND cloud_account_id=$2 AND last_seen_at < $3 AND deleted_detected_at IS NULL",
          [job.orgId, account.id, startedAt],
        );
        missing = markedMissing.rowCount ?? 0;
      }
      if (inventory.complete) await evaluateIdleFindings(client, job.orgId, account.id);
      const status = inventory.complete ? "succeeded" : "partial";
      await client.query(
        "UPDATE sync_runs SET status=$2, finished_at=now(), resources_seen=$3, resources_created=$4, resources_updated=$5, resources_missing=$6, error_code=$7, error_message=$8, is_complete=$9, lease_token=NULL, lease_expires_at=NULL WHERE id=$1 AND org_id=$10 AND lease_token=$11",
        [job.syncRunId, status, inventory.resources.length, created, updated, missing, inventory.complete ? null : "PARTIAL_PROVIDER_RESPONSE", inventory.complete ? null : inventory.warnings.slice(0, 20).join(","), inventory.complete, job.orgId, leaseToken],
      );
      await client.query(
        "UPDATE cloud_accounts SET status=$3, last_sync_at=now(), last_sync_status=$4, last_error_code=$5, updated_at=now() WHERE id=$1 AND org_id=$2 AND disconnected_at IS NULL",
        [account.id, job.orgId, inventory.complete ? "connected" : "degraded", status, inventory.complete ? null : "PARTIAL_PROVIDER_RESPONSE"],
      );
      return true;
    });
    clearInterval(heartbeat);
    if (!persisted) return;
  } catch (error) {
    clearInterval(heartbeat);
    const code = error instanceof Error && /^[A-Z0-9_:-]{1,80}$/.test(error.message) ? error.message : "INVENTORY_SYNC_FAILED";
    if (code === "ACCOUNT_UNAVAILABLE" || code === "ACCOUNT_DISCONNECTED") {
      await withOrgTransaction(job.orgId, (client) => client.query(
        "UPDATE sync_runs SET status='cancelled', finished_at=now(), error_code='ACCOUNT_DISCONNECTED', is_complete=false, lease_token=NULL, lease_expires_at=NULL WHERE id=$1 AND org_id=$2 AND status='running' AND lease_token=$3",
        [job.syncRunId, job.orgId, leaseToken],
      ));
      return;
    }
    await withOrgTransaction(job.orgId, async (client) => {
      await client.query(
        "UPDATE sync_runs SET status='failed', finished_at=now(), error_code=$3, error_message='Inventory sync failed. Check the connection and permissions.', is_complete=false WHERE id=$1 AND org_id=$2 AND status='running'",
        [job.syncRunId, job.orgId, code],
      );
      await client.query(
        "UPDATE cloud_accounts SET status='error', last_sync_status='failed', last_error_code=$3, updated_at=now() WHERE id=$1 AND org_id=$2 AND disconnected_at IS NULL",
        [job.accountId, job.orgId, code],
      );
    });
    await queueConnectionFailure(job.orgId, job.accountId, code).catch(() => undefined);
    throw error;
  }
}

export async function recoverExpiredSyncRunsOnce(): Promise<number> {
  const organizations = await getPool().query<{ id: string }>("SELECT id FROM organizations ORDER BY created_at ASC");
  let recovered = 0;
  for (const organization of organizations.rows) {
    const result = await withOrgTransaction(organization.id, (client) => client.query(
      "UPDATE sync_runs SET status='queued', started_at=NULL, finished_at=NULL, lease_token=NULL, lease_expires_at=NULL, " +
      "error_code='WORKER_LEASE_EXPIRED', error_message='A previous worker stopped before completing this job.' " +
      "WHERE status='running' AND COALESCE(lease_expires_at, started_at + interval '15 minutes', created_at + interval '15 minutes') <= now() " +
      "RETURNING id",
    ));
    recovered += result.rowCount ?? 0;
  }
  return recovered;
}

export async function pollQueuedRunsOnce(): Promise<boolean> {
  await recoverExpiredSyncRunsOnce();
  const organizations = await getPool().query<{ id: string }>("SELECT id FROM organizations ORDER BY created_at ASC");
  for (const organization of organizations.rows) {
    const result = await withOrgTransaction(organization.id, (client) => client.query<{ id: string; org_id: string; cloud_account_id: string; job_type: string }>(
      "SELECT id, org_id, cloud_account_id, job_type FROM sync_runs WHERE status='queued' AND job_type IN ('inventory_sync','cost_sync') ORDER BY created_at ASC LIMIT 1",
    ));
    const row = result.rows[0];
    if (!row) continue;
    if (row.job_type === "cost_sync") await processCostSync({ syncRunId: row.id, orgId: row.org_id, accountId: row.cloud_account_id });
    else await processInventorySync({ syncRunId: row.id, orgId: row.org_id, accountId: row.cloud_account_id });
    return true;
  }
  return false;
}
