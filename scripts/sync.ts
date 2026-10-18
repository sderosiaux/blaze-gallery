/**
 * Indexes the bucket outside the web server. A serverless host can't keep a
 * scan alive (the function is frozen once it answers), so the app no longer
 * syncs there; run this from a machine that can, by hand or from cron.
 *
 * A full scan lists the bucket, diffs it against the database and writes only
 * the differences. It removes the photos whose file left the bucket, unless
 * that is more than 5% of them (see --allow-mass-removal).
 *
 *   npm run sync                          # queue a full scan, then run the queue dry
 *   npm run sync -- --queued              # only run what is already queued
 *   npm run sync -- --dry-run             # print what a full scan would change; writes nothing
 *   npm run sync -- --allow-mass-removal  # let this run remove more than 5% of the photos
 *   npm run sync -- --folder "a/b"        # only that folder and those under it (with any of the above)
 */
import * as dotenv from "dotenv";
import { out } from "./cli";

dotenv.config({ quiet: true });

const SAMPLE = 10;

/** Value of `--folder <path>`, without its slashes; undefined for the whole bucket */
function folderArgument(): string | undefined {
  const index = process.argv.indexOf("--folder");
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error('--folder needs a folder path, e.g. --folder "2024/Rome"');
  }
  const folder = value.replace(/^\/+|\/+$/g, "");
  return folder === "" ? undefined : folder;
}

function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return seconds < 60
    ? `${seconds} s`
    : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

function count(n: number): string {
  return n.toLocaleString("en-US");
}

function printSample(title: string, keys: readonly string[]): void {
  out(`${title}: ${count(keys.length)}`);
  for (const key of keys.slice(0, SAMPLE)) out(`  ${key}`);
  if (keys.length > SAMPLE) out(`  … ${count(keys.length - SAMPLE)} more`);
}

async function dryRun(folder: string | undefined): Promise<void> {
  const { planBucketSync } = await import("../src/lib/sync");
  const { isMassRemoval, MAX_REMOVED_SHARE } = await import(
    "../src/lib/bucketDiff"
  );

  out("Dry run: nothing is written (no job, no audit log).");
  if (folder) out(`Folder: ${folder} and those under it.`);
  const started = Date.now();
  const plan = await planBucketSync({
    folder,
    audit: false,
    onPage: (listed, pageNumber) => {
      if (pageNumber % 50 === 0) out(`  … ${count(listed)} objects listed`);
      return Promise.resolve();
    },
  });
  const { diff } = plan;

  out(
    `Database: ${count(plan.knownPhotos)} photos${folder ? " there" : ""}, ${count(plan.folderIds.size)} folders in all.`,
  );
  out(
    `Bucket: ${count(diff.listed)} objects in ${count(plan.pages)} pages (read and listed in ${duration(Date.now() - started)}).`,
  );
  printSample(
    "New photos",
    diff.added.map((object) => object.key),
  );
  printSample(
    "Replaced files (new size or date)",
    diff.changed.map(({ id, object }) => `#${id} ${object.key}`),
  );
  printSample(
    "Photos whose file left the bucket",
    diff.removed.map(({ id, key }) => `#${id} ${key}`),
  );
  printSample(
    "Folders to create",
    plan.foldersToCreate.map((folder) => folder.path || "(root)"),
  );
  if (isMassRemoval(diff.removed.length, plan.knownPhotos)) {
    out(
      `A full scan would stop before writing: it removes more than ${MAX_REMOVED_SHARE * 100}% of the photos (needs --allow-mass-removal).`,
    );
  }
}

async function sync(folder: string | undefined): Promise<boolean> {
  // After dotenv: the database and storage clients read the environment.
  const { syncService } = await import("../src/lib/sync");
  const { createSyncJob, failStaleSyncJobs, getActiveSyncJobs, getSyncJob } =
    await import("../src/lib/database");

  let fullScanId: number | undefined;
  if (!process.argv.includes("--queued")) {
    // A scan left running by a dead process must not count as the one to wait for.
    await failStaleSyncJobs(15);
    const active = await getActiveSyncJobs();
    const queued = active.find((job) => job.type === "full_scan");
    if (queued) {
      fullScanId = queued.id;
      out(
        `Full scan #${queued.id} is already queued or running: running the queue.`,
      );
    } else {
      const job = await createSyncJob({
        type: "full_scan",
        folder_path: folder ?? "/",
      });
      fullScanId = job.id;
      out(`Queued full scan #${job.id}${folder ? ` of ${folder}` : ""}.`);
    }
  }

  await syncService.drain({
    allowMassRemoval: process.argv.includes("--allow-mass-removal"),
  });
  out("Sync queue empty.");

  if (fullScanId === undefined) return true;
  const job = await getSyncJob(fullScanId);
  if (!job) return true;
  const took =
    job.started_at && job.completed_at
      ? ` in ${duration(new Date(job.completed_at).getTime() - new Date(job.started_at).getTime())}`
      : "";
  out(`Full scan #${job.id} ${job.status}${took}.`);
  const { stats } = job;
  if (stats) {
    out(
      `  ${count(stats.listed)} objects compared: ${count(stats.added)} added, ` +
        `${count(stats.changed)} replaced, ${count(stats.removed)} removed, ` +
        `${count(stats.folders_created)} folders created, ` +
        `${count(stats.folders_recounted ?? 0)} folder counts corrected.`,
    );
    if (stats.changed_photo_ids.length > 0) {
      out(
        `  Replaced files keep their faces and descriptions until analysed again: photo ids ${stats.changed_photo_ids.join(", ")}`,
      );
    }
  }
  if (job.error_message) out(`  ${job.error_message}`);
  return job.status === "completed";
}

async function main(): Promise<boolean> {
  const folder = folderArgument();
  if (process.argv.includes("--dry-run")) {
    await dryRun(folder);
    return true;
  }
  return sync(folder);
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((error: unknown) => {
    out(
      `Sync failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
