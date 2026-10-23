# CloudRoute

CloudRoute is a read-first, multi-cloud visibility platform that brings cloud inventory, cost information, synchronization status, and savings findings into one workspace.

## MVP boundaries

The MVP connects AWS and Google Cloud using read-only permissions. It inventories supported resources, presents cost data with clear attribution and freshness, identifies a small set of potential savings, and records simple migration labels.

**CloudRoute must not create, modify, or delete customer cloud resources in the MVP.** Demo data must be clearly separated from connected-provider data. Missing or stale provider data must never be presented as current.

## Planned stack

- **Web:** Next.js, React, TypeScript
- **API:** Node.js, Fastify, TypeScript, REST/OpenAPI
- **Worker:** separate Node.js process for scheduled synchronization
- **Data:** PostgreSQL with organization-level tenant isolation and row-level security
- **Queue/cache:** Redis and BullMQ when synchronization is introduced
- **Providers:** AWS and Google Cloud read-only connectors
- **Repository:** pnpm workspace monorepo

## Repository layout

```text
apps/
  api/                 REST API
  web/                 web application
  worker/              background synchronization process
packages/
  shared/              shared types and utilities
  connector-sdk/       provider-neutral connector contracts
  connector-aws/       AWS connector
  connector-gcp/       Google Cloud connector
  db/                  database schema and migrations
docs/
  architecture/        architecture decisions
  security/             security and permission guidance
infra/                  infrastructure definitions (later unit)
```

## Requirements

- Node.js 22 or newer
- pnpm 10 or newer

Install dependencies:

```bash
corepack enable
pnpm install
```

Start the API:

```bash
pnpm --filter @cloudroute/api dev
```

The API listens on `PORT` (default `4000`) and exposes `GET /health`. This endpoint reports application liveness only; it does not claim that cloud providers or a database are connected.

## Environment configuration

Copy `.env.example` to `.env` for local development. Never commit real credentials, cloud keys, tokens, or production secrets. The initial foundation does not require cloud credentials.

## Development principles

1. Read-only cloud access for the MVP.
2. Least privilege and explicit connection status.
3. Preserve provider identifiers and raw payloads alongside normalized fields.
4. Display data freshness and distinguish estimates from provider-reported costs.
5. Enforce organization boundaries in the API and database.
6. Never delete inventory based on a failed or partial synchronization.
7. Add functionality in small, tested units; do not mark a feature complete until its acceptance checks pass.

## Status

Unit 1 establishes the monorepo, shared TypeScript conventions, API health endpoint, worker entry point, connector contracts, and security baseline. Provider integrations, authentication, database migrations, dashboard UI, and real synchronization are implemented in later units.

## License

See [LICENSE](./LICENSE).
