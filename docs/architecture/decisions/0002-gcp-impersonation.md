# ADR 0002: Google Cloud service-account impersonation

**Status:** Accepted for the initial connector

## Context

CloudRoute needs project-scoped, read-only Google Cloud inventory. Accepting uploaded service-account private keys would create a long-lived credential storage and rotation burden.

## Decision

Use the CloudRoute runtime's Application Default Credentials to impersonate a customer-owned service account. Request short-lived access tokens with the cloud-platform.read-only scope and call Cloud Asset Inventory through read-only HTTP GET requests. The customer service account receives Cloud Asset Viewer at the target project, while the runtime identity receives Token Creator only on that service account.

## Consequences

- No customer private-key JSON is uploaded or stored.
- Runtime deployment must supply a valid Google Cloud identity and impersonation permission.
- Inventory is project-scoped in this iteration.
- Live integration testing is mandatory before production use.
- The connector must never add cloud resource mutation methods.
