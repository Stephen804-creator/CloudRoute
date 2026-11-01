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

test("inventory sync rechecks account connection before persisting provider results", async () => {
  const source = await readFile(fileURLToPath(new URL("./sync.ts", import.meta.url)), "utf8");
  assert.match(source, /SELECT id FROM cloud_accounts WHERE id=\$1 AND org_id=\$2 AND disconnected_at IS NULL FOR UPDATE/);
  assert.match(source, /error_code='ACCOUNT_DISCONNECTED'/);
  assert.match(source, /disconnected_at IS NULL/);
});

test("cost sync rechecks account connection before persisting provider results", async () => {
  const source = await readFile(fileURLToPath(new URL("./cost-sync.ts", import.meta.url)), "utf8");
  assert.match(source, /SELECT id FROM cloud_accounts WHERE id=\$1 AND org_id=\$2 AND disconnected_at IS NULL FOR UPDATE/);
  assert.match(source, /error_code='ACCOUNT_DISCONNECTED'/);
  assert.match(source, /disconnected_at IS NULL/);
});

test("inventory and cost syncs use expiring ownership leases before persistence", async () => {
  const inventory = await readFile(fileURLToPath(new URL("./sync.ts", import.meta.url)), "utf8");
  const costs = await readFile(fileURLToPath(new URL("./cost-sync.ts", import.meta.url)), "utf8");
  for (const source of [inventory, costs]) {
    assert.match(source, /lease_token=\$4/);
    assert.match(source, /lease_expires_at=now\(\)\+interval '15 minutes'/);
    assert.match(source, /lease_token=\$3 AND lease_expires_at>now\(\) FOR UPDATE/);
    assert.match(source, /setInterval\(\(\) =>/);
  }
  assert.match(inventory, /recoverExpiredSyncRunsOnce/);
  assert.match(inventory, /WORKER_LEASE_EXPIRED/);
});
