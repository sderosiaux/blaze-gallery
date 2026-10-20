/**
 * The filter arguments the MCP photo tools share, read as the app reads its
 * URL: out of route.ts, whose exports Next.js restricts, so they can be
 * tested.
 */
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { CONTENT_LIMIT } from "@/lib/database";
import {
  resolveFilter,
  type ContentStatus,
  type ResolvedFilter,
} from "@/lib/filterResolver";
import {
  EXPRESSIONS,
  isExpression,
  MAX_VALUES,
  NO_URL_FILTER,
  type FaceCondition,
  type TagCondition,
} from "@/lib/photoFilter";
import type { DateFilter } from "@/lib/semanticQuery";
import {
  COLOR_TONES,
  HUES,
  isColorTone,
  isHue,
  type ColorFilter,
} from "@/lib/colors";
import type { JsonObject } from "@/app/api/_lib/request";
import { isJsonObject } from "@/app/api/_lib/request";
import { PeopleError } from "@/lib/people";
import { resolvePerson } from "@/lib/peopleMcp";

/** A tool argument error: reported to the client as a JSON-RPC error with its own code and HTTP status. */
export class McpToolError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export type ToolArgs = JsonObject;

/** At most MAX_VALUES values in an array argument, as in the app's URL. */
function requireFew(name: string, values: unknown[]): void {
  if (values.length > MAX_VALUES)
    throw new McpToolError(
      ErrorCode.InvalidParams,
      `${name} takes at most ${String(MAX_VALUES)} values`,
    );
}

/** `color` and `tone`, each optional; a wrong value is an error. */
export function parseColors(args: ToolArgs): ColorFilter {
  const optional = <T>(
    value: unknown,
    is: (v: unknown) => v is T,
    message: string,
  ): T | null => {
    if (value === undefined || value === null) return null;
    if (!is(value)) throw new McpToolError(ErrorCode.InvalidRequest, message);
    return value;
  };
  return {
    color: optional(
      args.color,
      isHue,
      `color must be one of ${HUES.join(", ")}`,
    ),
    tone: optional(
      args.tone,
      isColorTone,
      `tone must be one of ${COLOR_TONES.join(", ")}`,
    ),
  };
}

/** `people` (or `name`): person_ids or exact names, each resolved; absent is nobody. */
async function parsePeople(
  args: ToolArgs,
  name: "people" | "without_people" = "people",
): Promise<number[]> {
  const people = args[name];
  if (people === undefined || people === null) return [];
  if (
    !Array.isArray(people) ||
    !people.every(
      (ref) =>
        (typeof ref === "string" && ref.trim() !== "") ||
        (typeof ref === "number" && Number.isSafeInteger(ref)),
    )
  ) {
    throw new McpToolError(
      ErrorCode.InvalidParams,
      `${name} must be an array of person_ids (numbers) or exact names (strings)`,
    );
  }
  requireFew(name, people);
  const refs = people as (string | number)[];
  const rows = await peopleCall(() => Promise.all(refs.map(resolvePerson)));
  return [...new Set(rows.map((person) => person.id))];
}

/**
 * `expressions`: looks of a face, each a string (anyone's face) or
 * { person, expression } (that person's face); people resolved as in
 * parsePeople.
 */
export async function parseExpressions(
  args: ToolArgs,
): Promise<FaceCondition[]> {
  const value = args.expressions;
  if (value === undefined || value === null) return [];
  const fail = () =>
    new McpToolError(
      ErrorCode.InvalidParams,
      `expressions must be an array of ${EXPRESSIONS.join(", ")}, or of { person, expression }`,
    );
  if (!Array.isArray(value)) throw fail();
  requireFew("expressions", value);
  return Promise.all(
    value.map(async (item: unknown): Promise<FaceCondition> => {
      if (isExpression(item)) return { person: null, expression: item };
      if (!isJsonObject(item) || !isExpression(item.expression)) throw fail();
      const ref = item.person;
      if (ref === undefined || ref === null)
        return { person: null, expression: item.expression };
      if (
        !(typeof ref === "string" && ref.trim() !== "") &&
        !(typeof ref === "number" && Number.isSafeInteger(ref))
      )
        throw fail();
      const person = await peopleCall(() => resolvePerson(ref));
      return { person: person.id, expression: item.expression };
    }),
  );
}

/** `tags` and `without_tags`: tag names of db/tags.json, a tag in one of them only. */
export function parseTags(args: ToolArgs): TagCondition[] {
  const read = (name: "tags" | "without_tags", negated: boolean) => {
    const value = args[name];
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || !value.every((t) => typeof t === "string"))
      throw new McpToolError(
        ErrorCode.InvalidParams,
        `${name} must be an array of tag names`,
      );
    requireFew(name, value);
    return value.map((tag) => ({ tag, negated }));
  };
  const shown = read("tags", false);
  const without = read("without_tags", true);
  const both = shown.find(({ tag }) => without.some((t) => t.tag === tag));
  if (both)
    throw new McpToolError(
      ErrorCode.InvalidParams,
      `${both.tag} is in both tags and without_tags`,
    );
  return [...shown, ...without];
}

/**
 * The filter arguments the photo tools share (FILTER_PROPERTIES), read the
 * way the app reads its URL (lib/filterResolver.ts), plus the tool's own
 * dates. A tag no photo has yet reads as words (`content`), reported in
 * `untagged`.
 */
export async function filterArgs(
  args: ToolArgs,
  dates: DateFilter[],
  /** The person a tool lists the photos of: on them, and not "somebody else" */
  person: number | null = null,
): Promise<ResolvedFilter> {
  const only = args.only;
  if (only !== undefined && only !== null && typeof only !== "boolean")
    throw new McpToolError(ErrorCode.InvalidParams, "only must be a boolean");
  const folder = args.folder;
  if (folder !== undefined && folder !== null && typeof folder !== "string")
    throw new McpToolError(
      ErrorCode.InvalidParams,
      "folder must be a folder path",
    );
  const tags = parseTags(args);
  const colors = parseColors(args);
  const [people, withoutPeople, faces] = await Promise.all([
    parsePeople(args),
    parsePeople(args, "without_people"),
    parseExpressions(args),
  ]);
  const resolved = await resolveFilter(
    {
      ...NO_URL_FILTER,
      people,
      withoutPeople,
      faces,
      tags,
      only: only === true,
      colors,
    },
    {
      folder: folder ?? undefined,
      dates,
      people: person === null ? [] : [person],
    },
  );
  if (!resolved.ok)
    throw new McpToolError(ErrorCode.InvalidParams, resolved.error);
  return resolved.value;
}

/** What a tool answers about its filter, as the app's lists do (src/app/api/_lib/filter.ts). */
export function filterNotesOf(
  read: ResolvedFilter,
  content: { content: ContentStatus | null; complete: boolean },
) {
  return {
    untagged: read.untagged,
    ...(content.content ? { content: content.content } : {}),
    ...(content.complete ? {} : { content_limited: CONTENT_LIMIT }),
    ...(read.taggedShare === null ? {} : { tagged_share: read.taggedShare }),
  };
}

/** People errors carry an HTTP status: 404 for an unknown person or photo. */
export async function peopleCall<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof PeopleError) {
      throw new McpToolError(
        error.status === 404
          ? ErrorCode.InvalidRequest
          : ErrorCode.InvalidParams,
        error.message,
        error.status,
      );
    }
    throw error;
  }
}
