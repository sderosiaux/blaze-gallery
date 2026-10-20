import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";

void test("photo deletion keeps the index intact when storage refuses", async (t) => {
  const env = {
    NODE_ENV: "test",
    GOOGLE_AUTH_ENABLED: "false",
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

  const { DELETE } = await import("./route");
  const { getPool } = await import("@/lib/database");
  const { getS3Client, destroyS3Client } = await import("@/lib/s3");
  const { thumbnailService } = await import("@/lib/thumbnails");
  const { logger } = await import("@/lib/logger");
  t.mock.method(logger, "info", () => undefined);
  t.mock.method(logger, "apiError", () => undefined);
  t.mock.method(logger, "s3Error", () => undefined);
  const pool = getPool();
  const storage = getS3Client();
  t.after(async () => {
    destroyS3Client();
    await pool.end();
  });

  for (const status of [403, 503, 204]) {
    await t.test(`storage returns ${status}`, async (t) => {
      const changes: string[] = [];
      t.mock.method(pool, "query", (sql: string) => {
        if (sql.startsWith("SELECT * FROM photos")) {
          return Promise.resolve({
            rows: [
              {
                id: 42,
                filename: "photo.jpg",
                s3_key: "album/photo.jpg",
                thumbnail_path: "thumbnail.jpg",
              },
            ],
            rowCount: 1,
          });
        }
        if (sql.startsWith("DELETE FROM photos")) changes.push("database");
        else assert.match(sql, /INSERT INTO s3_audit_logs/);
        return Promise.resolve({ rows: [{ id: 42 }], rowCount: 1 });
      });
      t.mock.method(storage, "send", (command: unknown) => {
        assert.ok(command instanceof DeleteObjectCommand);
        assert.deepEqual(command.input, {
          Bucket: "test-photos",
          Key: "album/photo.jpg",
        });
        changes.push("storage");
        if (status !== 204) {
          return Promise.reject(
            Object.assign(new Error("private provider error"), {
              $metadata: { httpStatusCode: status },
            }),
          );
        }
        return Promise.resolve({});
      });
      t.mock.method(thumbnailService, "deleteThumbnail", () => {
        changes.push("thumbnail");
        return Promise.resolve();
      });

      const response = await DELETE(
        new NextRequest("http://localhost/api/photos/42", {
          method: "DELETE",
        }),
        { params: { id: "42" } },
      );
      const body = (await response.json()) as Record<string, unknown>;
      if (status === 204) {
        assert.equal(response.status, 200);
        assert.equal(body.success, true);
        assert.deepEqual(changes, ["storage", "thumbnail", "database"]);
      } else {
        assert.equal(response.status, status === 403 ? 403 : 500);
        assert.equal(body.success, false);
        assert.equal(
          body.code,
          status === 403 ? "STORAGE_DELETE_FORBIDDEN" : "DELETE_FAILED",
        );
        assert.equal(typeof body.error, "string");
        assert.doesNotMatch(String(body.error), /private provider error/);
        if (status === 403) assert.match(String(body.error), /clé d’accès/);
        assert.deepEqual(changes, ["storage"]);
      }
    });
  }
});
