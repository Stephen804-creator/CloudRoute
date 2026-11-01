import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { closePool, withOrgTransaction, withTransaction } from "./client.js";

test("row-level security blocks cross-tenant reads, updates, deletes, and inserts", { skip: !process.env.DATABASE_URL }, async () => {
  const suffix = randomUUID();
  let userA = "", userB = "", orgA = "", orgB = "", accountA = "";
  const ids: Record<string, string> = {};
  try {
    const created = await withTransaction(async (client) => {
      const a = await client.query<{id:string}>("INSERT INTO users(email,password_hash,full_name) VALUES ($1,'test-hash','Tenant A') RETURNING id", ["tenant-a-"+suffix+"@example.test"]);
      const b = await client.query<{id:string}>("INSERT INTO users(email,password_hash,full_name) VALUES ($1,'test-hash','Tenant B') RETURNING id", ["tenant-b-"+suffix+"@example.test"]);
      const oa = await client.query<{id:string}>("INSERT INTO organizations(name,created_by) VALUES ('Tenant A ' || $1,$2) RETURNING id", [suffix,a.rows[0]!.id]);
      const ob = await client.query<{id:string}>("INSERT INTO organizations(name,created_by) VALUES ('Tenant B ' || $1,$2) RETURNING id", [suffix,b.rows[0]!.id]);
      await client.query("SELECT set_config('app.current_org_id',$1,true)", [oa.rows[0]!.id]);
      await client.query("INSERT INTO memberships(org_id,user_id,role) VALUES ($1,$2,'owner')", [oa.rows[0]!.id,a.rows[0]!.id]);
      await client.query("SELECT set_config('app.current_org_id',$1,true)", [ob.rows[0]!.id]);
      await client.query("INSERT INTO memberships(org_id,user_id,role) VALUES ($1,$2,'owner')", [ob.rows[0]!.id,b.rows[0]!.id]);
      return {userA:a.rows[0]!.id,userB:b.rows[0]!.id,orgA:oa.rows[0]!.id,orgB:ob.rows[0]!.id};
    });
    ({userA,userB,orgA,orgB}=created);
    const account = await withOrgTransaction(orgA, client => client.query<{id:string}>(
      "INSERT INTO cloud_accounts(org_id,provider,display_name,external_account_id,role_arn,external_id) VALUES ($1,'aws','Tenant A AWS',$2,NULL,'test-external-id') RETURNING id",
      [orgA,"123456789012"]));
    accountA=account.rows[0]!.id;
    await withOrgTransaction(orgA, async client => {
      const resource=await client.query<{id:string}>("INSERT INTO resources(org_id,cloud_account_id,provider,external_id,resource_type,display_name) VALUES ($1,$2,'aws','i-' || $3,'ec2_instance','Tenant A resource') RETURNING id",[orgA,accountA,suffix]);
      ids.resource=resource.rows[0]!.id;
      const cost=await client.query<{id:string}>("INSERT INTO cost_records(org_id,cloud_account_id,provider,period_start,period_end,service,amount,currency) VALUES ($1,$2,'aws',CURRENT_DATE,CURRENT_DATE+1,'Amazon EC2',12.5,'USD') RETURNING id",[orgA,accountA]);
      ids.cost=cost.rows[0]!.id;
      const finding=await client.query<{id:string}>("INSERT INTO findings(org_id,cloud_account_id,resource_id,rule_key,title,description) VALUES ($1,$2,$3,'test_rule','Tenant A finding','RLS fixture') RETURNING id",[orgA,accountA,ids.resource]);
      ids.finding=finding.rows[0]!.id;
      const history=await client.query<{id:string}>("SELECT id FROM resource_history WHERE org_id=$1 AND resource_id=$2 ORDER BY observed_at DESC LIMIT 1",[orgA,ids.resource]);
      assert.ok(history.rows[0],"resource creation should produce history");
      ids.history=history.rows[0]!.id;
      await client.query("INSERT INTO notification_preferences(org_id) VALUES ($1)",[orgA]);
      const outbox=await client.query<{id:string}>("INSERT INTO email_outbox(org_id,recipient,template_key,dedupe_key) VALUES ($1,'tenant-a@example.test','weekly_digest',$2) RETURNING id",[orgA,"rls-test:"+suffix]);
      ids.outbox=outbox.rows[0]!.id;
    });

    const reads=await withOrgTransaction(orgB,client=>Promise.all([
      client.query("SELECT id FROM cloud_accounts WHERE id=$1",[accountA]),
      client.query("SELECT id FROM resources WHERE id=$1",[ids.resource]),
      client.query("SELECT id FROM cost_records WHERE id=$1",[ids.cost]),
      client.query("SELECT id FROM findings WHERE id=$1",[ids.finding]),
      client.query("SELECT id FROM resource_history WHERE id=$1",[ids.history]),
      client.query("SELECT org_id FROM notification_preferences WHERE org_id=$1",[orgA]),
      client.query("SELECT id FROM email_outbox WHERE id=$1",[ids.outbox]),
    ]));
    for(const result of reads) assert.equal(result.rowCount,0,"cross-tenant read must return no rows");

    const updates=await withOrgTransaction(orgB,client=>Promise.all([
      client.query("UPDATE cloud_accounts SET display_name='tampered' WHERE id=$1",[accountA]),
      client.query("UPDATE resources SET display_name='tampered' WHERE id=$1",[ids.resource]),
      client.query("UPDATE cost_records SET amount=999 WHERE id=$1",[ids.cost]),
      client.query("UPDATE findings SET title='tampered' WHERE id=$1",[ids.finding]),
      client.query("UPDATE notification_preferences SET weekly_digest_enabled=false WHERE org_id=$1",[orgA]),
      client.query("UPDATE email_outbox SET status='sent' WHERE id=$1",[ids.outbox]),
    ]));
    for(const result of updates) assert.equal(result.rowCount,0,"cross-tenant update must affect no rows");

    const deletes=await withOrgTransaction(orgB,client=>Promise.all([
      client.query("DELETE FROM cloud_accounts WHERE id=$1",[accountA]),
      client.query("DELETE FROM resources WHERE id=$1",[ids.resource]),
      client.query("DELETE FROM cost_records WHERE id=$1",[ids.cost]),
      client.query("DELETE FROM findings WHERE id=$1",[ids.finding]),
      client.query("DELETE FROM resource_history WHERE id=$1",[ids.history]),
      client.query("DELETE FROM notification_preferences WHERE org_id=$1",[orgA]),
      client.query("DELETE FROM email_outbox WHERE id=$1",[ids.outbox]),
    ]));
    for(const result of deletes) assert.equal(result.rowCount,0,"cross-tenant delete must affect no rows");

    const forbidden=[
      () => withOrgTransaction(orgB,client=>client.query("INSERT INTO cloud_accounts(org_id,provider,display_name,external_account_id,role_arn,external_id) VALUES ($1,'aws','Forbidden',$2,NULL,'test-id')",[orgA,"123456789013"])),
      () => withOrgTransaction(orgB,client=>client.query("INSERT INTO resources(org_id,cloud_account_id,provider,external_id,resource_type) VALUES ($1,$2,'aws',$3,'ec2_instance')",[orgA,accountA,"forbidden-"+suffix])),
      () => withOrgTransaction(orgB,client=>client.query("INSERT INTO notification_preferences(org_id) VALUES ($1)",[orgA])),
      () => withOrgTransaction(orgB,client=>client.query("INSERT INTO email_outbox(org_id,recipient,template_key,dedupe_key) VALUES ($1,'forbidden@example.test','weekly_digest',$2)",[orgA,"forbidden:"+suffix])),
    ];
    for(const insert of forbidden) await assert.rejects(insert,(error:unknown)=>(error as {code?:string}).code==="42501","cross-tenant insert must be rejected");

    const unchanged=await withOrgTransaction(orgA,client=>Promise.all([
      client.query<{display_name:string}>("SELECT display_name FROM cloud_accounts WHERE id=$1",[accountA]),
      client.query<{display_name:string}>("SELECT display_name FROM resources WHERE id=$1",[ids.resource]),
      client.query<{amount:string}>("SELECT amount::text FROM cost_records WHERE id=$1",[ids.cost]),
      client.query<{title:string}>("SELECT title FROM findings WHERE id=$1",[ids.finding]),
    ]));
    assert.equal(unchanged[0].rows[0]?.display_name,"Tenant A AWS");
    assert.equal(unchanged[1].rows[0]?.display_name,"Tenant A resource");
    assert.equal(unchanged[2].rows[0]?.amount,"12.500000");
    assert.equal(unchanged[3].rows[0]?.title,"Tenant A finding");
  } finally {
    if(orgA||orgB) await withTransaction(async client=>{
      if(orgA) await client.query("DELETE FROM organizations WHERE id=$1",[orgA]);
      if(orgB) await client.query("DELETE FROM organizations WHERE id=$1",[orgB]);
      if(userA) await client.query("DELETE FROM users WHERE id=$1",[userA]);
      if(userB) await client.query("DELETE FROM users WHERE id=$1",[userB]);
    });
    await closePool();
  }
});
