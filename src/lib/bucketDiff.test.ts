import assert from "node:assert/strict";
import { test } from "node:test";
import type { KnownPhoto, ListingPage } from "./bucketDiff";
import {
  BucketDiffer,
  IncompleteListingError,
  diffBucket,
  isMassRemoval,
  missingFolders,
} from "./bucketDiff";
import type { S3Object } from "./s3";

const MAY = Date.UTC(2024, 4, 1, 12, 0, 0, 250);

function object(key: string, size = 100, modifiedAt = MAY): S3Object {
  return { key, size, lastModified: new Date(modifiedAt), etag: "e" };
}

/** Known photos; an etag not given is not read yet */
function known(
  entries: [
    key: string,
    photo: Omit<KnownPhoto, "etag"> & { etag?: string | null },
  ][],
): Map<string, KnownPhoto> {
  return new Map(
    entries.map(([key, photo]) => [key, { etag: null, ...photo }]),
  );
}

function page(
  objects: S3Object[],
  next?: string,
  isTruncated = next !== undefined,
): ListingPage {
  return { objects, isTruncated, nextContinuationToken: next };
}

void test("a key the database doesn't know is added when it is a media file", () => {
  const diff = diffBucket(known([]), [
    page([object("trip/a.JPG"), object("trip/notes.txt"), object("b.mp4")]),
  ]);

  assert.deepEqual(
    diff.added.map((o) => o.key),
    ["trip/a.JPG", "b.mp4"],
  );
  assert.equal(diff.listed, 3);
  assert.deepEqual(diff.changed, []);
  assert.deepEqual(diff.removed, []);
});

void test("a known file with the same size and date is left alone", () => {
  const diff = diffBucket(
    known([["trip/a.jpg", { id: 1, size: 100, modifiedAt: MAY }]]),
    [page([object("trip/a.jpg")])],
  );

  assert.deepEqual(diff.added, []);
  assert.deepEqual(diff.changed, []);
  assert.deepEqual(diff.removed, []);
});

void test("a known file with a new size or a new date is changed", () => {
  const diff = diffBucket(
    known([
      ["a.jpg", { id: 1, size: 100, modifiedAt: MAY }],
      ["b.jpg", { id: 2, size: 100, modifiedAt: MAY }],
      ["c.jpg", { id: 3, size: 100, modifiedAt: MAY }],
    ]),
    [
      page([
        object("a.jpg", 101),
        object("b.jpg", 100, MAY + 1),
        object("c.jpg"),
      ]),
    ],
  );

  assert.deepEqual(
    diff.changed.map((c) => [c.id, c.object.key]),
    [
      [1, "a.jpg"],
      [2, "b.jpg"],
    ],
  );
});

void test("a known key missing from a complete listing is removed", () => {
  const diff = diffBucket(
    known([
      ["kept.jpg", { id: 1, size: 100, modifiedAt: MAY }],
      ["gone.jpg", { id: 2, size: 100, modifiedAt: MAY }],
      ["also-gone.mov", { id: 3, size: 100, modifiedAt: MAY }],
    ]),
    [page([object("kept.jpg")], "t1"), page([])],
  );

  assert.deepEqual(diff.removed, [
    { id: 2, key: "gone.jpg" },
    { id: 3, key: "also-gone.mov" },
  ]);
});

void test("a known key still listed is not removed, even if it no longer counts as media", () => {
  const diff = diffBucket(
    known([["old.xyz", { id: 1, size: 100, modifiedAt: MAY }]]),
    [page([object("old.xyz")])],
  );

  assert.deepEqual(diff.removed, []);
  assert.deepEqual(diff.added, []);
});

void test("pages are combined: a key on any page counts as present", () => {
  const diff = diffBucket(
    known([
      ["p1.jpg", { id: 1, size: 100, modifiedAt: MAY }],
      ["p3.jpg", { id: 3, size: 100, modifiedAt: MAY }],
    ]),
    [
      page([object("p1.jpg")], "t1"),
      page([object("p2.jpg")], "t2"),
      page([object("p3.jpg")]),
    ],
  );

  assert.deepEqual(
    diff.added.map((o) => o.key),
    ["p2.jpg"],
  );
  assert.deepEqual(diff.removed, []);
  assert.equal(diff.listed, 3);
});

void test("a key listed twice is counted once", () => {
  const diff = diffBucket(known([]), [
    page([object("a.jpg")], "t1"),
    page([object("a.jpg")]),
  ]);

  assert.equal(diff.listed, 1);
  assert.equal(diff.added.length, 1);
});

void test("every listed object gives its folder, media or not", () => {
  const diff = diffBucket(known([]), [
    page([object("root.jpg"), object("a/b/.DS_Store"), object("a/c/d.jpg")]),
  ]);

  assert.deepEqual([...diff.folders].sort(), ["", "a/b", "a/c"]);
});

void test("a listing cut before its last page removes nothing: it throws", () => {
  const snapshot = known([
    ["first.jpg", { id: 1, size: 100, modifiedAt: MAY }],
    ["on-page-2.jpg", { id: 2, size: 100, modifiedAt: MAY }],
  ]);
  const differ = new BucketDiffer(snapshot);
  // Page 1 says more follows; page 2 never came (the request failed)
  differ.addPage(page([object("first.jpg")], "t1"));

  assert.throws(() => differ.finish(), IncompleteListingError);
});

void test("a truncated page without a token to continue is an incomplete listing", () => {
  assert.throws(
    () =>
      diffBucket(known([["a.jpg", { id: 1, size: 100, modifiedAt: MAY }]]), [
        page([], undefined, true),
      ]),
    IncompleteListingError,
  );
});

void test("a last page that still carries a token is an incomplete listing", () => {
  assert.throws(
    () =>
      diffBucket(known([["a.jpg", { id: 1, size: 100, modifiedAt: MAY }]]), [
        page([], "t1", false),
      ]),
    IncompleteListingError,
  );
});

void test("no page at all is an incomplete listing, not an empty bucket", () => {
  assert.throws(
    () =>
      diffBucket(known([["a.jpg", { id: 1, size: 100, modifiedAt: MAY }]]), []),
    IncompleteListingError,
  );
});

void test("a complete but empty listing removes everything: the caller guards against it", () => {
  const diff = diffBucket(
    known([["a.jpg", { id: 1, size: 100, modifiedAt: MAY }]]),
    [page([])],
  );

  assert.deepEqual(diff.removed, [{ id: 1, key: "a.jpg" }]);
});

void test("removing more than 5% of the library is a mass removal", () => {
  assert.equal(isMassRemoval(0, 0), false);
  assert.equal(isMassRemoval(0, 215_000), false);
  assert.equal(isMassRemoval(10_750, 215_000), false);
  assert.equal(isMassRemoval(10_751, 215_000), true);
  assert.equal(isMassRemoval(215_000, 215_000), true);
});

void test("a page after the last one is refused", () => {
  const differ = new BucketDiffer(known([]));
  differ.addPage(page([object("a.jpg")]));

  assert.throws(() => {
    differ.addPage(page([object("b.jpg")]));
  });
});

void test("missing folders come with their missing ancestors, parents first", () => {
  const folders = missingFolders(
    ["a/b/c", "a/x", "", "top"],
    new Map([["a", 1]]),
  );

  assert.deepEqual(folders, [
    { path: "", name: "Root", parentPath: null },
    { path: "top", name: "top", parentPath: null },
    { path: "a/b", name: "b", parentPath: "a" },
    { path: "a/x", name: "x", parentPath: "a" },
    { path: "a/b/c", name: "c", parentPath: "a/b" },
  ]);
});

void test("known folders are not created again", () => {
  assert.deepEqual(
    missingFolders(
      ["a/b", ""],
      new Map([
        ["a", 1],
        ["a/b", 2],
        ["", 3],
      ]),
    ),
    [],
  );
});

void test("a known file with another ETag is changed, once the stored one is known", () => {
  const listed = [
    page([object("same.jpg"), object("other.jpg"), object("unread.jpg")]),
  ];
  const diff = diffBucket(
    known([
      ["same.jpg", { id: 1, size: 100, modifiedAt: MAY, etag: "e" }],
      ["other.jpg", { id: 2, size: 100, modifiedAt: MAY, etag: "f" }],
      ["unread.jpg", { id: 3, size: 100, modifiedAt: MAY }],
    ]),
    listed,
  );
  assert.deepEqual(
    diff.changed.map((c) => c.id),
    [2],
  );
});
