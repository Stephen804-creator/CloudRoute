import type { FastifyInstance } from "fastify";
import { withOrgTransaction } from "@cloudroute/db";
import { authenticate } from "../auth/guard.js";

export async function registerResourceHistoryRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", async (request, reply) => {
    if (request.url.startsWith("/v1/resources/") && request.url.endsWith("/history")) await authenticate(request, reply);
  });
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>("/v1/resources/:id/history", async (request, reply) => {
    if (!request.authContext) return;
    const limit = Math.max(1, Math.min(100, Number.parseInt(request.query.limit ?? "30", 10) || 30));
    const result = await withOrgTransaction(request.authContext.orgId, (client) => client.query(
      "SELECT h.id,h.change_type AS \"changeType\",h.changed_fields AS \"changedFields\",h.snapshot,h.observed_at AS \"observedAt\" " +
      "FROM resource_history h JOIN resources r ON r.id=h.resource_id AND r.org_id=h.org_id " +
      "WHERE h.org_id=$1 AND h.resource_id=$2 ORDER BY h.observed_at DESC LIMIT $3",
      [request.authContext!.orgId, request.params.id, limit],
    ));
    return reply.send({ history: result.rows });
  });
}
