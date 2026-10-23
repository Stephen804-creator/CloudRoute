import type { FastifyInstance } from "fastify";
import { withOrgTransaction } from "@cloudroute/db";
import { authenticate } from "../auth/guard.js";

const labels = new Set(["unclassified", "retain", "migrate", "retire", "review"]);
const providers = new Set(["aws", "gcp"]);
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  const first = text.trimStart()[0];
  const safe = first === "=" || first === "+" || first === "-" || first === "@" ? "'" + text : text;
  return '"' + safe.replace(/"/g, '""') + '"';
}

export async function registerResourceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", async (request, reply) => {
    if (request.url.startsWith("/v1/resources") || request.url.startsWith("/v1/overview")) await authenticate(request, reply);
  });

  app.get<{ Querystring: { provider?: string; type?: string; region?: string; q?: string; migrationLabel?: string; limit?: string; cursor?: string } }>("/v1/resources", async (request, reply) => {
    if (!request.authContext) return;
    const q = request.query.q?.trim().slice(0, 160);
    const provider = request.query.provider;
    const type = request.query.type?.trim().slice(0, 80);
    const region = request.query.region?.trim().slice(0, 80);
    const label = request.query.migrationLabel;
    if (provider && !providers.has(provider)) return reply.code(400).send({ error: { code: "INVALID_PROVIDER", message: "Provider must be aws or gcp." } });
    if (label && !labels.has(label)) return reply.code(400).send({ error: { code: "INVALID_MIGRATION_LABEL", message: "Migration label is not supported." } });
    const limit = Math.max(1, Math.min(100, Number.parseInt(request.query.limit ?? "50", 10) || 50));
    let cursorTime: string | null = null;
    let cursorId: string | null = null;
    if (request.query.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(request.query.cursor, "base64url").toString("utf8")) as { lastSeenAt?: unknown; id?: unknown };
        if (typeof decoded.lastSeenAt !== "string" || Number.isNaN(Date.parse(decoded.lastSeenAt)) || typeof decoded.id !== "string" || !/^[0-9a-f-]{36}$/i.test(decoded.id)) throw new Error("invalid cursor");
        cursorTime = decoded.lastSeenAt;
        cursorId = decoded.id;
      } catch {
        return reply.code(400).send({ error: { code: "INVALID_CURSOR", message: "Cursor is invalid. Refresh the inventory list and try again." } });
      }
    }
    const result = await withOrgTransaction(request.authContext.orgId, (client) => client.query(
      "SELECT r.id, r.provider, r.external_id AS \"externalId\", r.resource_type AS \"resourceType\", " +
      "r.display_name AS \"displayName\", r.region, r.resource_status AS status, r.tags, " +
      "r.migration_label AS \"migrationLabel\", r.first_seen_at AS \"firstSeenAt\", r.last_seen_at AS \"lastSeenAt\", " +
      "a.display_name AS \"accountName\", a.external_account_id AS \"accountId\" " +
      "FROM resources r JOIN cloud_accounts a ON a.id=r.cloud_account_id AND a.org_id=r.org_id " +
      "WHERE r.org_id=$1 AND r.deleted_detected_at IS NULL AND ($2::text IS NULL OR r.provider=$2) " +
      "AND ($3::text IS NULL OR r.resource_type=$3) AND ($4::text IS NULL OR r.region=$4) " +
      "AND ($5::text IS NULL OR r.migration_label=$5) " +
      "AND ($6::text IS NULL OR (r.display_name ILIKE '%' || $6 || '%' OR r.external_id ILIKE '%' || $6 || '%')) " +
      "AND ($7::timestamptz IS NULL OR (r.last_seen_at, r.id) < ($7::timestamptz, $8::uuid)) ORDER BY r.last_seen_at DESC, r.id DESC LIMIT $9",
      [request.authContext!.orgId, provider ?? null, type ?? null, region ?? null, label ?? null, q ?? null, cursorTime, cursorId, limit + 1],
    ));
    const hasMore = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    return reply.send({ resources: rows, page: { limit, hasMore, nextCursor: hasMore && rows[rows.length - 1] ? Buffer.from(JSON.stringify({ lastSeenAt: rows[rows.length - 1]!.lastSeenAt, id: rows[rows.length - 1]!.id })).toString("base64url") : null } });
  });

  app.get<{ Params: { id: string } }>("/v1/resources/:id", async (request, reply) => {
    if (!request.authContext) return;
    const result = await withOrgTransaction(request.authContext.orgId, (client) => client.query(
      "SELECT r.*, a.display_name AS account_name, a.external_account_id AS account_id " +
      "FROM resources r JOIN cloud_accounts a ON a.id=r.cloud_account_id AND a.org_id=r.org_id " +
      "WHERE r.id=$1 AND r.org_id=$2", [request.params.id, request.authContext!.orgId],
    ));
    if (!result.rows[0]) return reply.code(404).send({ error: { code: "RESOURCE_NOT_FOUND", message: "Resource was not found in this workspace." } });
    return reply.send({ resource: result.rows[0] });
  });

  app.patch<{ Params: { id: string }; Body: { migrationLabel: string; notes?: string } }>("/v1/resources/:id/migration-label", async (request, reply) => {
    if (!request.authContext) return;
    const label = request.body?.migrationLabel;
    const notes = typeof request.body?.notes === "string" ? request.body.notes.trim().slice(0, 1000) : null;
    if (!labels.has(label)) return reply.code(400).send({ error: { code: "INVALID_MIGRATION_LABEL", message: "Choose a supported migration label." } });
    const updated = await withOrgTransaction(request.authContext.orgId, async (client) => {
      const row = await client.query(
        "UPDATE resources SET migration_label=$3, updated_at=now() WHERE id=$1 AND org_id=$2 RETURNING id, migration_label",
        [request.params.id, request.authContext!.orgId, label],
      );
      if (!row.rows[0]) return null;
      await client.query(
        "INSERT INTO migration_labels(org_id, resource_id, label, notes, updated_by) VALUES ($1,$2,$3,$4,$5) " +
        "ON CONFLICT (org_id,resource_id) DO UPDATE SET label=EXCLUDED.label, notes=EXCLUDED.notes, updated_by=EXCLUDED.updated_by, updated_at=now()",
        [request.authContext!.orgId, request.params.id, label, notes, request.authContext!.userId],
      );
      await client.query(
        "INSERT INTO audit_log(org_id, actor_user_id, action, target_type, target_id, details) VALUES ($1,$2,'resource.migration_label.updated','resource',$3,$4::jsonb)",
        [request.authContext!.orgId, request.authContext!.userId, request.params.id, JSON.stringify({ label })],
      );
      return row.rows[0];
    });
    if (!updated) return reply.code(404).send({ error: { code: "RESOURCE_NOT_FOUND", message: "Resource was not found." } });
    return reply.send({ resource: updated });
  });

  app.get("/v1/resources/export.csv", async (request, reply) => {
    if (!request.authContext) return;
    const result = await withOrgTransaction(request.authContext.orgId, (client) => client.query(
      "SELECT provider, resource_type, display_name, external_id, region, resource_status, migration_label, last_seen_at " +
      "FROM resources WHERE org_id=$1 AND deleted_detected_at IS NULL ORDER BY provider, resource_type, display_name LIMIT 50000",
      [request.authContext!.orgId],
    ));
    const headers = ["provider","resource_type","display_name","external_id","region","status","migration_label","last_seen_at"];
    const csv = [headers.map(csvCell).join(","), ...result.rows.map((row) => [
      row.provider,row.resource_type,row.display_name,row.external_id,row.region,row.resource_status,row.migration_label,row.last_seen_at,
    ].map(csvCell).join(","))].join("\r\n");
    return reply.header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="cloudroute-inventory.csv"').send(csv);
  });

  app.get("/v1/overview", async (request, reply) => {
    if (!request.authContext) return;
    const orgId = request.authContext.orgId;
    const data = await withOrgTransaction(orgId, async (client) => {
      const [resources, accounts, findings, sync] = await Promise.all([
        client.query("SELECT provider, resource_type, count(*)::int AS count FROM resources WHERE org_id=$1 AND deleted_detected_at IS NULL GROUP BY provider, resource_type ORDER BY provider, resource_type", [orgId]),
        client.query("SELECT id, provider, display_name AS name, status, last_sync_at AS \"lastSyncAt\", last_sync_status AS \"lastSyncStatus\" FROM cloud_accounts WHERE org_id=$1 AND disconnected_at IS NULL ORDER BY created_at DESC", [orgId]),
        client.query("SELECT id, title, severity, estimated_monthly_saving AS \"estimatedMonthlySaving\", currency, status FROM findings WHERE org_id=$1 AND status='open' ORDER BY CASE severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, created_at DESC LIMIT 5", [orgId]),
        client.query("SELECT id, status, job_type AS \"jobType\", started_at AS \"startedAt\", finished_at AS \"finishedAt\", error_code AS \"errorCode\" FROM sync_runs WHERE org_id=$1 ORDER BY created_at DESC LIMIT 10", [orgId]),
      ]);
      return { resources: resources.rows, accounts: accounts.rows, findings: findings.rows, recentSyncRuns: sync.rows };
    });
    return reply.send({ ...data, generatedAt: new Date().toISOString() });
  });
}
