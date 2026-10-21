/**
 * « Photos similaires »: the photos whose image embedding (photo_embeddings,
 * SigLIP2 B-16) is close to a photo's, as the filter `like` keeps them
 * (lib/photoFilter.ts) and as Recherche ranks them.
 */

/**
 * Cosine a photo needs to the source to look like it. Measured on the
 * library (2026-10-21): 60 random photos of the gallery, their nearest
 * photos outside their own stack, 20 pairs per band looked at side by side,
 * counting those showing the same place, subject or event:
 *
 *   0.90 to 0.95   20 of 20
 *   0.85 to 0.90   13 of 20, the 7 others the same kind of scene
 *   0.80 to 0.85    7 of 20
 *   0.75 to 0.80    0 of 20, at most the same broad kind (a person outdoors, cats)
 *
 * At 0.85 a photo has a median of 42 alike (90th percentile 649, 7 of the
 * 60 none); at 0.90, 6 (12 of 60 none); at 0.80, 376. The embeddings sit
 * close together: orchard's 0.70 would keep nearly the whole library.
 */
export const SIMILAR_MIN_COSINE = 0.85;

/**
 * Most photos « Ressemble à » keeps, the nearest: as a filter (its ids go
 * to the planner, like a content's) and as Recherche's ranking, page after
 * page.
 */
export const SIMILAR_LIMIT = 1_000;
