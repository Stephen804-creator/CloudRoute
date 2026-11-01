import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sanitizeAwsTags } from "./inventory.js";

test("AWS connector reads resource metadata and excludes function environment values", async () => {
  const source = await readFile(fileURLToPath(new URL("./inventory.ts", import.meta.url)), "utf8");
  assert.match(source, /DescribeInstancesCommand/);
  assert.match(source, /ListBucketsCommand/);
  assert.match(source, /DescribeDBInstancesCommand/);
  assert.match(source, /environmentVariablesStored: false/);
  assert.doesNotMatch(source, /Environment\.Variables|GetObjectCommand|GetUserData/i);
});

test("AWS connector exposes no resource mutation commands", async () => {
  const source = await readFile(fileURLToPath(new URL("./inventory.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(source, /RunInstancesCommand|TerminateInstancesCommand|DeleteBucketCommand|DeleteDBInstanceCommand|UpdateFunctionCodeCommand/);
});

test("AWS tag projection bounds customer-controlled metadata and excludes credential material", () => {
  const tags = sanitizeAwsTags([
    { Key: "Name", Value: "production-api" },
    { Key: "environment", Value: "production" },
    { Key: "API_KEY", Value: "must-not-persist" },
    { Key: "password-note", Value: "not-persisted" },
    { Key: "description", Value: "Bearer abc.def.ghi" },
    { Key: "owner", Value: "AKIAABCDEFGHIJKLMNOP" },
    { Key: "oversized", Value: "x".repeat(257) },
    { Key: "x".repeat(129), Value: "ignored" },
    { Key: "safe", Value: "kept" },
    { Key: "__proto__", Value: "polluted" },
  ]);
  assert.deepEqual(tags, {
    Name: "production-api",
    environment: "production",
    safe: "kept",
  });
  assert.equal(Object.hasOwn(tags, "__proto__"), false);
});

test("AWS tag projection caps the number of persisted tags", () => {
  const tags = sanitizeAwsTags(Array.from({ length: 60 }, (_, index) => ({
    Key: "tag-" + index,
    Value: "value-" + index,
  })));
  assert.equal(Object.keys(tags).length, 50);
  assert.equal(tags["tag-49"], "value-49");
  assert.equal(tags["tag-50"], undefined);
});
