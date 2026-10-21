/**
 * The gallery's counts leave the Corbeille out, on a real PostgreSQL
 * (lib/testDatabase.ts): the Stats page's headline, the MCP statistics,
 * analytics and trends, the library summary, the Hors galerie cards. The
 * storage stays the bucket's, the Corbeille's files included until erased.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { NextRequest } from "next/server";
import type { Client } from "pg";
import type * as Database from "./database";
import type * as Trash from "./trash";
import { startTestDatabase, type TestDatabase } from "./testDatabase";

let db: TestDatabase;
let sql: Client;
let database: typeof Database;
let trash: typeof Trash;

before(async () => {
  db = await startTestDatabase();
  sql = db.client;
  database = await import("./database");
  trash = await import("./trash");
  // photo_count: the files the sync counted
  await sql.query(`INSERT INTO folders (id, path, name, photo_count) VALUES
    (1, '2020 Voyage', '2020 Voyage', 3), (2, 'books', 'books', 2)`);
  await sql.query(`INSERT INTO excluded_folders (path) VALUES ('books')`);
  const photos: [number, number, string, boolean][] = [
    [1, 1, "2020 Voyage/p1.jpg", true],
    [2, 1, "2020 Voyage/p2.jpg", true],
    [3, 1, "2020 Voyage/p3.jpg", false],
    [4, 2, "books/p4.jpg", false],
    [5, 2, "books/p5.jpg", false],
  ];
  for (const [id, folder, key, favorite] of photos)
    await sql.query(
      `INSERT INTO photos (id, folder_id, filename, s3_key, size, mime_type,
         modified_at, metadata, is_favorite)
       VALUES ($1, $2, $3, $3, 1000, 'image/jpeg', '2020-05-01', $4, $5)`,
      [
        id,
        folder,
        key,
        { date_taken: `2020-05-0${id}T10:00:00.000Z` },
        favorite,
      ],
    );
  // A favourite and a book thrown away
  await trash.trashPhotos([2, 5]);
});

after(async () => {
  await database.getPool().end();
  await db.stop();
});

async function tool(name: string, args: Record<string, unknown> = {}) {
  const { POST } = await import("../app/api/mcp/route");
  const response = await POST(
    new NextRequest("http://localhost/api/mcp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
  );
  const body = (await response.json()) as {
    result: { content: { text: string }[] };
  };
  return JSON.parse(body.result.content[0]?.text ?? "null") as Record<
    string,
    unknown
  >;
}

void describe("the gallery's counts and the Corbeille", () => {
  void test("the Stats page counts the library without it, the storage with it", async () => {
    const { GET } = await import("../app/api/stats/route");
    const response = await GET(new NextRequest("http://localhost/api/stats"));
    const { data } = (await response.json()) as {
      data: {
        photos: number;
        favorites: number;
        albums: number;
        storage_bytes: number;
      };
    };
    assert.equal(data.photos, 3);
    assert.equal(data.favorites, 1);
    assert.equal(data.albums, 2);
    assert.equal(data.storage_bytes, 5000);
  });

  void test("MCP: statistics, analytics and trends leave it out, and say how many it holds", async () => {
    const stats = await tool("get_gallery_stats");
    assert.equal(Number(stats.total_photos), 3);
    assert.equal(Number(stats.favorite_photos), 1);
    assert.equal(Number(stats.total_size), 3000);
    assert.equal(Number(stats.photos_in_corbeille), 2);
    const analytics = (await tool("get_photo_analytics", { groupBy: "folder" }))
      .analytics as { period: string; photo_count: string }[];
    assert.deepEqual(
      analytics.map((row) => [row.period, Number(row.photo_count)]).sort(),
      [
        ["2020 Voyage", 2],
        ["books", 1],
      ],
    );
    const trends = (
      await tool("get_photo_trends", { timeRange: "all-time", groupBy: "year" })
    ).trends as { value: string }[];
    assert.deepEqual(
      trends.map((row) => Number(row.value)),
      [3],
    );
  });

  void test("the Storage and Videos tabs count what the library holds", async () => {
    await sql.query(
      `INSERT INTO photos (id, folder_id, filename, s3_key, size, mime_type, modified_at, metadata)
       VALUES (6, 1, 'v6.mp4', '2020 Voyage/v6.mp4', 9000, 'video/mp4', '2020-05-01', '{}'),
              (7, 1, 'v7.mp4', '2020 Voyage/v7.mp4', 8000, 'video/mp4', '2020-05-01', '{}')`,
    );
    await trash.trashPhotos([7]);
    try {
      const storage = await import("../app/api/stats/storage/route");
      const { data: store } = (await (
        await storage.GET(new NextRequest("http://localhost/api/stats/storage"))
      ).json()) as {
        data: {
          largest_by_size: {
            path: string;
            photo_count: number;
            video_count: number;
            total_size: number;
          }[];
        };
      };
      const trip = store.largest_by_size.find((f) => f.path === "2020 Voyage");
      assert.deepEqual(
        [trip?.photo_count, trip?.video_count, trip?.total_size],
        [2, 1, 11000],
      );
      const videos = await import("../app/api/stats/videos/route");
      const { data: video } = (await (
        await videos.GET(new NextRequest("http://localhost/api/stats/videos"))
      ).json()) as {
        data: {
          summary: { total_videos: number; total_size_bytes: number };
          largest: { id: number }[];
        };
      };
      assert.deepEqual(
        [video.summary.total_videos, video.summary.total_size_bytes],
        [1, 9000],
      );
      assert.deepEqual(
        video.largest.map((x) => x.id),
        [6],
      );
    } finally {
      await sql.query("DELETE FROM photos WHERE id IN (6, 7)");
    }
  });

  void test("the library summary and the Hors galerie cards leave it out", async () => {
    const summary = await database.getLibrarySummary();
    assert.equal(summary.photos, 3);
    const excluded = await database.listExcludedFolders();
    assert.deepEqual(
      excluded.map((x) => [x.path, x.photo_count]),
      [["books", 1]],
    );
  });
});
