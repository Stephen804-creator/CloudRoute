# CloudRoute Implementation and Verification Plan

**Document ID:** CR-PLAN-001 | **Version:** 1.0 | **Status:** Authoritative delivery sequence

Companion documents: Product Requirements, Technical Requirements, Data Schema, Design Brief.

## 1. Purpose and completion vocabulary

This is the ordered plan for completing, testing, and releasing the MVP. Existing code is not discarded; it is mapped into milestones. The plan distinguishes:
- **Implemented:** code is present.
- **CI Verified:** automated checks passed on a specific commit.
- **Environment Verified:** a real external service/deployed environment was tested.
- **Accepted:** evidence was reviewed and the gate owner approved it.

Code presence is not external validation. A green CI run is not production approval.

## 2. Standard terminology

### Document and work identifiers

| Prefix | Meaning |
|---|---|
| CR-PRD | Product requirements |
| CR-TRD | Technical requirements |
| CR-DATA | Data schema |
| CR-DESIGN | Design brief |
| CR-PLAN | Implementation plan |
| CR-M | Delivery milestone |
| CR-AT | Acceptance test |
| CR-VAL | External validation gate |
| CR-ADR | Architecture decision record |
| CR-RISK | Tracked risk |

### Milestone naming convention

Milestone ID: CR-M01  
Name: Foundation and Identity  
Branch: milestone/cr-m01-foundation-identity  
PR title: [CR-M01] Foundation and Identity  
Commit: feat(CR-M01): add ...

Validation branch: validation/cr-val01-aws-sandbox  
Validation PR title: [CR-VAL01] AWS Sandbox Verification

Do not create new generic build/1, build/next, or unit-17 branches. Existing historical branch names remain unchanged for traceability. New work uses this convention.

### Status vocabulary

Use only Planned, In Progress, Implemented, CI Verified, Environment Verified, Accepted, Blocked, Deferred. A status of CI Verified or above must link to evidence.

## 3. Existing implementation mapped to milestones

| Historical work | Milestone mapping | Scope |
|---|---|---|
| Unit 1 foundation | CR-M01 | Repo shape, initial shell, connector boundary, security baseline |
| PR #2 / Units 2–7 | CR-M01–CR-M03 | PostgreSQL tenancy, auth, dashboard, AWS connector, sync, inventory |
| PR #3 / Unit 8 | CR-M02 | Google Cloud connector and impersonation onboarding |
| PR #4 / Units 9–12 | CR-M03–CR-M05 | Resource history, cost, savings rules, findings, notifications |
| PR #5 / Units 13–16 | CR-M06 | Integration contracts, production security, tests, health/readiness, runbook |
| PR #6 | CR-M06 | Tenant integration coverage and account-disconnect race protection |
| PR #7 | CR-M06 | Production validation gates and CI branch-filter coverage |

This is historical mapping, not a claim that every PR is merged. Refresh GitHub branch/PR status before merging or declaring integration complete.

## 4. Dependency order

CR-M00 → CR-M01 → CR-M02 → CR-M03 → CR-M04 → CR-M05 → CR-M06 → CR-M07.

Do not skip prerequisite acceptance. Keep stacked PRs based on the preceding accepted branch and merge in dependency order.

## 5. Delivery milestones

### CR-M00 — Product Contract and Repository Governance
**Outcome:** All contributors implement the same product, architecture, data model, design language, and delivery vocabulary.

Deliverables: five authoritative product documents; documentation index; README links; milestone/branch/PR/commit/test/status convention; change-control rule.

Acceptance:
- CR-AT-M00-01: All documents agree on provider scope, read-only boundary, currency, tenant model, and non-goals.
- CR-AT-M00-02: README links to the documents.
- CR-AT-M00-03: Implemented work and external validation are distinguished honestly.

Status: In Progress until documentation PR review and merge.

### CR-M01 — Foundation and Identity
**Outcome:** User securely creates and accesses one workspace.

Scope: monorepo and CI; PostgreSQL migrations/tenant transactions/RLS; signup/login/logout/session expiry/revocation; organization creation; server-derived organization; API/web shell and safe empty states.

Acceptance:
- CR-AT-M01-01 fresh migrations succeed.
- CR-AT-M01-02 signup creates user, owner membership, organization.
- CR-AT-M01-03 login/logout/expiry/revocation work.
- CR-AT-M01-04 two organizations cannot read or mutate each other's rows.
- CR-AT-M01-05 runtime DB role cannot bypass RLS.

Existing status: core code implemented in foundation/PR #2 history. Fresh environment verification and public-launch identity hardening remain under CR-M06.

### CR-M02 — Cloud Connections and Provider Inventory
**Outcome:** Workspace connects AWS and GCP through read-only identities and sees normalized resources.

Scope: AWS role/external ID; GCP impersonation; connector SDK/mappings; enumeration/pagination/regions; permission validation; fixtures.

Acceptance:
- CR-AT-M02-01 AWS sandbox role works with exact trust policy and fails with wrong external ID.
- CR-AT-M02-02 representative AWS write actions are denied.
- CR-AT-M02-03 GCP impersonation works with intended identity/read-only grants.
- CR-AT-M02-04 representative GCP mutations are denied.
- CR-AT-M02-05 inventory reconciles against known sandbox resources.
- CR-AT-M02-06 pagination and regional enumeration are complete or explicitly partial.
- CR-AT-M02-07 no prohibited customer content is collected.

Existing status: connector code implemented. Live sandbox permissions and inventory reconciliation not yet accepted without evidence.

### CR-M03 — Synchronization and Inventory Experience
**Outcome:** Inventory remains correct under retries, partial failures, stale data, and disconnection.

Scope: durable sync runs; scheduling; Redis/BullMQ and PostgreSQL fallback; idempotent upserts; partial safety; missing-resource reconciliation; inventory search/filter/pagination/detail/export; resource history; disconnect safety.

Acceptance:
- CR-AT-M03-01 repeated logical job delivery creates no duplicate resources.
- CR-AT-M03-02 partial page failure never marks unseen resources missing.
- CR-AT-M03-03 complete run reconciles missing resources correctly.
- CR-AT-M03-04 worker restart recovers queued work and no running work is stuck indefinitely.
- CR-AT-M03-05 disconnect during queued/fetch/persist stages prevents late writes.
- CR-AT-M03-06 inventory features work for 10,000 resources.
- CR-AT-M03-07 CSV neutralizes spreadsheet formula injection.

Existing status: implementation and initial race protection exist. Fault-injection, browser, recovery, and scale evidence remain.

### CR-M04 — Cost Visibility
**Outcome:** Users understand provider-reported daily cost without misleading currency aggregation or attribution.

Scope: AWS Cost Explorer; optional GCP BigQuery billing export; restatement; idempotent upsert; summary/trend/breakdown; original currency/freshness.

Acceptance:
- CR-AT-M04-01 AWS completed-day totals reconcile within documented tolerance.
- CR-AT-M04-02 GCP completed-day totals reconcile within documented tolerance.
- CR-AT-M04-03 missing GCP export shows unavailable, not zero.
- CR-AT-M04-04 restatement updates existing records without duplicates.
- CR-AT-M04-05 currencies remain separate in API and UI.
- CR-AT-M04-06 service-level costs are not presented as resource-level attribution.

Existing status: ingestion/UI implemented. Live reconciliation and export validation pending.

### CR-M05 — Savings Findings and Notifications
**Outcome:** Users review evidence-backed potential savings and receive configured notifications.

Scope: six conservative rule families; evidence/estimates/status; dismiss/reopen/snooze/audit; organization preferences; weekly digest and connection-failure outbox.

Acceptance:
- CR-AT-M05-01 every rule passes positive, negative, missing-evidence, and partial-inventory tests.
- CR-AT-M05-02 metrics rules never run without actual metrics.
- CR-AT-M05-03 estimates are absent when price evidence is insufficient.
- CR-AT-M05-04 finding state changes are tenant-scoped and audited.
- CR-AT-M05-05 digest is deduplicated per organization/period.
- CR-AT-M05-06 outbox retry, terminal failure, and provider timeout work.
- CR-AT-M05-07 email delivery/bounce/suppression is verified.

Existing status: rules/findings/preferences/outbox implemented. Full rule and provider delivery validation pending.

### CR-M06 — Security, Reliability, and Release Readiness
**Outcome:** The complete app is safe to operate in controlled private beta.

Scope: API authorization matrix; tenant isolation; session/Origin/cookie/TLS/secrets review; queue retries/duplicates/cancellation/recovery; browser E2E; email provider; deployment/monitoring/backups/restore/rollback/load/canary; public security and deletion docs.

Acceptance:
- CR-AT-M06-01 build, typecheck, migrations, tests pass on exact release SHA.
- CR-AT-M06-02 every route has explicit auth/authorization expectation.
- CR-AT-M06-03 RLS tests use non-superuser without BYPASSRLS.
- CR-AT-M06-04 browser journeys pass on desktop and mobile-sized viewports.
- CR-AT-M06-05 independent review has no unresolved critical/high findings.
- CR-AT-M06-06 backup restore succeeds in isolation.
- CR-AT-M06-07 10,000-resource load test and DB/queue budgets pass.
- CR-AT-M06-08 rollback is rehearsed without schema reversal.
- CR-AT-M06-09 worker health/queue age are monitored independently.
- CR-AT-M06-10 monitored canary meets rollback thresholds.

Existing status: hardening, tests, probes, runbook, and validation gates implemented in PR history. External acceptance is still required.

### CR-M07 — Private Beta and Product Validation
**Outcome:** Real users validate usefulness, trust, onboarding, and repeat value.

Scope: at least 10 external beta users; observe onboarding/time-to-first-inventory; track connection completion/provider mix/weekly return/findings/labels/exports; conduct interviews; record go/no-go decision.

Acceptance:
- CR-AT-M07-01 at least 10 external users complete onboarding.
- CR-AT-M07-02 metrics avoid sensitive cloud metadata.
- CR-AT-M07-03 five follow-up interviews are documented.
- CR-AT-M07-04 decision to iterate or proceed to Phase 2 is recorded.
- CR-AT-M07-05 no Phase 2 feature starts before that decision.

Status: Planned.

## 6. External validation gates

| Gate | Evidence required |
|---|---|
| CR-VAL01 AWS sandbox | Role trust, external ID, denied write actions, inventory/cost reconciliation |
| CR-VAL02 GCP sandbox | Impersonation, denied mutation actions, inventory/billing reconciliation |
| CR-VAL03 Tenant security | Route matrix, cross-tenant CRUD tests, runtime RLS role proof |
| CR-VAL04 Browser E2E | Signup-to-disconnect journeys and responsive checks |
| CR-VAL05 Worker reliability | Duplicate/retry/crash/disconnect fault-injection results |
| CR-VAL06 Email delivery | Outbox transitions, provider acceptance, retry and bounce/suppression evidence |
| CR-VAL07 Recovery | Backup restore, rollback rehearsal, migration report |
| CR-VAL08 Performance | 10,000-resource and queue/database capacity report |
| CR-VAL09 Security review | Independent penetration test and remediation evidence |
| CR-VAL10 Canary | Monitored deployment, error/latency/queue thresholds, rollback decision |

Each gate needs a dated evidence link and reviewer before it can be Accepted.

## 7. Work execution protocol

For every milestone:
1. Read all five product documents.
2. Confirm outcome and acceptance-test IDs.
3. Inspect branch, PR stack, schema, routes, and tests.
4. Write a scoped implementation proposal and identify affected interfaces/files.
5. Create a milestone branch from the correct predecessor.
6. Implement only the milestone scope.
7. Add positive, negative, and failure-path tests.
8. Run focused tests, then build, typecheck, migrations, and full CI.
9. Review security, data exposure, API compatibility, and docs.
10. Open PR with milestone ID, acceptance IDs, evidence, and risks.
11. Keep draft until checks and review pass.
12. Do not merge without explicit owner approval.
13. Update milestone register only with evidence.

## 8. PR and commit standards

PR title: [CR-M04] Cost Visibility.

PR body includes outcome; requirements/acceptance IDs; files/packages; migration impact; security/tenant impact; commands and actual results; external validation; rollback/compatibility.

Commit examples:
- feat(CR-M02): add gcp asset inventory pagination
- fix(CR-M03): prevent persistence after account disconnect
- test(CR-M06): verify tenant isolation for cost records
- docs(CR-M00): define product and delivery baseline

Never claim tests pass unless run on the exact commit.

## 9. Immediate ordered work

1. Review and accept CR-M00 documents.
2. Refresh branch heads and confirm stacked PR order; do not merge automatically.
3. Run CI on the final integrated commit.
4. Complete CR-VAL03 tenant security and API authorization matrix.
5. Complete CR-VAL05 queue/worker fault injection.
6. Complete CR-VAL01 and CR-VAL02 with dedicated provider sandboxes.
7. Complete CR-VAL04 browser E2E.
8. Complete CR-VAL06 email delivery.
9. Complete CR-VAL07 restore/rollback and CR-VAL08 load tests.
10. Obtain CR-VAL09 independent security review.
11. Complete CR-M07 private beta after release gates are accepted.

Do not begin unrelated Phase 2 features while mandatory MVP gates are failing.

## 10. Milestone register

| ID | Name | Status | Evidence |
|---|---|---|---|
| CR-M00 | Product Contract and Repository Governance | In Progress | Documentation PR |
| CR-M01 | Foundation and Identity | Implemented | Foundation/PR #2 history; refresh checks before acceptance |
| CR-M02 | Cloud Connections and Provider Inventory | Implemented | AWS/GCP connector branches; live validation not accepted |
| CR-M03 | Synchronization and Inventory Experience | Implemented | Sync/history code and PR #6 race fix; external evidence pending |
| CR-M04 | Cost Visibility | Implemented | Ingestion/UI; live reconciliation pending |
| CR-M05 | Savings Findings and Notifications | Implemented | Rules/findings/outbox; delivery/full validation pending |
| CR-M06 | Security, Reliability, and Release Readiness | In Progress | PRs #5–#7; external gates pending |
| CR-M07 | Private Beta and Product Validation | Planned | No beta evidence recorded |

This register reflects repository evidence known when this version was authored. Refresh before every release decision.
