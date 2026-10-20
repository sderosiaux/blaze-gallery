import assert from "node:assert/strict";
import { test } from "node:test";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { MAX_VALUES } from "@/lib/photoFilter";
import {
  filterArgs,
  McpToolError,
  parseExpressions,
  parseTags,
} from "./filterArgs";

/** An InvalidParams tool error whose message matches */
const invalid = (message: RegExp) => (error: unknown) =>
  error instanceof McpToolError &&
  error.code === Number(ErrorCode.InvalidParams) &&
  message.test(error.message);

/** One value more than an array argument takes */
const tooMany = <T>(value: T): T[] =>
  Array.from({ length: MAX_VALUES + 1 }, () => value);

void test("tags and without_tags: a tag in one of them only, a few each", () => {
  assert.deepEqual(parseTags({ tags: ["plage"], without_tags: ["ville"] }), [
    { tag: "plage", negated: false },
    { tag: "ville", negated: true },
  ]);
  assert.deepEqual(parseTags({}), []);
  assert.throws(
    () => parseTags({ tags: ["chat"], without_tags: ["chat"] }),
    invalid(/chat is in both tags and without_tags/),
  );
  assert.throws(
    () => parseTags({ without_tags: tooMany("ville") }),
    invalid(/without_tags takes at most 12 values/),
  );
  assert.throws(
    () => parseTags({ tags: "plage" }),
    invalid(/tags must be an array/),
  );
});

void test("expressions: anyone's look as a string or without a person; the looks not offered are refused", async () => {
  assert.deepEqual(
    await parseExpressions({
      expressions: ["sourit", { expression: "triste" }],
    }),
    [
      { person: null, expression: "sourit" },
      { person: null, expression: "triste" },
    ],
  );
  await assert.rejects(
    parseExpressions({ expressions: ["colere"] }),
    invalid(/expressions must be an array of sourit, rit, triste, yeux_fermes/),
  );
  await assert.rejects(
    parseExpressions({ expressions: tooMany("rit") }),
    invalid(/expressions takes at most 12 values/),
  );
});

void test("the filter arguments are refused before a person is looked up", async () => {
  await assert.rejects(
    filterArgs({ only: "yes" }, []),
    invalid(/only must be a boolean/),
  );
  await assert.rejects(
    filterArgs({ people: [1], tags: ["chat"], without_tags: ["chat"] }, []),
    invalid(/chat is in both/),
  );
  await assert.rejects(
    filterArgs({ people: tooMany(1) }, []),
    invalid(/people takes at most 12 values/),
  );
  await assert.rejects(
    filterArgs({ without_people: tooMany("Suzie") }, []),
    invalid(/without_people takes at most 12 values/),
  );
});
