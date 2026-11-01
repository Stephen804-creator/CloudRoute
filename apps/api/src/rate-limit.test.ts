import assert from "node:assert/strict";
import test from "node:test";
import { getRateLimitPolicy } from "./rate-limit.js";

test("health endpoints bypass shared rate limiting", () => {
  assert.equal(getRateLimitPolicy("GET", "/health"), null);
  assert.equal(getRateLimitPolicy("GET", "/ready"), null);
});

test("authentication endpoints receive the strictest policy", () => {
  assert.deepEqual(getRateLimitPolicy("POST", "/v1/auth/login"), {
    bucket: "authentication", limit: 10, windowSeconds: 900,
  });
});

test("cloud account mutations have a dedicated policy", () => {
  assert.deepEqual(getRateLimitPolicy("DELETE", "/v1/accounts/:id"), {
    bucket: "account-mutation", limit: 30, windowSeconds: 60,
  });
});

test("general writes and reads use separate policies", () => {
  assert.deepEqual(getRateLimitPolicy("PATCH", "/v1/resources/:id"), {
    bucket: "mutation", limit: 60, windowSeconds: 60,
  });
  assert.deepEqual(getRateLimitPolicy("GET", "/v1/resources"), {
    bucket: "read", limit: 300, windowSeconds: 60,
  });
});
