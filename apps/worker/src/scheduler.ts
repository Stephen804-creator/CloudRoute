import { getPool, withOrgTransaction } from "@cloudroute/db";

export async function scheduleHourlyInventoryRunsOnce(): Promise<number> {
  const organizations = await getPool().query<{ id: string }>("SELECT id FROM organizations ORDER BY created_at ASC");
  let queued = 0;
  for (const organization of organizations.rows) {
    const result = await withOrgTransaction(organization.id, (client) => client.query(
      "INSERT INTO sync_runs(org_id, cloud_account_id, job_type, status) " +
      "SELECT $1, a.id, 'inventory_sync', 'queued' FROM cloud_accounts a " +
      "WHERE a.org_id=$1 AND a.provider='aws' AND a.status IN ('connected','degraded') AND a.disconnected_at IS NULL " +
      "AND (a.last_sync_at IS NULL OR a.last_sync_at < now() - interval '1 hour') " +
      "AND NOT EXISTS (SELECT 1 FROM sync_runs r WHERE r.cloud_account_id=a.id AND r.status IN ('queued','running') AND r.created_at > now() - interval '2 hours') " +
      "RETURNING id",
      [organization.id],
    ));
    queued += result.rowCount ?? 0;
  }
  return queued;
}
