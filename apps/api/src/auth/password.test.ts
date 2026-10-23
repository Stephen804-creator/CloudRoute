import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "./password.js";

test("password hashes verify only the original password", async () => {
  const hash = await hashPassword("a-long-test-password-123");
  assert.notEqual(hash, "a-long-test-password-123");
  assert.equal(await verifyPassword("a-long-test-password-123", hash), true);
  assert.equal(await verifyPassword("a-different-password-456", hash), false);
});
test("malformed password hashes fail closed", async () => {
  assert.equal(await verifyPassword("anything", "not-a-hash"), false);
});
