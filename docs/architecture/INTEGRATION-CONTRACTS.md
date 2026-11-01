# CloudRoute integration contracts

## System boundaries

- **Web:** Next.js presentation layer. It calls the same-origin `/v1` API routes and never connects directly to PostgreSQL or cloud providers.
- **API:** Fastify authentication, organization authorization, validation, and read endpoints. The API owns customer-facing HTTP contracts.
- **Database:** PostgreSQL is the durable source of truth. Organization-scoped transactions set `app.current_org_id` for row-level security.
- **Worker:** Executes queued inventory and cost reads, evaluates savings evidence, and delivers configured notifications. It is not a user-facing API.
- **Connectors:** AWS and Google Cloud adapters normalize provider metadata. Credentials are short-lived; customer private keys and long-lived AWS access keys are not accepted.

## Cross-unit invariants

1. Every customer-owned row and API result is scoped to the authenticated organization. Client-supplied organization identifiers are never authorization.
2. CloudRoute remains read-only. No connector or worker may create, change, start, stop, or delete a customer cloud resource.
3. A partial, failed, cancelled, or page-limited inventory run never marks unseen resources missing and never evaluates savings rules as if the scan were complete.
4. Inventory upserts are idempotent on the provider account/resource identity. A retry must not create duplicate resource or cost records.
5. Cost data retains provider, account, period, service, region, and original currency. Amounts in different currencies are not summed into a single total.
6. Missing billing exports, missing metrics, and unconfigured email are represented as unavailable/queued—not as zero spend, proven utilization, or delivered messages.
7. Notification state changes and user actions remain organization-scoped and auditable.
8. Account disconnect stops future collection and cascades account-owned inventory, cost, findings, and sync data according to the documented retention policy.

## HTTP contract

- Browser calls use same-origin `/v1` paths. The web proxy forwards these to the internal API URL.
- Session cookies are HttpOnly, SameSite=Strict, and Secure in production.
- Unsafe browser requests in production must carry the exact configured `PUBLIC_APP_ORIGIN`.
- `/health` is a process liveness check and must not depend on PostgreSQL.
- `/ready` is a readiness check and returns success only when PostgreSQL can answer a lightweight query.
- Tenant-owned routes require an authenticated session and use organization-scoped database transactions.

## Worker contract

- Queue claims must be atomic and idempotent.
- Provider credentials must never be written to logs, job payloads, or durable application tables.
- Failed provider pages produce partial runs; only complete runs may perform missing-resource reconciliation.
- Cost restatement re-reads recent periods and upserts by the provider billing identity.
- Email outbox claims use row locking; retries use bounded backoff. A queued message is not a delivered message.

## Compatibility and release discipline

- Database changes are forward-only numbered migrations. Run migrations before deploying code that depends on the new schema.
- Deploy API and worker code from the same release revision.
- Deploy the web app with its internal API target configured to the matching API service.
- Never merge stacked PRs out of order. Merge Units 2–7, then Unit 8, then Units 9–12, then Units 13–16, resolving and re-running CI at each boundary.
