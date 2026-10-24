UPDATE cost_records SET region='' WHERE region IS NULL;
ALTER TABLE cost_records ALTER COLUMN region SET DEFAULT '';
ALTER TABLE cost_records ALTER COLUMN region SET NOT NULL;
