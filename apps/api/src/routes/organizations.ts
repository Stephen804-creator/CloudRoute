import type { FastifyInstance } from "fastify";
import { withOrgTransaction } from "@cloudroute/db";
import { authenticate } from "../auth/guard.js";

interface DeleteOrganizationBody { confirmName?: string }

export async function registerOrganizationRoutes(app: FastifyInstance): Promise<void> {
  app.delete<{ Params: { id: string }; Body: DeleteOrganizationBody }>(
    "/v1/organizations/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      if (!request.authContext) return;
      if (request.params.id !== request.authContext.orgId) {
        return reply.code(404).send({ error: { code: "ORGANIZATION_NOT_FOUND", message: "Workspace was not found." } });
      }
      if (request.authContext.role !== "owner") {
        return reply.code(403).send({ error: { code: "OWNER_REQUIRED", message: "Only a workspace owner can delete this workspace." } });
      }
      const confirmation = typeof request.body?.confirmName === "string" ? request.body.confirmName.trim() : "";
      if (!confirmation || confirmation !== request.authContext.orgName) {
        return reply.code(400).send({ error: { code: "ORGANIZATION_CONFIRMATION_MISMATCH", message: "Enter the exact workspace name to confirm deletion." } });
      }

      const deleted = await withOrgTransaction(request.authContext.orgId, async client => {
        const organization = await client.query<{ name: string }>(
          "SELECT name FROM organizations WHERE id=$1 FOR UPDATE",
          [request.authContext!.orgId],
        );
        if (!organization.rows[0] || organization.rows[0].name !== confirmation) return "not_found" as const;

        await client.query("SELECT set_config('app.current_user_id',$1,true)",[request.authContext!.userId]);
        const membership = await client.query<{ role: string }>(
          "SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2 FOR UPDATE",
          [request.authContext!.orgId,request.authContext!.userId],
        );
        if (membership.rows[0]?.role !== "owner") return "not_owner" as const;

        const otherMembership = await client.query(
          "SELECT id FROM memberships WHERE user_id=$1 AND org_id<>$2 LIMIT 1",
          [request.authContext!.userId,request.authContext!.orgId],
        );
        // Keep the user's identity usable. The final workspace cannot be
        // deleted until workspace creation/join and account lifecycle flows
        // provide a safe destination for the signed-in user.
        if (!otherMembership.rowCount) return "last_workspace" as const;

        const counts = await Promise.all([
          client.query("SELECT count(*)::int AS count FROM cloud_accounts WHERE org_id=$1",[request.authContext!.orgId]),
          client.query("SELECT count(*)::int AS count FROM resources WHERE org_id=$1",[request.authContext!.orgId]),
          client.query("SELECT count(*)::int AS count FROM cost_records WHERE org_id=$1",[request.authContext!.orgId]),
          client.query("SELECT count(*)::int AS count FROM findings WHERE org_id=$1",[request.authContext!.orgId]),
          client.query("SELECT count(*)::int AS count FROM memberships WHERE org_id=$1",[request.authContext!.orgId]),
        ]);
        await client.query(
          "INSERT INTO organization_deletion_audit(organization_id,organization_name,deleted_by,details) VALUES ($1,$2,$3,$4::jsonb)",
          [request.authContext!.orgId,organization.rows[0].name,request.authContext!.userId,
            JSON.stringify({ cloudAccounts:counts[0].rows[0]?.count ?? 0, resources:counts[1].rows[0]?.count ?? 0, costRecords:counts[2].rows[0]?.count ?? 0, findings:counts[3].rows[0]?.count ?? 0, memberships:counts[4].rows[0]?.count ?? 0 })],
        );
        await client.query("DELETE FROM organizations WHERE id=$1",[request.authContext!.orgId]);
        return "deleted" as const;
      });

      if (deleted === "not_found") return reply.code(404).send({ error: { code: "ORGANIZATION_NOT_FOUND", message: "Workspace was not found." } });
      if (deleted === "not_owner") return reply.code(403).send({ error: { code: "OWNER_REQUIRED", message: "Only a workspace owner can delete this workspace." } });
      if (deleted === "last_workspace") return reply.code(409).send({ error: { code: "LAST_WORKSPACE", message: "Create or join another workspace before deleting your last workspace. Your user account will remain active." } });
      return reply.send({ deleted: true, message: "Workspace and its organization-owned data were deleted." });
    },
  );
}
