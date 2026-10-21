import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
} from "@aws-sdk/client-s3";

void test("a file's versions and hide markers, only its own; deleted in the order given; served or not", async (t) => {
  const env = {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test:test@127.0.0.1:1/test",
    BACKBLAZE_ENDPOINT: "http://127.0.0.1:1",
    BACKBLAZE_BUCKET: "test-photos",
    BACKBLAZE_ACCESS_KEY: "test-key",
    BACKBLAZE_SECRET_KEY: "test-secret",
    THUMBNAIL_STORAGE: "local",
  };
  const previous = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  });
  const {
    deleteFileVersions,
    destroyS3Client,
    fileExists,
    getS3Client,
    listFileVersions,
  } = await import("./s3");
  const { getPool } = await import("./database");
  const { logger } = await import("./logger");
  t.mock.method(logger, "s3Error", () => undefined);
  const pool = getPool();
  // The audit log is written to the database: answered here
  t.mock.method(pool, "query", () =>
    Promise.resolve({ rows: [{ id: 1 }], rowCount: 1 }),
  );
  const storage = getS3Client();
  t.after(async () => {
    destroyS3Client();
    await pool.end();
  });

  const deleted: string[] = [];
  let listed = 0;
  let head = 200;
  const old = new Date("2020-01-01T00:00:00Z");
  t.mock.method(storage, "send", (command: unknown) => {
    if (command instanceof ListObjectVersionsCommand) {
      listed += 1;
      assert.equal(command.input.Prefix, "a/photo.jpg");
      // Two pages; the prefix also finds a sibling, which stays
      return Promise.resolve(
        listed === 1
          ? {
              Versions: [
                {
                  Key: "a/photo.jpg",
                  VersionId: "v2",
                  IsLatest: true,
                  LastModified: old,
                },
                { Key: "a/photo.jpg (1).jpg", VersionId: "x1" },
              ],
              IsTruncated: true,
              NextKeyMarker: "a/photo.jpg",
              NextVersionIdMarker: "v2",
            }
          : {
              Versions: [
                { Key: "a/photo.jpg", VersionId: "v1", LastModified: old },
              ],
              DeleteMarkers: [{ Key: "a/photo.jpg", VersionId: "m1" }],
              IsTruncated: false,
            },
      );
    }
    if (command instanceof HeadObjectCommand)
      return head === 200
        ? Promise.resolve({})
        : Promise.reject(
            Object.assign(new Error("head"), {
              $metadata: { httpStatusCode: head },
            }),
          );
    assert.ok(command instanceof DeleteObjectCommand);
    assert.equal(command.input.Bucket, "test-photos");
    assert.equal(command.input.Key, "a/photo.jpg");
    deleted.push(String(command.input.VersionId));
    return Promise.resolve({});
  });

  assert.deepEqual(await listFileVersions("test-photos", "a/photo.jpg"), [
    { id: "v2", latest: true, marker: false, lastModified: old },
    { id: "v1", latest: false, marker: false, lastModified: old },
    { id: "m1", latest: false, marker: true, lastModified: null },
  ]);
  assert.equal(listed, 2);
  await deleteFileVersions("test-photos", "a/photo.jpg", ["v1", "m1", "v2"]);
  assert.deepEqual(deleted, ["v1", "m1", "v2"]);
  assert.equal(await fileExists("test-photos", "a/photo.jpg"), true);
  head = 404;
  assert.equal(await fileExists("test-photos", "a/photo.jpg"), false);
  // Refused is not gone
  head = 403;
  await assert.rejects(fileExists("test-photos", "a/photo.jpg"));
});
