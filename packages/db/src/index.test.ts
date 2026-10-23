import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(new URL("../migrations/0001_initial.sql", import.meta.url));

test("schema contains required tenant-owned entities and RLS policies", async () => {
  const sql = await readFile(migrationPath, "utf8");
  for (const table of [
    "organizations", "users", "memberships", "cloud_accounts", "resources",
    "cost_records", "findings", "sync_runs", "audit_log", "migration_labels",
  ]) assert.match(sql, new RegExp(`CREATE TABLE ${table}\\b`, "i"));
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/i);
  assert.match(sql, /cloudroute_current_org_id/i);
  assert.match(sql, /audit_log_no_update/i);
});

test("resource identity is account-scoped and AWS key fields are absent", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /UNIQUE \(cloud_account_id, external_id\)/i);
  assert.match(sql, /role_arn text/i);
  assert.match(sql, /external_id text/i);
  assert.doesNotMatch(sql, /aws_access_key_id|aws_secret_access_key/i);
});
