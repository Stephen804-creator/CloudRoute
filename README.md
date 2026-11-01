# CloudRoute

CloudRoute is a read-first multi-cloud visibility platform for cloud resource inventory, cost visibility, synchronization health, and potential savings. The MVP supports read-only inventory and billing visibility for AWS and Google Cloud, evidence-based savings findings, and configurable email notifications.

**Safety boundary:** MVP access is read-only. CloudRoute must not create, modify, or delete customer cloud resources. It does not read data inside customer buckets, databases, or disks, and it does not store Lambda environment variables. Missing resources are marked as deleted only after a complete successful inventory run.

## Current implementation

Units 2–7 are in PR #2. Unit 8 adds the Google Cloud connector. Units 9–12 extend inventory history, billing ingestion, savings findings, and notifications on `build/units-9-12`. Units 13–16 add integration contracts, production security checks, expanded tenant isolation tests, readiness probes, and an operations runbook on `build/units-13-16`.

- TypeScript pnpm monorepo with Next.js, Fastify API, PostgreSQL, a separate worker, and AWS/GCP connector packages.
- PostgreSQL schema for users, organizations, memberships, sessions, accounts, resources, costs, findings, sync runs, audit log, migration labels, history, and notification outbox.
- Organization-scoped transactions and row-level security policies.
- Email/password authentication with scrypt password hashes, opaque hashed sessions, and optional state-checked Google OAuth.
- Read-only AWS role onboarding with an external ID and STS role assumption.
- Google Cloud project onboarding through short-lived service-account impersonation and Cloud Asset Inventory.
- Idempotent inventory sync, hourly refresh scheduling, partial-run safety, and Redis/BullMQ with PostgreSQL queue fallback.
- Resource change history, AWS Cost Explorer ingestion, optional GCP BigQuery billing export ingestion, conservative savings findings, and configurable email notifications.
- Liveness and database-backed readiness endpoints; production startup validation for database TLS and HTTPS origin.
- CI includes build, typecheck, tests, migrations, and PostgreSQL tenant-isolation checks.

## Stack

- Node.js 22+ and pnpm 10+
- Next.js / React / TypeScript
- Fastify REST API
- PostgreSQL with row-level security
- Redis / BullMQ (optional locally; PostgreSQL polling fallback is included)
- AWS SDK v3 and Google Auth Library using short-lived credentials

## Local development

Follow [docs/LOCAL-DEVELOPMENT.md](docs/LOCAL-DEVELOPMENT.md).

```bash
cp .env.example .env
docker compose up -d
corepack enable
pnpm install
pnpm db:migrate
pnpm dev:api
pnpm dev:worker
pnpm dev:web
```

Run validation:

```bash
pnpm build
pnpm typecheck
pnpm test
```

## Security and operations

- [Security baseline](docs/security/SECURITY.md)
- [Integration contracts](docs/architecture/INTEGRATION-CONTRACTS.md)
- [Production operations runbook](docs/operations/PRODUCTION-RUNBOOK.md)
- [Local development](docs/LOCAL-DEVELOPMENT.md)

The MVP is not production-approved until the live provider, browser journey, backup restoration, email delivery, security, and canary release gates in the checklist have evidence.

## Project checklists

- [Unit 2–7](docs/UNIT-2-7-CHECKLIST.md)
- [Unit 8 Google Cloud](docs/UNIT-8-GCP-CHECKLIST.md)
- [Units 9–12](docs/UNIT-9-12-CHECKLIST.md)
- [Units 13–16](docs/UNIT-13-16-CHECKLIST.md)

## License

See [LICENSE](./LICENSE).
