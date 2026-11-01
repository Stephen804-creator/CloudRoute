import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { query } from "@cloudroute/db";

interface RateLimitPolicy {
  bucket: string;
  limit: number;
  windowSeconds: number;
}

export function getRateLimitPolicy(method: string, route: string): RateLimitPolicy | null {
  if (route === "/health" || route === "/ready" || route === "/v1/health/database") return null;
  if (route === "/v1/auth/login" || route === "/v1/auth/signup" || route === "/v1/auth/google/callback") {
    return { bucket: "authentication", limit: 10, windowSeconds: 900 };
  }
  if (route.startsWith("/v1/accounts") && (method === "POST" || method === "DELETE")) {
    return { bucket: "account-mutation", limit: 30, windowSeconds: 60 };
  }
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return { bucket: "mutation", limit: 60, windowSeconds: 60 };
  }
  return { bucket: "read", limit: 300, windowSeconds: 60 };
}

let requestsSinceCleanup = 0;

export async function enforceRateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const route = request.routeOptions.url ?? request.url.split("?")[0] ?? "/";
  const policy = getRateLimitPolicy(request.method, route);
  if (!policy) return;

  // Hash the network identifier so raw IP addresses are not retained in the
  // shared counter table. Fastify does not trust forwarded headers by default.
  const bucketKey = createHash("sha256")
    .update(policy.bucket + ":" + request.ip)
    .digest("hex");

  try {
    const result = await query<{ request_count: number; window_started_at: Date | string }>(
      "INSERT INTO api_rate_limits(bucket_key,window_started_at,request_count,expires_at) " +
      "VALUES ($1,to_timestamp(floor(extract(epoch FROM clock_timestamp()) / $2) * $2),1,now()+($2::int * interval '2 seconds')) " +
      "ON CONFLICT (bucket_key) DO UPDATE SET " +
      "request_count=CASE WHEN api_rate_limits.window_started_at < to_timestamp(floor(extract(epoch FROM clock_timestamp()) / $2) * $2) THEN 1 ELSE api_rate_limits.request_count+1 END, " +
      "window_started_at=to_timestamp(floor(extract(epoch FROM clock_timestamp()) / $2) * $2), " +
      "expires_at=now()+($2::int * interval '2 seconds') " +
      "RETURNING request_count,window_started_at",
      [bucketKey, policy.windowSeconds],
    );
    const count = Number(result.rows[0]?.request_count ?? 0);
    const windowStart = new Date(result.rows[0]?.window_started_at ?? Date.now()).getTime();
    if (count > policy.limit) {
      const retryAfter = Math.max(1, Math.ceil((windowStart + policy.windowSeconds * 1000 - Date.now()) / 1000));
      reply.header("retry-after", String(retryAfter));
      reply.code(429).send({ error: { code: "RATE_LIMITED", message: "Too many requests. Wait before trying again." } });
      return;
    }

    requestsSinceCleanup++;
    if (requestsSinceCleanup >= 100) {
      requestsSinceCleanup = 0;
      await query(
        "WITH expired AS (SELECT bucket_key FROM api_rate_limits WHERE expires_at < now() ORDER BY expires_at LIMIT 500) " +
        "DELETE FROM api_rate_limits limits USING expired WHERE limits.bucket_key=expired.bucket_key",
      );
    }
  } catch {
    reply.code(503).send({ error: { code: "RATE_LIMITER_UNAVAILABLE", message: "Request protection is temporarily unavailable. Try again shortly." } });
  }
}
