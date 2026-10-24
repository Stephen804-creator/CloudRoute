ALTER TABLE cloud_accounts
  ADD COLUMN IF NOT EXISTS gcp_service_account_email text;

ALTER TABLE cloud_accounts
  ADD CONSTRAINT cloud_accounts_gcp_identity_check
  CHECK (
    (provider <> 'gcp')
    OR (
      gcp_service_account_email IS NULL
      OR gcp_service_account_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.]iam[.]gserviceaccount[.]com$'
    )
  );

CREATE INDEX IF NOT EXISTS cloud_accounts_gcp_project_idx
  ON cloud_accounts(org_id, external_account_id)
  WHERE provider = 'gcp' AND disconnected_at IS NULL;
