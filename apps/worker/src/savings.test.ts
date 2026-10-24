import test from "node:test";
import assert from "node:assert/strict";
import { buildIdleCandidates } from "./savings.js";

const now = new Date("2026-10-24T00:00:00.000Z");
const base = {
  id: "11111111-1111-4111-8111-111111111111",
  external_id: "arn:aws:ec2:us-east-1:123456789012:volume/vol-123",
  provider: "aws",
  resource_type: "block_volume",
  display_name: "unused-volume",
  region: "us-east-1",
  resource_status: "available",
  metadata: { attached: false, sizeGiB: 20, createTime: "2026-10-01T00:00:00.000Z" },
};

test("flags explicitly unattached old volumes without inventing cost estimates", () => {
  const findings = buildIdleCandidates([base], now);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.ruleKey, "unattached_volume");
  assert.equal(findings[0]?.evidence.attached, false);
});

test("does not flag volumes when attachment state is unknown", () => {
  const findings = buildIdleCandidates([{ ...base, metadata: { sizeGiB: 20 } }], now);
  assert.equal(findings.length, 0);
});

test("flags unassociated static IP from explicit provider metadata", () => {
  const findings = buildIdleCandidates([{
    ...base, id: "22222222-2222-4222-8222-222222222222", resource_type: "static_ip",
    external_id: "arn:aws:ec2:us-east-1:123456789012:elastic-ip/eipalloc-1",
    resource_status: "unassociated", metadata: { associationId: null },
  }], now);
  assert.equal(findings[0]?.ruleKey, "unassociated_static_ip");
});

test("does not run utilization rules unless metrics are explicitly present", () => {
  const findings = buildIdleCandidates([{
    ...base, resource_type: "compute_instance", resource_status: "running",
    metadata: { launchTime: "2026-01-01T00:00:00.000Z" },
  }], now);
  assert.equal(findings.length, 0);
});

test("flags low utilization only when measured CPU evidence exists", () => {
  const findings = buildIdleCandidates([{
    ...base, resource_type: "compute_instance", resource_status: "running",
    metadata: { averageCpu14d: 2.4 },
  }], now);
  assert.equal(findings[0]?.ruleKey, "low_utilization_instance");
  assert.equal(findings[0]?.evidence.averageCpuPercent14d, 2.4);
});
