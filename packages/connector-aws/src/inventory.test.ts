import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

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
