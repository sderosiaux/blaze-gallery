/**
 * The stacks' extra photos into the Corbeille, one pass at a time, each a
 * lot that `npm run trash -- restore <lot>` puts back whole (rules and
 * holds: src/lib/autoTrash.ts). Never erases a file: the purge does, 30
 * days later.
 *
 *   npm run dedupe -- copies                  # what would go, per hold what stays; writes nothing
 *   npm run dedupe -- copies --plan plan.json # the same, and the plan to a file to look at
 *   npm run dedupe -- copies --plan plan.json --folder same|other
 *       # only the photos in the kept one's folder, or in another: a lot each
 *   npm run dedupe -- copies --apply plan.json
 *       # throws that plan's photos away, if planning again now gives the
 *       # very same photos; else nothing
 *
 * Passes: copies (one copy of a file stays), then near (near-duplicates
 * clearly behind their stack's front).
 */
import { readFileSync, writeFileSync } from "node:fs";
import * as dotenv from "dotenv";
import { out } from "./cli";

dotenv.config({ quiet: true });

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<boolean> {
  // After dotenv: the database client reads the environment.
  const {
    applyDedupe,
    DEDUPE_PASSES,
    HOLDS,
    inFolders,
    planDedupe,
    verifyCopies,
  } = await import("../src/lib/autoTrash");
  type Pass = (typeof DEDUPE_PASSES)[number];
  const pass = process.argv[2] as Pass;
  if (!DEDUPE_PASSES.includes(pass))
    throw new Error(`a pass is needed: ${DEDUPE_PASSES.join(" or ")}`);
  const applying = option("--apply");
  if (applying) {
    const shown = JSON.parse(readFileSync(applying, "utf8")) as Awaited<
      ReturnType<typeof planDedupe>
    >;
    if (shown.pass !== pass)
      throw new Error(`${applying} is a plan of ${shown.pass}, not ${pass}`);
    const { lot, trashed } = await applyDedupe(shown);
    out(
      `${trashed.length} photos into the Corbeille, lot ${lot.batch} (npm run trash -- restore ${lot.batch} puts them back).`,
    );
    return true;
  }
  const planned = await planDedupe(pass);
  const verified =
    pass === "copies" ? await verifyCopies(planned, await md5s()) : planned;
  const folder = option("--folder");
  if (folder !== undefined && folder !== "same" && folder !== "other")
    throw new Error("--folder is same or other");
  const plan =
    folder === undefined ? verified : inFolders(verified, folder === "same");
  const stacks = new Set(plan.go.map((c) => c.group_id));
  out(
    `${pass}: ${plan.go.length} photos would go, from ${stacks.size} stacks; ${plan.held.length} stay.`,
  );
  for (const hold of HOLDS) {
    const n = plan.held.filter((c) => c.holds.includes(hold)).length;
    if (n > 0) out(`  ${hold}: ${n}`);
  }
  const file = option("--plan");
  if (file) {
    writeFileSync(file, JSON.stringify(plan));
    out(`Plan written to ${file}.`);
  }
  return true;
}

/**
 * The bucket's MD5 of an original: its ETag, when not a multipart upload's
 * (those end in -<parts>). Straight to the client: these reads are not
 * the app's, and write no audit row.
 */
async function md5s(): Promise<(key: string) => Promise<string | null>> {
  const [{ HeadObjectCommand }, { getS3Client }, { getConfig }] =
    await Promise.all([
      import("@aws-sdk/client-s3"),
      import("../src/lib/s3"),
      import("../src/lib/config"),
    ]);
  const client = getS3Client();
  const bucket = getConfig().backblaze_bucket;
  let done = 0;
  return async (key) => {
    const head = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (++done % 5000 === 0) out(`  ${done} files checked in the bucket`);
    const etag = head.ETag?.replace(/"/g, "") ?? "";
    return /^[0-9a-f]{32}$/.test(etag) ? etag : null;
  };
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((error: unknown) => {
    out(
      `Dedupe failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
