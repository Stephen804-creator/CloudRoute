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

test.after(async () => {
  await app.close();
});
