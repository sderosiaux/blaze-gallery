import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SEMANTIC_QUERY_MAX,
  normalizeSemanticQuery,
  parseDateRange,
  queryNamesPerson,
} from "./semanticQuery";
import { turnBox } from "./rotation";

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

void test("a query names a person by whole words, accents and case aside", () => {
  assert.equal(queryNamesPerson("Suzie", "Suzie"), true);
  assert.equal(queryNamesPerson("suzie à la plage", "Suzie"), true);
  assert.equal(queryNamesPerson("lea", "Léa Martin"), true);
  assert.equal(queryNamesPerson("léa martin", "Léa Martin"), true);
  assert.equal(queryNamesPerson("chat", "Chatelain"), false);
  assert.equal(queryNamesPerson("suz", "Suzie"), false);
  assert.equal(queryNamesPerson("martin léa", "Léa Martin"), false);
  assert.equal(queryNamesPerson("  ", "Suzie"), false);
});

void test("a face box follows the owner's quarter turns", () => {
  const box = [0.1, 0.2, 0.3, 0.4] as const;
  const close = (actual: readonly number[], expected: number[]) => {
    assert.deepEqual(
      actual.map((v) => Math.round(v * 1000) / 1000),
      expected,
    );
  };
  close(turnBox(box, 0), [0.1, 0.2, 0.3, 0.4]);
  close(turnBox(box, 90), [0.4, 0.1, 0.4, 0.3]);
  close(turnBox(box, 180), [0.6, 0.4, 0.3, 0.4]);
  close(turnBox(box, 270), [0.2, 0.6, 0.4, 0.3]);
});
