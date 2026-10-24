# Unit 8 — Google Cloud connector

## Implemented in this branch
- [x] Google Cloud Asset Inventory connector using short-lived service-account impersonation.
- [x] Read-only OAuth scope and GET-only inventory requests.
- [x] Provider-neutral resource normalization for supported MVP resource types.
- [x] Pagination support and stable external resource names.
- [x] Google Cloud project onboarding API and connection validation.
- [x] Persist service-account identity, not private key material.
- [x] Worker inventory sync dispatches to AWS or GCP, with incomplete-run safety.
- [x] Hourly scheduler includes connected Google Cloud projects.
- [x] Account UI setup instructions and validation button.
- [x] Connector tests for normalization, pagination, and input validation.

## Required before production
- [ ] Run CI on this branch and fix every failing check.
- [ ] Validate against a dedicated Google Cloud test project with Cloud Asset API enabled.
- [ ] Confirm impersonation and project-level Cloud Asset Viewer permissions with the actual deployment identity.
- [ ] Confirm all intended resource categories appear and no sensitive payloads are collected.
- [ ] Exercise partial pagination failure and verify that missing-resource detection is not triggered.
- [ ] Deploy API and worker with managed workload identity; do not use a service-account key file as a shortcut.

Passing unit tests does not establish that the live Google Cloud permissions or deployment identity are configured correctly.
