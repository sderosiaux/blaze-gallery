import {
  cachedQueryEmbedding,
  cacheQueryEmbedding,
  countPhotoEmbeddings,
  searchPhotosByContent,
  type PhotoFilter,
  type QueryEmbedding,
  type ScoredPhoto,
} from "./database";
import {
  embedderConfig,
  requestTextEmbedding,
  vectorLiteral,
  type EmbedderConfig,
} from "./embedderClient";
import { logger } from "./logger";
import { normalizeSemanticQuery } from "./semanticQuery";

/**
 * ok: ranked photos (maybe none above the floor). unavailable: the query
 * could not be embedded (no embedder configured, embedder unreachable or
 * too slow, or nothing to embed); the
 * text search still answers. not_indexed: no photo is embedded yet.
 */
export type SemanticStatus = "ok" | "unavailable" | "not_indexed";

export interface SemanticResults {
  status: SemanticStatus;
  photos: ScoredPhoto[];
  /** Offset of the next page; null on the last one */
  next: number | null;
  /** Photos embedded so far; null when not counted (later pages) */
  indexed: number | null;
}

/**
 * Photos showing what `q` describes, among those passing `filter`. Never
 * throws: a search keeps its text results whatever happens here, so
 * failures read as "unavailable".
 */
export async function semanticSearch(
  q: string,
  options: {
    filter: PhotoFilter;
    /** Keep only the photos close enough to `q` (searchPhotosByContent) */
    cut: boolean;
    offset: number;
    limit: number;
    /** Count photo_embeddings (first page); later pages skip it */
    count: boolean;
  },
): Promise<SemanticResults> {
  let indexed: number | null = null;
  const unavailable = (): SemanticResults => ({
    status: "unavailable",
    photos: [],
    next: null,
    indexed,
  });
  try {
    const text = normalizeSemanticQuery(q);
    // The count and the embedding, each a round trip, go together
    const [count, embedding] = await Promise.all([
      options.count ? countPhotoEmbeddings() : null,
      text === null ? null : embedQuery(embedderConfig(), text),
    ]);
    indexed = count;
    if (indexed === 0)
      return { status: "not_indexed", photos: [], next: null, indexed };
    if (!embedding) return unavailable();
    const page = await searchPhotosByContent(
      embedding,
      options.filter,
      options.offset,
      options.limit,
      options.cut,
    );
    return { status: "ok", photos: page.items, next: page.next, indexed };
  } catch (error) {
    logger.error(
      "Semantic search failed",
      { query: q },
      error instanceof Error ? error : new Error(String(error)),
    );
    return unavailable();
  }
}

/**
 * The embedding of what the photos should show, for the lists that keep
 * the photos close enough to it (lib/filterResolver.ts). Null when it
 * could not be had: nothing to embed, no embedder, no answer in time.
 * Never throws, like semanticSearch.
 */
export async function embedContent(q: string): Promise<QueryEmbedding | null> {
  const text = normalizeSemanticQuery(q);
  if (text === null) return null;
  try {
    return await embedQuery(embedderConfig(), text);
  } catch (error) {
    logger.error(
      "Embedding the content failed",
      { query: text },
      error instanceof Error ? error : new Error(String(error)),
    );
    return null;
  }
}

/**
 * A normalized query's embedding: stored when asked before, else asked of
 * the embedder (EMBEDDER_LIMITS) and stored. Null when it was never asked
 * and no embedder is configured (a stored one needs none), or when the
 * embedder did not answer in time.
 */
async function embedQuery(
  config: EmbedderConfig | null,
  text: string,
): Promise<QueryEmbedding | null> {
  const cached = await cachedQueryEmbedding(text);
  if (cached) return cached;
  if (config === null) return null;
  const answer = await requestTextEmbedding(config, text);
  if (!answer) {
    logger.warn("Semantic search: the embedder did not answer", {
      query: text,
    });
    return null;
  }
  const embedding = {
    embedding: vectorLiteral(answer.embedding),
    model: answer.model,
  };
  await cacheQueryEmbedding(text, embedding);
  return embedding;
}
