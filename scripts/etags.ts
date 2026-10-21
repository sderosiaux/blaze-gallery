/**
 * Fills photos.etag from the bucket's listing for the photos recorded
 * before the sync kept ETags (src/lib/etags.ts). Never changes an ETag
 * already stored; lists the ones that differ.
 *
 *   npm run etags -- --dry-run                 # counts only; writes nothing
 *   npm run etags -- --dry-run --prefix "a/b"  # only that folder and below
 *   npm run etags -- --prefix "a/b"            # write that folder first
 *   npm run etags                              # write them all
 */
import * as dotenv from "dotenv";
import { out } from "./cli";

dotenv.config({ quiet: true });

function prefixArgument(): string | undefined {
  const index = process.argv.indexOf("--prefix");
  if (index === -1) return undefined;
  const value = process.argv[index + 1]?.replace(/^\/+|\/+$/g, "");
  if (!value || value.startsWith("--"))
    throw new Error(
      '--prefix needs a folder, e.g. --prefix "pc-fixe/2019-09 - Quebec"',
    );
  return `${value}/`;
}

async function main(): Promise<boolean> {
  // After dotenv: the database and storage clients read the environment.
  const [
    { applyEtags, etagCounters, planEtags },
    { listObjectsAuto },
    { getPool },
  ] = await Promise.all([
    import("../src/lib/etags"),
    import("../src/lib/s3"),
    import("../src/lib/database"),
  ]);
  const prefix = prefixArgument();
  const dryRun = process.argv.includes("--dry-run");
  try {
    let pages = 0;
    // A listing is a read: no audit row per page
    const plan = await planEtags(async (token) => {
      const page = await listObjectsAuto({
        prefix,
        continuationToken: token,
        maxKeys: 1000,
        pageNumber: ++pages,
        audit: false,
      });
      if (pages % 50 === 0) out(`  ${pages} pages listed`);
      return page;
    }, prefix);
    out(
      `${prefix ?? "whole bucket"}: ${plan.listed} objects listed, ${plan.matched} with a photo.`,
    );
    out(`  already set: ${plan.alreadySet}`);
    out(`  to set: ${plan.toSet.length} (${plan.multipart} multipart, no MD5)`);
    out(`  stale (size or date differ, the sync's): ${plan.stale}`);
    out(`  stored and different (left as they are): ${plan.conflicts.length}`);
    for (const c of plan.conflicts.slice(0, 20))
      out(`    photo ${c.id} ${c.key}: stored ${c.stored}, listed ${c.listed}`);
    out(`  keys in the bucket without a photo: ${plan.bucketOnly}`);
    out(`  photos without a key in the bucket: ${plan.photoOnly}`);
    if (dryRun) {
      const now = await etagCounters();
      out(
        `Dry run: nothing written. Photos ${now.photos}, ${now.with_etag} with an ETag.`,
      );
      return true;
    }
    const { before, after, written } = await applyEtags(plan);
    out(`Written: ${written}.`);
    out(
      `  before: photos ${before.photos}, with an ETag ${before.with_etag}, others ${before.others}`,
    );
    out(
      `  after:  photos ${after.photos}, with an ETag ${after.with_etag}, others ${after.others}`,
    );
    return true;
  } finally {
    await getPool().end();
  }
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((error: unknown) => {
    out(
      `Etags failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
