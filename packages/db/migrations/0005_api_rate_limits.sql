CREATE TABLE IF NOT EXISTS api_rate_limits (
  bucket_key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count >= 0),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS api_rate_limits_expiry_idx ON api_rate_limits(expires_at);
