import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { closePool, getPool, withOrgTransaction, withTransaction } from "./client.js";

test("row-level security blocks cross-tenant reads and writes", { skip: !process.env.DATABASE_URL }, async () => {
  const suffix = randomUUID();
  let userA = "";
  let userB = "";
  let orgA = "";
  let orgB = "";
  let accountA = "";
  try {
    const created = await withTransaction(async (client) => {
      const a = await client.query<{ id: string }>(
        "INSERT INTO users(email,password_hash,full_name) VALUES ($1,'test-hash','Tenant A') RETURNING id",
        ["tenant-a-" + suffix + "@example.test"],
      );
      const b = await client.query<{ id: string }>(
        "INSERT INTO users(email,password_hash,full_name) VALUES ($1,'test-hash','Tenant B') RETURNING id",
        ["tenant-b-" + suffix + "@example.test"],
      );
      const oa = await client.query<{ id: string }>("INSERT INTO organizations(name,created_by) VALUES ('Tenant A ' || $1,$2) RETURNING id", [suffix, a.rows[0]!.id]);
      const ob = await client.query<{ id: string }>("INSERT INTO organizations(name,created_by) VALUES ('Tenant B ' || $1,$2) RETURNING id", [suffix, b.rows[0]!.id]);
      await client.query("SELECT set_config('app.current_org_id',$1,true)", [oa.rows[0]!.id]);
      await client.query("INSERT INTO memberships(org_id,user_id,role) VALUES ($1,$2,'owner')", [oa.rows[0]!.id,a.rows[0]!.id]);
      await client.query("SELECT set_config('app.current_org_id',$1,true)", [ob.rows[0]!.id]);
      await client.query("INSERT INTO memberships(org_id,user_id,role) VALUES ($1,$2,'owner')", [ob.rows[0]!.id,b.rows[0]!.id]);
      return { userA: a.rows[0]!.id, userB: b.rows[0]!.id, orgA: oa.rows[0]!.id, orgB: ob.rows[0]!.id };
    });
    userA = created.userA; userB = created.userB; orgA = created.orgA; orgB = created.orgB;

    const account = await withOrgTransaction(orgA, (client) => client.query<{ id: string }>(
      "INSERT INTO cloud_accounts(org_id,provider,display_name,external_account_id,role_arn,external_id) VALUES ($1,'aws','Tenant A AWS',$2,NULL,'test-external-id') RETURNING id",
      [orgA, "123456789012"],
    ));
    accountA = account.rows[0]!.id;

    const crossRead = await withOrgTransaction(orgB, (client) => client.query(
      "SELECT id FROM cloud_accounts WHERE id=$1", [accountA],
    ));
    assert.equal(crossRead.rowCount, 0, "tenant B must not read tenant A's account");

    await assert.rejects(
      withOrgTransaction(orgB, (client) => client.query(
        "INSERT INTO cloud_accounts(org_id,provider,display_name,external_account_id,role_arn,external_id) VALUES ($1,'aws','Forbidden',$2,NULL,'test-id')",
        [orgA, "123456789013"],
      )),
      (error: unknown) => (error as { code?: string }).code === "42501",
      "tenant B must not write a row for tenant A",
    );
  } finally {
    if (orgA || orgB) await withTransaction(async (client) => {
      if (orgA) await client.query("DELETE FROM organizations WHERE id=$1", [orgA]);
      if (orgB) await client.query("DELETE FROM organizations WHERE id=$1", [orgB]);
      if (userA) await client.query("DELETE FROM users WHERE id=$1", [userA]);
      if (userB) await client.query("DELETE FROM users WHERE id=$1", [userB]);
    });
    await closePool();
  }
});
