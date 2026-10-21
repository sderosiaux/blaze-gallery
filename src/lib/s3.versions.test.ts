import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DeleteObjectCommand,
  ListObjectVersionsCommand,
} from "@aws-sdk/client-s3";

void test("erasing a file deletes each of its versions and hide markers, only its own", async (t) => {
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
  const { deleteAllVersions, destroyS3Client, getS3Client } = await import(
    "./s3"
  );
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
  t.mock.method(storage, "send", (command: unknown) => {
    if (command instanceof ListObjectVersionsCommand) {
      listed += 1;
      assert.equal(command.input.Prefix, "a/photo.jpg");
      // Two pages; the prefix also finds a sibling, which stays
      return Promise.resolve(
        listed === 1
          ? {
              Versions: [
                { Key: "a/photo.jpg", VersionId: "v2" },
                { Key: "a/photo.jpg (1).jpg", VersionId: "x1" },
              ],
              IsTruncated: true,
              NextKeyMarker: "a/photo.jpg",
              NextVersionIdMarker: "v2",
            }
          : {
              Versions: [{ Key: "a/photo.jpg", VersionId: "v1" }],
              DeleteMarkers: [{ Key: "a/photo.jpg", VersionId: "m1" }],
              IsTruncated: false,
            },
      );
    }
    assert.ok(command instanceof DeleteObjectCommand);
    assert.equal(command.input.Bucket, "test-photos");
    assert.equal(command.input.Key, "a/photo.jpg");
    deleted.push(String(command.input.VersionId));
    return Promise.resolve({});
  });

  assert.deepEqual(await deleteAllVersions("test-photos", "a/photo.jpg"), [
    "v2",
    "v1",
    "m1",
  ]);
  assert.deepEqual(deleted, ["v2", "v1", "m1"]);
  assert.equal(listed, 2);
});
