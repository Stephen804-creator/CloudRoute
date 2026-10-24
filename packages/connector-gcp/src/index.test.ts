import assert from "node:assert/strict";
import test from "node:test";
import { GcpInventoryConnector, normalizeGcpAsset } from "./index.js";

test("normalizes a Compute Engine instance and preserves provider metadata", () => {
  const result = normalizeGcpAsset({
    name: "//compute.googleapis.com/projects/demo-prod/zones/us-central1-a/instances/web-01",
    assetType: "compute.googleapis.com/Instance",
    updateTime: "2026-10-01T12:00:00Z",
    resource: { location: "us-central1-a", data: { name: "web-01", status: "RUNNING", zone: "projects/demo-prod/zones/us-central1-a", labels: { env: "prod", count: 4 }, machineType: "e2-medium" } },
  }, "demo-prod", "2026-10-24T10:00:00.000Z");
  assert.ok(result);
  assert.equal(result.provider, "gcp");
  assert.equal(result.providerAccountId, "demo-prod");
  assert.equal(result.resourceType, "compute_instance");
  assert.equal(result.displayName, "web-01");
  assert.equal(result.region, "us-central1-a");
  assert.equal(result.rawPayload.status, "RUNNING");
  assert.deepEqual(result.rawPayload.labels, { env: "prod" });
  assert.equal((result.rawPayload.data as Record<string, unknown>).machineType, "e2-medium");
});

test("maps supported asset types to provider-neutral CloudRoute resource types", () => {
  const cases: Array<[string, string]> = [
    ["compute.googleapis.com/Disk", "block_volume"], ["storage.googleapis.com/Bucket", "object_bucket"],
    ["sqladmin.googleapis.com/Instance", "database"], ["cloudfunctions.googleapis.com/Function", "function"],
    ["compute.googleapis.com/ForwardingRule", "load_balancer"], ["compute.googleapis.com/Address", "static_ip"],
    ["compute.googleapis.com/Snapshot", "snapshot"],
  ];
  for (const [assetType, expected] of cases) {
    assert.equal(normalizeGcpAsset({ name: "//resource/example", assetType, resource: { data: { name: "example" } } }, "demo-prod")?.resourceType, expected);
  }
});

test("skips malformed assets with no canonical resource name", () => {
  assert.equal(normalizeGcpAsset({ assetType: "compute.googleapis.com/Instance" }, "demo-prod"), null);
});

test("paginates Cloud Asset Inventory using GET-only requests", async () => {
  const requested: URL[] = [];
  let call = 0;
  const connector = new GcpInventoryConnector("cloudroute-reader@demo-prod.iam.gserviceaccount.com", {
    getAccessToken: async () => "short-lived-test-token",
    now: () => new Date("2026-10-24T10:00:00.000Z"),
    fetch: async (input, init) => {
      assert.equal(init?.method, "GET");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer short-lived-test-token");
      requested.push(new URL(String(input)));
      call++;
      return new Response(JSON.stringify(call === 1
        ? { assets: [{ name: "//compute.googleapis.com/projects/demo-prod/zones/us-central1-a/instances/web-01", assetType: "compute.googleapis.com/Instance", resource: { data: { name: "web-01" } } }], nextPageToken: "next-page" }
        : { assets: [{ name: "//storage.googleapis.com/projects/_/buckets/demo-bucket", assetType: "storage.googleapis.com/Bucket", resource: { data: { name: "demo-bucket" } } }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const account = { provider: "gcp" as const, accountId: "demo-prod" };
  const first = await connector.listResources(account);
  const second = await connector.listResources(account, first.nextPageToken ?? undefined);
  assert.equal(first.resources.length, 1);
  assert.equal(first.nextPageToken, "next-page");
  assert.equal(second.resources[0]?.resourceType, "object_bucket");
  assert.equal(requested.length, 2);
  assert.equal(requested[1]?.searchParams.get("pageToken"), "next-page");
  assert.equal(requested[0]?.searchParams.get("contentType"), "RESOURCE");
});

test("rejects invalid service account and project identifiers", async () => {
  assert.throws(() => new GcpInventoryConnector("not-an-email"), /INVALID_GCP_SERVICE_ACCOUNT/);
  const connector = new GcpInventoryConnector("reader@demo-prod.iam.gserviceaccount.com", { getAccessToken: async () => "token" });
  await assert.rejects(connector.listResources({ provider: "gcp", accountId: "Bad Project ID" }), /INVALID_GCP_PROJECT_ID/);
});

test("redacts function environment variables and secret-like fields before persistence", () => {
  const result = normalizeGcpAsset({
    name: "//cloudfunctions.googleapis.com/projects/demo-prod/locations/us-central1/functions/worker",
    assetType: "cloudfunctions.googleapis.com/Function",
    resource: { data: { name: "worker", serviceConfig: { environmentVariables: { API_KEY: "must-not-persist" }, secretEnvironmentVariables: [{ key: "TOKEN", projectId: "demo-prod", secret: "secret-name" }], availableMemory: "256M" }, labels: { team: "platform" } } },
  }, "demo-prod");
  assert.ok(result);
  const serialized = JSON.stringify(result.rawPayload);
  assert.equal(serialized.includes("must-not-persist"), false);
  assert.equal(serialized.includes("environmentVariables"), false);
  assert.equal(serialized.includes("secretEnvironmentVariables"), false);
  assert.deepEqual(result.rawPayload.labels, { team: "platform" });
});
