import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "dotenv";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { query } from "@cloudroute/db";
import { assertRuntimeEnvironment, isAllowedBrowserOrigin } from "./runtime-config.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAccountRoutes } from "./routes/accounts.js";
import { registerResourceRoutes } from "./routes/resources.js";
import { registerCostRoutes } from "./routes/costs.js";
import { registerFindingRoutes } from "./routes/findings.js";
import { registerResourceHistoryRoutes } from "./routes/resource-history.js";
import { registerNotificationPreferenceRoutes } from "./routes/notification-preferences.js";
import type { AuthContext } from "./auth/session.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"), override: false });

const app = Fastify({ logger: process.env.NODE_ENV !== "test", bodyLimit: 1_048_576 });
app.decorateRequest("authContext", null as AuthContext | null);
await app.register(cookie);

app.addHook("onRequest", async (request, reply) => {
  const unsafe = ["POST", "PUT", "PATCH", "DELETE"].includes(request.method);
  if (unsafe && !isAllowedBrowserOrigin(request.headers.origin, process.env.PUBLIC_APP_ORIGIN, process.env.NODE_ENV === "production")) {
    return reply.code(403).send({ error: { code: "ORIGIN_NOT_ALLOWED", message: "Request origin is not allowed." } });
  }
});
app.addHook("onSend", async (_request, reply, payload) => {
  reply.header("x-content-type-options", "nosniff");
  reply.header("x-frame-options", "DENY");
  reply.header("referrer-policy", "no-referrer");
  reply.header("cache-control", "no-store");
  if (process.env.NODE_ENV === "production") {
    reply.header("strict-transport-security", "max-age=63072000; includeSubDomains");
  }
  return payload;
});

app.get("/health", async () => ({ status: "ok", service: "cloudroute-api", mode: "read-only" }));
app.get("/ready", async (_request, reply) => {
  try {
    await query("SELECT 1");
    return { status: "ready", service: "cloudroute-api" };
  } catch {
    return reply.code(503).send({ status: "not_ready", service: "cloudroute-api" });
  }
});
await registerAuthRoutes(app);
await registerAccountRoutes(app);
await registerResourceRoutes(app);
await registerResourceHistoryRoutes(app);
await registerCostRoutes(app);
await registerFindingRoutes(app);
await registerNotificationPreferenceRoutes(app);

const port = Number.parseInt(process.env.PORT ?? "4000", 10);
const host = process.env.HOST ?? (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer between 1 and 65535");

const invokedPath = process.argv[1];
const isEntrypoint = invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href;
if (isEntrypoint) {
  try {
    assertRuntimeEnvironment();
    await app.listen({ port, host });
  } catch (error) {
    app.log.error(error, "API startup failed");
    process.exitCode = 1;
  }
}
export { app };
