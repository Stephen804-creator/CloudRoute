import assert from "node:assert/strict";
import test from "node:test";
import { app } from "./index.js";

test("GET /health reports API liveness and read-only mode", async () => {
  const response = await app.inject({ method: "GET", url: "/health" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    status: "ok",
    service: "cloudroute-api",
    mode: "read-only",
  });
});

test("unknown API routes return 404", async () => {
  const response = await app.inject({ method: "GET", url: "/not-a-route" });
  assert.equal(response.statusCode, 404);
});

test("tenant-scoped endpoints reject requests without a session", async () => {
  for (const url of ["/v1/accounts", "/v1/resources", "/v1/overview"]) {
    const response = await app.inject({ method: "GET", url });
    assert.equal(response.statusCode, 401, url + " must require authentication");
  }
});

test("sign-up rejects weak passwords before database access", async () => {
  const response = await app.inject({
    method: "POST", url: "/v1/auth/signup",
    headers: { "content-type": "application/json" },
    payload: { email: "test@example.com", fullName: "Test User", password: "short" },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "WEAK_PASSWORD");
});

test.after(async () => {
  await app.close();
});
