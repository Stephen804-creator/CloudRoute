import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import { awsConnector } from "@cloudroute/connector-aws";
import { gcpConnector } from "@cloudroute/connector-gcp";

const app = Fastify({
  logger: process.env.NODE_ENV !== "test",
  bodyLimit: 1_048_576,
});

app.get("/health", async () => ({
  status: "ok",
  service: "cloudroute-api",
  mode: "read-only",
}));

app.get("/providers", async () => {
  const demoMode = process.env.CLOUDROUTE_DEMO_MODE === "1";
  const connectors = [awsConnector, gcpConnector];

  const snapshots = await Promise.all(
    connectors.map(async (connector) => {
      const accountId =
        connector.provider === "aws"
          ? process.env.CLOUDROUTE_AWS_ACCOUNT_ID ?? "demo-aws-account"
          : process.env.CLOUDROUTE_GCP_PROJECT_ID ?? "demo-gcp-project";

      if (!demoMode) {
        return {
          provider: connector.provider,
          status: "disconnected",
          message:
            "No provider account is configured. Connect a read-only account to enable inventory syncs.",
          accountId,
          resourceCount: 0,
          readOnly: true,
        };
      }

      try {
        await connector.validateConnection({
          provider: connector.provider,
          accountId,
          displayName: `${connector.provider.toUpperCase()} demo account`,
        });

        const page = await connector.listResources({
          provider: connector.provider,
          accountId,
          displayName: `${connector.provider.toUpperCase()} demo account`,
        });

        return {
          provider: connector.provider,
          status: "connected",
          message: "Read-only inventory is available in demo mode.",
          accountId,
          resourceCount: page.resources.length,
          readOnly: true,
        };
      } catch (error) {
        return {
          provider: connector.provider,
          status: "error",
          message: error instanceof Error ? error.message : "Unknown provider validation failure.",
          accountId,
          resourceCount: 0,
          readOnly: true,
        };
      }
    }),
  );

  return {
    mode: "read-only",
    providers: snapshots,
  };
});

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
