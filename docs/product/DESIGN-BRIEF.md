# CloudRoute Product Design Brief

**Document ID:** CR-DESIGN-001 | **Version:** 1.0 | **Status:** Authoritative experience and visual direction

Companion documents: Product Requirements, Technical Requirements, Data Schema, Implementation Plan.

## 1. Design purpose

CloudRoute is a calm, trustworthy operational workspace for people who need to understand multiple cloud environments without becoming cloud-console experts.

The interface must immediately answer:
1. What resources exist?
2. What do they cost, and where may waste exist?
3. How fresh and trustworthy is the information?

The product is an observer. Never make a user think a button changes a resource in AWS or Google Cloud.

## 2. Experience principles

- **Clarity over decoration:** restrained professional interface; avoid excessive gradients, animation, oversized cards, noisy dashboards, and fake activity.
- **One product model:** AWS and Google Cloud use the same layout and terms, with a small provider badge.
- **Freshness is visible:** show last success and state close to the data; inventory and billing freshness are separate.
- **Evidence is inspectable:** findings expose evidence, assumptions, time window, and limitations.
- **Safe verbs:** Connect, Validate, Sync, Label, Dismiss, Reopen, Snooze, Disconnect, Export. Never use Start, Stop, Delete resource, or Apply fix for cloud resources.
- **Useful empty states:** explain what is missing, why it matters, and the next safe step. Never fabricate customer data.

## 3. Information architecture

Workspace navigation:
1. **Overview** — account health, inventory counts, current-period cost, highest-priority findings.
2. **Inventory** — normalized resource table, filters, detail, history, migration label, CSV export.
3. **Costs** — daily trend and breakdown by provider, service, account; currency-separated totals and freshness.
4. **Savings** — evidence-backed findings and review state.
5. **Accounts** — AWS/GCP connections, permission state, sync freshness, connect/reconnect/disconnect.
6. **Settings** — profile/workspace settings and notification preferences.

Public navigation: product explanation, Security & Permissions, Sign in, Create account.

Do not add Activity, Migration Projects, Budgets, Actions, Team Management, Billing, or Assistant navigation in the MVP.

## 4. Visual direction

- Neutral, low-noise surfaces with clear text hierarchy.
- One restrained accent for primary actions and focus.
- Semantic success/warning/error/neutral colors; color is never the only status signal.
- Small consistent provider badges.
- Consistent spacing, borders, radius, typography, icon, and table-density tokens.
- Prefer readable tables over oversized summary cards for operational data.
- Use charts only for meaningful time/category comparisons.
- Use tabular numerals for currency, counts, and timestamps.
- Avoid inconsistent chart colors that imply different categories across screens.

## 5. Page requirements

### Overview
Show connected account count/provider split; inventory counts by normalized type; month-to-date costs separated by provider and currency; separate inventory/cost freshness; top evidence-backed findings; accounts needing attention. Never combine currencies, guarantee savings, or show demo values as live data.

### Accounts and onboarding
Show provider, display name, appropriately scoped external ID, connection state, permission state, last inventory sync, last cost sync where available, and next safe action.

Onboarding explains each permission; shows exact copyable setup values; validates before showing connected; gives recovery instructions for missing permissions, disabled APIs, billing export absence, and identity mismatch. Never request AWS access keys or GCP private-key JSON.

### Inventory
Prioritize columns: resource name, normalized type, provider, account/project, region, state, migration label, last seen. Filters must be visible/removable; pagination preserves filters; details have stable URLs; normalized and provider-specific metadata are separated; history shows actual changes; migration label is clearly manual; CSV confirms export scope.

### Costs
Show selected window, daily trend, totals by provider/currency, breakdown by provider/service/account, last cost sync, billing-lag notice. If GCP billing export is absent, show "Billing export not configured" with setup guidance, not zero spend.

### Savings
Each finding shows title/severity, resource/account, rule explanation, evidence and observation window, potential saving only when defensible, currency/caveat, first detected/updated time, status, and allowed local actions. No "fix now" or provider mutation.

### Settings
Provide profile and organization notification preferences. Organization deletion is visually separated, requires explicit confirmation, and explains consequences.

## 6. Required system states

| State | Required presentation |
|---|---|
| Not connected | Explain no account is connected; offer safe connect action |
| Loading | Skeleton/progress without layout jumps |
| Empty | Explain whether no resources exist, no sync occurred, or filters matched nothing |
| Fresh | Show last successful sync |
| Stale | Show actual age and why data may be outdated |
| Degraded | Explain failed scopes/pages; retain last good data |
| Error | Safe error code/message and recovery step |
| Partial | Explicitly label partial results; never imply complete coverage |
| Billing unavailable | State inventory works but billing export is not configured |
| Email queued | State queued, not delivered |
| Demo | Persistent unmistakable synthetic-data label |

Use friendly relative time in summaries and exact timestamp in detail; provide timezone context for schedules.

## 7. Product terminology

- **Workspace:** the user's CloudRoute organization.
- **Cloud account:** one AWS account or Google Cloud project connected to a workspace.
- **Provider:** AWS or Google Cloud.
- **Resource:** an individual cloud object represented in inventory.
- **Inventory sync:** read-only collection of resource metadata.
- **Cost sync:** read-only collection of billing data.
- **Sync run:** one recorded background-work execution.
- **Finding:** a potential issue or saving opportunity supported by evidence.
- **Migration label:** a manual planning label attached to a resource.
- **Disconnect:** stop collecting from a cloud account and begin its CloudRoute data deletion process.

Avoid ambiguous labels such as scan, deploy, fix, execute, or migrate when the action only changes CloudRoute metadata.

## 8. Responsive behavior

Desktop: full navigation and dense tables. Tablet: collapsible navigation and manageable tables. Mobile: read-only-friendly stacked details, filter drawer, comfortable tap targets. Avoid unintended horizontal overflow. Keep account state and freshness visible at narrow widths.

## 9. Accessibility

All controls have accessible names; all flows work by keyboard; focus is visible; status uses text/icon as well as color; errors are associated with fields; dialogs manage and restore focus; charts have text summaries/data alternatives; reduced-motion is respected; contrast and target sizes are sufficient; placeholders are never the only labels.

## 10. Design acceptance

A screen is accepted only when it follows the information architecture and terminology; has loading/empty/stale/partial/error/success states where relevant; shows no fabricated or misleading values; communicates provider and currency; has no dead buttons or fake controls; is keyboard usable and responsive; uses consistent tokens; distinguishes CloudRoute actions from cloud actions; and passes a UI/UX review before beta.
