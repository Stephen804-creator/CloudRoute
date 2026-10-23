/**
 * AWS connector implementation is scheduled for a later unit.
 * Planned access: cross-account IAM role, external ID, STS role assumption,
 * and narrowly scoped read-only permissions. Do not collect long-lived keys.
 */
export const awsConnectorStatus = "not-configured" as const;
