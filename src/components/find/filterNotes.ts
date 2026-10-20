/** What a list answered about its filter (src/app/api/_lib/filter.ts filterNotes). */
export interface FilterNotes {
  /** "unavailable": the words could not be applied */
  content: "ok" | "unavailable" | null;
  /** Only the nearest photos of the words are kept: this many */
  contentLimit: number | null;
  /** With tags, the share of the gallery the tagger has read */
  taggedShare: number | null;
}

export const NO_NOTES: FilterNotes = {
  content: null,
  contentLimit: null,
  taggedShare: null,
};

export function readFilterNotes(data: Record<string, unknown>): FilterNotes {
  const { content, content_limited: limit, tagged_share: share } = data;
  return {
    content: content === "ok" || content === "unavailable" ? content : null,
    contentLimit: typeof limit === "number" ? limit : null,
    taggedShare: typeof share === "number" ? share : null,
  };
}
