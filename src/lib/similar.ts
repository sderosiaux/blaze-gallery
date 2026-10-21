/**
 * « Photos similaires »: the photos whose image embedding (photo_embeddings,
 * SigLIP2 B-16) is close to a photo's, as the filter `like` keeps them
 * (lib/photoFilter.ts) and as Recherche ranks them.
 */

/** Cosine a photo needs to the source to look like it. */
export const SIMILAR_MIN_COSINE = 0.8; // measured: set by the parent

/**
 * Most photos « Ressemble à » keeps, the nearest: as a filter (its ids go
 * to the planner, like a content's) and as Recherche's ranking, page after
 * page.
 */
export const SIMILAR_LIMIT = 1_000;
