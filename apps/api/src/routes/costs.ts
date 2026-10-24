import type { FastifyInstance } from "fastify";
import { withOrgTransaction } from "@cloudroute/db";
import { authenticate } from "../auth/guard.js";

const groupings = new Set(["provider", "service", "account"]);

export async function registerCostRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", async (request, reply) => {
    if (request.url.startsWith("/v1/costs")) await authenticate(request, reply);
  });

  app.get<{ Querystring: { days?: string } }>("/v1/costs/summary", async (request, reply) => {
    if (!request.authContext) return;
    const days = Math.max(1, Math.min(365, Number.parseInt(request.query.days ?? "90", 10) || 90));
    const data = await withOrgTransaction(request.authContext.orgId, async (client) => {
      const [totals, daily, freshness] = await Promise.all([
        client.query(
          "SELECT provider, currency, COALESCE(SUM(amount) FILTER (WHERE period_start >= date_trunc('month', CURRENT_DATE)::date),0)::text AS month_to_date, " +
          "COALESCE(SUM(amount) FILTER (WHERE period_start >= date_trunc('month', CURRENT_DATE - interval '1 month')::date AND period_start < date_trunc('month', CURRENT_DATE)::date),0)::text AS previous_month " +
          "FROM cost_records WHERE org_id=$1 AND period_start >= CURRENT_DATE - ($2::int * interval '1 day') GROUP BY provider,currency ORDER BY provider,currency",
          [request.authContext!.orgId, days],
        ),
        client.query(
          "SELECT period_start AS date, provider, currency, SUM(amount)::text AS amount FROM cost_records " +
          "WHERE org_id=$1 AND period_start >= CURRENT_DATE - ($2::int * interval '1 day') GROUP BY period_start,provider,currency ORDER BY period_start ASC",
          [request.authContext!.orgId, days],
        ),
        client.query(
          "SELECT provider, max(last_cost_sync_at) AS last_success_at, max(last_cost_sync_status) AS last_status " +
          "FROM cloud_accounts WHERE org_id=$1 AND disconnected_at IS NULL GROUP BY provider ORDER BY provider",
          [request.authContext!.orgId],
        ),
      ]);
      return { totals: totals.rows, daily: daily.rows, freshness: freshness.rows };
    });
    return reply.send({ ...data, windowDays: days, generatedAt: new Date().toISOString(), note: "Provider billing data may lag by up to 24 hours. Amounts are grouped as reported by each provider; currencies are not converted." });
  });

  app.get<{ Querystring: { group_by?: string; days?: string } }>("/v1/costs/breakdown", async (request, reply) => {
    if (!request.authContext) return;
    const groupBy = request.query.group_by ?? "provider";
    if (!groupings.has(groupBy)) return reply.code(400).send({ error: { code: "INVALID_GROUPING", message: "group_by must be provider, service, or account." } });
    const days = Math.max(1, Math.min(365, Number.parseInt(request.query.days ?? "90", 10) || 90));
    const column = groupBy === "provider" ? "c.provider" : groupBy === "service" ? "c.service" : "a.display_name";
    const result = await withOrgTransaction(request.authContext.orgId, (client) => client.query(
      "SELECT " + column + " AS label, c.provider, c.currency, SUM(c.amount)::text AS amount, " +
      "MIN(c.period_start) AS period_start, MAX(c.period_end) AS period_end " +
      "FROM cost_records c JOIN cloud_accounts a ON a.id=c.cloud_account_id AND a.org_id=c.org_id " +
      "WHERE c.org_id=$1 AND c.period_start >= CURRENT_DATE - ($2::int * interval '1 day') " +
      "GROUP BY " + column + ",c.provider,c.currency ORDER BY SUM(c.amount) DESC LIMIT 100",
      [request.authContext!.orgId, days],
    ));
    return reply.send({ groupBy, rows: result.rows, windowDays: days });
  });
}
