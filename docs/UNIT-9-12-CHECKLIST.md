# CloudRoute Units 9–12 Checklist

These units extend the read-only MVP. Provider access remains observation-only; CloudRoute does not execute recommendations.

## Unit 9 — Inventory history and normalized inventory
- Added a tenant-scoped resource history table and database trigger.
- Records resource creation and meaningful metadata changes, not every poll.
- Exposes `GET /v1/resources/:id/history` with a bounded result limit.
- Preserves the existing rule that incomplete inventory scans never mark unseen resources as deleted.

## Unit 10 — Cost visibility and ingestion
- Added authenticated `GET /v1/costs/summary` and `GET /v1/costs/breakdown` endpoints.
- Adds a cost explorer screen for month-to-date and previous-month totals, time windows, provider/service/account breakdowns, and freshness.
- Adds scheduled AWS Cost Explorer ingestion for the trailing 90 days using temporary STS credentials.
- Adds optional Google Cloud Billing export ingestion through a configured BigQuery dataset/table and short-lived read-only impersonation.
- Re-reads recent periods and upserts daily records so provider restatements can be reflected.
- Currency is not silently converted; the UI warns that billing data may lag.

## Unit 11 — Savings rules and findings
- Evaluates rules after a complete inventory sync only.
- Implements conservative metadata/metrics-evidence rules for unattached volumes, unassociated static IPs, old snapshots whose source volume is absent, stopped instances with explicit stop-time and disk evidence, low-utilization compute instances when metrics are present, and idle databases when metrics are present.
- Does not infer utilization from inventory alone and does not fabricate savings estimates.
- Reconciles findings and resolves previously open findings when evidence no longer matches.

## Unit 12 — Findings workflow and email notifications
- Adds a findings API and savings workspace.
- Supports audited dismiss, reopen, and seven-day snooze actions.
- Adds organization-scoped notification preferences.
- Queues a weekly digest on Mondays and connection-failure messages to the owner email.
- Sends queued email through Resend when `RESEND_API_KEY` and `NOTIFICATION_FROM_EMAIL` are configured; retries failed deliveries with backoff. Without configuration, messages remain queued and are not claimed as delivered.

## Required configuration
- AWS customer role policy must include `ce:GetCostAndUsage` and `ce:GetDimensionValues` for cost ingestion.
- For Google Cloud cost ingestion, enable billing export to BigQuery, configure the project/dataset/table in the connection form, and grant the impersonated service account BigQuery Data Viewer on the dataset plus BigQuery Job User on the billing project.
- Set `RESEND_API_KEY` and `NOTIFICATION_FROM_EMAIL` to enable outbound email. Never put provider credentials into source files.
- Cost sync for Google Cloud is skipped when billing export configuration is absent; inventory-only mode remains supported.

## Validation still required before production
- Run the full CI build, typecheck, tests, and PostgreSQL tenant-isolation suite.
- Connect sandbox AWS and GCP billing accounts and reconcile daily totals against provider consoles.
- Verify the BigQuery export schema and dataset location for the target account.
- Validate all six rules against seeded provider metadata; metrics-based rules need explicitly configured CloudWatch/Cloud Monitoring collection.
- Configure Resend and verify delivery, retry, unsubscribe/notification preference, and bounce handling.
- Perform account disconnect/data deletion tests and a 10,000-resource scale test.
- Do not treat this checklist or a green CI run as a substitute for live provider and production security testing.
