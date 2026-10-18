/**
 * Indexes the bucket outside the web server. A serverless host can't keep a
 * scan alive (the function is frozen once it answers), so the app no longer
 * syncs there; run this from a machine that can, by hand or from cron.
 *
 *   npm run sync               # queue a full scan, then run the queue dry
 *   npm run sync -- --queued   # only run what is already queued
 */
import * as dotenv from "dotenv";
import { out } from "./cli";

dotenv.config({ quiet: true });

async function main() {
  // After dotenv: the database and storage clients read the environment.
  const { syncService } = await import("../src/lib/sync");
  const { createSyncJob, failStaleSyncJobs, getActiveSyncJobs } = await import(
    "../src/lib/database"
  );

  if (!process.argv.includes("--queued")) {
    // A scan left running by a dead process must not count as the one to wait for.
    await failStaleSyncJobs(15);
    const active = await getActiveSyncJobs();
    if (active.some((job) => job.type === "full_scan")) {
      out("A full scan is already queued or running: running the queue.");
    } else {
      const job = await createSyncJob({ type: "full_scan", folder_path: "/" });
      out(`Queued full scan #${job.id}.`);
    }
  }

  await syncService.drain();
  out("Sync queue empty.");
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    out(
      `Sync failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
