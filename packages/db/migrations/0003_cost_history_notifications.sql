ALTER TABLE cloud_accounts
  ADD COLUMN IF NOT EXISTS last_cost_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_cost_sync_status text,
  ADD COLUMN IF NOT EXISTS gcp_billing_project_id text,
  ADD COLUMN IF NOT EXISTS gcp_billing_dataset text,
  ADD COLUMN IF NOT EXISTS gcp_billing_table text;

CREATE TABLE IF NOT EXISTS resource_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resource_id uuid NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  change_type text NOT NULL CHECK (change_type IN ('created','changed','marked_missing','restored')),
  changed_fields text[] NOT NULL DEFAULT '{}',
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resource_history_resource_idx ON resource_history(org_id, resource_id, observed_at DESC);
ALTER TABLE resource_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON resource_history;
CREATE POLICY tenant_isolation ON resource_history
  USING (org_id = cloudroute_current_org_id())
  WITH CHECK (org_id = cloudroute_current_org_id());

CREATE TABLE IF NOT EXISTS notification_preferences (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  weekly_digest_enabled boolean NOT NULL DEFAULT true,
  connection_failure_enabled boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON notification_preferences;
CREATE POLICY tenant_isolation ON notification_preferences
  USING (org_id = cloudroute_current_org_id())
  WITH CHECK (org_id = cloudroute_current_org_id());

CREATE TABLE IF NOT EXISTS email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recipient text NOT NULL,
  template_key text NOT NULL CHECK (template_key IN ('weekly_digest','connection_failure')),
  dedupe_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (org_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS email_outbox_queue_idx ON email_outbox(status, next_attempt_at) WHERE status IN ('queued','failed');
ALTER TABLE email_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_outbox FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON email_outbox;
CREATE POLICY tenant_isolation ON email_outbox
  USING (org_id = cloudroute_current_org_id())
  WITH CHECK (org_id = cloudroute_current_org_id());

CREATE OR REPLACE FUNCTION cloudroute_record_resource_history() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE changed text[] := ARRAY[]::text[];
DECLARE kind text := 'changed';
BEGIN
  IF TG_OP = 'INSERT' THEN
    kind := 'created';
    INSERT INTO resource_history(org_id, resource_id, change_type, changed_fields, snapshot)
    VALUES (NEW.org_id, NEW.id, kind, ARRAY['created'], jsonb_build_object(
      'provider', NEW.provider, 'resourceType', NEW.resource_type, 'displayName', NEW.display_name,
      'region', NEW.region, 'status', NEW.resource_status, 'tags', NEW.tags, 'migrationLabel', NEW.migration_label
    ));
    RETURN NEW;
  END IF;
  IF OLD.deleted_detected_at IS NOT NULL AND NEW.deleted_detected_at IS NULL THEN
    kind := 'restored';
    changed := array_append(changed, 'deleted_detected_at');
  END IF;
  IF OLD.display_name IS DISTINCT FROM NEW.display_name THEN changed := array_append(changed, 'display_name'); END IF;
  IF OLD.region IS DISTINCT FROM NEW.region THEN changed := array_append(changed, 'region'); END IF;
  IF OLD.resource_status IS DISTINCT FROM NEW.resource_status THEN changed := array_append(changed, 'resource_status'); END IF;
  IF OLD.tags IS DISTINCT FROM NEW.tags THEN changed := array_append(changed, 'tags'); END IF;
  IF OLD.resource_type IS DISTINCT FROM NEW.resource_type THEN changed := array_append(changed, 'resource_type'); END IF;
  IF OLD.migration_label IS DISTINCT FROM NEW.migration_label THEN changed := array_append(changed, 'migration_label'); END IF;
  IF cardinality(changed) > 0 THEN
    INSERT INTO resource_history(org_id, resource_id, change_type, changed_fields, snapshot)
    VALUES (NEW.org_id, NEW.id, kind, changed, jsonb_build_object(
      'provider', NEW.provider, 'resourceType', NEW.resource_type, 'displayName', NEW.display_name,
      'region', NEW.region, 'status', NEW.resource_status, 'tags', NEW.tags, 'migrationLabel', NEW.migration_label,
      'deletedDetectedAt', NEW.deleted_detected_at
    ));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS resources_history_after_insert ON resources;
DROP TRIGGER IF EXISTS resources_history_after_update ON resources;
CREATE TRIGGER resources_history_after_insert AFTER INSERT ON resources
FOR EACH ROW EXECUTE FUNCTION cloudroute_record_resource_history();
CREATE TRIGGER resources_history_after_update AFTER UPDATE ON resources
FOR EACH ROW EXECUTE FUNCTION cloudroute_record_resource_history();
