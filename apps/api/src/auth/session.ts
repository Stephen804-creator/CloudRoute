import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { query, withTransaction } from "@cloudroute/db";

const COOKIE_NAME = "cloudroute_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface AuthContext {
  userId: string;
  orgId: string;
  email: string;
  fullName: string;
  orgName: string;
  role: string;
}
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export async function createSession(userId: string, reply: FastifyReply): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await query("INSERT INTO auth_sessions(user_id, token_hash, expires_at) VALUES ($1,$2,$3)", [userId, hashSessionToken(token), expiresAt]);
  reply.setCookie(COOKIE_NAME, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict",
    path: "/", expires: expiresAt,
  });
}
export async function revokeSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.cookies[COOKIE_NAME];
  if (token) await query("DELETE FROM auth_sessions WHERE token_hash=$1", [hashSessionToken(token)]);
  reply.clearCookie(COOKIE_NAME, { path: "/", sameSite: "strict" });
}
export async function getAuthContext(request: FastifyRequest): Promise<AuthContext | null> {
  const token = request.cookies[COOKIE_NAME];
  if (!token || token.length > 128) return null;
  const sessionResult = await query<{ userId: string; email: string; fullName: string; sessionId: string }>(
    "SELECT u.id AS \"userId\", u.email, u.full_name AS \"fullName\", s.id AS \"sessionId\" " +
    "FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()",
    [hashSessionToken(token)],
  );
  const session = sessionResult.rows[0];
  if (!session) return null;
  const membership = await withTransaction(async (client) => {
    await client.query("SELECT set_config('app.current_user_id',$1,true)", [session.userId]);
    const result = await client.query<{ orgId: string; orgName: string; role: string }>(
      "SELECT o.id AS \"orgId\", o.name AS \"orgName\", m.role FROM memberships m " +
      "JOIN organizations o ON o.id=m.org_id WHERE m.user_id=$1 ORDER BY m.created_at ASC LIMIT 1",
      [session.userId],
    );
    return result.rows[0] ?? null;
  });
  if (!membership) return null;
  await query("UPDATE auth_sessions SET last_seen_at=now() WHERE id=$1", [session.sessionId]);
  return { userId: session.userId, email: session.email, fullName: session.fullName, ...membership };
}
export const sessionCookieName = COOKIE_NAME;
