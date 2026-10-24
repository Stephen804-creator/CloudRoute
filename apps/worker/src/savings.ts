import type { PoolClient } from "pg";

interface ResourceRow {
  id: string;
  external_id: string;
  resource_type: string;
  display_name: string | null;
  region: string | null;
  resource_status: string | null;
  metadata: Record<string, unknown>;
  provider: string;
}

interface Candidate {
  resource: ResourceRow;
  ruleKey: string;
  severity: "low" | "medium" | "high";
  title: string;
  description: string;
  evidence: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function asDate(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function isOlderThan(value: unknown, days: number, now: Date): boolean {
  const date = asDate(value);
  return Boolean(date && now.getTime() - date.getTime() >= days * 86400000);
}
function attachedVolumeIds(resource: ResourceRow): string[] {
  const value = resource.metadata.attachedVolumeIds;
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}
function isVolumeAttached(resource: ResourceRow): boolean | null {
  if (typeof resource.metadata.attached === "boolean") return resource.metadata.attached;
  const data = asRecord(resource.metadata.data);
  if (Array.isArray(data.users)) return data.users.length > 0;
  if (Array.isArray(resource.metadata.users)) return resource.metadata.users.length > 0;
  return null;
}
function isAddressAssociated(resource: ResourceRow): boolean | null {
  if (typeof resource.metadata.associationId === "string") return true;
  if (resource.metadata.associationId === null) return false;
  const data = asRecord(resource.metadata.data);
  if (Array.isArray(data.users)) return data.users.length > 0;
  if (Array.isArray(resource.metadata.users)) return resource.metadata.users.length > 0;
  if (typeof resource.resource_status === "string" && /unassociated|reserved/i.test(resource.resource_status)) return false;
  return null;
}

export function buildIdleCandidates(resources: ResourceRow[], now = new Date()): Candidate[] {
  const candidates: Candidate[] = [];
  const volumes = new Set(resources.filter((r) => r.resource_type === "block_volume").map((r) => r.external_id));
  for (const resource of resources) {
    const metadata = resource.metadata ?? {};
    if (resource.resource_type === "compute_instance" && /stopped|terminated/i.test(resource.resource_status ?? "") &&
        isOlderThan(metadata.stoppedAt ?? metadata.lastStoppedAt, 7, now)) {
      const ids = attachedVolumeIds(resource);
      const hasExistingVolume = ids.some((id) => volumes.has(id) || [...volumes].some((volume) => volume.endsWith("/" + id) || volume.endsWith(":" + id)));
      if (hasExistingVolume) candidates.push({
        resource, ruleKey: "stopped_instance_with_billable_disk", severity: "medium",
        title: "Stopped instance may still incur storage charges",
        description: "This instance has been stopped for at least seven days and its inventory metadata references a disk that still exists.",
        evidence: { status: resource.resource_status, stoppedAt: metadata.stoppedAt ?? metadata.lastStoppedAt, attachedVolumeIds: ids, windowDays: 7 },
      });
    }
    if (resource.resource_type === "block_volume" && isVolumeAttached(resource) === false &&
        isOlderThan(metadata.unattachedSince ?? metadata.detachedAt, 7, now)) {
      candidates.push({
        resource, ruleKey: "unattached_volume", severity: "medium",
        title: "Unattached block volume",
        description: "Provider metadata reports that this volume is not attached. Verify that it is no longer needed before removing it.",
        evidence: { attached: false, unattachedSince: metadata.unattachedSince ?? metadata.detachedAt, sizeGiB: metadata.sizeGiB ?? metadata.sizeGb ?? null, windowDays: 7 },
      });
    }
    if (resource.resource_type === "static_ip" && isAddressAssociated(resource) === false) {
      candidates.push({
        resource, ruleKey: "unassociated_static_ip", severity: "low",
        title: "Unassociated static IP address",
        description: "Provider metadata reports that this reserved address is not associated with a resource.",
        evidence: { status: resource.resource_status, allocationId: metadata.allocationId ?? null, associationId: metadata.associationId ?? null },
      });
    }
    if (resource.resource_type === "snapshot" && isOlderThan(metadata.startTime ?? metadata.creationTimestamp ?? metadata.createTime, 90, now)) {
      const sourceVolume = metadata.sourceVolumeId ?? metadata.volumeId ?? null;
      if (typeof sourceVolume === "string" && ![...volumes].some((id) => id.endsWith("/" + sourceVolume) || id.endsWith(":" + sourceVolume))) {
        candidates.push({
          resource, ruleKey: "old_snapshot_missing_source_volume", severity: "low",
          title: "Old snapshot with no matching source volume",
          description: "This snapshot is at least 90 days old and no matching source volume was found in the current inventory. Confirm retention requirements before deletion.",
          evidence: { snapshotTime: metadata.startTime ?? metadata.creationTimestamp ?? metadata.createTime, sourceVolumeId: sourceVolume, ageDays: 90 },
        });
      }
    }
    const averageCpu = metadata.averageCpu14d ?? metadata.averageCpuPercent14d;
    if (resource.resource_type === "compute_instance" && typeof averageCpu === "number" && averageCpu >= 0 && averageCpu < 5) {
      candidates.push({
        resource, ruleKey: "low_utilization_instance", severity: "low",
        title: "Low-utilization compute instance",
        description: "Collected metrics show average CPU below five percent over the last 14 days. Metrics must be explicitly enabled; inventory alone is not enough.",
        evidence: { averageCpuPercent14d: averageCpu, windowDays: 14, source: "provider_metrics" },
      });
    }
    const connections = metadata.databaseConnections14d ?? metadata.connections14d;
    if (resource.resource_type === "database" && typeof connections === "number" && connections <= 0) {
      candidates.push({
        resource, ruleKey: "idle_database", severity: "low",
        title: "Database with near-zero connections",
        description: "Collected metrics show no database connections over the last 14 days. Confirm application dependencies before making changes.",
        evidence: { connections14d: connections, windowDays: 14, source: "provider_metrics" },
      });
    }
  }
  return candidates;
}

export async function evaluateIdleFindings(client: PoolClient, orgId: string, accountId: string): Promise<number> {
  const result = await client.query<ResourceRow>(
    "SELECT id,external_id,provider,resource_type,display_name,region,resource_status,metadata FROM resources " +
    "WHERE org_id=$1 AND cloud_account_id=$2 AND deleted_detected_at IS NULL",
    [orgId, accountId],
  );
  const candidates = buildIdleCandidates(result.rows);
  const activeKeys = new Set(candidates.map((item) => item.ruleKey + ":" + item.resource.id));
  for (const item of candidates) {
    await client.query(
      "INSERT INTO findings(org_id,cloud_account_id,resource_id,rule_key,severity,title,description,evidence,estimated_monthly_saving,currency,status) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NULL,NULL,'open') " +
      "ON CONFLICT (cloud_account_id,rule_key,resource_id) DO UPDATE SET severity=EXCLUDED.severity,title=EXCLUDED.title,description=EXCLUDED.description,evidence=EXCLUDED.evidence,updated_at=now(), " +
      "status=CASE WHEN findings.status IN ('dismissed','snoozed') AND (findings.status='dismissed' OR findings.snoozed_until > now()) THEN findings.status ELSE 'open' END, " +
      "snoozed_until=CASE WHEN findings.status='snoozed' AND findings.snoozed_until > now() THEN findings.snoozed_until ELSE NULL END",
      [orgId, accountId, item.resource.id, item.ruleKey, item.severity, item.title, item.description, JSON.stringify(item.evidence)],
    );
  }
  const previous = await client.query<{ rule_key: string; resource_id: string }>(
    "SELECT rule_key,resource_id FROM findings WHERE org_id=$1 AND cloud_account_id=$2 AND status='open' AND resource_id IS NOT NULL",
    [orgId, accountId],
  );
  for (const finding of previous.rows) {
    if (!activeKeys.has(finding.rule_key + ":" + finding.resource_id)) {
      await client.query(
        "UPDATE findings SET status='resolved',updated_at=now() WHERE org_id=$1 AND cloud_account_id=$2 AND rule_key=$3 AND resource_id=$4 AND status='open'",
        [orgId, accountId, finding.rule_key, finding.resource_id],
      );
    }
  }
  return candidates.length;
}
