import assert from "node:assert/strict";
import { test } from "node:test";
import type { Photo } from "@/types";
import { frontAfter } from "./trashClient";

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
