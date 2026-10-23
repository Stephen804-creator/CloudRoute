# CloudRoute Security Baseline

## MVP permission boundary

CloudRoute is read-only. No MVP endpoint, worker, connector, or UI action may create, modify, or delete a customer's cloud resources. Any future control-plane capability requires a separate design, explicit approval, and security review.

## Credential handling

- Never request or store a customer's long-lived AWS access keys.
- AWS access is planned through a customer-created cross-account role, scoped to read-only actions and protected by an external ID.
- Prefer Google Cloud service-account impersonation or another short-lived credential flow. If a key-file fallback is later approved, it must be encrypted at rest, tightly access-controlled, and revocable.
- Never log tokens, private keys, authorization headers, or complete credential payloads.
- Secrets belong in environment-specific secret storage, not source control.

## Tenant isolation

Every organization-owned record must be scoped to an organization. API authorization must be enforced server-side; a client-supplied organization ID is never sufficient proof of access. PostgreSQL row-level security and application-level authorization will be added before organization data is exposed.

## Synchronization safety

- Show last successful synchronization and current status.
- A failed or partial run must not cause missing resources to be deleted.
- Retries must be bounded and use backoff.
- Provider errors must not leak credentials or sensitive response content.
- Treat provider payloads as untrusted input.

## Reporting integrity

Provider-reported values, estimates, and unattributed costs must be distinguishable. Stale data must not be labelled current. Demo data must be visibly labelled and must never be mixed silently with connected-account data.

## Reporting vulnerabilities

Do not include credentials or customer cloud data in public issues. Report suspected vulnerabilities privately to the repository owner until a dedicated security reporting process is published.
