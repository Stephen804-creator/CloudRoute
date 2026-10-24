import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { withOrgTransaction } from "@cloudroute/db";
import { authenticate } from "../auth/guard.js";
import { enqueueInventorySync } from "../queue.js";

interface AwsAccountBody { roleArn?: string; accountId: string; displayName?: string }\ninterface GcpAccountBody { projectId: string; serviceAccountEmail: string; displayName?: string }\nconst gcpProjectIdPattern = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;\nconst gcpServiceAccountPattern = /^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/;
const roleArnPattern = /^arn:aws:iam::\d{12}:role\/[A-Za-z0-9+=,.@_\/-]{1,512}$/;

export async function registerAccountRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", async (request, reply) => {
    if (request.url.startsWith("/v1/accounts")) await authenticate(request, reply);
  });

  app.get("/v1/security/aws-setup", async (_request, reply) => {
    const principalArn = process.env.CLOUDROUTE_AWS_PRINCIPAL_ARN ?? null;
    return reply.send({ configured: Boolean(principalArn), principalArn });
  });

  app.get("/v1/accounts", async (request, reply) => {
    if (!request.authContext) return;
    const result = await withOrgTransaction(request.authContext.orgId, (client) => client.query(
      "SELECT id, provider, display_name AS \"displayName\", external_account_id AS \"accountId\", status, " +
      "permission_status AS \"permissionStatus\", gcp_service_account_email AS \"serviceAccountEmail\", last_sync_at AS \"lastSyncAt\", last_sync_status AS \"lastSyncStatus\", created_at AS \"createdAt\" " +
      "FROM cloud_accounts WHERE org_id=$1 AND disconnected_at IS NULL ORDER BY created_at DESC",
      [request.authContext!.orgId],
    ));
    return reply.send({ accounts: result.rows });
  });

  app.get<{ Params: { id: string } }>("/v1/accounts/:id/setup", async (request, reply) => {
    if (!request.authContext) return;
    const result = await withOrgTransaction(request.authContext.orgId, (client) => client.query(
      "SELECT id, provider, display_name AS \"displayName\", external_account_id AS \"accountId\", role_arn AS \"roleArn\", status, permission_status AS \"permissionStatus\", external_id AS \"externalId\" " +
      "FROM cloud_accounts WHERE id=$1 AND org_id=$2 AND disconnected_at IS NULL",
      [request.params.id, request.authContext!.orgId],
    ));
    if (!result.rows[0] || result.rows[0].provider !== "aws") return reply.code(404).send({ error: { code: "ACCOUNT_NOT_FOUND", message: "AWS setup was not found in this workspace." } });
    const { externalId, ...account } = result.rows[0] as { externalId: string; [key: string]: unknown };
    return reply.send({ account, externalId, nextStep: "Configure the read-only IAM role and validate the connection." });
  });

  app.post<{ Body: AwsAccountBody }>("/v1/accounts/aws", async (request, reply) => {
    if (!request.authContext) return;
    const body = request.body ?? ({} as AwsAccountBody);
    const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
    const roleArn = typeof body.roleArn === "string" ? body.roleArn.trim() : "";
    const displayName = typeof body.displayName === "string" && body.displayName.trim()
      ? body.displayName.trim().slice(0, 120) : "AWS account " + accountId;
    if (!/^\d{12}$/.test(accountId) || (roleArn && !roleArnPattern.test(roleArn))) {
      return reply.code(400).send({ error: { code: "INVALID_AWS_ACCOUNT", message: "Provide a valid 12-digit AWS account ID and, if supplied, a valid role ARN." } });
    }
    if (roleArn && !roleArn.startsWith("arn:aws:iam::" + accountId + ":role/")) {
      return reply.code(400).send({ error: { code: "ACCOUNT_MISMATCH", message: "The role ARN account must match the supplied account ID." } });
    }
    const externalId = randomBytes(32).toString("base64url");
    try {
      const result = await withOrgTransaction(request.authContext.orgId, (client) => client.query(
        "INSERT INTO cloud_accounts(org_id, provider, display_name, external_account_id, role_arn, external_id) " +
        "VALUES ($1,'aws',$2,$3,$4,$5) " +
        "ON CONFLICT (org_id,provider,external_account_id) DO UPDATE SET display_name=EXCLUDED.display_name, role_arn=EXCLUDED.role_arn, external_id=EXCLUDED.external_id, status='pending', permission_status='not_checked', disconnected_at=NULL, last_error_code=NULL, updated_at=now() " +
        "RETURNING id, provider, display_name AS \"displayName\", external_account_id AS \"accountId\", status",
        [request.authContext!.orgId, displayName, accountId, roleArn || null, externalId],
      ));
      const account = result.rows[0];
      await withOrgTransaction(request.authContext.orgId, (client) => client.query(
        "UPDATE sync_runs SET status='cancelled', finished_at=now(), error_code='ACCOUNT_RECONNECTED' WHERE cloud_account_id=$1 AND org_id=$2 AND status IN ('queued','running')",
        [account.id, request.authContext!.orgId],
      ));
      await withOrgTransaction(request.authContext.orgId, (client) => client.query(
        "INSERT INTO audit_log(org_id, actor_user_id, action, target_type, target_id, details) VALUES ($1,$2,'cloud_account.created','cloud_account',$3,$4::jsonb)",
        [request.authContext!.orgId, request.authContext!.userId, account.id, JSON.stringify({ provider: "aws", accountId })],
      ));
      return reply.code(201).send({
        account, externalId,
        nextStep: "Add this external ID to the trust policy of your customer-created read-only IAM role, then save the role ARN and validate the connection.",
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: { code: "ACCOUNT_EXISTS", message: "This AWS account is already connected to this workspace." } });
      throw error;
    }
  });

  app.post<{ Body: GcpAccountBody }>("/v1/accounts/gcp", async (request, reply) => {
    if (!request.authContext) return;
    const projectId = typeof request.body?.projectId === "string" ? request.body.projectId.trim() : "";
    const serviceAccountEmail = typeof request.body?.serviceAccountEmail === "string" ? request.body.serviceAccountEmail.trim().toLowerCase() : "";
    const displayName = typeof request.body?.displayName === "string" && request.body.displayName.trim()
      ? request.body.displayName.trim().slice(0, 120) : "Google Cloud project " + projectId;
    if (!gcpProjectIdPattern.test(projectId) || !gcpServiceAccountPattern.test(serviceAccountEmail)) {
      return reply.code(400).send({ error: { code: "INVALID_GCP_ACCOUNT", message: "Provide a valid Google Cloud project ID and service-account email." } });
    }
    try {
      const result = await withOrgTransaction(request.authContext.orgId, (client) => client.query(
        "INSERT INTO cloud_accounts(org_id, provider, display_name, external_account_id, gcp_service_account_email) " +
        "VALUES ($1,'gcp',$2,$3,$4) " +
        "ON CONFLICT (org_id,provider,external_account_id) DO UPDATE SET display_name=EXCLUDED.display_name, gcp_service_account_email=EXCLUDED.gcp_service_account_email, status='pending', permission_status='not_checked', disconnected_at=NULL, last_error_code=NULL, updated_at=now() " +
        "RETURNING id, provider, display_name AS \"displayName\", external_account_id AS \"accountId\", gcp_service_account_email AS \"serviceAccountEmail\", status",
        [request.authContext!.orgId, displayName, projectId, serviceAccountEmail],
      ));
      const account = result.rows[0];
      await withOrgTransaction(request.authContext.orgId, (client) => client.query(
        "UPDATE sync_runs SET status='cancelled', finished_at=now(), error_code='ACCOUNT_RECONNECTED' WHERE cloud_account_id=$1 AND org_id=$2 AND status IN ('queued','running')",
        [account.id, request.authContext!.orgId],
      ));
      await withOrgTransaction(request.authContext.orgId, (client) => client.query(
        "INSERT INTO audit_log(org_id, actor_user_id, action, target_type, target_id, details) VALUES ($1,$2,'cloud_account.created','cloud_account',$3,$4::jsonb)",
        [request.authContext!.orgId, request.authContext!.userId, account.id, JSON.stringify({ provider: "gcp", projectId })],
      ));
      return reply.code(201).send({
        account,
        nextStep: "Grant the CloudRoute runtime identity permission to impersonate this service account, and grant the service account Cloud Asset Viewer access to the project. Then validate the connection.",
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: { code: "ACCOUNT_EXISTS", message: "This Google Cloud project is already connected to this workspace." } });
      throw error;
    }
  });

  app.post<{ Params: { id: string }; Body: { roleArn: string } }>("/v1/accounts/:id/role", async (request, reply) => {
    if (!request.authContext) return;
    const roleArn = typeof request.body?.roleArn === "string" ? request.body.roleArn.trim() : "";
    if (!roleArnPattern.test(roleArn)) return reply.code(400).send({ error: { code: "INVALID_ROLE_ARN", message: "Provide a valid AWS IAM role ARN." } });
    const result = await withOrgTransaction(request.authContext.orgId, (client) => client.query(
      "SELECT id, external_account_id FROM cloud_accounts WHERE id=$1 AND org_id=$2 AND provider='aws' AND disconnected_at IS NULL",
      [request.params.id, request.authContext!.orgId],
    ));
    const account = result.rows[0] as { id: string; external_account_id: string } | undefined;
    if (!account) return reply.code(404).send({ error: { code: "ACCOUNT_NOT_FOUND", message: "AWS account was not found in this workspace." } });
    if (!roleArn.startsWith("arn:aws:iam::" + account.external_account_id + ":role/")) {
      return reply.code(400).send({ error: { code: "ACCOUNT_MISMATCH", message: "The role ARN account must match the connected account ID." } });
    }
    await withOrgTransaction(request.authContext.orgId, (client) => client.query(
      "UPDATE cloud_accounts SET role_arn=$3, status='pending', permission_status='not_checked', updated_at=now() WHERE id=$1 AND org_id=$2",
      [account.id, request.authContext!.orgId, roleArn],
    ));
    return reply.send({ status: "pending", message: "Role saved. Validate the read-only connection next." });
  });

  app.post<{ Params: { id: string } }>("/v1/accounts/:id/validate", async (request, reply) => {
    if (!request.authContext) return;
    const result = await withOrgTransaction(request.authContext.orgId, (client) => client.query(
      "SELECT id, provider, external_account_id, role_arn, external_id, gcp_service_account_email FROM cloud_accounts WHERE id=$1 AND org_id=$2 AND disconnected_at IS NULL",
      [request.params.id, request.authContext!.orgId],
    ));
    const account = result.rows[0] as { id: string; provider: string; external_account_id: string; role_arn: string | null; external_id: string | null; gcp_service_account_email: string | null } | undefined;
    if (!account) return reply.code(404).send({ error: { code: "ACCOUNT_NOT_FOUND", message: "Cloud account was not found in this workspace." } });
    if (account.provider === "gcp") {
      if (!account.gcp_service_account_email) return reply.code(409).send({ error: { code: "SERVICE_ACCOUNT_NOT_CONFIGURED", message: "Save a Google Cloud service-account email before validating the connection." } });
      try {
        const { GcpInventoryConnector } = await import("@cloudroute/connector-gcp");
        const connector = new GcpInventoryConnector(account.gcp_service_account_email);
        await connector.validateConnection({ provider: "gcp", accountId: account.external_account_id });
        await withOrgTransaction(request.authContext.orgId, (client) => client.query(
          "UPDATE cloud_accounts SET status='connected', permission_status='valid', last_error_code=NULL, updated_at=now() WHERE id=$1 AND org_id=$2",
          [account.id, request.authContext!.orgId],
        ));
        const run = await withOrgTransaction(request.authContext.orgId, async (client) => {
          const existing = await client.query<{ id: string }>(
            "SELECT id FROM sync_runs WHERE org_id=$1 AND cloud_account_id=$2 AND job_type='inventory_sync' AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1",
            [request.authContext!.orgId, account.id],
          );
          if (existing.rows[0]) return { id: existing.rows[0].id };
          const inserted = await client.query<{ id: string }>(
            "INSERT INTO sync_runs(org_id, cloud_account_id, job_type, status) VALUES ($1,$2,'inventory_sync','queued') RETURNING id",
            [request.authContext!.orgId, account.id],
          );
          return { id: inserted.rows[0]!.id };
        });
        try { await enqueueInventorySync({ syncRunId: run.id, orgId: request.authContext.orgId, accountId: account.id }); } catch { /* PostgreSQL polling recovers transient queue failures. */ }
        return reply.send({ status: "connected", permissionStatus: "valid", syncRunId: run.id, message: "Google Cloud read-only access validated; initial inventory sync was queued." });
      } catch (error) {
        const code = error instanceof Error && /^[A-Z0-9_:-]{1,80}$/.test(error.message) ? error.message : "GCP_CONNECTION_VALIDATION_FAILED";
        await withOrgTransaction(request.authContext.orgId, (client) => client.query(
          "UPDATE cloud_accounts SET status='error', permission_status='insufficient', last_error_code=$3, updated_at=now() WHERE id=$1 AND org_id=$2",
          [account.id, request.authContext!.orgId, code],
        ));
        return reply.code(400).send({ error: { code, message: "Google Cloud access could not be validated. Check project ID, API enablement, impersonation permission, and read-only asset permissions." } });
      }
    }
    if (account.provider !== "aws") return reply.code(400).send({ error: { code: "UNSUPPORTED_PROVIDER", message: "This cloud provider is not supported." } });
    if (!account.role_arn || !account.external_id) return reply.code(409).send({ error: { code: "ROLE_NOT_CONFIGURED", message: "Save the AWS role ARN before validating the connection." } });
    try {
      const { STSClient, GetCallerIdentityCommand, AssumeRoleCommand } = await import("@aws-sdk/client-sts");
      const sts = new STSClient({ region: process.env.AWS_STS_REGION ?? "us-east-1" });
      let assumed;
      try {
        assumed = await sts.send(new AssumeRoleCommand({ RoleArn: account.role_arn, RoleSessionName: "CloudRouteReadOnlyValidation", ExternalId: account.external_id, DurationSeconds: 900 }));
      } finally { sts.destroy(); }
      if (!assumed.Credentials?.AccessKeyId || !assumed.Credentials.SecretAccessKey || !assumed.Credentials.SessionToken) throw new Error("ASSUME_ROLE_FAILED");
      const identity = new STSClient({
        region: process.env.AWS_STS_REGION ?? "us-east-1",
        credentials: { accessKeyId: assumed.Credentials.AccessKeyId, secretAccessKey: assumed.Credentials.SecretAccessKey, sessionToken: assumed.Credentials.SessionToken },
      });
      let returnedAccountId: string;
      try { returnedAccountId = (await identity.send(new GetCallerIdentityCommand({}))).Account ?? ""; }
      finally { identity.destroy(); }
      if (returnedAccountId !== account.external_account_id) {
        await withOrgTransaction(request.authContext.orgId, (client) => client.query(
          "UPDATE cloud_accounts SET status='error', permission_status='invalid', last_error_code='ACCOUNT_ID_MISMATCH', updated_at=now() WHERE id=$1 AND org_id=$2",
          [account.id, request.authContext!.orgId],
        ));
        return reply.code(400).send({ error: { code: "ACCOUNT_ID_MISMATCH", message: "AWS returned a different account ID than expected." } });
      }
      await withOrgTransaction(request.authContext.orgId, (client) => client.query(
        "UPDATE cloud_accounts SET status='connected', permission_status='valid', last_error_code=NULL, updated_at=now() WHERE id=$1 AND org_id=$2",
        [account.id, request.authContext!.orgId],
      ));
      const run = await withOrgTransaction(request.authContext.orgId, async (client) => {
        const existing = await client.query<{ id: string }>(
          "SELECT id FROM sync_runs WHERE org_id=$1 AND cloud_account_id=$2 AND job_type='inventory_sync' AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1",
          [request.authContext!.orgId, account.id],
        );
        if (existing.rows[0]) return { id: existing.rows[0].id };
        const inserted = await client.query<{ id: string }>(
          "INSERT INTO sync_runs(org_id, cloud_account_id, job_type, status) VALUES ($1,$2,'inventory_sync','queued') RETURNING id",
          [request.authContext!.orgId, account.id],
        );
        return { id: inserted.rows[0]!.id };
      });
      try { await enqueueInventorySync({ syncRunId: run.id, orgId: request.authContext.orgId, accountId: account.id }); } catch { /* The worker also polls durable PostgreSQL queue rows. */ }
      return reply.send({ status: "connected", accountId: returnedAccountId, syncRunId: run.id, message: "AWS role assumption succeeded. Initial inventory synchronization has been queued." });
    } catch (error) {
      const name = (error as { name?: string }).name ?? "AWS_CONNECTION_FAILED";
      const mapped = name === "AccessDenied" || name === "AccessDeniedException" ? "AWS_ROLE_ACCESS_DENIED" : "AWS_CONNECTION_FAILED";
      await withOrgTransaction(request.authContext.orgId, (client) => client.query(
        "UPDATE cloud_accounts SET status='error', permission_status='invalid', last_error_code=$3, updated_at=now() WHERE id=$1 AND org_id=$2",
        [account.id, request.authContext!.orgId, mapped],
      ));
      return reply.code(400).send({ error: { code: mapped, message: "AWS connection validation failed. Check the role trust policy, external ID, and read-only permissions." } });
    }
  });

  app.delete<{ Params: { id: string } }>("/v1/accounts/:id", async (request, reply) => {
    if (!request.authContext) return;
    const result = await withOrgTransaction(request.authContext.orgId, (client) => client.query(
      "UPDATE cloud_accounts SET status='disconnected', disconnected_at=now(), updated_at=now() WHERE id=$1 AND org_id=$2 AND disconnected_at IS NULL RETURNING id",
      [request.params.id, request.authContext!.orgId],
    ));
    if (!result.rowCount) return reply.code(404).send({ error: { code: "ACCOUNT_NOT_FOUND", message: "Cloud account was not found." } });
    return reply.code(204).send();
  });
}
