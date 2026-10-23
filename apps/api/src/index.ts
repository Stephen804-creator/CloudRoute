import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAccountRoutes } from "./routes/accounts.js";
import { registerResourceRoutes } from "./routes/resources.js";
import type { AuthContext } from "./auth/session.js";

const app = Fastify({ logger: process.env.NODE_ENV !== "test", bodyLimit: 1_048_576 });
app.decorateRequest("authContext", null as AuthContext | null);
await app.register(cookie);

app.addHook("onRequest", async (request, reply) => {
  const unsafe = ["POST", "PUT", "PATCH", "DELETE"].includes(request.method);
  const origin = request.headers.origin;
  const allowedOrigin = process.env.PUBLIC_APP_ORIGIN ?? "http://localhost:3000";
  if (unsafe && origin && origin !== allowedOrigin) {
    return reply.code(403).send({ error: { code: "ORIGIN_NOT_ALLOWED", message: "Request origin is not allowed." } });
  }
});
app.addHook("onSend", async (_request, reply, payload) => {
  reply.header("x-content-type-options", "nosniff");
  reply.header("x-frame-options", "DENY");
  reply.header("referrer-policy", "no-referrer");
  reply.header("cache-control", "no-store");
  return payload;
});

app.get("/health", async () => ({ status: "ok", service: "cloudroute-api", mode: "read-only" }));
await registerAuthRoutes(app);
await registerAccountRoutes(app);
await registerResourceRoutes(app);

const port = Number.parseInt(process.env.PORT ?? "4000", 10);
const host = process.env.HOST ?? "127.0.0.1";
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer between 1 and 65535");

const invokedPath = process.argv[1];
const isEntrypoint = invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href;
if (isEntrypoint) {
  try { await app.listen({ port, host }); }
  catch (error) { app.log.error(error, "API startup failed"); process.exitCode = 1; }
}
export { app };
