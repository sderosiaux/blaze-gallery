import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { sceneTagVocabulary, taggedTags } from "@/lib/filterResolver";
import { logger } from "@/lib/logger";
import { listPersonChoices } from "@/lib/people";
import { EXPRESSION_LABELS, EXPRESSIONS } from "@/lib/photoFilter";

export const dynamic = "force-dynamic";

/**
 * What the filters can say, for the filter menus and the search box (which
 * reads queries the way the server does, lib/searchQuery.ts): the named
 * people (`people`), the looks (`expressions`) and the scene tags of
 * db/tags.json (`tags`; `tagged`: some photo has it, the others read as
 * words for now).
 */
export const GET = requireAuth(async function GET() {
  try {
    const [people, tagged] = await Promise.all([
      listPersonChoices(),
      taggedTags(),
    ]);
    return NextResponse.json(
      {
        success: true,
        people,
        expressions: EXPRESSIONS.map((key) => ({
          key,
          label: EXPRESSION_LABELS[key],
        })),
        tags: sceneTagVocabulary().tags.map(({ tag, label, group, words }) => ({
          tag,
          label,
          group,
          words,
          tagged: tagged.has(tag),
        })),
      },
      // A name given or a tagging pass shows within a minute
      { headers: { "Cache-Control": "private, max-age=60" } },
    );
  } catch (error) {
    logger.apiError("Error in GET /api/filters/vocabulary", error as Error, {
      method: "GET",
      path: "/api/filters/vocabulary",
    });
    return NextResponse.json(
      { success: false, error: "vocabulary_failed" },
      { status: 500 },
    );
  }
});
