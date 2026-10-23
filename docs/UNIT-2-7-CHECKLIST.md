# CloudRoute — Units 2–7

## Unit 2: Database and tenant isolation
- [x] PostgreSQL migration for users, organizations, memberships, sessions, cloud accounts, resources, costs, findings, sync runs, audit log, and migration labels.
- [x] Organization-scoped transactions and row-level security policies.
- [x] Idempotent resource identity per cloud account and external resource ID.
- [x] Append-only audit log updates and tenant schema contract tests.
- [ ] Run migration against a real PostgreSQL instance and verify cross-tenant access is denied.

## Unit 3: Authentication and organizations
- [x] Email/password sign-up and login with scrypt password hashes.
- [x] Random opaque session cookie; only its SHA-256 hash is stored in PostgreSQL.
- [x] HttpOnly, SameSite=Strict cookie; Secure in production.
- [x] Single owner workspace per new user and tenant-scoped API guard.
- [ ] Add email verification and managed Google OAuth before public launch.

## Unit 4: Dashboard
- [x] Responsive overview, inventory, and accounts views.
- [x] First-run state does not fabricate provider data.
- [x] Search/filter controls, migration labels, and CSV export are wired to API endpoints.

## Unit 5: AWS read-only connector
- [x] STS AssumeRole with external ID; no customer AWS access keys.
- [x] Reads EC2 instances/volumes/addresses/snapshots, S3 bucket metadata, RDS, Lambda, and load balancer metadata.
- [x] Exact read-only policy template; Lambda environment values and bucket contents are not collected.
- [ ] Verify end-to-end using a dedicated AWS test account and the policy documented in this repository.

## Unit 6: Synchronization engine
- [x] SyncRun records and initial inventory sync on successful validation.
- [x] BullMQ/Redis queue with a PostgreSQL polling fallback.
- [x] Idempotent upserts, bounded queue retries, and partial-run status.
- [x] Deletion detection only after a complete inventory run.
- [ ] Run integration tests with PostgreSQL, Redis, and an AWS sandbox.

## Unit 7: Unified inventory
- [x] Tenant-scoped resource list/detail endpoints.
- [x] Provider/type/region/text/migration-label filters and cursor field.
- [x] Migration labels, audit entries, CSV export, overview counts, sync status.
- [ ] Add real database integration tests and load test the 10,000-resource target.

## Validation note

The checklist records implemented code, not a claim that production readiness or live cloud integration has already been proven. Complete the unchecked integration checks before deploying to real customer accounts.
