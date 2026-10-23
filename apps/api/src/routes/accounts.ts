import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { query, withOrgTransaction } from "@cloudroute/db";
import { authenticate } from "../auth/guard.js";

interface AwsAccountBody { roleArn: string; accountId: string; displayName?: string }

export async function registerAccountRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", async (request, reply) => {
    if (request.url.startsWith("/v1/accounts")) await authenticate(request, reply);
  });

  app.get("/v1/accounts", async (request, reply) => {
    if (!request.authContext) return;
    const result = await withOrgTransaction(request.authContext.orgId, (client) =>
      client.query(
        `SELECT id, provider, display_name AS "displayName", external_account_id AS "accountId",
                status, permission_status AS "permissionStatus", last_sync_at AS "lastSyncAt",
                last_sync_status AS "lastSyncStatus", created_at AS "createdAt"
           FROM cloud_accounts WHERE org_id = $1 AND disconnected_at IS NULL
           ORDER BY created_at DESC`,
        [request.authContext!.orgId],
      ),
    );
    return reply.send({ accounts: result.rows });
  });

  app.post<{ Body: AwsAccountBody }>("/v1/accounts/aws", async (request, reply) => {
    if (!request.authContext) return;
    const body = request.body ?? ({} as AwsAccountBody);
    const roleArn = typeof body.roleArn === "string" ? body.roleArn.trim() : "";
    const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
    const displayName = typeof body.displayName === "string" && body.displayName.trim()
      ? body.displayName.trim().slice(0, 120) : `AWS account ${accountId}`;
    if (!/^arn:aws:iam::\d{12}:role\/[A-Za-z0-9+=,.@_\/-]{1,512}$/.test(roleArn) || !/^\d{12}$/.test(accountId)) {
      return reply.code(400).send({ error: { code: "INVALID_AWS_ACCOUNT", message: "Provide a valid AWS role ARN and 12-digit account ID." } });
    }
    if (!roleArn.startsWith(`arn:aws:iam::${accountId}:role/`)) {
      return reply.code(400).send({ error: { code: "ACCOUNT_MISMATCH", message: "The role ARN account must match the supplied account ID." } });
    }
    const externalId = randomBytes(32).toString("base64url");
    try {
      const result = await withOrgTransaction(request.authContext.orgId, (client) =>
        client.query(
          `INSERT INTO cloud_accounts(org_id, provider, display_name, external_account_id, role_arn, external_id)
           VALUES ($1, 'aws', $2, $3, $4, $5)
           RETURNING id, provider, display_name AS "displayName", external_account_id AS "accountId", status`,
          [request.authContext!.orgId, displayName, accountId, roleArn, externalId],
        ),
      );
      const account = result.rows[0];
      await withOrgTransaction(request.authContext.orgId, (client) =>
        client.query(
          "INSERT INTO audit_log(org_id, actor_user_id, action, target_type, target_id, details) VALUES ($1,$2,'cloud_account.created','cloud_account',$3,$4::jsonb)",
          [request.authContext!.orgId, request.authContext!.userId, account.id, JSON.stringify({ provider: "aws", accountId })],
        ),
      );
      return reply.code(201).send({
        account,
        externalId,
        nextStep: "Add this external ID to the trust policy of the customer-created read-only IAM role, then validate the connection.",
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: { code: "ACCOUNT_EXISTS", message: "This AWS account is already connected to this workspace." } });
      }
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>("/v1/accounts/:id/validate", async (request, reply) => {
    if (!request.authContext) return;
    const accountId = request.params.id;
    const result = await withOrgTransaction(request.authContext.orgId, (client) =>
      client.query(
        "SELECT id, provider, external_account_id, role_arn, external_id FROM cloud_accounts WHERE id = $1 AND org_id = $2 AND disconnected_at IS NULL",
        [accountId, request.authContext!.orgId],
      ),
    );
    const account = result.rows[0] as { id: string; provider: string; external_account_id: string; role_arn: string; external_id: string } | undefined;
    if (!account) return reply.code(404).send({ error: { code: "ACCOUNT_NOT_FOUND", message: "Cloud account was not found in this workspace." } });
    if (account.provider !== "aws") return reply.code(501).send({ error: { code: "PROVIDER_NOT_READY", message: "This provider connector is not implemented yet." } });
    try {
      const { STSClient, GetCallerIdentityCommand, AssumeRoleCommand } = await import("@aws-sdk/client-sts");
      const sts = new STSClient({ region: process.env.AWS_STS_REGION ?? "us-east-1" });
      const assumed = await sts.send(new AssumeRoleCommand({
        RoleArn: account.role_arn,
        RoleSessionName: "CloudRouteReadOnlyValidation",
        ExternalId: account.external_id,
        DurationSeconds: 900,
      }));
      if (!assumed.Credentials) throw new Error("AWS did not return temporary role credentials.");
      const identity = new STSClient({
        region: process.env.AWS_STS_REGION ?? "us-east-1",
        credentials: {
          accessKeyId: assumed.Credentials.AccessKeyId!,
          secretAccessKey: assumed.Credentials.SecretAccessKey!,
          sessionToken: assumed.Credentials.SessionToken!,
        },
      });
      const caller = await identity.send(new GetCallerIdentityCommand({}));
      const returnedAccountId = caller.Account ?? "";
      if (returnedAccountId !== account.external_account_id) {
        await withOrgTransaction(request.authContext.orgId, (client) =>
          client.query("UPDATE cloud_accounts SET status='error', permission_status='invalid', last_error_code='ACCOUNT_ID_MISMATCH', updated_at=now() WHERE id=$1 AND org_id=$2", [account.id, request.authContext!.orgId]),
        );
        return reply.code(400).send({ error: { code: "ACCOUNT_ID_MISMATCH", message: "AWS returned a different account ID than expected." } });
      }
      await withOrgTransaction(request.authContext.orgId, (client) =>
        client.query("UPDATE cloud_accounts SET status='connected', permission_status='valid', last_error_code=NULL, updated_at=now() WHERE id=$1 AND org_id=$2", [account.id, request.authContext!.orgId]),
      );
      return reply.send({ status: "connected", accountId: returnedAccountId, message: "AWS role assumption succeeded. Inventory synchronization will be queued by the worker." });
    } catch (error) {
      const name = (error as { name?: string }).name ?? "AWS_CONNECTION_FAILED";
      const mapped = name === "AccessDenied" || name === "AccessDeniedException" ? "AWS_ROLE_ACCESS_DENIED" : "AWS_CONNECTION_FAILED";
      await withOrgTransaction(request.authContext.orgId, (client) =>
        client.query("UPDATE cloud_accounts SET status='error', permission_status='invalid', last_error_code=$3, updated_at=now() WHERE id=$1 AND org_id=$2", [account.id, request.authContext!.orgId, mapped]),
      );
      return reply.code(400).send({ error: { code: mapped, message: "AWS connection validation failed. Check the role trust policy, external ID, and read-only permissions." } });
    }
  });

  app.delete<{ Params: { id: string } }>("/v1/accounts/:id", async (request, reply) => {
    if (!request.authContext) return;
    const result = await withOrgTransaction(request.authContext.orgId, (client) =>
      client.query(
        "UPDATE cloud_accounts SET status='disconnected', disconnected_at=now(), updated_at=now() WHERE id=$1 AND org_id=$2 AND disconnected_at IS NULL RETURNING id",
        [request.params.id, request.authContext!.orgId],
      ),
    );
    if (!result.rowCount) return reply.code(404).send({ error: { code: "ACCOUNT_NOT_FOUND", message: "Cloud account was not found." } });
    return reply.code(204).send();
  });
}
