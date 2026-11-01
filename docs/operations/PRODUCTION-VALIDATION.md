# CloudRoute production validation gates

This document defines evidence required before CloudRoute can be called production-ready. It complements the automated CI pipeline; it does not claim that external services or production infrastructure have already been tested.

## Release boundary

CloudRoute remains a read-only cloud visibility product. Validation must prove that AWS and Google Cloud credentials cannot create, modify, start, stop, or delete customer resources. Do not use customer production accounts for destructive testing. Use isolated provider sandbox accounts with disposable test resources.

A green CI run proves only the checks executed by that workflow. It is not evidence of provider connectivity, browser behavior, email delivery, disaster recovery, penetration resistance, or production capacity.

## Gate A — repository and migration integrity

- [ ] Record the exact release commit SHA and the complete stacked-PR merge order.
- [ ] Confirm build, typecheck, unit tests, PostgreSQL migrations, and non-superuser tenant-isolation tests pass on that SHA.
- [ ] Confirm migration execution against the intended managed PostgreSQL major version.
- [ ] Confirm the deployed application role is not a superuser, does not have BYPASSRLS, and cannot assume an owner role.
- [ ] Review migration lock/serialization behavior so two deploy processes cannot apply migrations concurrently.
- [ ] Verify backup completion before migration and record a successful restore rehearsal.

Evidence: CI run URL, migration logs, role grants, backup identifier, restore report.

## Gate B — tenant authorization and API security

Test with two independent organizations and separate users/sessions.

- [ ] Attempt cross-tenant reads, updates, deletes, inserts, and identifier substitution for every tenant-owned API resource.
- [ ] Verify organization context is derived from the authenticated session, never trusted from request body, query string, or caller-controlled headers.
- [ ] Verify unauthenticated and expired sessions cannot reach tenant routes.
- [ ] Verify logout/revocation invalidates the session and cookie attributes are correct in HTTPS production.
- [ ] Verify unsafe browser requests reject missing, malformed, and untrusted Origin values according to the documented API-client policy.
- [ ] Verify rate limits are enforced across multiple API instances, not only within one process.
- [ ] Review authorization on every route and every background-job entry point; do not rely on UI hiding.

Evidence: test report with route/resource matrix, redacted request/response examples, security review findings.

## Gate C — AWS and Google Cloud provider sandbox

Use dedicated sandbox accounts/projects and the exact production trust/impersonation pattern.

- [ ] Verify the AWS role trust policy restricts the intended CloudRoute runtime principal and external ID.
- [ ] Verify AWS policy allows only the documented inventory and billing read actions; explicitly test representative write actions are denied.
- [ ] Verify GCP service-account impersonation is restricted to the intended runtime identity and read-only Asset Inventory / BigQuery billing permissions.
- [ ] Explicitly test representative GCP resource mutation permissions are denied.
- [ ] Compare CloudRoute inventory with provider consoles/APIs for known test resources, pagination, regions, labels, and resource identifiers.
- [ ] Verify revoked credentials, missing permissions, throttling, timeouts, and provider outages produce safe, actionable connection states.
- [ ] Verify incomplete/failed inventory runs never mark unseen resources deleted.
- [ ] Reconcile a known billing period and currency against AWS Cost Explorer and the GCP billing export, documenting timing and rounding differences.

Evidence: sanitized policy documents, denied-action results, inventory reconciliation, billing reconciliation, provider request IDs where safe.

## Gate D — queue, worker, and account lifecycle

- [ ] Submit the same sync request repeatedly and verify only one logical run is persisted/processed for a given idempotency key.
- [ ] Simulate worker termination before processing, during provider fetch, and during persistence; verify retry/recovery behavior.
- [ ] Verify exponential retries are bounded and terminal failures are visible without leaking provider secrets.
- [ ] Verify duplicate delivery does not duplicate inventory or cost records.
- [ ] Disconnect an account while a job is queued, fetching provider data, and immediately before persistence; verify no late writes and no status resurrection.
- [ ] Verify a failed job cannot overwrite a newer successful run's account status.
- [ ] Verify PostgreSQL polling fallback and Redis/BullMQ operation separately; monitor queue age and stuck-running jobs.
- [ ] Confirm worker health is independently monitored; API liveness/readiness does not establish worker health.

Evidence: job/run identifiers, fault-injection results, persisted row counts, queue metrics and worker logs.

## Gate E — browser journeys and user experience

Run against a deployed preview using a dedicated test organization.

- [ ] Sign up, sign in, sign out, and verify expired/invalid sessions.
- [ ] Complete AWS onboarding and GCP onboarding using the documented identity flows.
- [ ] Run inventory sync and verify loading, empty, partial, failed, and successful states.
- [ ] Open resource details and history; verify filters, pagination, and no cross-tenant data.
- [ ] Open cost views and savings findings; verify currency labels, date ranges, stale-data messaging, and no fabricated savings.
- [ ] Change notification preferences and verify persisted state.
- [ ] Test keyboard navigation, focus visibility, form errors, responsive layouts, and accessible names on critical journeys.
- [ ] Verify the web app's same-origin API rewrite and production HTTPS cookie behavior.

Evidence: browser/version, test account/org, screenshots or video, failed-step details, accessibility findings.

## Gate F — notifications and email

- [ ] Verify weekly digest scheduling, timezone policy, and duplicate suppression.
- [ ] Verify connection-failure alerts respect organization preferences.
- [ ] Verify outbox retry limits, backoff, idempotency, and terminal failure handling.
- [ ] Test accepted, rejected, bounced, and provider-timeout email outcomes using a controlled recipient.
- [ ] Verify unsubscribe/notification preference behavior and that logs do not expose full message bodies or secrets.

Evidence: redacted provider event IDs, outbox state transitions, delivery/retry report.

## Gate G — security, resilience, and operational readiness

- [ ] Complete independent application/API penetration testing and remediate critical/high findings.
- [ ] Review dependency and container vulnerabilities; document accepted exceptions and expiry dates.
- [ ] Verify TLS certificate validation, HTTPS redirects, security headers, cookie settings, secret storage, and log redaction in the deployed environment.
- [ ] Run load tests at an agreed concurrency and account/resource volume; record API latency, DB pool use, queue age, worker throughput, and provider throttling.
- [ ] Restore a backup into an isolated environment and verify migrations, tenant data, and application startup.
- [ ] Exercise rollback of web/API/worker to a known-good immutable release without automatically reversing schema migrations.
- [ ] Run a monitored canary with rollback thresholds and named operational ownership.

Evidence: signed security report, vulnerability report, load-test report, restore report, rollback record, canary dashboard.

## Release decision

A release owner must mark each gate as Pass, Fail, or Not Applicable with a reason and evidence link. Any untested gate remains Not Verified; it must not be silently treated as passed.

Production approval requires:
1. No open critical/high security findings.
2. All tenant isolation and read-only provider permission tests pass.
3. Provider inventory and billing reconciliation is accepted.
4. Browser critical journeys pass.
5. Queue recovery, account disconnection, and notification delivery behavior are verified.
6. Backup restoration, rollback, monitoring, and canary evidence are accepted.

## Validation record

| Field | Value |
| --- | --- |
| Release commit SHA | |
| Environment | |
| Validation date | |
| Validator | |
| CI run | |
| AWS sandbox evidence | |
| GCP sandbox evidence | |
| Browser journey evidence | |
| Queue/worker evidence | |
| Email evidence | |
| Security review | |
| Restore/rollback evidence | |
| Decision | Not Verified |
| Outstanding risks / owner | |
