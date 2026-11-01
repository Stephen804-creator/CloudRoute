# CloudRoute Data Schema and Data Dictionary

**Document ID:** CR-DATA-001 | **Version:** 1.0 | **Status:** Authoritative schema reference for migrations 0001–0004

**Executable source of truth:** packages/db/migrations/*.sql. This document describes the current schema; it is not a replacement schema proposal. Applied migrations must never be edited. All changes use a new numbered migration.

## 1. Schema rules and relationships

PostgreSQL is the durable source of truth. UUID primary keys use gen_random_uuid(); tenant-owned records carry org_id; tenant access uses organization-scoped transactions and RLS where defined; timestamps are timestamptz; cost periods are date; monetary values are numeric(20,6); structured metadata/evidence uses JSONB. Provider identity is retained. Provider secrets and tokens are not stored in these tables.

Relationships:
- users 1:N auth_sessions.
- users N:N organizations through memberships.
- organizations 1:N cloud_accounts.
- cloud_accounts 1:N resources, cost_records, findings, and sync_runs.
- resources 1:N resource_history.
- organizations 1:N audit_log and email_outbox.
- organizations 1:1 notification_preferences when a preference row exists.
- resources 1:1 current migration_labels row per organization/resource.

Actual foreign keys and delete actions in SQL migrations override this simplified diagram.

## 2. Controlled values

| Domain | Persisted values |
|---|---|
| Provider | aws, gcp |
| Account status | pending, connected, degraded, disconnected, error |
| Permission status | not_checked, valid, invalid, insufficient |
| Migration label | unclassified, retain, migrate, retire, review |
| Cost attribution | provider_reported, estimated, unattributed |
| Finding severity | info, low, medium, high |
| Finding status | open, dismissed, snoozed, resolved |
| Sync job type | inventory_sync, cost_sync, credential_check |
| Sync status | queued, running, succeeded, partial, failed, cancelled |
| History change | created, changed, marked_missing, restored |
| Email template | weekly_digest, connection_failure |
| Email status | queued, sending, sent, failed |
| Membership role | owner, admin, member, viewer |

Persisted values are stable contracts. UI may use human-readable labels but must not invent alternate stored spellings.

## 3. Tables

### users — global identity
- id uuid PK.
- email text NOT NULL UNIQUE; lowercase and trimmed.
- password_hash text NOT NULL; hash only, never plaintext.
- full_name text NOT NULL; length 1–120.
- email_verified_at timestamptz nullable.
- created_at, updated_at timestamptz NOT NULL.

### organizations — tenant root
- id uuid PK.
- name text NOT NULL; trimmed length 1–120.
- created_by uuid NOT NULL FK users(id), delete restricted.
- created_at, updated_at timestamptz NOT NULL.

### memberships — user/organization association
- id uuid PK.
- org_id uuid NOT NULL FK organizations(id) ON DELETE CASCADE.
- user_id uuid NOT NULL FK users(id) ON DELETE CASCADE.
- role text NOT NULL DEFAULT owner; allowed owner/admin/member/viewer.
- created_at timestamptz NOT NULL.
- UNIQUE(org_id,user_id); index on user_id.
- RLS allows lookup of authenticated user's memberships or the active organization; writes require active organization context.

### auth_sessions — user-scoped sessions
- id uuid PK.
- user_id uuid NOT NULL FK users(id) ON DELETE CASCADE.
- token_hash text NOT NULL UNIQUE; raw token exists only in secure cookie.
- expires_at timestamptz NOT NULL.
- created_at, last_seen_at timestamptz NOT NULL.
- Index on expires_at.

### cloud_accounts — connected provider account/project
- id uuid PK; org_id uuid NOT NULL FK organizations(id) ON DELETE CASCADE.
- provider text NOT NULL, constrained to aws/gcp.
- display_name text NOT NULL.
- external_account_id text NOT NULL (AWS account ID or GCP project ID).
- role_arn text nullable; external_id text nullable (AWS identity).
- status text NOT NULL DEFAULT pending; permission_status text NOT NULL DEFAULT not_checked.
- last_sync_at, last_sync_status, last_error_code.
- created_at, updated_at timestamptz NOT NULL; disconnected_at nullable.
- gcp_service_account_email text nullable.
- last_cost_sync_at, last_cost_sync_status nullable.
- gcp_billing_project_id, gcp_billing_dataset, gcp_billing_table nullable.
- UNIQUE(org_id,provider,external_account_id); UNIQUE(id,org_id).
- AWS requires role identity and external ID. GCP service-account email is format-checked. Billing configuration is optional.
- Indexes support org/status and active GCP project lookup.

### resources — normalized inventory
- id uuid PK; org_id uuid NOT NULL.
- cloud_account_id uuid NOT NULL FK (cloud_accounts.id,org_id) ON DELETE CASCADE.
- provider text constrained aws/gcp; external_id text NOT NULL.
- resource_type text NOT NULL; display_name, region, resource_status nullable.
- tags jsonb NOT NULL DEFAULT {}; metadata jsonb NOT NULL DEFAULT {}.
- migration_label text NOT NULL DEFAULT unclassified; controlled values above.
- first_seen_at, last_seen_at timestamptz NOT NULL.
- deleted_detected_at nullable; connector_version text NOT NULL DEFAULT 0.1.0.
- created_at, updated_at timestamptz NOT NULL.
- UNIQUE(cloud_account_id,external_id).
- Indexes: active org/type, provider, region, last_seen, trigram search over display name plus external ID.

### cost_records — provider-reported billing
- id uuid PK; org_id uuid NOT NULL.
- cloud_account_id uuid NOT NULL FK (cloud_accounts.id,org_id) ON DELETE CASCADE.
- provider text constrained aws/gcp.
- period_start, period_end date NOT NULL.
- service text NOT NULL; region text NOT NULL DEFAULT empty string after migration 0004.
- amount numeric(20,6) NOT NULL; currency char(3) NOT NULL.
- attribution text NOT NULL DEFAULT provider_reported; allowed provider_reported/estimated/unattributed.
- source_updated_at timestamptz nullable; created_at timestamptz NOT NULL.
- UNIQUE(cloud_account_id,period_start,period_end,service,region,currency).
- Index on (org_id,period_start DESC).
- Current schema is service/account level; it does not contain a resource_id column.

### findings — evidence-backed recommendations
- id uuid PK; org_id uuid NOT NULL.
- cloud_account_id uuid NOT NULL FK (cloud_accounts.id,org_id) ON DELETE CASCADE.
- resource_id uuid nullable FK resources(id) ON DELETE SET NULL.
- rule_key text NOT NULL; severity text NOT NULL DEFAULT info.
- title, description text NOT NULL; evidence jsonb NOT NULL DEFAULT {}.
- estimated_monthly_saving numeric(20,6) nullable; currency char(3) nullable.
- status text NOT NULL DEFAULT open; snoozed_until timestamptz nullable.
- created_at, updated_at timestamptz NOT NULL.
- UNIQUE(cloud_account_id,rule_key,resource_id).
- PostgreSQL nullable unique-key semantics do not prevent duplicates where resource_id is NULL; changing this requires an explicit migration and tests.

### sync_runs — durable work history
- id uuid PK; org_id uuid NOT NULL.
- cloud_account_id uuid NOT NULL FK (cloud_accounts.id,org_id) ON DELETE CASCADE.
- job_type text constrained inventory_sync/cost_sync/credential_check.
- status text constrained queued/running/succeeded/partial/failed/cancelled.
- started_at, finished_at nullable.
- resources_seen, resources_created, resources_updated, resources_missing integer NOT NULL DEFAULT 0.
- error_code, error_message nullable.
- connector_version text NOT NULL DEFAULT 0.1.0.
- is_complete boolean NOT NULL DEFAULT false; created_at timestamptz NOT NULL.
- Indexes support account history and queued polling.

### audit_log — CloudRoute action history
- id uuid PK; org_id uuid NOT NULL.
- actor_user_id uuid nullable FK users(id) ON DELETE SET NULL.
- action, target_type text NOT NULL; target_id text nullable.
- details jsonb NOT NULL DEFAULT {}; created_at timestamptz NOT NULL.
- Index on (org_id,created_at DESC).
- Update trigger rejects UPDATE. Do not claim protection against privileged DB operations or deletion by all possible administrative paths.

### migration_labels — current manual planning label
- id uuid PK; org_id uuid NOT NULL.
- resource_id uuid NOT NULL FK resources(id) ON DELETE CASCADE.
- label text NOT NULL, same controlled values as resources.
- notes text nullable; updated_by uuid nullable FK users(id) ON DELETE SET NULL.
- created_at, updated_at timestamptz NOT NULL.
- UNIQUE(org_id,resource_id).
- This is not a migration project/workflow engine.

### resource_history — meaningful resource changes
- id uuid PK; org_id uuid NOT NULL.
- resource_id uuid NOT NULL FK resources(id) ON DELETE CASCADE.
- change_type text constrained created/changed/marked_missing/restored.
- changed_fields text[] NOT NULL DEFAULT empty array.
- snapshot jsonb NOT NULL DEFAULT {}; observed_at timestamptz NOT NULL.
- Index on (org_id,resource_id,observed_at DESC).
- Trigger records creation and meaningful changes to display name, region, status, tags, type, migration label, and restoration. It does not record every poll.

### notification_preferences — organization preferences
- org_id uuid PK and FK organizations(id) ON DELETE CASCADE.
- weekly_digest_enabled boolean NOT NULL DEFAULT true.
- connection_failure_enabled boolean NOT NULL DEFAULT true.
- updated_by uuid nullable FK users(id) ON DELETE SET NULL.
- updated_at timestamptz NOT NULL.
- API returns enabled defaults when no row exists.

### email_outbox — durable email queue
- id uuid PK; org_id uuid NOT NULL FK organizations(id) ON DELETE CASCADE.
- recipient text NOT NULL.
- template_key text constrained weekly_digest/connection_failure.
- dedupe_key text NOT NULL; payload jsonb NOT NULL DEFAULT {}.
- status text constrained queued/sending/sent/failed.
- attempts integer NOT NULL DEFAULT 0; next_attempt_at timestamptz NOT NULL DEFAULT now().
- last_error_code nullable; created_at timestamptz NOT NULL; sent_at nullable.
- UNIQUE(org_id,dedupe_key); queue index on status/next_attempt_at.
- Provider webhook/bounce event ledger is not present in current migrations.

## 4. RLS coverage

Helper functions read transaction-local app.current_org_id and app.current_user_id.

RLS is enabled and forced for memberships, cloud_accounts, resources, cost_records, findings, sync_runs, audit_log, migration_labels, resource_history, notification_preferences, and email_outbox.

users, organizations, and auth_sessions are not in the migration's RLS table list. Protect them through restricted query paths and database privileges. Do not state that every table currently has RLS.

Runtime database role:
- Not a superuser.
- No BYPASSRLS.
- Must not own tenant tables in a way that bypasses forced RLS.
- Only required runtime privileges; controlled migration identity should be separate where practical.

## 5. Data lifecycle

### Account disconnect
Stop scheduling; cancel queued/running jobs; workers recheck connection under lock before persistence; delete account-owned inventory, history, costs, findings, and sync records under the documented deletion process; verify API/export/search/worker can no longer expose or recreate data. Current core account-owned relations use cascading foreign keys. Verify the complete disconnect transaction and audit-retention behavior before public release.

### Organization deletion
Require owner confirmation and re-authentication where appropriate; stop jobs and notifications; delete organization-owned data through documented cascades; revoke sessions/remove memberships as appropriate; verify no job can recreate data; confirm to user. Deletion from live DB does not immediately prove deletion from backups; publish backup expiry window.

### Retention
Define and publish retention for logs, backups, and legally retained audit information. Encrypt and access-control backups. Test restoration with tenant isolation intact.

## 6. Query and migration conventions

All tenant list queries filter org_id. Add indexes for observed query patterns. Use cursor pagination and bounded limits. Avoid unbounded JSONB scans. Group cost by currency. Use exact numeric arithmetic. Use EXPLAIN ANALYZE with representative data before adding expensive indexes or partitioning.

Never edit an applied migration. Add the next numbered migration; include constraints, indexes, RLS, and triggers; test from empty DB and previous released schema; prevent concurrent migration runners; deploy compatible schema before dependent code; do not auto-reverse schema on application rollback.

## 7. Not in the current schema

Do not add speculatively: provider activity events; migration projects/items; budgets/anomaly baselines; exchange-rate/reporting currency tables; resource relationship graph; action requests/control plane; API keys/teams/invitations/SSO; subscription billing; provider bounce/webhook ledger; raw provider payload object storage. Each requires approved PRD scope, threat/data-lifecycle review, migration, and tests.
