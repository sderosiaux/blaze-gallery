/**
 * Text utilities for search and normalization
 */

/**
 * Normalizes text by removing accents and converting to lowercase
 * This allows for accent-insensitive searches
 * 
 * Examples:
 * - "café" → "cafe"
 * - "naïve" → "naive"  
 * - "résumé" → "resume"
 * - "Björk" → "bjork"
 */
export function normalizeTextForSearch(text: string): string {
  return text
    .normalize('NFD') // Decompose accented characters
    .replace(/[\u0300-\u036f]/g, '') // Remove accent marks
    .toLowerCase()
    .trim();
}

/**
 * Creates a search-friendly version of text for database queries
 */
export function createSearchTerm(query: string): string {
  const normalized = normalizeTextForSearch(query);
  return `%${normalized}%`;
}

/**
 * Checks if a text contains a search query (accent-insensitive)
 */
export function textContains(text: string, searchQuery: string): boolean {
  const normalizedText = normalizeTextForSearch(text);
  const normalizedQuery = normalizeTextForSearch(searchQuery);
  return normalizedText.includes(normalizedQuery);
}