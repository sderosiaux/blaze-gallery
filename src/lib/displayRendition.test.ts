import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const FIXTURE = path.join("worker", "tests", "fixtures", "display_keys");

void test("the worker's display rendition keys are still the ones the app reads", () => {
  // The worker stores HEIC renditions at these keys (worker/tests/test_display.py
  // pins it to the file): a change to storageKey regenerates the file, then
  // the worker follows. Each configuration runs in its own process.
  const live = execFileSync(
    path.join("node_modules", ".bin", "tsx"),
    [`${FIXTURE}.ts`, "--print"],
    { encoding: "utf8", env: { PATH: process.env.PATH, NODE_ENV: "test" } },
  );
  assert.deepEqual(
    JSON.parse(live),
    JSON.parse(fs.readFileSync(`${FIXTURE}.json`, "utf8")),
    `regenerate with: npx tsx ${FIXTURE}.ts`,
  );
});
