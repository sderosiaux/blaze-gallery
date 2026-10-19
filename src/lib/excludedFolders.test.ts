import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeFolderPath } from "./excludedFolders";

// Which keys a marked path covers is SQL (excluded_folders.key_like):
// worker/tests/test_gallery.py runs it on Postgres.

void test("a path loses the slashes at its ends, as folders.path has none", () => {
  assert.equal(normalizeFolderPath("music/"), "music");
  assert.equal(normalizeFolderPath("/music"), "music");
  assert.equal(normalizeFolderPath("//books/coursera//"), "books/coursera");
});

void test("a nested path keeps its inner slashes and its name as typed", () => {
  assert.equal(
    normalizeFolderPath("stepmania/Anime Songs"),
    "stepmania/Anime Songs",
  );
  assert.equal(normalizeFolderPath("music/#SOIREE "), "music/#SOIREE ");
});

void test("the root cannot be marked", () => {
  assert.equal(normalizeFolderPath(""), null);
  assert.equal(normalizeFolderPath("/"), null);
  assert.equal(normalizeFolderPath("///"), null);
});
