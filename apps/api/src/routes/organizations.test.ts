import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { FastifyReply } from "fastify";
import { app } from "../index.js";
import { createSession, sessionCookieName } from "../auth/session.js";
import { closePool, query, withTransaction } from "@cloudroute/db";

test("organization deletion requires exact owner confirmation and preserves access to another workspace", { skip: !process.env.DATABASE_URL }, async () => {
  const suffix = randomUUID();
  let userId = "";
  let firstOrgId = "";
  let secondOrgId = "";
  let lastUserId = "";
  let lastOrgId = "";
  let firstToken = "";
  let lastToken = "";
  const fakeReply = (setToken: (value: string) => void) => ({
    setCookie(_name: string, value: string) { setToken(value); return fake; },
    clearCookie() { return fake; },
  } as unknown as FastifyReply);
  const fake = {} as FastifyReply;

  try {
    const created = await withTransaction(async client => {
      const user = await client.query<{id:string}>(
        "INSERT INTO users(email,password_hash,full_name) VALUES ($1,'test-hash','Workspace Owner') RETURNING id",
        ["org-route-"+suffix+"@example.test"],
      );
      const first = await client.query<{id:string}>(
        "INSERT INTO organizations(name,created_by) VALUES ('Old Workspace',$1) RETURNING id",
        [user.rows[0]!.id],
      );
      await client.query("SELECT set_config('app.current_org_id',$1,true)",[first.rows[0]!.id]);
      await client.query("INSERT INTO memberships(org_id,user_id,role) VALUES ($1,$2,'owner')",[first.rows[0]!.id,user.rows[0]!.id]);
      const second = await client.query<{id:string}>(
        "INSERT INTO organizations(name,created_by) VALUES ('Remaining Workspace',$1) RETURNING id",
        [user.rows[0]!.id],
      );
      await client.query("SELECT set_config('app.current_org_id',$1,true)",[second.rows[0]!.id]);
      await client.query("INSERT INTO memberships(org_id,user_id,role) VALUES ($1,$2,'owner')",[second.rows[0]!.id,user.rows[0]!.id]);

      const lastUser = await client.query<{id:string}>(
        "INSERT INTO users(email,password_hash,full_name) VALUES ($1,'test-hash','Last Workspace Owner') RETURNING id",
        ["last-org-route-"+suffix+"@example.test"],
      );
      const lastOrg = await client.query<{id:string}>(
        "INSERT INTO organizations(name,created_by) VALUES ('Only Workspace',$1) RETURNING id",
        [lastUser.rows[0]!.id],
      );
      await client.query("SELECT set_config('app.current_org_id',$1,true)",[lastOrg.rows[0]!.id]);
      await client.query("INSERT INTO memberships(org_id,user_id,role) VALUES ($1,$2,'owner')",[lastOrg.rows[0]!.id,lastUser.rows[0]!.id]);
      return { userId:user.rows[0]!.id, firstOrgId:first.rows[0]!.id, secondOrgId:second.rows[0]!.id, lastUserId:lastUser.rows[0]!.id, lastOrgId:lastOrg.rows[0]!.id };
    });
    userId=created.userId; firstOrgId=created.firstOrgId; secondOrgId=created.secondOrgId; lastUserId=created.lastUserId; lastOrgId=created.lastOrgId;

    await createSession(userId,fakeReply(value => { firstToken=value; }));
    await createSession(lastUserId,fakeReply(value => { lastToken=value; }));

    const mismatch = await app.inject({
      method:"DELETE",url:"/v1/organizations/"+firstOrgId,
      headers:{cookie:sessionCookieName+"="+firstToken,"content-type":"application/json"},
      payload:{confirmName:"Wrong Workspace"},
    });
    assert.equal(mismatch.statusCode,400);
    assert.equal((await query("SELECT id FROM organizations WHERE id=$1",[firstOrgId])).rowCount,1);

    const deletion = await app.inject({
      method:"DELETE",url:"/v1/organizations/"+firstOrgId,
      headers:{cookie:sessionCookieName+"="+firstToken,"content-type":"application/json"},
      payload:{confirmName:"Old Workspace"},
    });
    assert.equal(deletion.statusCode,200,deletion.body);
    assert.equal(JSON.parse(deletion.body).deleted,true);
    assert.equal((await query("SELECT id FROM organizations WHERE id=$1",[firstOrgId])).rowCount,0);
    assert.equal((await query("SELECT id FROM organization_deletion_audit WHERE organization_id=$1",[firstOrgId])).rowCount,1);

    const me = await app.inject({method:"GET",url:"/v1/auth/me",headers:{cookie:sessionCookieName+"="+firstToken}});
    assert.equal(me.statusCode,200,me.body);
    assert.equal(JSON.parse(me.body).organization.id,secondOrgId);

    const lastDeletion = await app.inject({
      method:"DELETE",url:"/v1/organizations/"+lastOrgId,
      headers:{cookie:sessionCookieName+"="+lastToken,"content-type":"application/json"},
      payload:{confirmName:"Only Workspace"},
    });
    assert.equal(lastDeletion.statusCode,409,lastDeletion.body);
    assert.equal(JSON.parse(lastDeletion.body).error.code,"LAST_WORKSPACE");
    assert.equal((await query("SELECT id FROM organizations WHERE id=$1",[lastOrgId])).rowCount,1);
  } finally {
    await query("DELETE FROM organizations WHERE id = ANY($1::uuid[])",[[firstOrgId,secondOrgId,lastOrgId].filter(Boolean)]);
    await query("DELETE FROM users WHERE id = ANY($1::uuid[])",[[userId,lastUserId].filter(Boolean)]);
    await closePool();
  }
});
