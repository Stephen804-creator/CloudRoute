import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { closePool, query, withTransaction } from "@cloudroute/db";
import { createSession, hashSessionToken, revokeSession, sessionCookieName } from "./session.js";

test("session token hashing is deterministic and does not expose the raw token", () => {
  const token = "test-session-token";
  const digest = hashSessionToken(token);
  assert.equal(digest, hashSessionToken(token));
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.notEqual(digest, token);
});

test("session creation stores only a digest and sets restrictive cookie flags", { skip: !process.env.DATABASE_URL }, async () => {
  const suffix = randomUUID();
  let userId = "";
  let cookieToken = "";
  let cookieName = "";
  let cookieOptions: Record<string, unknown> | undefined;
  let cleared = false;
  const reply = {
    setCookie(name: string, value: string, options: Record<string, unknown>) {
      cookieName = name; cookieToken = value; cookieOptions = options; return reply;
    },
    clearCookie() { cleared = true; return reply; },
  } as unknown as FastifyReply;

  try {
    const user = await withTransaction(client => client.query<{id:string}>(
      "INSERT INTO users(email,password_hash,full_name) VALUES ($1,'test-hash','Session Test') RETURNING id",
      ["session-"+suffix+"@example.test"],
    ));
    userId = user.rows[0]!.id;
    await createSession(userId, reply);
    assert.equal(cookieName, sessionCookieName);
    assert.equal(cookieOptions?.httpOnly, true);
    assert.equal(cookieOptions?.sameSite, "strict");
    assert.equal(cookieOptions?.path, "/");
    assert.equal(cookieOptions?.secure, process.env.NODE_ENV === "production");
    assert.ok(cookieOptions?.expires instanceof Date);

    const stored = await query<{token_hash:string}>(
      "SELECT token_hash FROM auth_sessions WHERE user_id=$1",
      [userId],
    );
    assert.equal(stored.rowCount, 1);
    assert.equal(stored.rows[0]!.token_hash, hashSessionToken(cookieToken));
    assert.notEqual(stored.rows[0]!.token_hash, cookieToken);

    const request = { cookies: { [sessionCookieName]: cookieToken } } as unknown as FastifyRequest;
    await revokeSession(request, reply);
    assert.equal(cleared, true);
    assert.equal((await query("SELECT id FROM auth_sessions WHERE user_id=$1",[userId])).rowCount,0);
  } finally {
    if (userId) await query("DELETE FROM users WHERE id=$1",[userId]);
    await closePool();
  }
});
