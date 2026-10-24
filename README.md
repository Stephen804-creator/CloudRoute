# CloudRoute

CloudRoute is a read-first multi-cloud visibility platform for cloud resource inventory, cost visibility, synchronization health, and potential savings. The MVP supports read-only inventory connections for AWS and Google Cloud. Cost ingestion and savings findings remain later units.

**Safety boundary:** MVP access is read-only. CloudRoute must not create, modify, or delete customer cloud resources. It does not read data inside customer buckets, databases, or disks, and it does not store Lambda environment variables. Missing resources are marked as deleted only after a complete successful inventory run.

## Current implementation

Units 2–7 are in PR #2. Unit 8 adds the Google Cloud connector on `build/unit-8-gcp`, stacked on that review branch.

- TypeScript pnpm monorepo with Next.js, Fastify API, PostgreSQL, a separate worker, and AWS connector packages.
- PostgreSQL schema for users, organizations, memberships, sessions, accounts, resources, costs, findings, sync runs, audit log, and migration labels.
- Organization-scoped transactions and row-level security policies.
- Email/password authentication with scrypt password hashes, opaque hashed sessions, and optional state-checked Google OAuth.
- Read-only AWS role onboarding with an external ID and STS role assumption.\n- Google Cloud project onboarding through short-lived service-account impersonation and Cloud Asset Inventory.
- AWS metadata inventory for EC2 instances, EBS volumes, snapshots, Elastic IPs, S3 bucket metadata, RDS databases, Lambda function metadata, and load balancers.
- Idempotent inventory sync, hourly refresh scheduling, partial-run safety, and Redis/BullMQ with PostgreSQL queue fallback.
- Searchable/filterable inventory, migration labels, CSV export, account status, and an overview dashboard.
- CI uses a non-superuser PostgreSQL role and attempts cross-tenant reads and writes.

Provider cost ingestion, savings rules, email digests, password-signup email verification, and production deployment remain incomplete.

## Stack

- Node.js 22+ and pnpm 10+
- Next.js / React / TypeScript
- Fastify REST API
- PostgreSQL with row-level security
- Redis / BullMQ (optional locally; PostgreSQL polling fallback is included)
- AWS SDK v3 with temporary STS role credentials\n- Google Auth Library with short-lived service-account impersonation

## Local development

Follow [docs/LOCAL-DEVELOPMENT.md](docs/LOCAL-DEVELOPMENT.md).

Quick setup:

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

Run the build, type checks, and tests:

```bash
pnpm build
pnpm typecheck
pnpm test
```

## AWS connection requirements

The account connection flow creates a unique external ID, accepts a customer-created IAM role ARN, validates it using STS, and queues inventory. CloudRoute never asks for long-lived AWS access keys.

See:
- [AWS read-only permissions](docs/security/aws-read-only-policy.json)
- [AWS trust policy template](docs/security/aws-role-trust-template.json)
- [Security baseline](docs/security/SECURITY.md)

A live AWS connection requires a deployed CloudRoute runtime role. Set `CLOUDROUTE_AWS_PRINCIPAL_ARN` to that exact role ARN before using the onboarding wizard. Do not replace it with an unrelated or broad principal.

## Project documents

- [Unit 2–7 checklist](docs/UNIT-2-7-CHECKLIST.md)\n- [Unit 8 Google Cloud checklist](docs/UNIT-8-GCP-CHECKLIST.md)\n- [Google Cloud read-only setup](docs/security/gcp-read-only-setup.md)\n- [Google Cloud impersonation decision](docs/architecture/decisions/0002-gcp-impersonation.md)
- [Local development](docs/LOCAL-DEVELOPMENT.md)
- [Architecture decision: modular monolith](docs/architecture/decisions/0001-modular-monolith.md)

## Security

Never commit `.env`, customer credentials, access tokens, or raw cloud data. Use a dedicated non-superuser database role so row-level security is exercised. Review the exact requested provider permissions before connecting an account. The MVP is not production-ready until CI passes and the live integration and deployment checks in the checklist are completed.

## License

See [LICENSE](./LICENSE).
