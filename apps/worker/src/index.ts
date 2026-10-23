import { Worker } from "bullmq";
import IORedis from "ioredis";
import { closePool } from "@cloudroute/db";
import { pollQueuedRunsOnce, processInventorySync } from "./sync.js";
import { scheduleHourlyInventoryRunsOnce } from "./scheduler.js";

interface InventoryJob { syncRunId: string; orgId: string; accountId: string }

async function main(): Promise<void> {
  await scheduleHourlyInventoryRunsOnce();
  const scheduler = setInterval(() => {
    void scheduleHourlyInventoryRunsOnce().catch((error) => console.error("Inventory scheduling failed", { message: error instanceof Error ? error.message : "unknown" }));
  }, 60_000);
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true });
    const worker = new Worker<InventoryJob>("cloudroute-inventory", async (job) => processInventorySync(job.data), {
      connection,
      concurrency: Math.max(1, Math.min(8, Number.parseInt(process.env.WORKER_CONCURRENCY ?? "2", 10) || 2)),
    });
    worker.on("failed", (job, error) => console.error("Inventory job failed", { jobId: job?.id, message: error.message }));
    let stopping = false;
    const shutdown = async () => {
      if (stopping) return;
      stopping = true;
      clearInterval(scheduler);
      await worker.close();
      await connection.quit();
      await closePool();
    };
    process.once("SIGINT", () => void shutdown());
    process.once("SIGTERM", () => void shutdown());
    console.info("CloudRoute worker online with Redis/BullMQ.");
    // Also poll durable PostgreSQL queued runs so a transient Redis enqueue failure is recoverable.
    while (!stopping) {
      try {
        const found = await pollQueuedRunsOnce();
        if (!found) await new Promise((resolve) => setTimeout(resolve, 5000));
      } catch (error) {
        console.error("Fallback queue polling failed", { message: error instanceof Error ? error.message : "unknown" });
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
    return;
  }

  console.info("CloudRoute worker online in PostgreSQL queue fallback mode.");
  let stopping = false;
  const shutdown = async () => { stopping = true; clearInterval(scheduler); await closePool(); };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  while (!stopping) {
    try {
      const found = await pollQueuedRunsOnce();
      if (!found) await new Promise((resolve) => setTimeout(resolve, 5000));
    } catch (error) {
      console.error("Queue polling failed", { message: error instanceof Error ? error.message : "unknown" });
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

if (process.env.NODE_ENV !== "test") {
  main().catch((error) => {
    console.error("Worker startup failed", { message: error instanceof Error ? error.message : "unknown" });
    process.exitCode = 1;
  });
}
