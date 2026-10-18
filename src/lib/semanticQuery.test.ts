import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SEMANTIC_QUERY_MAX,
  normalizeSemanticQuery,
  parseDateRange,
  periodFilter,
} from "./semanticQuery";

void test("a query is keyed lower case, spaces collapsed, accents kept", () => {
  assert.equal(
    normalizeSemanticQuery("  Un  Gâteau d'Anniversaire \n"),
    "un gâteau d'anniversaire",
  );
  // "é" typed as e + combining accent and as one code point share a key
  assert.equal(normalizeSemanticQuery("cafe\u0301"), "caf\u00e9");
});

void test("nothing to embed: blank or too long", () => {
  assert.equal(normalizeSemanticQuery("   "), null);
  assert.equal(
    normalizeSemanticQuery("a".repeat(SEMANTIC_QUERY_MAX)),
    "a".repeat(SEMANTIC_QUERY_MAX),
  );
  assert.equal(
    normalizeSemanticQuery("a".repeat(SEMANTIC_QUERY_MAX + 1)),
    null,
  );
});

void test("date bounds: a year, a month or a day, both ends included", () => {
  assert.deepEqual(parseDateRange("2019", "2019"), {
    ok: true,
    value: { from: "2019-01-01", before: "2020-01-01" },
  });
  assert.deepEqual(parseDateRange("2020-02", undefined), {
    ok: true,
    value: { from: "2020-02-01", before: null },
  });
  assert.deepEqual(parseDateRange(undefined, "2020-02"), {
    ok: true,
    value: { from: null, before: "2020-03-01" },
  });
  assert.deepEqual(parseDateRange("2021-12-31", "2021-12-31"), {
    ok: true,
    value: { from: "2021-12-31", before: "2022-01-01" },
  });
  assert.deepEqual(parseDateRange(undefined, undefined), {
    ok: true,
    value: { from: null, before: null },
  });
});

void test("date bounds that are not dates, or the wrong way round, are refused", () => {
  assert.equal(parseDateRange("2021-02-29", undefined).ok, false);
  assert.equal(parseDateRange("hier", undefined).ok, false);
  assert.equal(parseDateRange(undefined, "2019/07").ok, false);
  assert.equal(parseDateRange("2020", "2019-12").ok, false);
});

void test("the map's period of months or days becomes one range", () => {
  assert.deepEqual(periodFilter({ from: "2019-07", to: "2019-08" }), {
    ranges: [{ from: "2019-07-01", before: "2019-09-01" }],
    annual: [],
  });
  assert.deepEqual(periodFilter({ from: null, to: "2020-02-29" }), {
    ranges: [{ from: null, before: "2020-03-01" }],
    annual: [],
  });
  assert.deepEqual(periodFilter({ from: null, to: null }), {
    ranges: [],
    annual: [],
  });
});
