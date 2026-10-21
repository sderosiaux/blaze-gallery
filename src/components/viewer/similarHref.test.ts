import assert from "node:assert/strict";
import { test } from "node:test";
import { similarHref } from "./similarHref";

void test("« Photos similaires » narrows the view it is asked from, or goes to Recherche", () => {
  assert.equal(
    similarHref("/timeline", "?p=4&photo=12&year=2015", 12),
    "/timeline?p=4&year=2015&like=12",
  );
  // Another photo's likeness replaces the first
  assert.equal(
    similarHref("/folder/2020/Voyage", "?like=3&photo=12", 12),
    "/folder/2020/Voyage?like=12",
  );
  assert.equal(similarHref("/personnes/4", "", 7), "/personnes/4?like=7");
  for (const page of ["/admin/corbeille", "/admin/doublons", "/personnes", "/"])
    assert.equal(similarHref(page, "?photo=12", 12), "/search?like=12");
});
