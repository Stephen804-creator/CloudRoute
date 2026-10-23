# ADR 0001: Modular Monolith with Isolated Workers

- **Status:** Accepted for MVP
- **Date:** 2026-10-23

## Context

CloudRoute needs a clear separation between its web interface, request/authorization layer, scheduled provider synchronization, and provider-specific integrations. A large microservices deployment would add operational complexity before the product has validated its core workflow.

## Decision

Use a TypeScript pnpm monorepo with a modular API and separately runnable worker process. Provider connectors implement a provider-neutral contract. PostgreSQL is the durable system of record. Redis/BullMQ may be introduced for scheduled and retryable work in the synchronization unit.

## Consequences

- Shared types and connector contracts can be reviewed in one repository.
- The worker can be deployed and scaled separately from the API.
- Modules remain separable without introducing network boundaries prematurely.
- Tenant authorization, database constraints, idempotent synchronization, and credential isolation still require explicit implementation; the monorepo alone does not provide them.
