# CloudRoute Product Requirements Document

**Document ID:** CR-PRD-001 | **Version:** 1.0 | **Status:** Authoritative product baseline

Companion documents: Technical Requirements, Data Schema, Design Brief, Implementation Plan.

## 1. Product definition

CloudRoute is a read-first multi-cloud visibility platform. It connects AWS accounts and Google Cloud projects through customer-authorized read-only identities, collects resource metadata and billing information, normalizes the results, and presents inventory, cost visibility, synchronization health, resource history, and evidence-based savings findings in one workspace.

**Product promise:** Understand what exists across AWS and Google Cloud, what it costs, and where there may be waste—without giving CloudRoute permission to change customer infrastructure.

CloudRoute is not a cloud console replacement, infrastructure provisioning system, migration executor, or resource control panel.

## 2. Product principles

1. Observe before control. The MVP is read-only. No feature may create, modify, start, stop, or delete customer cloud resources.
2. Least privilege by default. Use temporary credentials and the narrowest documented read permissions.
3. Normalize without hiding. Present a common resource model while retaining provider identity and provider-specific type information.
4. Freshness is part of the data. Every account, inventory view, cost view, and finding must make its age and sync status understandable.
5. Evidence before recommendations. A savings finding explains the resource, rule, evidence, assumptions, currency, and limitations.
6. Partial data is not complete data. Failed or incomplete inventory runs must not mark unseen resources missing or trigger complete-inventory savings evaluation.
7. Tenant boundaries are mandatory. A user sees only data belonging to the authenticated organization.
8. Provider-neutral core. AWS and Google Cloud differences belong in connectors, not duplicated product screens.
9. Honest billing. Preserve original currencies and distinguish provider-reported amounts from estimates.
10. Trust is a product feature. Publish permissions, explain collection and exclusions, and make disconnect/deletion behavior clear.

## 3. Target customers and problem

Primary users are freelancers, founders, and small teams operating AWS and Google Cloud, especially teams moving workloads between providers without a dedicated FinOps or cloud operations specialist.

These users switch between provider consoles, learn different resource names, and reconcile separate bills. This creates blind spots: forgotten resources, unclear costs, and poor visibility into what remains during migration.

**Hypothesis:** If a small team can safely connect both providers and see unified inventory, cost visibility, freshness, and evidence-based idle-resource findings, the team will return regularly because the combined view is more useful than switching between consoles.

## 4. Goals and success measures

The MVP allows a user to create a workspace; connect AWS and GCP; inspect normalized inventory; inspect cost records and breakdowns; understand freshness and connection health; inspect resource history; review and manage evidence-backed findings; configure notifications; apply manual migration labels; disconnect accounts; and understand security permissions.

Product validation targets—not claims about current performance:

| Measure | Target |
|---|---:|
| Sign-ups connecting at least one account | 40%+ |
| Connected users connecting both providers | 30%+ |
| Weekly returning users after four weeks | 30%+ |
| Users very disappointed if CloudRoute disappeared | 40%+ |
| Median potential savings per connected organization | USD 50/month where evidence supports it |
| Sync success rate | 98%+ measured over time |
| Private beta | At least 10 external users complete onboarding |

Do not broaden permissions or invent savings to meet a target.

## 5. User journeys

### Create a workspace
Visitor understands the read-only promise and supported providers; signs up; receives one owner organization; sees a useful first-run state without fabricated cloud data.

### Connect AWS
User chooses AWS; CloudRoute generates a unique external ID; user creates a read-only IAM role; supplies account ID and role ARN; CloudRoute validates with STS; inventory sync is queued and progress/errors are shown. Never ask for long-lived AWS access keys.

### Connect Google Cloud
User supplies project ID and service-account identity; configures service-account impersonation and read-only permissions; CloudRoute validates and reads Cloud Asset Inventory. Billing export is optional. Without it, inventory remains usable and cost is clearly unavailable—not zero. Customer private-key JSON is not accepted in this release.

### Understand inventory
User searches and filters by provider, type, region, migration label, or text; inspects normalized and provider-specific details and history; exports supported fields; optionally applies a manual migration label.

### Understand cost
User selects a time window; views daily trend and breakdown by provider, service, or account; sees freshness and billing-lag caveats. Different currencies are never combined into one total.

### Review savings
User sees rule, affected resource, evidence, observation window, defensible estimate/currency if available, and caveats; may dismiss, reopen, or snooze. CloudRoute never executes the recommendation.

### Manage connections
User sees permission state and separate inventory/cost freshness; reconnects or disconnects; manages notification preferences. Disconnect stops future collection and begins the CloudRoute data deletion process.

## 6. Functional requirements

Priority: P0 = mandatory MVP release; P1 = private-beta polish; Later = excluded.

| ID | Requirement | Priority | Acceptance evidence |
|---|---|---|---|
| CR-FR-001 | Email/password signup, login, logout, session revocation | P0 | API and browser tests |
| CR-FR-002 | One owner organization per new user | P0 | DB/onboarding test |
| CR-FR-003 | AWS cross-account role and external-ID onboarding | P0 | AWS sandbox |
| CR-FR-004 | GCP short-lived service-account impersonation | P0 | GCP sandbox |
| CR-FR-005 | Normalized AWS/GCP inventory | P0 | Fixtures and sandbox reconciliation |
| CR-FR-006 | Preserve unknown types as Other or report why unsupported | P1 | Connector contract tests |
| CR-FR-007 | Inventory filters, cursor pagination, detail | P0 | API/browser tests |
| CR-FR-008 | Tenant-scoped CSV export, formula-injection safe | P1 | Export tests |
| CR-FR-009 | Resource history for meaningful changes | P1 | DB/API tests |
| CR-FR-010 | Idempotent inventory sync and safe retries | P0 | Duplicate-job tests |
| CR-FR-011 | Only complete inventory runs mark resources missing | P0 | Partial-run fault tests |
| CR-FR-012 | AWS Cost Explorer ingestion | P0 | Billing reconciliation |
| CR-FR-013 | Optional GCP BigQuery billing export ingestion | P1 | Billing reconciliation |
| CR-FR-014 | Cost trend and provider/service/account breakdown by original currency | P0 | API/UI tests |
| CR-FR-015 | Recent billing restatement updates existing records | P1 | Re-ingestion test |
| CR-FR-016 | Visible sync freshness and connection health | P0 | Healthy/stale/degraded/error UI tests |
| CR-FR-017 | Conservative evidence-backed savings rules | P0 | Seeded rule tests |
| CR-FR-018 | Dismiss/reopen/seven-day snooze with audit | P1 | API/audit/UI tests |
| CR-FR-019 | Weekly digest and connection-failure email when configured | P1 | Outbox/provider tests |
| CR-FR-020 | Organization-scoped notification preferences | P1 | Tenant tests |
| CR-FR-021 | Manual migration labels only | P1 | API/UI/history tests |
| CR-FR-022 | Disconnect prevents future persistence and removes account-owned data | P0 | Race/deletion tests |
| CR-FR-023 | Owner-confirmed organization deletion | P0 | End-to-end deletion test |
| CR-FR-024 | Public security and permissions explanation | P0 | Published page review |
| CR-FR-025 | Clearly labelled synthetic demo mode, isolated from customer data | P1 | Demo isolation test |

## 7. Supported resource scope

Normalized categories: compute instance, block volume, object bucket (metadata only), database, function, load balancer, static IP, snapshot, and Other.

AWS connector currently includes EC2, EBS, S3 bucket metadata, RDS, Lambda metadata, load balancers, Elastic IPs, and snapshots. Google Cloud uses Cloud Asset Inventory with provider-specific normalization. A category is not considered supported merely because it appears here; connector fixtures and sandbox reconciliation must prove it.

**Never read:** objects inside S3 or Cloud Storage, database contents, disk contents, instance user-data, function environment-variable values, application secrets, or customer workload contents.

## 8. Savings rules

Run only after complete inventory and only with required evidence.

| Rule | Required evidence | Limitation |
|---|---|---|
| Stopped compute with billable disk | Explicit stopped state and attached billable volume | Do not assume identical cost for every provider |
| Unattached block volume | Provider confirms no attachment for required period | State age/price assumptions |
| Unassociated static IP | Provider confirms address is unassociated | Billing rules vary |
| Old snapshot with missing source volume | Snapshot age and source-volume absence | Never infer from incomplete inventory |
| Low-utilization compute | Actual monitoring metrics over required window | No metric means no finding |
| Idle database | Actual connection/utilization metrics | Inventory metadata alone is insufficient |

Estimated savings is nullable. If price or currency evidence is missing, show the finding without a monetary estimate. Savings are suggestions, not guaranteed reductions.

## 9. Non-functional requirements

| Area | Requirement |
|---|---|
| Performance | Target page load under 2 seconds and inventory filtering under 500 ms for 10,000 resources in representative testing |
| Freshness | Inventory target hourly; cost target every six hours; display actual last success |
| Availability | MVP target 99% monthly, best effort; preserve last known good data |
| Security | Read-only access, TLS, encryption at rest, secure sessions, RLS and server authorization |
| Privacy | Metadata only; never read customer data inside buckets, databases, disks, or workloads |
| Compatibility | Latest two major desktop browser versions; tablet usable; mobile read-only friendly |
| Accessibility | Keyboard operation, visible focus, labelled controls, sufficient contrast |
| Reliability | Bounded retries, idempotency, partial-run safety, worker/queue monitoring |
| Maintainability | TypeScript monorepo, documented package boundaries, migrations and tests |
| Observability | Redacted structured logs, error reporting, sync-run state, queue age, worker and DB metrics |

## 10. Security and trust requirements

AWS uses a customer-created cross-account role, external ID, and temporary STS credentials. GCP uses short-lived service-account impersonation; no private-key JSON upload. Never place credentials in browser storage, job payloads, logs, or ordinary application tables. Fetch short-lived credentials just in time in workers. Tenant-owned access is organization-scoped and protected by RLS where applicable. Production unsafe browser requests require exact HTTPS Origin validation. Production PostgreSQL uses certificate-verified TLS. Publish provider permission documents. Disconnect and organization deletion are auditable and verifiable. User-facing errors are safe and actionable. Complete security reporting and response procedures before public launch.

## 11. Explicit non-goals

Not part of this MVP: cloud resource mutation/control; Azure or other providers; provider activity feed; full migration project board or execution; budgets, anomalies, forecasting; invitations, team roles UI, SSO/SCIM; public API/CLI/native mobile app; payments/subscriptions; self-hosted edition; natural-language assistant; arbitrary provider API passthrough; reading customer object/database/disk/workload contents.

## 12. MVP release acceptance

Release-candidate complete requires objective evidence for all P0 requirements and:
1. A new user independently connects AWS and GCP using published instructions.
2. Supported inventory reconciles with known sandbox resources, including pagination and regions.
3. Partial/failed sync tests prove no false missing-resource detection.
4. Cost reconciles with provider consoles for completed days within a documented tolerance; billing lag is disclosed.
5. Every displayed finding has traceable evidence.
6. Tenant isolation passes for tenant-owned tables and API routes.
7. Disconnect and organization deletion are tested and verified.
8. Critical browser journeys pass on desktop and mobile-sized viewports.
9. Email delivery, retries, suppression/preferences are verified.
10. Security review, backup restore, rollback, load test, and monitored canary are accepted.
11. Public security/permissions information is available.
12. At least 10 external beta users complete onboarding.

Green CI alone is not release approval.

## 13. Fixed product decisions

| Decision | MVP rule |
|---|---|
| Name | CloudRoute is the working product name used internally; trademark/domain clearance is a launch check |
| Providers | AWS and Google Cloud only |
| Access | Read-only only |
| AWS auth | Cross-account role, external ID, STS |
| GCP auth | Service-account impersonation, short-lived tokens |
| GCP billing | Optional BigQuery export; inventory-only mode is valid |
| Currency | Original currency only; no conversion or cross-currency total |
| Cost detail | Daily provider/service/account; resource attribution only if source provides it |
| User model | One owner organization per user |
| Migration | Manual resource labels only |
| Queue | BullMQ/Redis with PostgreSQL polling fallback |
| Database | PostgreSQL, tenant isolation, forward migrations |
| Public API | Excluded |
| Cloud control | Excluded |
| Deployment | Containerized web/API/worker with managed PostgreSQL; hosting provider must not change product behavior |

## 14. Change control

Any change to provider scope, permissions, data collection, currency behavior, user roles, or release acceptance requires a written proposal, customer/security/data impact review, updates to affected documents, compatibility/migration plan, and acceptance tests. Do not silently implement a feature that conflicts with this baseline.
