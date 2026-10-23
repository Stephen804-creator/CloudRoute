CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_normalized CHECK (email = lower(trim(email))),
  CONSTRAINT users_full_name_length CHECK (char_length(full_name) BETWEEN 1 AND 120)
);

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organizations_name_length CHECK (char_length(trim(name)) BETWEEN 1 AND 120)
);

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','admin','member','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships(user_id);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_expiry_idx ON auth_sessions(expires_at);

CREATE TABLE cloud_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('aws','gcp')),
  display_name text NOT NULL,
  external_account_id text NOT NULL,
  role_arn text,
  external_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','connected','degraded','disconnected','error')),
  permission_status text NOT NULL DEFAULT 'not_checked' CHECK (permission_status IN ('not_checked','valid','invalid','insufficient')),
  last_sync_at timestamptz,
  last_sync_status text,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  disconnected_at timestamptz,
  UNIQUE (org_id, provider, external_account_id),
  UNIQUE (id, org_id),
  CHECK (provider <> 'aws' OR (role_arn IS NOT NULL AND external_id IS NOT NULL))
);
CREATE INDEX cloud_accounts_org_idx ON cloud_accounts(org_id, status);

CREATE TABLE resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cloud_account_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('aws','gcp')),
  external_id text NOT NULL,
  resource_type text NOT NULL,
  display_name text,
  region text,
  resource_status text,
  tags jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  migration_label text NOT NULL DEFAULT 'unclassified' CHECK (migration_label IN ('unclassified','retain','migrate','retire','review')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  deleted_detected_at timestamptz,
  connector_version text NOT NULL DEFAULT '0.1.0',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cloud_account_id, org_id) REFERENCES cloud_accounts(id, org_id) ON DELETE CASCADE,
  UNIQUE (cloud_account_id, external_id)
);
CREATE INDEX resources_org_type_idx ON resources(org_id, resource_type) WHERE deleted_detected_at IS NULL;
CREATE INDEX resources_org_provider_idx ON resources(org_id, provider) WHERE deleted_detected_at IS NULL;
CREATE INDEX resources_org_region_idx ON resources(org_id, region) WHERE deleted_detected_at IS NULL;
CREATE INDEX resources_org_seen_idx ON resources(org_id, last_seen_at DESC);
CREATE INDEX resources_search_trgm_idx ON resources USING gin ((coalesce(display_name,'') || ' ' || external_id) gin_trgm_ops);

CREATE TABLE cost_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cloud_account_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('aws','gcp')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  service text NOT NULL,
  region text,
  amount numeric(20,6) NOT NULL,
  currency char(3) NOT NULL,
  attribution text NOT NULL DEFAULT 'provider_reported' CHECK (attribution IN ('provider_reported','estimated','unattributed')),
  source_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cloud_account_id, org_id) REFERENCES cloud_accounts(id, org_id) ON DELETE CASCADE,
  UNIQUE (cloud_account_id, period_start, period_end, service, region, currency)
);
CREATE INDEX costs_org_period_idx ON cost_records(org_id, period_start DESC);

CREATE TABLE findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cloud_account_id uuid NOT NULL,
  resource_id uuid,
  rule_key text NOT NULL,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','low','medium','high')),
  title text NOT NULL,
  description text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  estimated_monthly_saving numeric(20,6),
  currency char(3),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','snoozed','resolved')),
  snoozed_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cloud_account_id, org_id) REFERENCES cloud_accounts(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE SET NULL,
  UNIQUE (cloud_account_id, rule_key, resource_id)
);
CREATE INDEX findings_org_status_idx ON findings(org_id, status, severity);

CREATE TABLE sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cloud_account_id uuid NOT NULL,
  job_type text NOT NULL CHECK (job_type IN ('inventory_sync','cost_sync','credential_check')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','partial','failed','cancelled')),
  started_at timestamptz,
  finished_at timestamptz,
  resources_seen integer NOT NULL DEFAULT 0,
  resources_created integer NOT NULL DEFAULT 0,
  resources_updated integer NOT NULL DEFAULT 0,
  resources_missing integer NOT NULL DEFAULT 0,
  error_code text,
  error_message text,
  connector_version text NOT NULL DEFAULT '0.1.0',
  is_complete boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cloud_account_id, org_id) REFERENCES cloud_accounts(id, org_id) ON DELETE CASCADE
);
CREATE INDEX sync_runs_account_idx ON sync_runs(cloud_account_id, created_at DESC);
CREATE INDEX sync_runs_queue_idx ON sync_runs(status, created_at) WHERE status = 'queued';

CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_org_created_idx ON audit_log(org_id, created_at DESC);

CREATE TABLE migration_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resource_id uuid NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (label IN ('unclassified','retain','migrate','retire','review')),
  notes text,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, resource_id)
);

CREATE OR REPLACE FUNCTION cloudroute_current_org_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_org_id', true), '')::uuid
$$;
CREATE OR REPLACE FUNCTION cloudroute_current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'memberships','cloud_accounts','resources','cost_records',
    'findings','sync_runs','audit_log','migration_labels'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (org_id = cloudroute_current_org_id()) WITH CHECK (org_id = cloudroute_current_org_id())',
      table_name
    );
  END LOOP;
END $$;
DROP POLICY tenant_isolation ON memberships;
CREATE POLICY tenant_isolation ON memberships
  USING (org_id = cloudroute_current_org_id() OR user_id = cloudroute_current_user_id())
  WITH CHECK (org_id = cloudroute_current_org_id());
ALTER TABLE cloud_accounts DROP CONSTRAINT cloud_accounts_check;
ALTER TABLE cloud_accounts ADD CONSTRAINT cloud_accounts_check CHECK (provider <> 'aws' OR external_id IS NOT NULL);

CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
