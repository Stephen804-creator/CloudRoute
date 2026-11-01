import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { closePool, query } from "@cloudroute/db";
import { incrementRateLimitBucket } from "./rate-limit.js";

test("shared rate-limit counters increment atomically under concurrent requests", { skip: !process.env.DATABASE_URL }, async () => {
  const key = "integration-" + randomUUID();
  try {
    const results = await Promise.all(
      Array.from({ length: 32 }, () => incrementRateLimitBucket(key, 60)),
    );
    const counts = results.map(result => result.requestCount).sort((a,b) => a-b);
    assert.deepEqual(counts, Array.from({ length: 32 }, (_, index) => index + 1));

    await query(
      "UPDATE api_rate_limits SET window_started_at=now()-interval '2 minutes',request_count=999 WHERE bucket_key=$1",
      [key],
    );
    const reset = await incrementRateLimitBucket(key, 60);
    assert.equal(reset.requestCount, 1, "a new fixed window must reset the shared counter");
  } finally {
    await query("DELETE FROM api_rate_limits WHERE bucket_key=$1",[key]);
    await closePool();
  }
});
