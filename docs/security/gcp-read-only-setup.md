# Google Cloud read-only connection

CloudRoute's Google Cloud connector uses Application Default Credentials (ADC) for the CloudRoute runtime and impersonates a customer-owned service account. It does not accept or store service-account private-key JSON files.

## Customer project setup

1. Select the Google Cloud project that CloudRoute should observe.
2. Enable the **Cloud Asset API** (cloudasset.googleapis.com) in that project.
3. Create a dedicated service account, for example cloudroute-reader@PROJECT_ID.iam.gserviceaccount.com.
4. Grant that service account the predefined **Cloud Asset Viewer** role (roles/cloudasset.viewer) on the target project. Do not grant Owner, Editor, or resource-administration roles.
5. In the target service account's IAM permissions, grant the CloudRoute runtime service identity permission to impersonate it. The narrow predefined role is **Service Account Token Creator** (roles/iam.serviceAccountTokenCreator) on that service account, not at the whole project level.
6. Optional cost reporting: enable Cloud Billing export to BigQuery, then grant the target service account **BigQuery Data Viewer** on the billing dataset and **BigQuery Job User** on the billing project. In CloudRoute, enter the billing export project ID, dataset ID, and table ID. These fields must be supplied together.
7. In CloudRoute, enter the project ID and target service-account email, then select **Validate Google Cloud connection**.

## CloudRoute runtime requirements

- The API and worker must run with a Google Cloud identity (or workload identity) configured for Application Default Credentials.
- That source identity must be allowed to mint short-lived tokens for the target service account.
- The inventory connector requests the cloud-platform.read-only OAuth scope and calls Cloud Asset Inventory's projects.assets.list endpoint using GET requests. Cost ingestion uses a separately scoped BigQuery read-only impersonated token and queries only the configured billing export table for the trailing 90 days. The configured table name is validated before it is interpolated into the query.
- Only resource metadata is collected. CloudRoute does not read bucket objects, disk contents, database records, secrets, or function environment values.

## Supported inventory types

The initial connector normalizes Compute Engine instances and disks, Cloud Storage bucket metadata, Cloud SQL instances, Cloud Functions, load balancer forwarding rules, static IP addresses, and snapshots. Unknown asset types are not requested by the connector. Inventory is project-scoped; organization-wide aggregation is not enabled.

## Cost export limitations

- Cloud Billing export only contains data from when export was enabled; it does not backfill earlier periods.
- Billing data may lag provider consoles by up to 24 hours. CloudRoute re-reads the trailing 90 days to account for restatements.
- If billing export fields are blank, the project remains inventory-only and cost sync is not scheduled.

## Troubleshooting

- GCP_INSUFFICIENT_PERMISSIONS: confirm the Cloud Asset API is enabled and the target service account has Cloud Asset Viewer on the project.
- GCP_PROJECT_OR_API_NOT_FOUND: verify the project ID and API enablement.
- GCP_ACCESS_TOKEN_UNAVAILABLE: confirm the CloudRoute runtime identity is configured and can impersonate the target service account.
- If validation works but a resource category is absent, verify the resource type is supported and the service account has permission to list those assets.

Do not put service-account keys, OAuth access tokens, or private key material in tickets, logs, repository files, or screenshots.
