CREATE TABLE IF NOT EXISTS organization_deletion_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  organization_name text NOT NULL,
  deleted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS organization_deletion_audit_deleted_at_idx
  ON organization_deletion_audit(deleted_at DESC);
