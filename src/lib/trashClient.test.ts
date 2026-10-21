import assert from "node:assert/strict";
import { test } from "node:test";
import type { Photo } from "@/types";
import {
  emptyTrash,
  frontAfter,
  TrashError,
  type EmptyConfirmed,
} from "./trashClient";

const photo = (id: number, extra: Partial<Photo> = {}) =>
  ({ id, filename: `p${id}.jpg`, ...extra }) as Photo;

void test("a slot keeps its own photo or empties, never takes another of the stack", () => {
  const front = photo(1, { is_favorite: true, stack: { id: 1, count: 3 } });
  const left = [photo(1), photo(2), photo(3)];
  // Its front went: whatever is next in the stack, the slot empties
  assert.equal(frontAfter(front, [1], left), null);
  // Another went: the front stays, the badge counts what the server shows
  assert.deepEqual(frontAfter(front, [3], left.slice(0, 2)), {
    ...front,
    stack: { id: 1, count: 2 },
  });
  // One left: no badge
  assert.deepEqual(frontAfter(front, [2, 3], left.slice(0, 1)), {
    id: 1,
    filename: "p1.jpg",
    is_favorite: true,
  });
  // The server could not say: the slot keeps its photo as it was
  assert.equal(frontAfter(front, [3], null), front);
  // A photo out of any stack
  assert.equal(frontAfter(photo(9), [9], null), null);
});

void test("« Vider » expects, request after request, exactly what the one before left", async () => {
  const sent: EmptyConfirmed[] = [];
  const answers = [
    { purged: 10, remaining: 15 },
    { purged: 10, remaining: 5 },
    { purged: 5, remaining: 0 },
  ];
  const progress: number[] = [];
  const done = await emptyTrash(
    { expected: 25, cutoff: "2026-09-21T00:00:00.000Z", all: false },
    (n) => progress.push(n),
    (body) => {
      sent.push(body);
      const answer = answers[sent.length - 1];
      return Promise.resolve({ ok: true, data: { success: true, ...answer } });
    },
  );
  assert.equal(done, 25);
  assert.deepEqual(
    sent.map((b) => b.expected),
    [25, 15, 5],
  );
  assert.ok(sent.every((b) => !b.all && b.cutoff.startsWith("2026-09-21")));
  assert.deepEqual(progress, [10, 20, 25]);
  // Nothing more can go: it stops, it does not ask again
  let calls = 0;
  await assert.rejects(
    emptyTrash(
      { expected: 3, cutoff: "2026-10-21T00:00:00.000Z", all: true },
      () => undefined,
      () => {
        calls++;
        return Promise.resolve({
          ok: true,
          data: { success: true, purged: 0, remaining: 3, left: 3 },
        });
      },
    ),
    TrashError,
  );
  assert.equal(calls, 1);
});
