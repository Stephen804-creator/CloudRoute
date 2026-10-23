import { Queue } from "bullmq";
import IORedis from "ioredis";

export interface InventoryJob { syncRunId: string; orgId: string; accountId: string }
let queue: Queue<InventoryJob> | undefined;
let connection: IORedis | undefined;

export async function enqueueInventorySync(job: InventoryJob): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return;
  if (!queue) {
    connection = new IORedis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true });
    queue = new Queue<InventoryJob>("cloudroute-inventory", { connection });
  }
  await queue.add("inventory-sync", job, {
    jobId: job.syncRunId,
    attempts: 4,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { age: 86400, count: 2000 },
    removeOnFail: { age: 604800, count: 5000 },
  });
}
export async function closeQueue(): Promise<void> {
  await queue?.close();
  await connection?.quit();
  queue = undefined;
  connection = undefined;
}
