/**
 * Runs once when the server starts. The folder palettes take seconds to
 * compute over the whole library (lib/database.ts): starting now, the
 * first library listing finds them ready instead of going without.
 */
export async function register() {
  // Inside the condition, so the edge bundle drops the import (pg needs Node)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { warmFolderPalettes } = await import("./lib/database");
    warmFolderPalettes();
  }
}
