ALTER TABLE sync_runs
  ADD COLUMN IF NOT EXISTS lease_token uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;

UPDATE sync_runs
SET lease_expires_at = COALESCE(started_at, created_at) + interval '15 minutes'
WHERE status='running' AND lease_expires_at IS NULL;

CREATE INDEX IF NOT EXISTS sync_runs_lease_expiry_idx
  ON sync_runs(lease_expires_at)
  WHERE status='running';
