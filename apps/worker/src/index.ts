/**
 * CloudRoute synchronization worker entry point.
 *
 * Provider synchronization is intentionally not started in Unit 1.
 * Later units will add a durable queue, bounded retries, per-account
 * concurrency controls, and safe handling of partial synchronization runs.
 */

export const workerStatus = {
  service: "cloudroute-worker",
  status: "idle",
  reason: "synchronization-not-configured",
} as const;

if (process.env.NODE_ENV !== "test") {
  console.info(JSON.stringify(workerStatus));
}
