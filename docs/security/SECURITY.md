# CloudRoute Security Baseline

## MVP permission boundary

CloudRoute is read-only. No MVP endpoint, worker, connector, or UI action may create, modify, start, stop, or delete a customer's cloud resources. Any future control-plane capability requires a separate design, explicit approval, and security review.

## Credential handling

- Never request or store a customer's long-lived AWS access keys.
- AWS access uses a customer-created cross-account role, scoped to read-only actions and protected by an external ID.
- Google Cloud access uses runtime Application Default Credentials to impersonate a customer-owned service account with short-lived tokens and a read-only scope. Customer private-key JSON files are not accepted.
- Never log tokens, private keys, authorization headers, or complete credential payloads.
- Secrets belong in environment-specific secret storage, not source control.
- Production PostgreSQL connections require certificate-verified TLS. Production configuration is rejected when the database URL, TLS setting, or HTTPS public origin is missing or invalid.

## Tenant isolation

Every organization-owned record is scoped to an organization. API authorization is enforced server-side; a client-supplied organization ID is never sufficient proof of access. PostgreSQL row-level security and organization-scoped transactions are used together. CI exercises cross-tenant reads and writes for accounts, resources, history, costs, findings, notification preferences, and email outbox records using a non-superuser database role.

## Browser request integrity

- Session cookies are HttpOnly, SameSite=Strict, and Secure in production.
- Unsafe browser requests in production must include an Origin header that exactly matches the configured HTTPS `PUBLIC_APP_ORIGIN`.
- API responses include no-store, nosniff, frame-denial, and no-referrer headers.
- HSTS is emitted in production; HTTPS termination and correct trusted-proxy configuration remain deployment responsibilities.

## Synchronization safety

- Show last successful synchronization and current status.
- A failed or partial run must not cause missing resources to be deleted or trigger complete-scan savings evaluation.
- Retries must be bounded and use backoff.
- Provider errors must not leak credentials or sensitive response content.
- Treat provider payloads as untrusted input.

## Billing and email integrity

- AWS Cost Explorer access is read-only and uses temporary role credentials.
- Google Cloud billing reads use a configured BigQuery export table and a short-lived read-only impersonated token. Billing export is optional; inventory remains available without it.
- Cost amounts retain their original provider currency; CloudRoute does not combine different currencies into a misleading total.
- Email notifications require an explicit outbound provider configuration. When unconfigured, messages remain queued and are not reported as delivered.

## Reporting integrity

Provider-reported values, estimates, and unattributed costs must be distinguishable. Stale data must not be labelled current. Demo data must be visibly labelled and must never be mixed silently with connected-account data.

## Reporting vulnerabilities

Do not include credentials or customer cloud data in public issues. Report suspected vulnerabilities privately to the repository owner until a dedicated security reporting process is published.
