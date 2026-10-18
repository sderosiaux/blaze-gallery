import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeCursor, encodeCursor, toOffsetCursor } from "./cursor";

void test("an offset cursor comes back as it was handed out", () => {
  const cursor = encodeCursor({ offset: 60 });
  assert.ok(cursor);
  assert.deepEqual(decodeCursor(cursor, toOffsetCursor), { offset: 60 });
  assert.equal(encodeCursor(null), null);
});

void test("anything else is not an offset cursor", () => {
  const bad = [
    "not base64 json",
    encodeCursor({ offset: 0 }),
    encodeCursor({ offset: -60 }),
    encodeCursor({ offset: 1.5 }),
    encodeCursor({ offset: "60" }),
    encodeCursor({ offset: 1_000_000 }),
    encodeCursor({ folderPath: "a", filename: "b", id: "1" }),
  ];
  for (const value of bad) {
    assert.ok(value !== null);
    assert.equal(decodeCursor(value, toOffsetCursor), null, value);
  }
});
