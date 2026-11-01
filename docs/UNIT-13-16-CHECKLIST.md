# CloudRoute Units 13–16 Checklist

These units harden the existing AWS/GCP read-only MVP. They do not add cloud write permissions or permit CloudRoute to execute savings recommendations.

## Unit 13 — Cross-unit integration and contract audit
- [x] Document the API, database, worker, provider, and web integration contracts.
- [x] Define shared invariants for organization scope, account lifecycle, sync completeness, currency, and notification delivery.
- [x] Add production configuration validation at API startup.
- [ ] Validate live AWS and GCP accounts, billing exports, and email delivery in isolated provider sandboxes.
- [ ] Confirm the final branch stack after PRs #2–#4 are reviewed and merged in dependency order.

## Unit 14 — Security and tenant isolation
- [x] Fail production startup when PostgreSQL TLS, database URL, or HTTPS public origin is missing or invalid.
- [x] Require exact configured origin matching for unsafe browser requests in production.
- [x] Add HSTS in production and retain no-store, nosniff, frame-denial, and referrer protections.
- [x] Extend PostgreSQL integration coverage to the Unit 9–12 tenant-owned tables.
- [ ] Perform an independent penetration test and review provider IAM grants in the deployed environment.
- [ ] Configure secret storage, rotation, alerting, backups, and restore access controls.

## Unit 15 — End-to-end and regression validation
- [x] Expand API smoke tests for health/readiness, authentication boundaries, security headers, and production origin enforcement.
- [x] Add production configuration regression tests.
- [x] Keep PostgreSQL row-level-security integration tests in the CI path.
- [ ] Run browser-based signup/login/account-onboarding/inventory/cost/findings/settings journeys against a deployed test environment.
- [ ] Verify failure, retry, partial sync, duplicate job, provider rate-limit, and email delivery scenarios with sandbox accounts.

## Unit 16 — Production readiness
- [x] Separate liveness from database-backed readiness.
- [x] Add a production operations runbook and release gate.
- [x] Document deployment topology, required environment variables, migrations, backups, observability, and rollback.
- [ ] Provision managed PostgreSQL with TLS, secret storage, API/worker/web hosting, and outbound email.
- [ ] Complete restore rehearsal, load test, provider reconciliation, security review, and monitored canary release.

## Release decision
A green CI run proves the automated checks in that run only. It does not prove live provider access, billing reconciliation, browser journeys, email deliverability, backup restoration, or production security. Keep CloudRoute in pre-production until every unchecked release gate above has evidence attached to the release record.
