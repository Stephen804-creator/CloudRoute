# CloudRoute Security Baseline

## MVP permission boundary

CloudRoute is read-only. No MVP endpoint, worker, connector, or UI action may create, modify, or delete a customer's cloud resources. Any future control-plane capability requires a separate design, explicit approval, and security review.

## Credential handling

- Never request or store a customer's long-lived AWS access keys.
- AWS access uses a customer-created cross-account role, scoped to read-only actions and protected by an external ID.\n- Google Cloud access uses runtime Application Default Credentials to impersonate a customer-owned service account with short-lived tokens and a read-only scope. Customer private-key JSON files are not accepted.
- Never log tokens, private keys, authorization headers, or complete credential payloads.
- Never log tokens, private keys, authorization headers, or complete credential payloads.
- Secrets belong in environment-specific secret storage, not source control.

## Tenant isolation

Every organization-owned record is scoped to an organization. API authorization is enforced server-side; a client-supplied organization ID is never sufficient proof of access. PostgreSQL row-level security and organization-scoped transactions are used together.

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
