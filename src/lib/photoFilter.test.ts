import assert from "node:assert/strict";
import { test } from "node:test";
import {
  filterSearch,
  NO_URL_FILTER,
  parseUrlFilter,
  readUrlFilter,
  setLikeParam,
  writeUrlFilter,
  type UrlFilter,
} from "./photoFilter";

const parse = (query: string) => {
  const params = new URLSearchParams(query);
  return parseUrlFilter(
    (key) => params.get(key),
    (key) => params.getAll(key),
  );
};

void test("every condition of the URL, and back", () => {
  const read = parse(
    "q=au+jardin&p=4.sourit&p=5&expr=triste&tag=plage&tag=-vehicule&only=1&color=blue&tone=sombre&date=%C3%A9t%C3%A9+2015&like=321",
  );
  assert.ok(read.ok);
  const filter: UrlFilter = {
    q: "au jardin",
    people: [5],
    withoutPeople: [],
    faces: [
      { person: 4, expression: "sourit" },
      { person: null, expression: "triste" },
    ],
    tags: [
      { tag: "plage", negated: false },
      { tag: "vehicule", negated: true },
    ],
    only: true,
    colors: { color: "blue", tone: "sombre" },
    dates: ["été 2015"],
    like: 321,
  };
  assert.deepEqual(read.value, filter);
  // Equal filters, equal URLs, whatever the order they came in
  const again = parse(writeUrlFilter(new URLSearchParams(), filter).toString());
  assert.ok(again.ok);
  assert.deepEqual(again.value, filter);
});

void test("the view's own parameters stay, the filter's are replaced", () => {
  const params = new URLSearchParams("photo=12&year=2015&p=4&color=red");
  writeUrlFilter(params, { ...NO_URL_FILTER, people: [5] });
  assert.equal(params.toString(), "photo=12&year=2015&p=5");
  assert.equal(filterSearch(NO_URL_FILTER), "");
});

void test("a wrong value is an error for the API", () => {
  for (const query of [
    "p=abc",
    "p=0",
    "p=4.joie",
    "expr=joie",
    "tag=Plage",
    "tag=a b",
    "only=yes",
    "color=fuchsia",
    `q=${"x".repeat(501)}`,
    "date=" + "2".repeat(61),
    "like=abc",
    "like=0",
    "like=-4",
  ])
    assert.equal(parse(query).ok, false, query);
});

void test("a page drops what does not read and keeps the rest", () => {
  const filter = readUrlFilter(
    new URLSearchParams("p=abc&p=4&expr=joie&expr=rit&color=fuchsia&tone=nb"),
  );
  assert.deepEqual(filter.people, [4]);
  assert.deepEqual(filter.faces, [{ person: null, expression: "rit" }]);
  assert.deepEqual(filter.colors, { color: null, tone: "nb" });
});

void test("« Ressemble à »: a page drops a wrong photo id, setLikeParam sets and clears it", () => {
  assert.equal(readUrlFilter(new URLSearchParams("like=x&p=4")).like, null);
  assert.equal(readUrlFilter(new URLSearchParams("like=12&p=4")).like, 12);
  const params = new URLSearchParams("year=2015&p=4");
  assert.equal(setLikeParam(params, 12).toString(), "year=2015&p=4&like=12");
  assert.equal(
    setLikeParam(new URLSearchParams("p=4&like=12"), null).toString(),
    "p=4",
  );
  // The params given stay as they were
  assert.equal(params.toString(), "year=2015&p=4");
});

void test("the same person or tag twice is one condition", () => {
  const read = parse("p=4&p=4&p=4.sourit&p=4.sourit&tag=plage&tag=-plage");
  assert.ok(read.ok);
  assert.deepEqual(read.value.people, [4]);
  assert.deepEqual(read.value.faces, [{ person: 4, expression: "sourit" }]);
  assert.deepEqual(read.value.tags, [{ tag: "plage", negated: false }]);
});
