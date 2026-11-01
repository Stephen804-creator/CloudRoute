import assert from "node:assert/strict";
import test from "node:test";
import { canRetryEmailAttempt, emailRetryDelayMinutes } from "./notifications.js";

test("email retry delay grows exponentially and caps at six hours", () => {
  assert.deepEqual([1,2,3,4,5,6,7,8].map(emailRetryDelayMinutes),[5,10,20,40,80,160,320,360]);
});

test("email retry delay safely handles invalid attempt counts", () => {
  assert.equal(emailRetryDelayMinutes(0),5);
  assert.equal(emailRetryDelayMinutes(-5),5);
  assert.equal(emailRetryDelayMinutes(Number.NaN),5);
  assert.equal(emailRetryDelayMinutes(100),360);
});

test("email retries stop before the provider idempotency retention window expires", () => {
  const now = Date.now();
  assert.equal(canRetryEmailAttempt(null, now), true);
  assert.equal(canRetryEmailAttempt(new Date(now - 22 * 60 * 60 * 1000), now), true);
  assert.equal(canRetryEmailAttempt(new Date(now - 24 * 60 * 60 * 1000), now), false);
  assert.equal(canRetryEmailAttempt("not-a-date", now), false);
});
