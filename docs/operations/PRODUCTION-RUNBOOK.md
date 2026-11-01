# CloudRoute production operations runbook

## Supported deployment shape

Run the web app, API, and worker as separate processes/services from the same release revision. Use managed PostgreSQL with TLS and a dedicated non-superuser application role. Redis/BullMQ is optional because the worker has a PostgreSQL polling fallback, but production queue behavior must be load-tested with the chosen topology.

Do not expose PostgreSQL or Redis publicly. Place the web app and API behind HTTPS ingress. Keep the API's internal address private and set the web rewrite target to that address.

## Required production configuration

- `NODE_ENV=production`
- `DATABASE_URL`: managed PostgreSQL connection URL using the application role
- `DATABASE_SSL=true`: enables certificate-verified TLS
- `DB_POOL_MAX`: sized for API and worker replicas within the database connection budget
- `PUBLIC_APP_ORIGIN`: exact HTTPS origin serving the web app, without a path
- `CLOUDROUTE_API_INTERNAL_URL`: private API URL used by the Next.js rewrite
- `HOST=0.0.0.0`: bind API to the container/service interface
- `REDIS_URL`: managed private Redis when BullMQ is enabled
- `RESEND_API_KEY` and `NOTIFICATION_FROM_EMAIL`: only when outbound email is enabled
- Google OAuth credentials only when Google login is enabled
- `CLOUDROUTE_AWS_PRINCIPAL_ARN`: exact deployed AWS runtime principal when AWS account onboarding is enabled

Use the hosting provider's secret manager. Never put production secrets in GitHub source files, build arguments, client-side Next.js variables, logs, or PR comments.

## Release procedure

1. Confirm the target commit and all prerequisite stacked PRs are merged in dependency order.
2. Build immutable web, API, and worker artifacts from that exact commit.
3. Provision or verify PostgreSQL, Redis (if used), outbound email, and provider runtime identities.
4. Take a database backup and verify that a recent restore rehearsal succeeded.
5. Run numbered migrations once using a controlled migration job and the application database role.
6. Deploy API and worker, then verify `/health` and `/ready`; confirm worker polling and queue processing.
7. Deploy web with the matching internal API URL and exact HTTPS public origin.
8. Run authenticated smoke tests in a non-customer test organization.
9. Connect isolated AWS and GCP sandbox accounts, verify read-only inventory, billing reconciliation, and partial-run safety.
10. Verify notification preferences, email delivery, retries, and provider failure handling.
11. Monitor errors, queue age, sync freshness, database connections, and provider throttling during a canary period.

## Health and response

- `GET /health`: liveness only. A 200 means the API process is running.
- `GET /ready`: database-backed readiness. A non-200 response means the API must not receive new traffic.
- Worker: inspect service logs and queued/running `sync_runs`; a healthy API does not prove the worker is healthy.
- Web: verify the deployed page and same-origin `/v1` rewrite separately.

Do not expose database URLs, provider error payloads, customer identifiers, session tokens, or email payloads in health endpoints.

## Rollback

- Prefer rolling API, worker, and web services back together to the last known-good immutable release.
- Do not automatically reverse schema migrations. Migrations may be forward-compatible; assess the exact schema dependency and restore plan first.
- If a migration is incompatible, stop writes/worker processing, preserve logs, and use the approved database recovery procedure.
- Never delete customer cloud resources as part of rollback. CloudRoute's provider access remains read-only.

## Mandatory release evidence

Attach the commit SHA, CI run URL, migration result, restore rehearsal, security review, provider sandbox reconciliation, browser journey results, email delivery/retry evidence, and canary observations. A green build alone is not production approval.
