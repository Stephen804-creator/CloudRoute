import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { query, withTransaction } from "@cloudroute/db";
import { authenticate } from "../auth/guard.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { createSession, revokeSession } from "../auth/session.js";

interface SignupBody { email: string; password: string; fullName: string; organizationName?: string }
interface LoginBody { email: string; password: string }

function validEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: SignupBody }>("/v1/auth/signup", async (request, reply) => {
    const { email, password, fullName, organizationName } = request.body ?? ({} as SignupBody);
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const name = typeof fullName === "string" ? fullName.trim() : "";
    const orgName = typeof organizationName === "string" && organizationName.trim()
      ? organizationName.trim() : (name ? `${name}'s workspace` : "");
    if (!validEmail(normalizedEmail)) return reply.code(400).send({ error: { code: "INVALID_EMAIL", message: "Enter a valid email address." } });
    if (typeof password !== "string" || password.length < 12 || password.length > 256) {
      return reply.code(400).send({ error: { code: "WEAK_PASSWORD", message: "Password must be 12–256 characters." } });
    }
    if (name.length < 1 || name.length > 120 || orgName.length < 1 || orgName.length > 120) {
      return reply.code(400).send({ error: { code: "INVALID_NAME", message: "Name and workspace name must be 1–120 characters." } });
    }
    const passwordHash = await hashPassword(password);
    try {
      const user = await withTransaction(async (client) => {
        const inserted = await client.query<{ id: string }>(
          "INSERT INTO users(email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id",
          [normalizedEmail, passwordHash, name],
        );
        const userId = inserted.rows[0]!.id;
        const org = await client.query<{ id: string }>(
          "INSERT INTO organizations(name, created_by) VALUES ($1, $2) RETURNING id",
          [orgName, userId],
        );
        await client.query("INSERT INTO memberships(org_id, user_id, role) VALUES ($1, $2, 'owner')", [org.rows[0]!.id, userId]);
        await client.query(
          "INSERT INTO audit_log(org_id, actor_user_id, action, target_type, details) VALUES ($1, $2, 'organization.created', 'organization', $3::jsonb)",
          [org.rows[0]!.id, userId, JSON.stringify({ source: "signup" })],
        );
        return { id: userId, orgId: org.rows[0]!.id };
      });
      await createSession(user.id, reply);
      return reply.code(201).send({ user: { id: user.id, email: normalizedEmail, fullName: name }, organization: { id: user.orgId, name: orgName, role: "owner" } });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") return reply.code(409).send({ error: { code: "EMAIL_EXISTS", message: "An account with this email already exists." } });
      throw error;
    }
  });

  app.post<{ Body: LoginBody }>("/v1/auth/login", async (request, reply) => {
    const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    if (!validEmail(email) || password.length === 0 || password.length > 256) {
      return reply.code(400).send({ error: { code: "INVALID_CREDENTIALS", message: "Enter your email and password." } });
    }
    const result = await query<{ id: string; email: string; full_name: string; password_hash: string }>(
      "SELECT id, email, full_name, password_hash FROM users WHERE email = $1",
      [email],
    );
    const user = result.rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return reply.code(401).send({ error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." } });
    }
    await createSession(user.id, reply);
    return reply.send({ user: { id: user.id, email: user.email, fullName: user.full_name } });
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    await revokeSession(request, reply);
    return reply.code(204).send();
  });

  app.get("/v1/auth/me", { preHandler: authenticate }, async (request, reply) => {
    if (!request.authContext) return;
    const { userId, orgId, email, fullName, orgName, role } = request.authContext;
    return reply.send({ user: { id: userId, email, fullName }, organization: { id: orgId, name: orgName, role } });
  });

  app.get("/v1/health/database", async (_request, reply) => {
    try {
      await query("SELECT 1");
      return reply.send({ status: "ok" });
    } catch {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not available." } });
    }
  });
}
