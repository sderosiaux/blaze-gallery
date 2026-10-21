import assert from "node:assert/strict";
import { test } from "node:test";
import { keepLabel } from "./StackStrip";

void test("« Garder celle-ci » says how many photos go, once the server said", () => {
  assert.equal(keepLabel(null), "Garder celle-ci");
  assert.equal(keepLabel(0), "Garder celle-ci · aucune ne part");
  assert.equal(keepLabel(1), "Garder celle-ci · 1 part");
  assert.equal(keepLabel(5), "Garder celle-ci · 5 partent");
});
