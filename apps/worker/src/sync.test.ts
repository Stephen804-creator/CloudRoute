import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

test("resource deletion is gated on complete inventory runs", async () => {
  const source = await readFile(fileURLToPath(new URL("./sync.ts", import.meta.url)), "utf8");
  assert.match(source, /if \(inventory\.complete\)/);
  assert.match(source, /last_seen_at < \$3/);
  assert.match(source, /inventory\.complete \? "succeeded" : "partial"/);
});

test("resource upsert is idempotent on cloud account and external ID", async () => {
  const source = await readFile(fileURLToPath(new URL("./sync.ts", import.meta.url)), "utf8");
  assert.match(source, /ON CONFLICT \(cloud_account_id, external_id\) DO UPDATE/);
  assert.match(source, /deleted_detected_at=NULL/);
});
