/**
 * Erases the photos that have waited TRASH_DAYS in the Corbeille: every
 * version of their file in the bucket, their thumbnail and renditions, then
 * their row. Run it from the sync machine (worker/weekly.sh, with the keys
 * of both storages) or with the app's .env; the bucket key needs listFiles
 * and deleteFiles.
 *
 * It refuses, touching nothing, when more photos are due than --max (by
 * default a twentieth of the library): a mark set by mistake on many
 * photos must not empty the bucket. Every key erased is printed. A run
 * that refuses, stops on a doubt or is refused by storage prints a line
 * starting with ALERT and exits 2 (worker/weekly.sh keeps that line).
 *
 *   npm run trash                    # how many wait, and since when
 *   npm run trash -- purge --dry-run # the keys a purge would erase; writes nothing
 *   npm run trash -- purge           # erase those trashed TRASH_DAYS ago or more
 *   npm run trash -- purge --days 0 --max 40   # everything, if at most 40
 *   npm run trash -- purge --limit 500         # at most 500 erased this run
 *   npm run trash -- lots                       # the lots, last first
 *   npm run trash -- restore <lot>              # put a whole lot back
 */
import * as dotenv from "dotenv";
import { out } from "./cli";

dotenv.config({ quiet: true });

function option(name: string): number | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = Number(process.argv[index + 1]);
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${name} needs a whole number`);
  return value;
}

/** 0: done; 1: the counts do not add up; 2: an ALERT was printed. */
async function main(): Promise<number> {
  // After dotenv: the database client reads the environment.
  const { query, requireRow } = await import("../src/lib/database");
  const {
    listLots,
    purgeTrash,
    PurgeRefused,
    restoreLot,
    storagePurgeStore,
    TRASH_DAYS,
  } = await import("../src/lib/trash");
  if (process.argv[2] === "lots") {
    for (const lot of await listLots())
      out(
        `${lot.batch}  ${lot.by}  ${lot.photos} photos, ${lot.stacks} stacks, ${lot.trashed_at}`,
      );
    return 0;
  }
  if (process.argv[2] === "restore") {
    const batch = process.argv[3];
    if (!batch) throw new Error("restore needs a lot (npm run trash -- lots)");
    out(`${await restoreLot(batch)} photos of ${batch} put back.`);
    return 0;
  }
  const days = option("--days") ?? TRASH_DAYS;
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const counts = requireRow(
    await query<{
      photos: number;
      trashed: number;
      due: number;
      oldest: Date | null;
    }>(
      `SELECT (SELECT count(*) FROM photos)::int AS photos,
              count(*)::int AS trashed,
              (count(*) FILTER (WHERE trashed_at <= $1))::int AS due,
              min(trashed_at) AS oldest
       FROM photos WHERE trashed_at IS NOT NULL`,
      [cutoff],
    ),
  );
  out(
    `Corbeille: ${counts.trashed} photos, ${counts.due} thrown away ${days} days ago or more` +
      (counts.oldest ? ` (oldest ${counts.oldest.toISOString()}).` : "."),
  );
  if (process.argv[2] !== "purge") return 0;

  const max = option("--max") ?? Math.floor(counts.photos / 20);
  const dryRun = process.argv.includes("--dry-run");
  out(
    dryRun ? "Dry run: nothing is erased." : `Erasing at most ${max} photos.`,
  );
  let report: Awaited<ReturnType<typeof purgeTrash>>;
  try {
    report = await purgeTrash(storagePurgeStore(), {
      cutoff,
      expected: max,
      dryRun,
      limit: option("--limit"),
    });
  } catch (error) {
    if (!(error instanceof PurgeRefused)) throw error;
    out(
      `ALERT purge refused, nothing erased: ${error.message} (--max ${max}). Look at the Corbeille, then run with a larger --max if it is meant.`,
    );
    return 2;
  }
  for (const photo of report.purged)
    out(
      `  erased ${photo.s3_key} (${photo.versions} versions, photo ${photo.id})`,
    );
  const after = requireRow(
    await query<{ photos: number }>(
      "SELECT count(*)::int AS photos FROM photos",
    ),
  ).photos;
  for (const photo of report.left)
    out(
      `  left ${photo.s3_key} (photo ${photo.id}): ${photo.reason === "reuploaded" ? "written again after it was thrown away" : "no file in the bucket"}`,
    );
  out(
    `${report.purged.length} erased, ${report.left.length} left, ${report.remaining} still due; photos ${counts.photos} -> ${after}.`,
  );
  if (report.refused) {
    out(
      `ALERT storage refused ${report.refused.s3_key} (HTTP ${String(report.refused.status)}): stopped there, it stays in the Corbeille.`,
    );
    return 2;
  }
  if (report.stopped) {
    out(
      `ALERT purge stopped at ${report.stopped.s3_key} (photo ${report.stopped.id}): ${STOPPED[report.stopped.reason]}`,
    );
    return 2;
  }
  return counts.photos - after === report.purged.length ? 0 : 1;
}

const STOPPED = {
  listing:
    "the bucket serves it but lists no version of it (a key without listFiles?)",
  remains: "versions still listed once deleted; it stays in the Corbeille",
  missing:
    "several photos in a row have no file in the bucket (the wrong bucket?)",
} as const;

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    out(
      `ALERT trash failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(2);
  });
