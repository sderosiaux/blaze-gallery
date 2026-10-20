import assert from "node:assert/strict";
import { test } from "node:test";
import { NO_URL_FILTER } from "@/lib/photoFilter";
import { pageUrl, searchListSource } from "./useSearchFeed";

void test("a later page repeats every value of a key the URL repeats", () => {
  const source = searchListSource(
    { ...NO_URL_FILTER, q: "plage", people: [4], withoutPeople: [7] },
    "photos",
  );
  const params = new URL(pageUrl(source, "c2"), "http://x").searchParams;
  assert.deepEqual(params.getAll("p"), ["4", "-7"]);
  assert.equal(params.get("q"), "plage");
  assert.equal(params.get("photos_after"), "c2");
  // The next page's cursor replaces the one before, the filter stays
  const again = new URL(pageUrl({ ...source, params }, "c3"), "http://x")
    .searchParams;
  assert.deepEqual(again.getAll("photos_after"), ["c3"]);
  assert.deepEqual(again.getAll("p"), ["4", "-7"]);
});
