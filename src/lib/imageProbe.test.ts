import { test } from "node:test";
import assert from "node:assert/strict";
import { isIsoBmff, parseImageHead } from "./imageProbe";

// The start of an iPhone HEIC: a ftyp box, then boxes whose Exif item lies further on
const heicHead = Buffer.concat([
  Buffer.from([0, 0, 0, 24]),
  Buffer.from("ftypheic", "latin1"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("mif1heic", "latin1"),
  Buffer.alloc(4096),
]);

void test("a HEIC head is recognised by its ftyp box", () => {
  assert.equal(isIsoBmff(heicHead), true);
  assert.equal(
    isIsoBmff(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 0, 0, 0, 0, 0, 0, 0])),
    false,
  );
  assert.equal(isIsoBmff(Buffer.alloc(4)), false);
});

void test("a HEIC head without a date asks for a larger window", async () => {
  const parsed = await parseImageHead(heicHead);
  assert.equal(parsed.needsMore, true);
});
