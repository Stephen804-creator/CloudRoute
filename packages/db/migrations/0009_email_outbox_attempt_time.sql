ALTER TABLE email_outbox
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;

-- Existing attempts predate this column. Use the original enqueue time as a
-- conservative age marker so old ambiguous deliveries are not retried outside
-- the provider's idempotency retention window.
UPDATE email_outbox
SET last_attempt_at = created_at
WHERE attempts > 0 AND last_attempt_at IS NULL;
