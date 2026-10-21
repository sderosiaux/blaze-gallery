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

// 8 x 8 JPEGs whose EXIF has DateTime 2019-01-01 08:00, and for the first
// DateTimeOriginal 2020-05-01 10:00 and an exposure bias of -2/3 EV
const withOriginal = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/4QCgRXhpZgAATU0AKgAAAAgABAEPAAIAAAAGAAAAPgEQAAIAAAAGAAAARAEyAAIAAAAUAAAASodpAAQAAAABAAAAXgAAAABOSUtPTgBENzAwMAAyMDE5OjAxOjAxIDA4OjAwOjAwAAACkAMAAgAAABQAAAB8kgQACgAAAAEAAACQAAAAADIwMjA6MDU6MDEgMTA6MDA6MDAA/////gAAAAP/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCvRRRQB//Z",
  "base64",
);
const dateTimeOnly = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/4QBaRXhpZgAATU0AKgAAAAgAAwEPAAIAAAAGAAAAMgEQAAIAAAAGAAAAOAEyAAIAAAAUAAAAPgAAAABOSUtPTgBENzAwMAAyMDE5OjAxOjAxIDA4OjAwOjAwAP/bAEMACAYGBwYFCAcHBwkJCAoMFA0MCwsMGRITDxQdGh8eHRocHCAkLicgIiwjHBwoNyksMDE0NDQfJzk9ODI8LjM0Mv/bAEMBCQkJDAsMGA0NGDIhHCEyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMv/AABEIAAgACAMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/xAAfAQADAQEBAQEBAQEBAAAAAAAAAQIDBAUGBwgJCgv/xAC1EQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/AK9FFFAH/9k=",
  "base64",
);

void test("the date taken says which EXIF tag it came from, and the exposure bias is kept", async () => {
  const shot = (await parseImageHead(withOriginal)).result.metadata;
  assert.ok(shot);
  assert.equal(shot.date_taken, "2020-05-01T10:00:00.000Z");
  assert.equal(shot.date_tag, "DateTimeOriginal");
  assert.equal(shot.exposure_bias, -0.67);
  const edited = (await parseImageHead(dateTimeOnly)).result.metadata;
  assert.ok(edited);
  assert.equal(edited.date_taken, "2019-01-01T08:00:00.000Z");
  assert.equal(edited.date_tag, "DateTime");
  assert.equal(edited.exposure_bias, undefined);
});
