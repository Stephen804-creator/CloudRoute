import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { closePool, query, withOrgTransaction, withTransaction } from "@cloudroute/db";
import { recoverExpiredSyncRunsOnce } from "./sync.js";

test("expired sync leases are requeued while active leases remain running", { skip: !process.env.DATABASE_URL }, async () => {
  const suffix = randomUUID();
  let userId = "";
  let orgId = "";
  let accountId = "";
  let expiredRunId = "";
  let activeRunId = "";
  try {
    const created = await withTransaction(async client => {
      const user = await client.query<{id:string}>(
        "INSERT INTO users(email,password_hash,full_name) VALUES ($1,'test-hash','Worker Lease Test') RETURNING id",
        ["worker-lease-"+suffix+"@example.test"],
      );
      const org = await client.query<{id:string}>(
        "INSERT INTO organizations(name,created_by) VALUES ($1,$2) RETURNING id",
        ["Worker Lease "+suffix,user.rows[0]!.id],
      );
      await client.query("SELECT set_config('app.current_org_id',$1,true)",[org.rows[0]!.id]);
      await client.query("INSERT INTO memberships(org_id,user_id,role) VALUES ($1,$2,'owner')",[org.rows[0]!.id,user.rows[0]!.id]);
      return {userId:user.rows[0]!.id,orgId:org.rows[0]!.id};
    });
    userId=created.userId; orgId=created.orgId;

    await withOrgTransaction(orgId,async client=>{
      const account=await client.query<{id:string}>(
        "INSERT INTO cloud_accounts(org_id,provider,display_name,external_account_id,role_arn,external_id) VALUES ($1,'aws','Worker Lease Account',$2,NULL,'lease-test') RETURNING id",
        [orgId,"123456789010"],
      );
      accountId=account.rows[0]!.id;
      const expired=await client.query<{id:string}>(
        "INSERT INTO sync_runs(org_id,cloud_account_id,job_type,status,started_at,lease_token,lease_expires_at) VALUES ($1,$2,'inventory_sync','running',now()-interval '1 hour',$3::uuid,now()-interval '30 minutes') RETURNING id",
        [orgId,accountId,randomUUID()],
      );
      expiredRunId=expired.rows[0]!.id;
      const active=await client.query<{id:string}>(
        "INSERT INTO sync_runs(org_id,cloud_account_id,job_type,status,started_at,lease_token,lease_expires_at) VALUES ($1,$2,'cost_sync','running',now(),$3::uuid,now()+interval '10 minutes') RETURNING id",
        [orgId,accountId,randomUUID()],
      );
      activeRunId=active.rows[0]!.id;
    });

    const recovered=await recoverExpiredSyncRunsOnce();
    assert.ok(recovered >= 1);
    const states=await withOrgTransaction(orgId, client => client.query<{id:string;status:string;lease_token:string|null;lease_expires_at:Date|null;error_code:string|null}>(
      "SELECT id,status,lease_token,lease_expires_at,error_code FROM sync_runs WHERE id=ANY($1::uuid[])",
      [[expiredRunId,activeRunId]],
    ));
    const expired=states.rows.find(row=>row.id===expiredRunId);
    const active=states.rows.find(row=>row.id===activeRunId);
    assert.equal(expired?.status,"queued");
    assert.equal(expired?.lease_token,null);
    assert.equal(expired?.lease_expires_at,null);
    assert.equal(expired?.error_code,"WORKER_LEASE_EXPIRED");
    assert.equal(active?.status,"running");
    assert.ok(active?.lease_token);
    assert.ok(active?.lease_expires_at);
  } finally {
    if(orgId) await query("DELETE FROM organizations WHERE id=$1",[orgId]);
    if(userId) await query("DELETE FROM users WHERE id=$1",[userId]);
    await closePool();
  }
});
