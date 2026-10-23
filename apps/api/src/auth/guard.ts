import type { FastifyReply, FastifyRequest } from "fastify";
import { getAuthContext, type AuthContext } from "./session.js";

declare module "fastify" {
  interface FastifyRequest {
    authContext: AuthContext | null;
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const context = await getAuthContext(request);
  request.authContext = context;
  if (!context) {
    await reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } });
  }
}
