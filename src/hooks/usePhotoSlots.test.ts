import assert from "node:assert/strict";
import { test } from "node:test";
import type { Photo } from "@/types";
import { slotItems } from "./usePhotoSlots";

const photo = (id: number, extra: Partial<Photo> = {}) =>
  ({ id, filename: `p${id}.jpg`, ...extra }) as Photo;

void test("a slot empties, changes hands, or keeps its photo with a new stack", () => {
  const list = [
    photo(1, { stack: { id: 1, count: 3 } }),
    photo(2, { is_favorite: true, stack: { id: 2, count: 2 } }),
    photo(3),
  ];
  const slots = new Map<string, Photo | null>([
    ["1", photo(11, { stack: { id: 1, count: 2 } })],
    ["2", photo(2)],
    ["3", null],
  ]);
  const items = slotItems(list, slots);
  assert.deepEqual(
    items.map((p) => [p.id, p.stack?.count]),
    [
      [11, 2],
      [2, undefined],
    ],
  );
  // The list's own fields of a photo kept in its slot still show
  assert.equal(items[1]?.is_favorite, true);
});

void test("a photo the list loads again where the server now puts it shows once", () => {
  const list = [photo(1, { stack: { id: 1, count: 2 } }), photo(5), photo(11)];
  const slots = new Map<string, Photo | null>([["1", photo(11)]]);
  assert.deepEqual(
    slotItems(list, slots).map((p) => p.id),
    [11, 5],
  );
});

void test("an emptied slot shows nothing, and its photo again once put back", () => {
  const front = photo(1, { stack: { id: 1, count: 2 } });
  const list = [front, photo(5)];
  const emptied = new Map<string, Photo | null>([["1", null]]);
  assert.deepEqual(
    slotItems(list, emptied).map((p) => p.id),
    [5],
  );
  const back = new Map<string, Photo | null>([["1", front]]);
  assert.deepEqual(
    slotItems(list, back).map((p) => [p.id, p.stack?.count]),
    [
      [1, 2],
      [5, undefined],
    ],
  );
});
