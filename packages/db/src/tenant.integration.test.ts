import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { closePool, withOrgTransaction, withTransaction } from "./client.js";

test("row-level security blocks cross-tenant reads and writes across core and Unit 9–12 data", { skip: !process.env.DATABASE_URL }, async () => {
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

    await withOrgTransaction(orgA, async (client) => {
      const resource = await client.query<{ id: string }>(
        "INSERT INTO resources(org_id,cloud_account_id,provider,external_id,resource_type,display_name) VALUES ($1,$2,'aws','i-' || $3,'ec2_instance','Tenant A resource') RETURNING id",
        [orgA, accountA, suffix],
      );
      await client.query(
        "INSERT INTO cost_records(org_id,cloud_account_id,provider,period_start,period_end,service,amount,currency) VALUES ($1,$2,'aws',CURRENT_DATE,CURRENT_DATE + 1,'Amazon EC2',12.5,'USD')",
        [orgA, accountA],
      );
      await client.query(
        "INSERT INTO findings(org_id,cloud_account_id,resource_id,rule_key,title,description) VALUES ($1,$2,$3,'test_rule','Tenant A finding','RLS integration fixture')",
        [orgA, accountA, resource.rows[0]!.id],
      );
      await client.query("INSERT INTO notification_preferences(org_id) VALUES ($1)", [orgA]);
      await client.query(
        "INSERT INTO email_outbox(org_id,recipient,template_key,dedupe_key) VALUES ($1,'tenant-a@example.test','weekly_digest',$2)",
        [orgA, "rls-test:" + suffix],
      );
    });

    const crossRead = await withOrgTransaction(orgB, async (client) => {
      const accounts = await client.query("SELECT id FROM cloud_accounts WHERE id=$1", [accountA]);
      const resources = await client.query("SELECT id FROM resources WHERE org_id=$1", [orgA]);
      const costs = await client.query("SELECT id FROM cost_records WHERE org_id=$1", [orgA]);
      const findings = await client.query("SELECT id FROM findings WHERE org_id=$1", [orgA]);
      const history = await client.query("SELECT id FROM resource_history WHERE org_id=$1", [orgA]);
      const preferences = await client.query("SELECT org_id FROM notification_preferences WHERE org_id=$1", [orgA]);
      const outbox = await client.query("SELECT id FROM email_outbox WHERE org_id=$1", [orgA]);
      return [accounts, resources, costs, findings, history, preferences, outbox];
    });
    for (const result of crossRead) assert.equal(result.rowCount, 0, "tenant B must not read tenant A data");

    await assert.rejects(
      withOrgTransaction(orgB, (client) => client.query(
        "INSERT INTO cloud_accounts(org_id,provider,display_name,external_account_id,role_arn,external_id) VALUES ($1,'aws','Forbidden',$2,NULL,'test-id')",
        [orgA, "123456789013"],
      )),
      (error: unknown) => (error as { code?: string }).code === "42501",
      "tenant B must not write a row for tenant A",
    );
    await assert.rejects(
      withOrgTransaction(orgB, (client) => client.query(
        "INSERT INTO notification_preferences(org_id) VALUES ($1)",
        [orgA],
      )),
      (error: unknown) => (error as { code?: string }).code === "42501",
      "tenant B must not create tenant A notification preferences",
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
