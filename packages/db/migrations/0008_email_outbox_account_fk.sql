ALTER TABLE email_outbox
  ADD COLUMN IF NOT EXISTS cloud_account_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_outbox_cloud_account_fk'
  ) THEN
    ALTER TABLE email_outbox
      ADD CONSTRAINT email_outbox_cloud_account_fk
      FOREIGN KEY (cloud_account_id, org_id)
      REFERENCES cloud_accounts(id, org_id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS email_outbox_cloud_account_idx
  ON email_outbox(org_id, cloud_account_id)
  WHERE cloud_account_id IS NOT NULL;
