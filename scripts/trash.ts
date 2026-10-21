/**
 * Erases the photos that have waited TRASH_DAYS in the Corbeille: every
 * version of their file in the bucket, their thumbnail and renditions, then
 * their row. Run it from the sync machine (worker/weekly.sh, with the keys
 * of both storages) or with the app's .env; the bucket key needs listFiles
 * and deleteFiles.
 *
 * It refuses, touching nothing, when more photos are due than --max (by
 * default a twentieth of the library): a mark set by mistake on many
 * photos must not empty the bucket. Every key erased is printed.
 *
 *   npm run trash                    # how many wait, and since when
 *   npm run trash -- purge --dry-run # the keys a purge would erase; writes nothing
 *   npm run trash -- purge           # erase those trashed TRASH_DAYS ago or more
 *   npm run trash -- purge --days 0 --max 40   # everything, if at most 40
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

async function main(): Promise<boolean> {
  // After dotenv: the database client reads the environment.
  const { query, requireRow } = await import("../src/lib/database");
  const { purgeTrash, storagePurgeStore, TRASH_DAYS } = await import(
    "../src/lib/trash"
  );
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
  if (process.argv[2] !== "purge") return true;

  const max = option("--max") ?? Math.floor(counts.photos / 20);
  const dryRun = process.argv.includes("--dry-run");
  out(
    dryRun ? "Dry run: nothing is erased." : `Erasing at most ${max} photos.`,
  );
  const report = await purgeTrash(storagePurgeStore(), {
    cutoff,
    expected: max,
    dryRun,
  });
  for (const photo of report.purged)
    out(
      `  erased ${photo.s3_key} (${photo.versions} versions, photo ${photo.id})`,
    );
  const after = requireRow(
    await query<{ photos: number }>(
      "SELECT count(*)::int AS photos FROM photos",
    ),
  ).photos;
  out(
    `${report.purged.length} erased, ${report.remaining} still due; photos ${counts.photos} -> ${after}.`,
  );
  if (report.refused) {
    out(
      `Storage refused ${report.refused.s3_key} (HTTP ${String(report.refused.status)}): stopped there, it stays in the Corbeille.`,
    );
    return false;
  }
  return counts.photos - after === report.purged.length;
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((error: unknown) => {
    out(
      `Trash failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
