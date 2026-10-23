import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Fastify from "fastify";

const app = Fastify({
  logger: process.env.NODE_ENV !== "test",
  bodyLimit: 1_048_576,
});

app.get("/health", async () => ({
  status: "ok",
  service: "cloudroute-api",
  mode: "read-only",
}));

const port = Number.parseInt(process.env.PORT ?? "4000", 10);
const host = process.env.HOST ?? "127.0.0.1";

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

const invokedPath = process.argv[1];
const isEntrypoint =
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href;

if (isEntrypoint) {
  try {
    await app.listen({ port, host });
  } catch (error) {
    app.log.error(error, "API startup failed");
    process.exitCode = 1;
  }
}

export { app };
