/**
 * Stores every folder's palette, the strip under its cover in folder
 * listings, in folder_palettes. Folding the palettes of the whole library
 * takes seconds, too long for a request on a serverless host: run this
 * from the sync machine after each sync, and during or after a worker
 * "thumbs" pass as colors come in.
 *
 * Reads photo_colors, photos and folders; writes only folder_palettes,
 * whose content it replaces in one transaction (a folder that lost its
 * palette loses its row).
 *
 *   npm run palettes                # compute and store
 *   npm run palettes -- --dry-run   # compute and compare with what is stored; writes nothing
 */
import * as dotenv from "dotenv";
import { out } from "./cli";

dotenv.config({ quiet: true });

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

function count(n: number): string {
  return n.toLocaleString("en-US");
}

async function main(): Promise<void> {
  // After dotenv: the database client reads the environment.
  const { computeFolderPalettes, query, replaceFolderPalettes, requireRow } =
    await import("../src/lib/database");

  const started = Date.now();
  const palettes = await computeFolderPalettes();
  out(
    `${count(palettes.size)} folders have a palette (computed in ${seconds(Date.now() - started)}).`,
  );

  if (process.argv.includes("--dry-run")) {
    const stored = requireRow(
      await query<{ rows: number }>(
        "SELECT COUNT(*)::int AS rows FROM folder_palettes",
      ),
    );
    out(
      `Dry run: nothing is written. folder_palettes holds ${count(stored.rows)} rows.`,
    );
    return;
  }

  const writing = Date.now();
  const { written, removed } = await replaceFolderPalettes(palettes);
  out(
    `folder_palettes: ${count(written)} rows written, ${count(removed)} removed (in ${seconds(Date.now() - writing)}).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    out(
      `Palettes failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
