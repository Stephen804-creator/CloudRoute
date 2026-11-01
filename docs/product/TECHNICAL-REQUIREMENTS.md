# CloudRoute Technical Requirements Document

**Document ID:** CR-TRD-001 | **Version:** 1.0 | **Status:** Authoritative technical baseline

Companion documents: Product Requirements, Data Schema, Design Brief, Implementation Plan.

## 1. Purpose and architecture decisions

This document defines the technical behavior required to deliver the CloudRoute product baseline. CloudRoute is a read-only observer outside the customer workload data path. A CloudRoute outage must not affect customer workloads.

| Concern | Decision |
|---|---|
| Repository | pnpm TypeScript monorepo |
| Runtime | Node.js 22+ |
| Frontend | Next.js and React |
| HTTP API | Fastify, REST/JSON, /v1 |
| Worker | Separate Node process |
| Database | PostgreSQL |
| Tenant isolation | Organization-scoped transactions plus RLS |
| Queue | Redis/BullMQ when configured; PostgreSQL polling fallback |
| AWS | AWS SDK v3, STS AssumeRole, temporary credentials |
| Google Cloud | Google Auth Library, service-account impersonation, short-lived token |
| Email | Resend adapter with durable PostgreSQL outbox |
| Shared contracts | packages/shared and packages/connector-sdk |
| Deployment | Separate web, API, worker services from one release revision |
| API | Authenticated tenant-scoped REST; no public API in MVP |

## 2. Component responsibilities

### Web — apps/web
Renders public landing/security pages and authenticated workspace screens; collects input; calls same-origin /v1 through the configured rewrite; displays provider, freshness, status, currency, evidence, loading/empty/error states. It never calls cloud APIs directly or stores provider credentials/session secrets in client storage.

Screens: landing/security, signup/login, overview, accounts/onboarding, inventory/detail/history/export, costs, savings, settings/notification preferences.

### API — apps/api
Owns authentication, server-derived organization context, validation, authorization, stable JSON/error contracts, sync-run creation, health/readiness. Long-running provider work never runs in the HTTP request lifecycle.

Current route families include /health, /ready, /v1/auth, /v1/accounts, /v1/resources, /v1/resources/:id/history, /v1/resources/export.csv, /v1/overview, /v1/costs/summary, /v1/costs/breakdown, /v1/findings, /v1/notification-preferences, and /v1/security/aws-setup. Every new route must enter the authorization matrix and tests.

### Worker — apps/worker
Schedules inventory/cost work; claims durable runs; fetches temporary credentials just in time; runs connectors; persists normalized data; evaluates savings; queues and delivers notifications; handles bounded retries, throttling, cancellation, and graceful shutdown. Worker health is monitored separately from API health.

### Database — packages/db
Owns numbered SQL migrations, pool/transaction helpers, tenant context, RLS, and migration execution. PostgreSQL is the durable source of truth. Do not introduce a second authoritative store for jobs, sync status, or user data.

### Connectors
packages/connector-sdk defines provider-neutral contracts. packages/connector-aws uses STS role assumption and the exact policy in docs/security/aws-read-only-policy.json. packages/connector-gcp impersonates a customer service account with read-only scopes and Cloud Asset Inventory. Connector code must not depend on web or API routes and must be testable with sanitized fixtures.

## 3. Required data flows

### Connection
Authenticated user submits provider identity; API validates and stores connection metadata only; API records audit event; identity is validated; durable sync run is created; worker claims it; connector reads and normalizes metadata; worker persists in tenant transaction; API exposes state and data.

### Inventory sync
- One logical active inventory run per account.
- Bounded provider/region concurrency and complete pagination.
- Idempotent upsert on (cloud_account_id, external_id).
- Record status, counts, timestamps, connector version, sanitized error code.
- Complete means every required scope/page was read successfully.
- Only complete runs may reconcile unseen resources.
- Partial, failed, cancelled, or disconnected runs never mark resources missing.
- Recheck account connection under a database lock before persistence.
- Retries must be safe and idempotent.

### Cost sync
- AWS Cost Explorer with temporary STS credentials.
- GCP BigQuery billing export with short-lived impersonated token and parameterized date values.
- Bounded trailing period and re-read recent periods for restatements.
- Upsert by account, period, service, region, and currency.
- Preserve original currency and provider attribution.
- Never invent resource-level attribution from service-level source data.
- Missing GCP billing export is unavailable, not zero cost.
- Display billing lag and last-success time.

### Savings
Run only after complete inventory; require each rule's evidence; metrics-based rules require actual monitoring metrics; estimated savings stays null without defensible price/currency evidence; reconcile findings when evidence changes; never execute findings.

### Notifications
Create organization-scoped outbox row with deterministic dedupe key; atomically claim; send through configured provider; retry transient failures with bounded backoff; store provider message ID/status where available; queued is not sent and sent is not proof of inbox delivery; respect preferences.

## 4. API requirements

- Versioned REST/JSON under /v1; CSV only for export.
- All customer data routes require authentication.
- Organization ID is derived from server auth context, never trusted from request parameters as authorization.
- Validate IDs, enums, lengths, cursors, date ranges, and numeric values.
- Use parameterized SQL; untrusted values never become SQL identifiers or expressions.
- Use bounded cursor pagination for large lists.
- Return consistent machine-readable error codes and safe messages.
- Use shared rate limiting when multiple API instances run.
- Use durable idempotency/uniqueness for retryable writes.
- Maintain route-to-authorization test matrix.
- No public API or arbitrary provider passthrough in MVP.

## 5. Authentication and authorization

Current baseline is email/password, salted password hashes, cryptographically random opaque session token stored as a hash, HttpOnly cookie, SameSite=Strict, Secure in production, server-side logout revocation, and server-derived organization/membership.

Required: verify expiry/revocation; owner-only authorization for destructive workspace operations; exact Origin validation for unsafe browser requests; documented non-browser client policy; never rely on UI hiding; complete email verification and account recovery before broad public launch. Google OAuth is not required for this MVP unless separately accepted and specified.

## 6. Tenant isolation

- Organization is the tenant boundary.
- Tenant-owned tables carry org_id and use RLS enabled/forced where defined.
- Tenant queries execute in a transaction with app.current_org_id.
- Membership lookup uses authenticated user context; no arbitrary organization selection.
- Prefer composite foreign keys including org_id for tenant relationships.
- Test cross-tenant reads, inserts, updates, and deletes with non-superuser role without BYPASSRLS.
- Runtime role must not own tenant tables in a way that bypasses forced RLS.
- Workers establish tenant context for every tenant job.

## 7. Security and privacy

- TLS externally; PostgreSQL verifies server certificate in production.
- Encrypt database, backups, secrets, and future object storage at rest.
- No secrets in source, browser bundles, URLs, queue payloads, or logs.
- No long-lived AWS credentials or GCP customer key files.
- Never read bucket objects, database rows, disk contents, instance user-data, function environment values, or workload contents.
- Sanitize provider payloads before persistence.
- Redact tokens, authorization headers, and sensitive provider responses from logs.
- Apply security headers and secure cookies.
- Run dependency and secret scanning.
- Publish exact provider permission documents.
- Independent penetration test required before public launch.

## 8. Reliability and performance

| Concern | Requirement |
|---|---|
| Inventory cadence | Target hourly |
| Cost cadence | Target every six hours |
| Credential health | At least hourly or on provider auth failure |
| Manual sync | At most once per account per 10 minutes |
| Provider concurrency | Bounded; target no more than five regional calls per account |
| Retry | Bounded exponential backoff with jitter |
| Duplicate work | Durable idempotency; one active logical run per account/job type |
| Partial scans | Keep previous good data; never infer deletion |
| Worker recovery | Recover queued jobs; detect and recover stuck running jobs |
| Scale | Validate 10,000 resources per organization |
| Performance | Page load target <2s; inventory filtering target <500ms |
| DB connections | Explicit pool budget across API/worker replicas |
| Shutdown | Stop claiming, safely finish/release jobs, close queue and DB |
| Observability | Queue age, run duration, success rate, throttling, worker heartbeat, DB pool |

## 9. Deployment requirements

Deploy web, API, and worker separately from the same immutable release revision. Use managed PostgreSQL with certificate-verified TLS and a dedicated non-superuser runtime role. Redis is private and optional only while PostgreSQL fallback is operational and monitored. Use HTTPS ingress, secret manager, email provider, encrypted backups, structured logs, error reporting, uptime checks, and service metrics.

Production must fail closed when DATABASE_URL, DATABASE_SSL=true, or exact HTTPS PUBLIC_APP_ORIGIN is missing/invalid. Configure internal web-to-API URL and provider runtime identity explicitly.

Migrations are numbered and forward-only. Run once as a controlled release step before dependent code. Do not automatically reverse migrations during application rollback.

## 10. Testing requirements

| Level | Required coverage |
|---|---|
| Unit | Normalization, validation, savings rules, currency grouping, sessions, runtime config |
| Connector contract | Sanitized AWS/GCP fixtures, mapping, pagination, missing fields, unknown types |
| DB integration | Migrations, constraints, RLS, cross-tenant CRUD, history triggers |
| API integration | Authentication, authorization, validation, Origin, error contracts |
| Worker integration | Idempotency, retry, duplicate delivery, partial runs, disconnect race, recovery |
| Provider sandbox | Real AWS/GCP read-only permissions, inventory and billing reconciliation |
| Browser E2E | Signup, login, connect, inventory, history, costs, findings, preferences, disconnect |
| Security | IAM least privilege, secret handling, sessions/CSRF, tenant isolation, penetration test |
| Performance | 10,000 resources, queue throughput, API latency, DB connection budget |
| Recovery | Backup restore, migration compatibility, rollback, canary |

Source-text assertions do not replace behavior-level integration tests where a real DB/service can be used.

## 11. Engineering conventions

Use strict TypeScript and shared types for cross-package contracts. Provider-specific behavior stays in connector packages. API requests stay short; long-running work belongs in workers. Migrations are numbered, forward-only, reviewed, and tested. Use domain names consistently: cloud_account, resource, cost_record, finding, sync_run, notification_preference, email_outbox. Use org_id for tenant ownership; UTC timestamptz for timestamps; date for cost periods; numeric for money. Preserve provider IDs and raw provider type strings. Do not introduce abstractions without at least two real implementations. Update API contracts, schema docs, tests, and design docs together when behavior changes.

## 12. Technical completion rule

A requirement is complete only when implementation exists, the correct test exercises it, that test ran on the relevant commit/environment, security and failure behavior are covered, and documentation is current. External checks not runnable in CI must be recorded as evidence or explicitly Not Verified. Code merged, green CI, or a healthy endpoint alone is not production readiness.
