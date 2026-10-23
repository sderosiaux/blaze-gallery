/** One-off, journaled cleanup authorized on 2026-10-22. Never downloads media to disk. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "dotenv";
import { Client } from "pg";
import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectVersionsCommand,
} from "@aws-sdk/client-s3";

const env = {
  ...parse(await fs.readFile(".env")),
  ...parse(await fs.readFile(".env.local")),
};
Object.assign(process.env, env, { LOG_LEVEL: "WARN" });
const { query, getPool, inGallery, runTransaction } = await import(
  "../src/lib/database"
);
const root = path.resolve("data/cleanup-20261022");
await fs.mkdir(root, { recursive: true, mode: 0o700 });
const bucket = env.BACKBLAZE_BUCKET!;
assert(bucket);
const s3 = new S3Client({
  endpoint: env.BACKBLAZE_ENDPOINT,
  region: "us-east-1",
  credentials: {
    accessKeyId: env.BACKBLAZE_ACCESS_KEY!,
    secretAccessKey: env.BACKBLAZE_SECRET_KEY!,
  },
});
const unquote = (v: string | undefined) => v?.replace(/"/g, "");
function albumPreference(folder: string) {
  return (
    (/(^|\/)(selection|sélection)(\/|$)/i.test(folder) ? 50 : 0) +
    (/^pc-fixe\/\d{4}[- ]/.test(folder) ? 20 : 0) +
    (/^divers\//.test(folder) ? 5 : 0) -
    (/(^|\/)(a trier|todo|backup|aaaa)[^/]*(\/|$)/i.test(folder) ? 10 : 0)
  );
}
async function save(name: string, value: unknown) {
  const file = path.join(root, name);
  const tmp = file + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await fs.rename(tmp, file);
}
async function read(name: string): Promise<any> {
  return JSON.parse(await fs.readFile(path.join(root, name), "utf8"));
}
async function exists(name: string) {
  return fs.access(path.join(root, name)).then(
    () => true,
    () => false,
  );
}
async function retry<T>(fn: () => Promise<T>): Promise<T> {
  for (let n = 0; ; n++) {
    try {
      return await fn();
    } catch (e: any) {
      if (
        n >= 3 ||
        !/ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|TLS|SSL|socket|Connection terminated|Timeout|SlowDown|ServiceUnavailable|InternalError/i.test(
          String(e),
        )
      )
        throw e;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (n + 1)));
    }
  }
}
const imageFingerprintSql = `SELECT count(*)::int AS count,coalesce(sum(size),0)::text AS bytes,md5(string_agg(jsonb_build_array(id,s3_key,size,etag,is_favorite)::text,',' ORDER BY id)) AS fingerprint FROM photos WHERE trashed_at IS NULL AND mime_type NOT LIKE 'video/%'`;
async function plan() {
  assert(!(await exists("plan.json")), "A frozen plan already exists");
  const snapshot = await runTransaction(async (client) => {
    await client.query(
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    const cutoff = (await client.query("SELECT now() AS cutoff")).rows[0]
      .cutoff;
    const trash = (
      await client.query(
        `SELECT id::text,folder_id::text,s3_key,filename,etag,size::text,mime_type,thumbnail_path,trashed_at,trash_batch,trashed_for::text FROM photos WHERE trashed_at IS NOT NULL AND trashed_at <= $1 ORDER BY trashed_at,id`,
        [cutoff],
      )
    ).rows;
    const videos = (
      await client.query(
        `SELECT p.id::text,p.folder_id::text,p.s3_key,p.filename,p.etag,p.size::text,p.mime_type,p.thumbnail_path,p.is_favorite,p.metadata,f.path,${inGallery()} AS in_gallery,EXISTS(SELECT 1 FROM shared_folders sf WHERE sf.folder_id=p.folder_id OR sf.folder_path=f.path) AS shared FROM photos p JOIN folders f ON f.id=p.folder_id WHERE p.trashed_at IS NULL AND p.mime_type LIKE 'video/%' ORDER BY p.id`,
      )
    ).rows;
    const images = (await client.query(imageFingerprintSql)).rows[0];
    return { cutoff, trash, videos, images };
  });
  const sizes = new Map<string, number>();
  for (const p of snapshot.videos)
    if (Number(p.size) > 10240) sizes.set(p.size, (sizes.get(p.size) ?? 0) + 1);
  const candidates = snapshot.videos.filter(
    (p) => (sizes.get(p.size) ?? 0) > 1,
  );
  await save("trash.json", snapshot.trash);
  await save("videos.json", snapshot.videos);
  await save("candidates.json", candidates);
  const p = {
    bucket,
    createdAt: new Date().toISOString(),
    cutoff: snapshot.cutoff,
    trashCount: snapshot.trash.length,
    trashBytes: snapshot.trash.reduce((s, p) => s + Number(p.size), 0),
    activeVideos: snapshot.videos.length,
    videoCandidates: candidates.length,
    candidateBytes: candidates.reduce((s, p) => s + Number(p.size), 0),
    activeImages: snapshot.images,
  };
  await save("plan.json", p);
  console.log(JSON.stringify(p));
}
async function hashVideos() {
  const candidates = (await read("candidates.json")) as any[];
  const totalBytes = candidates.reduce((s, p) => s + Number(p.size), 0);
  let cursor = 0,
    completed = 0,
    bytesRead = 0,
    failure: unknown;
  const active = new Set<string>();
  const update = () =>
    save("hash-progress.json", {
      at: new Date().toISOString(),
      completed,
      total: candidates.length,
      bytesRead,
      totalBytes,
      active: [...active],
      error: failure ? String(failure) : null,
    });
  const timer = setInterval(() => {
    void update();
  }, 5000);
  try {
    const jobs = await Promise.allSettled(
      Array.from({ length: 3 }, async () => {
        while (!failure) {
          const source = candidates[cursor++];
          if (!source) return;
          active.add(source.id);
          try {
            if (await exists("hashes/" + source.id + ".json")) {
              completed++;
              continue;
            }
            const result = await retry(async () => {
              const head = await s3.send(
                new HeadObjectCommand({ Bucket: bucket, Key: source.s3_key }),
              );
              assert.equal(
                unquote(head.ETag),
                source.etag,
                "Video changed: " + source.id,
              );
              assert.equal(head.ContentLength, Number(source.size));
              assert(head.VersionId);
              const response = await s3.send(
                new GetObjectCommand({
                  Bucket: bucket,
                  Key: source.s3_key,
                  VersionId: head.VersionId,
                  IfMatch: '"' + source.etag + '"',
                }),
              );
              assert.equal(response.VersionId, head.VersionId);
              assert(response.Body);
              const hash = crypto.createHash("sha256");
              let bytes = 0;
              for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
                hash.update(chunk);
                bytes += chunk.length;
                bytesRead += chunk.length;
              }
              assert.equal(bytes, Number(source.size));
              return {
                id: source.id,
                key: source.s3_key,
                etag: source.etag,
                version: head.VersionId,
                bytes,
                sha256: hash.digest("hex"),
                verifiedAt: new Date().toISOString(),
              };
            });
            await save("hashes/" + source.id + ".json", result);
            completed++;
            if (completed % 10 === 0)
              console.log(
                JSON.stringify({
                  hashed: completed,
                  total: candidates.length,
                  GBRead: bytesRead / 1e9,
                }),
              );
          } catch (e) {
            failure = e;
            throw e;
          } finally {
            active.delete(source.id);
          }
        }
      }),
    );
    for (const j of jobs) if (j.status === "rejected") throw j.reason;
    const groups = new Map<string, any[]>();
    for (const source of candidates) {
      const hash = await read("hashes/" + source.id + ".json");
      const key = hash.bytes + ":" + hash.sha256;
      const group = groups.get(key) ?? [];
      group.push({ ...source, hash });
      groups.set(key, group);
    }
    const duplicates = [];
    for (const group of groups.values())
      if (group.length > 1) {
        group.sort(
          (a, b) =>
            Number(b.in_gallery) - Number(a.in_gallery) ||
            Number(b.shared) - Number(a.shared) ||
            Number(b.is_favorite) - Number(a.is_favorite) ||
            albumPreference(b.path) - albumPreference(a.path) ||
            a.path.localeCompare(b.path, "en") ||
            Number(a.id) - Number(b.id),
        );
        duplicates.push({ keep: group[0], remove: group.slice(1) });
      }
    const report = {
      verifiedAt: new Date().toISOString(),
      hashed: candidates.length,
      groups: duplicates,
      removeCount: duplicates.reduce((s, g) => s + g.remove.length, 0),
      removeBytes: duplicates.reduce(
        (s, g) =>
          s + g.remove.reduce((t: any, p: any) => t + Number(p.size), 0),
        0,
      ),
    };
    await save("verified-videos.json", report);
    console.log(
      JSON.stringify({
        hashed: report.hashed,
        groups: duplicates.length,
        removeCount: report.removeCount,
        removeBytes: report.removeBytes,
      }),
    );
  } finally {
    clearInterval(timer);
    await update();
  }
}

async function guarded<T>(fn: (alive: () => void) => Promise<T>) {
  const guard = new Client({
    connectionString: env.DATABASE_URL,
    application_name: "blaze-cleanup-maintenance",
    lock_timeout: 5000,
  });
  let timer: NodeJS.Timeout | undefined,
    lost = false;
  await guard.connect();
  try {
    await guard.query("BEGIN");
    await guard.query("SET LOCAL idle_in_transaction_session_timeout=0");
    await guard.query("LOCK TABLE sync_jobs, task_leases IN SHARE MODE");
    assert.equal(
      (
        await guard.query(
          "SELECT 1 FROM sync_jobs WHERE status='running' LIMIT 1",
        )
      ).rowCount,
      0,
      "An active sync must finish first",
    );
    assert.equal(
      (
        await guard.query(
          "SELECT 1 FROM task_leases WHERE expires_at>now() LIMIT 1",
        )
      ).rowCount,
      0,
      "An active worker must finish first",
    );
    assert(
      (
        await guard.query("SELECT pg_try_advisory_xact_lock($1) AS ok", [
          0x626c617a6567,
        ])
      ).rows[0].ok,
      "A grouping operation must finish first",
    );
    timer = setInterval(() => {
      void guard.query("SELECT 1").catch(() => {
        lost = true;
      });
    }, 15000);
    return await fn(() => assert(!lost, "Maintenance connection lost"));
  } finally {
    if (timer) clearInterval(timer);
    await guard.query("ROLLBACK").catch(() => {});
    await guard.end();
  }
}

async function purge(scope: "trash" | "video-trash") {
  assert(process.argv.includes("--apply"), "Requires --apply");
  const pilot = process.argv.includes("--pilot");
  const concurrencyAt = process.argv.indexOf("--concurrency");
  const concurrency =
    concurrencyAt < 0 ? 24 : Number(process.argv[concurrencyAt + 1]);
  assert(
    Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 24,
  );
  const { purgeTrash } = await import("../src/lib/trash");
  const p = await read(
    scope === "trash" ? "plan.json" : "video-trash-plan.json",
  );
  const sources = (await read(scope + ".json")) as any[];
  const byKey = new Map(sources.map((s) => [s.s3_key, s]));
  const initialVersions = new Map<string, any[]>();
  const done = new Map<string, any>();
  const logName = scope + "-purged.jsonl";
  if (await exists(logName))
    for (const line of (await fs.readFile(path.join(root, logName), "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)) {
      const r = JSON.parse(line);
      done.set(r.id, r);
    }
  let journal = Promise.resolve(),
    failure: unknown;
  const append = (name: string, row: unknown) => {
    const operation = journal.then(() =>
      fs.appendFile(path.join(root, name), JSON.stringify(row) + "\n", {
        mode: 0o600,
      }),
    );
    journal = operation.catch(() => {});
    return operation;
  };
  const progress = () =>
    save(scope + "-progress.json", {
      at: new Date().toISOString(),
      purged: done.size,
      total: sources.length,
      bytes: [...done.values()].reduce((s, r) => s + r.bytes, 0),
      error: failure ? String(failure) : null,
    });
  const timer = setInterval(() => {
    void progress();
  }, 5000);
  try {
    await guarded(async (alive) => {
      const store = {
        versions: async (key: string) => {
          alive();
          assert(byKey.has(key), "Purge attempted an unplanned key");
          const all: any[] = [];
          let keyMarker: string | undefined, versionMarker: string | undefined;
          do {
            const page = await retry(() =>
              s3.send(
                new ListObjectVersionsCommand({
                  Bucket: bucket,
                  Prefix: key,
                  KeyMarker: keyMarker,
                  VersionIdMarker: versionMarker,
                }),
              ),
            );
            for (const v of [
              ...(page.Versions ?? []).map((v) => ({ ...v, marker: false })),
              ...(page.DeleteMarkers ?? []).map((v) => ({
                ...v,
                marker: true,
              })),
            ])
              if (v.Key === key) {
                assert(v.VersionId);
                all.push({
                  id: v.VersionId,
                  latest: v.IsLatest === true,
                  marker: v.marker,
                  lastModified: v.LastModified ?? null,
                  bytes: (v as any).Size ?? 0,
                  etag: unquote((v as any).ETag),
                });
              }
            keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
            versionMarker = page.IsTruncated
              ? page.NextVersionIdMarker
              : undefined;
          } while (keyMarker);
          if (!initialVersions.has(key) && all.length) {
            const source = byKey.get(key)!;
            const latest = all.find((v) => v.latest && !v.marker);
            if (latest) {
              assert.equal(
                latest.bytes,
                Number(source.size),
                "Trash contents changed: " + source.id,
              );
              assert.equal(
                latest.etag,
                source.etag,
                "Trash contents changed: " + source.id,
              );
            }
            initialVersions.set(key, all);
            await append(scope + "-versions.jsonl", {
              id: source.id,
              key,
              versions: all,
            });
          }
          return all;
        },
        deleteVersions: async (key: string, ids: readonly string[]) => {
          alive();
          const known = initialVersions.get(key);
          assert(known);
          for (const id of ids) {
            assert(known.some((v) => v.id === id));
            await retry(() =>
              s3.send(
                new DeleteObjectCommand({
                  Bucket: bucket,
                  Key: key,
                  VersionId: id,
                }),
              ),
            );
          }
        },
        exists: async (key: string) => {
          alive();
          try {
            await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
            return true;
          } catch (e: any) {
            if (e?.$metadata?.httpStatusCode === 404) return false;
            throw e;
          }
        },
        deleteDerived: async (photo: { id: number; s3_key: string }) => {
          const source = byKey.get(photo.s3_key);
          assert(source && Number(source.id) === photo.id);
          const row = {
            id: source.id,
            key: source.s3_key,
            bytes: Number(source.size),
            versionBytes:
              initialVersions
                .get(source.s3_key)
                ?.reduce((s, v) => s + v.bytes, 0) ?? 0,
            purgedAt: new Date().toISOString(),
          };
          await append(logName, row);
          done.set(source.id, row);
          if (done.size % 500 === 0)
            console.log(
              JSON.stringify({
                scope,
                purged: done.size,
                total: sources.length,
                GB: [...done.values()].reduce((s, r) => s + r.bytes, 0) / 1e9,
              }),
            );
        },
      };
      const jobs = await Promise.allSettled(
        Array.from({ length: pilot ? 1 : concurrency }, async () => {
          let deadlocks = 0;
          while (!failure) {
            try {
              alive();
              const report = await purgeTrash(store, {
                cutoff: new Date(p.cutoff),
                expected: sources.length,
                limit: pilot ? 5 : 50,
              });
              if (report.refused || report.stopped || report.left.length)
                throw new Error(
                  JSON.stringify({
                    refused: report.refused,
                    stopped: report.stopped,
                    left: report.left,
                  }),
                );
              if (pilot || report.purged.length === 0) return;
              deadlocks = 0;
            } catch (e) {
              // FK cascades can lock a shared face_candidates row in opposite
              // orders. PostgreSQL rolls this DELETE back before object deletion.
              if (
                (e as { code?: string }).code === "40P01" &&
                deadlocks++ < 10
              ) {
                console.log(
                  JSON.stringify({ databaseDeadlockRetry: deadlocks }),
                );
                await new Promise((resolve) =>
                  setTimeout(resolve, 250 * deadlocks),
                );
                continue;
              }
              failure = e;
              throw e;
            }
          }
        }),
      );
      for (const j of jobs) if (j.status === "rejected") throw j.reason;
      await journal;
      const remaining = (
        await query(
          "SELECT count(*)::int AS n FROM photos WHERE id=ANY($1::bigint[])",
          [sources.map((s) => s.id)],
        )
      ).rows[0]!.n;
      assert.equal(
        remaining,
        sources.length - done.size,
        "Purge journal incomplete",
      );
      if (!pilot) assert.equal(remaining, 0, "Frozen trash rows remain");
    });
    await save(scope + (pilot ? "-pilot-report.json" : "-report.json"), {
      verifiedAt: new Date().toISOString(),
      purged: done.size,
      bytes: [...done.values()].reduce((s, p) => s + p.bytes, 0),
      versionBytes: [...done.values()].reduce((s, p) => s + p.versionBytes, 0),
      remainingRows: sources.length - done.size,
    });
  } finally {
    clearInterval(timer);
    await progress();
  }
}

async function cleanDerivatives(scope: "trash" | "video-trash") {
  assert(process.argv.includes("--apply"), "Requires --apply");
  assert.equal((await read(scope + "-report.json")).remainingRows, 0);
  assert.equal(env.THUMBNAIL_STORAGE, "s3");
  const { renditionKeys } = await import("../src/lib/displayRendition");
  const sources = (await read(scope + ".json")) as any[];
  const used = new Set(
    (
      await query(
        "SELECT DISTINCT thumbnail_path FROM photos WHERE thumbnail_path IS NOT NULL",
      )
    ).rows.map((p) => p.thumbnail_path),
  );
  const keys = [
    ...new Set(
      sources.flatMap((s) => [
        ...(s.thumbnail_path && !used.has(s.thumbnail_path)
          ? [s.thumbnail_path]
          : []),
        ...renditionKeys(s),
      ]),
    ),
  ] as string[];
  assert(keys.every((k) => k && !k.startsWith("/") && !k.includes("../")));
  const r2 = new S3Client({
    endpoint: env.THUMBNAIL_S3_ENDPOINT,
    region: "auto",
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: env.THUMBNAIL_S3_ACCESS_KEY!,
      secretAccessKey: env.THUMBNAIL_S3_SECRET_KEY!,
    },
  });
  let cursor = 0,
    cleared = 0;
  try {
    const jobs = await Promise.allSettled(
      Array.from({ length: 4 }, async () => {
        while (cursor < keys.length) {
          const batch = keys.slice(cursor, cursor + 500);
          cursor += 500;
          const result = await retry(() =>
            r2.send(
              new DeleteObjectsCommand({
                Bucket: env.THUMBNAIL_S3_BUCKET,
                Delete: {
                  Objects: batch.map((Key) => ({ Key })),
                  Quiet: false,
                },
              }),
            ),
          );
          assert.equal(
            result.Errors?.length ?? 0,
            0,
            JSON.stringify(result.Errors),
          );
          assert.equal(result.Deleted?.length, batch.length);
          cleared += batch.length;
        }
      }),
    );
    for (const j of jobs) if (j.status === "rejected") throw j.reason;
    await save(scope + "-derivatives.json", {
      completedAt: new Date().toISOString(),
      keysCleared: cleared,
      originals: sources.length,
    });
    console.log(JSON.stringify({ scope, keysCleared: cleared }));
  } finally {
    r2.destroy();
  }
}

async function markVideos() {
  assert(process.argv.includes("--apply"), "Requires --apply");
  assert(
    !(await exists("video-trash-plan.json")),
    "Video cleanup already planned",
  );
  const verified = await read("verified-videos.json");
  for (const group of verified.groups)
    for (const copy of group.remove) {
      assert.equal(copy.hash.sha256, group.keep.hash.sha256);
      assert.equal(copy.hash.bytes, group.keep.hash.bytes);
      assert.notEqual(copy.s3_key, group.keep.s3_key);
    }
  const all = verified.groups.flatMap((g: any) => [g.keep, ...g.remove]);
  const pairs = verified.groups.flatMap((g: any) =>
    g.remove.map((p: any) => ({ id: Number(p.id), keep: Number(g.keep.id) })),
  );
  const { markTrashed, newLot } = await import("../src/lib/trash");
  const { carryNames } = await import("../src/lib/people");
  await guarded(async (alive) => {
    for (const source of all) {
      alive();
      const head = await retry(() =>
        s3.send(new HeadObjectCommand({ Bucket: bucket, Key: source.s3_key })),
      );
      assert.equal(
        head.VersionId,
        source.hash.version,
        "Verified video was replaced",
      );
      assert.equal(unquote(head.ETag), source.hash.etag);
      assert.equal(head.ContentLength, source.hash.bytes);
    }
    const lot = newLot("owner", "verified-videos-sha256");
    // Persist the intent first so an interruption after COMMIT is recoverable.
    await save("video-mark-intent.json", {
      lot,
      pairs,
      verifiedAt: new Date().toISOString(),
    });
    const outcome = await runTransaction(async (client) => {
      await client.query("SET LOCAL statement_timeout='60s'");
      const rows = (
        await client.query(
          "SELECT id::text,s3_key,etag,size::text,trashed_at,is_favorite,metadata FROM photos WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE",
          [all.map((p: any) => p.id)],
        )
      ).rows;
      assert.equal(rows.length, all.length);
      for (const source of all) {
        const row = rows.find((p) => p.id === source.id);
        assert(row);
        assert.equal(row.trashed_at, null);
        assert.equal(row.s3_key, source.s3_key);
        assert.equal(row.etag, source.etag);
        assert.equal(row.size, source.size);
      }
      const transferred = await carryNames(client, pairs);
      const favorites: string[] = [];
      for (const group of verified.groups) {
        const members = [group.keep, ...group.remove].map((p: any) =>
          rows.find((r) => r.id === p.id),
        );
        if (
          members.some((p: any) => p.is_favorite) &&
          !members[0].is_favorite
        ) {
          await client.query("UPDATE photos SET is_favorite=true WHERE id=$1", [
            group.keep.id,
          ]);
          favorites.push(group.keep.id);
        }
      }
      // No owned face identity is discarded if the video catalogue ever gains faces.
      const unresolved = (
        await client.query(
          `WITH pairs AS(SELECT * FROM unnest($1::bigint[],$2::bigint[]) AS t(id,keep)) SELECT count(*)::int AS n FROM pairs t JOIN faces f ON f.photo_id=t.id WHERE f.person_id IS NOT NULL AND f.assignment IN ('seed','manual','auto') AND NOT EXISTS(SELECT 1 FROM faces k WHERE k.photo_id=t.keep AND k.person_id=f.person_id AND k.assignment IN ('seed','manual','auto'))`,
          [pairs.map((p: any) => p.id), pairs.map((p: any) => p.keep)],
        )
      ).rows[0].n;
      assert.equal(
        unresolved,
        0,
        "A video still carries an untransferred face identity",
      );
      const moved = await markTrashed(client, pairs, lot);
      assert.equal(moved.length, pairs.length);
      // PostgreSQL stores microseconds; JS Date truncates to milliseconds.
      // Round the post-mark clock upward so this batch is inside its cutoff.
      const cutoff = (
        await client.query(
          "SELECT date_trunc('milliseconds',clock_timestamp()) + interval '1 millisecond' AS cutoff",
        )
      ).rows[0].cutoff;
      const trash = (
        await client.query(
          "SELECT id::text,folder_id::text,s3_key,filename,etag,size::text,mime_type,thumbnail_path,trashed_at,trash_batch,trashed_for::text FROM photos WHERE id=ANY($1::bigint[]) ORDER BY id",
          [pairs.map((p: any) => p.id)],
        )
      ).rows;
      return { cutoff, trash, favorites, transferred };
    });
    await save("video-trash.json", outcome.trash);
    const report = {
      bucket,
      cutoff: outcome.cutoff,
      count: outcome.trash.length,
      bytes: outcome.trash.reduce((s, p) => s + Number(p.size), 0),
      lot,
      favoritesTransferred: outcome.favorites,
      faceNamesTransferred: outcome.transferred,
      kept: verified.groups.map((g: any) => g.keep.id),
    };
    await save("video-trash-plan.json", report);
    console.log(JSON.stringify(report));
  });
}

async function finalAudit() {
  const plan = await read("plan.json"),
    videoPlan = await read("video-trash-plan.json"),
    verified = await read("verified-videos.json");
  const originalVideos = (await read("videos.json")) as any[];
  const removed = new Set<string>(
    verified.groups.flatMap((g: any) => g.remove.map((p: any) => p.id)),
  );
  const images = (await query(imageFingerprintSql)).rows[0];
  assert(images);
  assert.deepEqual(images, plan.activeImages, "Active photographs changed");
  const currentVideos = (
    await query(
      "SELECT id::text,s3_key,etag,size::text,is_favorite,trashed_at FROM photos WHERE mime_type LIKE 'video/%' AND trashed_at IS NULL",
    )
  ).rows;
  assert.equal(currentVideos.length, originalVideos.length - removed.size);
  for (const row of currentVideos) {
    const old = originalVideos.find((p) => p.id === row.id);
    assert(old && !removed.has(row.id));
    for (const field of ["s3_key", "etag", "size"])
      assert.equal(row[field], old[field]);
    assert.equal(
      row.is_favorite,
      old.is_favorite || videoPlan.favoritesTransferred.includes(row.id),
    );
  }
  const remainingTrash = (
    await query(
      "SELECT count(*)::int AS n FROM photos WHERE trashed_at IS NOT NULL",
    )
  ).rows[0]!.n;
  assert.equal(remainingTrash, 0);
  let keepersVerified = 0;
  for (const group of verified.groups) {
    const keep = group.keep;
    const head = await retry(() =>
      s3.send(new HeadObjectCommand({ Bucket: bucket, Key: keep.s3_key })),
    );
    assert.equal(head.VersionId, keep.hash.version);
    assert.equal(head.ContentLength, keep.hash.bytes);
    assert.equal(unquote(head.ETag), keep.hash.etag);
    keepersVerified++;
  }
  const trashReport = await read("trash-report.json"),
    videosReport = await read("video-trash-report.json");
  assert.equal(trashReport.purged, plan.trashCount);
  assert.equal(videosReport.purged, removed.size);
  const derivatives = await read("trash-derivatives.json"),
    videoDerivatives = await read("video-trash-derivatives.json");
  const report = {
    verifiedAt: new Date().toISOString(),
    trashPurged: trashReport.purged,
    trashBytes: trashReport.bytes,
    videoCopiesPurged: videosReport.purged,
    videoBytes: videosReport.bytes,
    totalBytes: trashReport.bytes + videosReport.bytes,
    totalVersionBytes: trashReport.versionBytes + videosReport.versionBytes,
    remainingTrash,
    keepersVerified,
    activeImagesUnchanged: images.count,
    remainingActiveVideos: currentVideos.length,
    derivativeKeysCleared:
      derivatives.keysCleared + videoDerivatives.keysCleared,
    localMediaFilesCreated: 0,
  };
  await save("final-report.json", report);
  console.log(JSON.stringify(report));
}

try {
  const action = process.argv[2];
  if (action === "plan") await plan();
  else if (action === "hash-videos") await hashVideos();
  else if (action === "mark-videos") await markVideos();
  else if (action === "purge-trash") await purge("trash");
  else if (action === "purge-videos") await purge("video-trash");
  else if (action === "clean-trash-derivatives")
    await cleanDerivatives("trash");
  else if (action === "clean-video-derivatives")
    await cleanDerivatives("video-trash");
  else if (action === "recount-folders") {
    assert(process.argv.includes("--apply"), "Requires --apply");
    const { recountDriftedFolders } = await import("../src/lib/database");
    const corrected = await recountDriftedFolders();
    await save("folder-counts.json", {
      corrected,
      at: new Date().toISOString(),
    });
    console.log(JSON.stringify({ foldersRecounted: corrected }));
  } else if (action === "verify") await finalAudit();
  else throw new Error("Unknown action");
} finally {
  await getPool().end();
  s3.destroy();
}
