import type { FastifyInstance } from "fastify";
import { withOrgTransaction } from "@cloudroute/db";
import { authenticate } from "../auth/guard.js";

export async function registerNotificationPreferenceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", async (request, reply) => {
    if (request.url.startsWith("/v1/notification-preferences")) await authenticate(request, reply);
  });
  app.get("/v1/notification-preferences", async (request, reply) => {
    if (!request.authContext) return;
    const result = await withOrgTransaction(request.authContext.orgId, (client) => client.query(
      "SELECT weekly_digest_enabled AS \"weeklyDigestEnabled\", connection_failure_enabled AS \"connectionFailureEnabled\", updated_at AS \"updatedAt\" " +
      "FROM notification_preferences WHERE org_id=$1",
      [request.authContext!.orgId],
    ));
    return reply.send({ preferences: result.rows[0] ?? { weeklyDigestEnabled: true, connectionFailureEnabled: true, updatedAt: null } });
  });
  app.patch<{ Body: { weeklyDigestEnabled?: boolean; connectionFailureEnabled?: boolean } }>("/v1/notification-preferences", async (request, reply) => {
    if (!request.authContext) return;
    const weekly = request.body?.weeklyDigestEnabled;
    const failure = request.body?.connectionFailureEnabled;
    if (typeof weekly !== "boolean" || typeof failure !== "boolean") {
      return reply.code(400).send({ error: { code: "INVALID_NOTIFICATION_PREFERENCES", message: "Provide boolean values for both notification preferences." } });
    }
    const result = await withOrgTransaction(request.authContext.orgId, async (client) => {
      const updated = await client.query(
        "INSERT INTO notification_preferences(org_id,weekly_digest_enabled,connection_failure_enabled,updated_by) VALUES ($1,$2,$3,$4) " +
        "ON CONFLICT (org_id) DO UPDATE SET weekly_digest_enabled=EXCLUDED.weekly_digest_enabled,connection_failure_enabled=EXCLUDED.connection_failure_enabled,updated_by=EXCLUDED.updated_by,updated_at=now() " +
        "RETURNING weekly_digest_enabled AS \"weeklyDigestEnabled\",connection_failure_enabled AS \"connectionFailureEnabled\",updated_at AS \"updatedAt\"",
        [request.authContext!.orgId, weekly, failure, request.authContext!.userId],
      );
      await client.query(
        "INSERT INTO audit_log(org_id,actor_user_id,action,target_type,target_id,details) VALUES ($1,$2,'notification_preferences.updated','organization',$1,$3::jsonb)",
        [request.authContext!.orgId, request.authContext!.userId, JSON.stringify({ weeklyDigestEnabled: weekly, connectionFailureEnabled: failure })],
      );
      return updated.rows[0];
    });
    return reply.send({ preferences: result });
  });
}
