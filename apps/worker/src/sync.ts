import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { fetchAwsInventory } from "@cloudroute/connector-aws/inventory";
import { getPool, withOrgTransaction } from "@cloudroute/db";

interface SyncJob { syncRunId: string; orgId: string; accountId: string }

export async function processInventorySync(job: SyncJob): Promise<void> {
  const claimed = await withOrgTransaction(job.orgId, (client) => client.query(
    "UPDATE sync_runs SET status='running', started_at=now(), finished_at=NULL, error_code=NULL, error_message=NULL " +
    "WHERE id=$1 AND org_id=$2 AND cloud_account_id=$3 AND job_type='inventory_sync' AND status IN ('queued','failed') RETURNING id, started_at",
    [job.syncRunId, job.orgId, job.accountId],
  ));
  if (!claimed.rows[0]) return;

  try {
    const accountResult = await withOrgTransaction(job.orgId, (client) => client.query(
      "SELECT id, provider, external_account_id, role_arn, external_id FROM cloud_accounts " +
      "WHERE id=$1 AND org_id=$2 AND disconnected_at IS NULL",
      [job.accountId, job.orgId],
    ));
    const account = accountResult.rows[0] as { id: string; provider: string; external_account_id: string; role_arn: string | null; external_id: string | null } | undefined;
    if (!account) throw new Error("ACCOUNT_UNAVAILABLE");
    if (account.provider !== "aws" || !account.role_arn || !account.external_id) throw new Error("PROVIDER_NOT_READY");

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
        expiration: assumed.Credentials.Expiration,
      };
    } finally { sts.destroy(); }

    const inventory = await fetchAwsInventory(credentials, account.external_account_id);
    let created = 0;
    let updated = 0;
    let missing = 0;
    const startedAt = claimed.rows[0].started_at;
    await withOrgTransaction(job.orgId, async (client) => {
      for (const item of inventory.resources) {
        const upsert = await client.query(
          "INSERT INTO resources(org_id, cloud_account_id, provider, external_id, resource_type, display_name, region, resource_status, tags, metadata, last_seen_at, deleted_detected_at, connector_version) " +
          "VALUES ($1,$2,'aws',$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,now(),NULL,'0.2.0') " +
          "ON CONFLICT (cloud_account_id, external_id) DO UPDATE SET resource_type=EXCLUDED.resource_type, display_name=EXCLUDED.display_name, region=EXCLUDED.region, resource_status=EXCLUDED.resource_status, tags=EXCLUDED.tags, metadata=EXCLUDED.metadata, last_seen_at=now(), deleted_detected_at=NULL, connector_version=EXCLUDED.connector_version, updated_at=now() " +
          "RETURNING (xmax = 0) AS inserted",
          [job.orgId, account.id, item.externalId, item.resourceType, item.displayName, item.region, item.resourceStatus, JSON.stringify(item.tags), JSON.stringify(item.metadata)],
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
      const status = inventory.complete ? "succeeded" : "partial";
      await client.query(
        "UPDATE sync_runs SET status=$2, finished_at=now(), resources_seen=$3, resources_created=$4, resources_updated=$5, resources_missing=$6, error_code=$7, error_message=$8, is_complete=$9 WHERE id=$1 AND org_id=$10",
        [job.syncRunId, status, inventory.resources.length, created, updated, missing, inventory.complete ? null : "PARTIAL_PROVIDER_RESPONSE", inventory.complete ? null : inventory.warnings.slice(0, 20).join(","), inventory.complete, job.orgId],
      );
      await client.query(
        "UPDATE cloud_accounts SET status=$3, last_sync_at=now(), last_sync_status=$4, last_error_code=$5, updated_at=now() WHERE id=$1 AND org_id=$2",
        [account.id, job.orgId, inventory.complete ? "connected" : "degraded", status, inventory.complete ? null : "PARTIAL_PROVIDER_RESPONSE"],
      );
    });
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_:-]{1,80}$/.test(error.message) ? error.message : "INVENTORY_SYNC_FAILED";
    await withOrgTransaction(job.orgId, async (client) => {
      await client.query(
        "UPDATE sync_runs SET status='failed', finished_at=now(), error_code=$3, error_message='Inventory sync failed. Check the connection and permissions.', is_complete=false WHERE id=$1 AND org_id=$2",
        [job.syncRunId, job.orgId, code],
      );
      await client.query(
        "UPDATE cloud_accounts SET status='error', last_sync_status='failed', last_error_code=$3, updated_at=now() WHERE id=$1 AND org_id=$2",
        [job.accountId, job.orgId, code],
      );
    });
    throw error;
  }
}

export async function pollQueuedRunsOnce(): Promise<boolean> {
  const organizations = await getPool().query<{ id: string }>("SELECT id FROM organizations ORDER BY created_at ASC");
  for (const organization of organizations.rows) {
    const result = await withOrgTransaction(organization.id, (client) => client.query<{ id: string; org_id: string; cloud_account_id: string }>(
      "SELECT id, org_id, cloud_account_id FROM sync_runs WHERE status='queued' AND job_type='inventory_sync' ORDER BY created_at ASC LIMIT 1",
    ));
    const row = result.rows[0];
    if (!row) continue;
    await processInventorySync({ syncRunId: row.id, orgId: row.org_id, accountId: row.cloud_account_id });
    return true;
  }
  return false;
}
