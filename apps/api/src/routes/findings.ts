import type { FastifyInstance } from "fastify";
import { withOrgTransaction } from "@cloudroute/db";
import { authenticate } from "../auth/guard.js";

const allowedStatuses = new Set(["dismissed", "snoozed", "open"]);
export async function registerFindingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", async (request, reply) => {
    if (request.url.startsWith("/v1/findings")) await authenticate(request, reply);
  });

  app.get<{ Querystring: { status?: string; limit?: string } }>("/v1/findings", async (request, reply) => {
    if (!request.authContext) return;
    const status = request.query.status ?? "open";
    if (!["open", "dismissed", "snoozed", "resolved", "all"].includes(status)) return reply.code(400).send({ error: { code: "INVALID_FINDING_STATUS", message: "Finding status is not supported." } });
    const limit = Math.max(1, Math.min(100, Number.parseInt(request.query.limit ?? "50", 10) || 50));
    const result = await withOrgTransaction(request.authContext.orgId, (client) => client.query(
      "SELECT f.id, f.rule_key AS \"ruleKey\", f.severity, f.title, f.description, f.evidence, " +
      "f.estimated_monthly_saving AS \"estimatedMonthlySaving\", f.currency, f.status, f.snoozed_until AS \"snoozedUntil\", " +
      "f.created_at AS \"firstDetectedAt\", f.updated_at AS \"updatedAt\", r.display_name AS \"resourceName\", " +
      "r.external_id AS \"resourceExternalId\", r.provider, r.resource_type AS \"resourceType\", r.region, a.display_name AS \"accountName\" " +
      "FROM findings f JOIN cloud_accounts a ON a.id=f.cloud_account_id AND a.org_id=f.org_id " +
      "LEFT JOIN resources r ON r.id=f.resource_id AND r.org_id=f.org_id " +
      "WHERE f.org_id=$1 AND ($2::text='all' OR f.status=$2) " +
      "ORDER BY CASE f.severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, f.created_at DESC LIMIT $3",
      [request.authContext!.orgId, status, limit],
    ));
    return reply.send({ findings: result.rows, generatedAt: new Date().toISOString() });
  });

  app.patch<{ Params: { id: string }; Body: { status: string; snoozeDays?: number } }>("/v1/findings/:id", async (request, reply) => {
    if (!request.authContext) return;
    const status = request.body?.status;
    if (!allowedStatuses.has(status)) return reply.code(400).send({ error: { code: "INVALID_FINDING_STATUS", message: "Status must be open, dismissed, or snoozed." } });
    const days = request.body?.snoozeDays;
    if (status === "snoozed" && (!Number.isInteger(days) || (days as number) < 1 || (days as number) > 90)) {
      return reply.code(400).send({ error: { code: "INVALID_SNOOZE_DAYS", message: "snoozeDays must be an integer between 1 and 90." } });
    }
    const updated = await withOrgTransaction(request.authContext.orgId, async (client) => {
      const result = await client.query(
        "UPDATE findings SET status=$3, snoozed_until=CASE WHEN $3='snoozed' THEN now()+($4::int * interval '1 day') ELSE NULL END, updated_at=now() " +
        "WHERE id=$1 AND org_id=$2 RETURNING id,status,snoozed_until AS \"snoozedUntil\"",
        [request.params.id, request.authContext!.orgId, status, status === "snoozed" ? days : null],
      );
      if (!result.rows[0]) return null;
      await client.query(
        "INSERT INTO audit_log(org_id,actor_user_id,action,target_type,target_id,details) VALUES ($1,$2,$3,'finding',$4,$5::jsonb)",
        [request.authContext!.orgId, request.authContext!.userId, "finding." + status, request.params.id, JSON.stringify({ status, snoozeDays: status === "snoozed" ? days : null })],
      );
      return result.rows[0];
    });
    if (!updated) return reply.code(404).send({ error: { code: "FINDING_NOT_FOUND", message: "Finding was not found in this workspace." } });
    return reply.send({ finding: updated });
  });
}
