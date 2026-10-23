import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { NextRequest } from "next/server";
import type * as Database from "@/lib/database";
import type * as Duplicates from "@/lib/exactDuplicates";
import type * as Route from "./route";
import type {
  DuplicateSelection,
  ExactDuplicatesPage,
} from "@/lib/exactDuplicateTypes";
import { startTestDatabase, type TestDatabase } from "@/lib/testDatabase";

const APP = "https://photos.example";
let db: TestDatabase;
let database: typeof Database;
let duplicates: typeof Duplicates;
let route: typeof Route;
before(async () => {
  Object.assign(process.env, {
    NEXT_PUBLIC_APP_URL: APP,
    GOOGLE_AUTH_ENABLED: "false",
  });
  db = await startTestDatabase();
  database = await import("@/lib/database");
  duplicates = await import("@/lib/exactDuplicates");
  route = await import("./route");
  await db.client.query(`INSERT INTO folders (id, path, name) VALUES
    (1, 'gallery', 'gallery'), (2, 'backup', 'backup'), (3, 'a-outside', 'a-outside'),
    (4, 'backup/child', 'child'), (5, 'another', 'another'), (6, '@eaDir', '@eaDir')`);
});
beforeEach(async () => {
  await db.client.query(
    "TRUNCATE photos, excluded_folders, task_leases CASCADE",
  );
  await db.client.query(
    "INSERT INTO excluded_folders (path) VALUES ('a-outside')",
  );
});
after(async () => {
  await database.getPool().end();
  await db.stop();
});

async function photo(
  id: number,
  folder: number,
  name: string,
  hash: string | null,
  size = 20000,
  mime = "image/jpeg",
) {
  await db.client.query(
    `INSERT INTO photos (id, folder_id, filename, s3_key, size, mime_type, modified_at, etag)
    SELECT $1, id, $3::text, path || '/' || $3::text, $5, $6, now(), $4 FROM folders WHERE id = $2`,
    [id, folder, name, hash, size, mime],
  );
}
const A = "a".repeat(32),
  B = "b".repeat(32),
  C = "c".repeat(32);
const allFiles: DuplicateSelection = {
  kind: "files",
  group: "all",
  keep: [],
  skip: [],
};
const allFolders: DuplicateSelection = { ...allFiles, kind: "folders" };
const list = (kind: "files" | "folders" = "files") =>
  duplicates.listExactDuplicates(kind, null);
const count = async () =>
  Number(
    (
      await db.client.query<{ n: string }>(
        "SELECT count(*) AS n FROM photos WHERE trashed_at IS NOT NULL",
      )
    ).rows[0]?.n,
  );
async function post(body: Record<string, unknown>, origin = APP) {
  const response = await route.POST(
    new NextRequest(`${APP}/api/stats/duplicates/trash`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return {
    status: response.status,
    data: (await response.json()) as Record<string, unknown>,
  };
}
const preview = (selection = allFiles) =>
  post({ action: "preview", ...selection });
const apply = (signature: unknown, selection = allFiles) =>
  post({ action: "trash", ...selection, signature });

async function bulk(groups: number) {
  await db.client.query(
    `INSERT INTO photos (id, folder_id, filename, s3_key, size, mime_type, modified_at, etag)
    SELECT id, CASE WHEN id % 2 = 1 THEN 1 ELSE 2 END,
      'clip' || ((id + 1) / 2) || '.mp4', 'bulk/p' || id || '.mp4', 20000, 'video/mp4', now(), md5(((id + 1) / 2)::text)
    FROM generate_series(1, $1::int * 2) id`,
    [groups],
  );
}

void test("global contents include renamed photos and ungrouped videos, but never name/size false positives or unknown fingerprints", async () => {
  await photo(1, 1, "original.jpg", A);
  await photo(2, 2, "renamed.jpg", A);
  await photo(3, 1, "same.jpg", B);
  await photo(4, 2, "same.jpg", C);
  await photo(5, 1, "video.mp4", "d".repeat(32), 50000, "video/mp4");
  await photo(6, 2, "other.mp4", "d".repeat(32), 50000, "video/mp4");
  for (const [a, b, name, hash, size] of [
    [7, 8, "unknown.jpg", null, 20000],
    [9, 10, "multi.jpg", `${A}-2`, 20000],
    [11, 12, "small.jpg", A, 10240],
    [13, 14, "Thumbs.db", A, 20000],
  ] as const) {
    await photo(a, 1, name, hash, size);
    await photo(b, 2, name, hash, size);
  }
  await photo(15, 6, "nas.jpg", A);
  await photo(16, 1, "trashed.jpg", A);
  await db.client.query("UPDATE photos SET trashed_at = now() WHERE id = 16");
  const page = await list();
  assert.deepEqual(page.summary, {
    groups: 2,
    members: 4,
    extra_files: 2,
    extra_bytes: 70000,
  });
  const group = page.groups.find((g) => g.members.some((m) => m.id === 1));
  assert.ok(group);
  const choice = { ...allFiles, group: group.key, keep: [2] };
  const shown = await preview(choice);
  assert.equal(shown.data.count, 1);
  const done = await apply(shown.data.signature, choice);
  assert.equal(done.status, 200);
  assert.equal(await count(), 2); // existing trash + original; video untouched
  assert.equal((await list()).summary.extra_files, 1);
  assert.equal(
    await (await import("@/lib/trash")).restoreLot(String(done.data.lot)),
    1,
  );
  assert.equal((await list()).summary.extra_files, 2);
});

void test("folder copies keep direct counterparts, with no deletion of child folders or ignored files", async () => {
  for (const folder of [1, 2, 3]) {
    await photo(folder * 10 + 1, folder, "a.jpg", A);
    await photo(folder * 10 + 2, folder, "b.jpg", B);
  }
  await photo(23, 2, "small-unique.jpg", C, 500);
  await photo(24, 2, "SYNOPHOTO_THUMB_unique.jpg", C);
  await photo(41, 4, "child-unique.jpg", C);
  await photo(51, 5, "a.jpg", A);
  await photo(52, 5, "b.jpg", C); // names and sizes agree, contents differ
  const page = await list("folders");
  assert.deepEqual(page.summary, {
    groups: 1,
    members: 3,
    extra_files: 4,
    extra_bytes: 80000,
  });
  const choice = { ...allFolders, keep: [2] };
  const shown = await preview(choice);
  assert.equal(shown.data.count, 4);
  const done = await apply(shown.data.signature, choice);
  assert.equal(done.status, 200);
  assert.deepEqual(
    (
      await db.client.query<{ id: number; kept: number }>(
        "SELECT id::int, trashed_for::int AS kept FROM photos WHERE trashed_at IS NOT NULL ORDER BY id",
      )
    ).rows,
    [
      { id: 11, kept: 21 },
      { id: 12, kept: 22 },
      { id: 31, kept: 21 },
      { id: 32, kept: 22 },
    ],
  );
  assert.equal((await db.client.query("SELECT id FROM folders")).rowCount, 6);
  assert.equal((await list("folders")).summary.groups, 0);
  assert.equal(
    await (await import("@/lib/trash")).restoreLot(String(done.data.lot)),
    4,
  );
  assert.equal((await list("folders")).summary.groups, 1);
});

void test("one unknown or multipart file prevents declaring whole folders identical", async () => {
  for (const folder of [1, 2]) {
    await photo(folder * 10 + 1, folder, "known.jpg", A);
    await photo(folder * 10 + 2, folder, "unknown.jpg", null);
  }
  assert.equal((await list("folders")).summary.groups, 0);
  assert.equal((await list()).summary.extra_files, 1);
  await db.client.query(
    "UPDATE photos SET etag = $1 WHERE filename = 'unknown.jpg'",
    [`${B}-2`],
  );
  assert.equal((await list("folders")).summary.groups, 0);
});

void test("default keeper prefers gallery over an excluded favourite, then favourites within the gallery", async () => {
  await photo(1, 1, "a.jpg", A);
  await photo(2, 2, "b.jpg", A);
  await photo(3, 3, "c.jpg", A);
  await db.client.query(
    "UPDATE photos SET is_favorite = true WHERE id IN (1,3)",
  );
  const page = await list();
  assert.deepEqual(
    page.groups[0]?.members.map((m) => m.id),
    [1, 2, 3],
  );
  assert.equal(page.groups[0]?.members[2]?.outside_gallery, true);
  const shown = await preview();
  assert.equal((await apply(shown.data.signature)).status, 200);
  assert.equal(
    (
      await db.client.query(
        "SELECT id FROM photos WHERE id = 1 AND trashed_at IS NULL",
      )
    ).rowCount,
    1,
  );
});

void test("pagination sees all tied groups and all locations; a global action honours skipped groups and unseen keepers", async () => {
  await bulk(30);
  const first = await list();
  assert.equal(first.groups.length, 24);
  assert.ok(first.next);
  const second = await duplicates.listExactDuplicates("files", first.next);
  assert.equal(second.groups.length, 6);
  assert.equal(second.next, null);
  assert.equal(
    new Set([...first.groups, ...second.groups].map((g) => g.key)).size,
    30,
  );
  const skip = first.groups[0];
  const unseen = second.groups[0];
  assert.ok(skip && unseen);
  const keeper = unseen.members[1];
  assert.ok(keeper);
  const choice = { ...allFiles, keep: [keeper.id], skip: [skip.key] };
  const shown = await preview(choice);
  assert.equal(shown.data.count, 29);
  const done = await apply(shown.data.signature, choice);
  assert.equal(done.status, 200);
  assert.equal(await count(), 29);
  assert.equal(
    (
      await db.client.query(
        "SELECT id FROM photos WHERE id = ANY($1::bigint[]) AND trashed_at IS NULL",
        [[keeper.id, ...skip.members.map((m) => m.id)]],
      )
    ).rowCount,
    3,
  );
  assert.equal((await apply(shown.data.signature, choice)).status, 409);
});

void test("global operations exceed 5000 files and restore as one lot", async () => {
  await bulk(5001);
  const shown = await preview();
  assert.equal(shown.data.count, 5001);
  const done = await apply(shown.data.signature);
  assert.equal(done.status, 200);
  assert.equal(await count(), 5001);
  assert.equal(
    await (await import("@/lib/trash")).restoreLot(String(done.data.lot)),
    5001,
  );
});

void test("report routes expose real pagination, validate cursors and require authentication", async () => {
  await bulk(30);
  const files = await import("../route");
  const folders = await import("../../duplicate-folders/route");
  const get = (suffix = "") =>
    files.GET(new NextRequest(`${APP}/api/stats/duplicates${suffix}`));
  const response = await get();
  assert.equal(response.status, 200);
  const { data } = (await response.json()) as { data: ExactDuplicatesPage };
  assert.equal(data.groups.length, 24);
  assert.ok(data.next);
  const next = await get(`?bytes=${data.next.bytes}&key=${data.next.key}`);
  const nextBody = (await next.json()) as { data: ExactDuplicatesPage };
  assert.equal(nextBody.data.groups.length, 6);
  for (const suffix of [
    "?bytes=-1&key=bad",
    "?bytes=NaN",
    "?key=bad",
    "?bytes=",
  ])
    assert.equal((await get(suffix)).status, 400);
  assert.equal(
    (await folders.GET(new NextRequest(`${APP}/api/stats/duplicate-folders`)))
      .status,
    200,
  );
  const { authConfig } = await import("@/lib/auth/config");
  authConfig.enabled = true;
  try {
    assert.equal((await get()).status, 401);
  } finally {
    authConfig.enabled = false;
  }
});

void test("changed contents, choices and folder membership invalidate confirmation even at the same count", async () => {
  await bulk(2);
  const shown = await preview();
  assert.equal(
    (await apply(shown.data.signature, { ...allFiles, keep: [1] })).data.code,
    "DUPLICATES_CHANGED",
  );
  await db.client.query(
    "UPDATE photos SET etag = md5('different bytes') WHERE id IN (1,2)",
  );
  assert.equal(
    (await apply(shown.data.signature)).data.code,
    "DUPLICATES_CHANGED",
  );
  const folders = await preview(allFolders);
  await photo(10, 2, "new.jpg", A);
  assert.equal(
    (await apply(folders.data.signature, allFolders)).data.code,
    "DUPLICATES_CHANGED",
  );
  assert.equal(await count(), 0);
  assert.equal((await preview({ ...allFiles, keep: [999] })).status, 409);
  assert.equal((await preview({ ...allFiles, keep: [1, 2] })).status, 409);
});

void test("a concurrent trash of the keeper rolls back the entire global operation", async () => {
  await bulk(2);
  const shown = await preview();
  await db.client.query("BEGIN");
  await db.client.query("UPDATE photos SET trashed_at = now() WHERE id = 2"); // default backup folder keeper
  const pending = apply(shown.data.signature);
  try {
    let waiting = false;
    for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
      await db.client.query("SELECT pg_stat_clear_snapshot()");
      waiting =
        (
          await db.client.query(
            "SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE 'SELECT id FROM photos%FOR UPDATE'",
          )
        ).rows.length > 0;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(waiting, true);
  } finally {
    await db.client.query("COMMIT");
  }
  const done = await pending;
  assert.equal(done.data.code, "DUPLICATES_CHANGED");
  assert.equal(await count(), 1);
});

void test("workers, origins, auth and malformed selections cannot bypass confirmation", async () => {
  await bulk(1);
  const shown = await preview();
  await db.client.query("SELECT pg_advisory_lock($1)", [0x626c617a6567]);
  try {
    assert.equal((await apply(shown.data.signature)).data.code, "PASS_RUNNING");
  } finally {
    await db.client.query("SELECT pg_advisory_unlock($1)", [0x626c617a6567]);
  }
  await db.client.query(
    "INSERT INTO task_leases VALUES ('groups','test',now() + interval '1 minute')",
  );
  assert.equal((await apply(shown.data.signature)).data.code, "PASS_RUNNING");
  assert.equal(
    (
      await post(
        { action: "preview", ...allFiles },
        "https://elsewhere.example",
      )
    ).status,
    403,
  );
  for (const body of [
    {},
    { action: "trash", ...allFiles },
    { action: "preview", ...allFiles, keep: [-1] },
    { action: "preview", ...allFiles, group: "bad" },
    { action: "preview", ...allFiles, skip: [3] },
  ])
    assert.equal((await post(body)).status, 400);
  const { authConfig } = await import("@/lib/auth/config");
  authConfig.enabled = true;
  try {
    assert.equal((await preview()).status, 401);
  } finally {
    authConfig.enabled = false;
  }
  assert.equal(await count(), 0);
});
