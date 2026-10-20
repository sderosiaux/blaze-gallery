import { formatNumber } from "@/lib/albums";
import type { FilterNotes } from "./filterNotes";

/** Below this share of the gallery read by the tagger, a scene says so. */
const PARTLY_TAGGED = 0.95;

/**
 * What the photos shown leave out, when they do: the words could not be
 * applied (no embedder answer), only the nearest photos of the words, the
 * tagger still reading the gallery.
 */
export function FilterNotice({ notes }: { notes: FilterNotes }) {
  const lines = [
    notes.content === "unavailable"
      ? "La recherche par le contenu ne répond pas : les mots ne sont pas appliqués."
      : null,
    notes.content === "ok" && notes.contentLimit !== null
      ? `Les ${formatNumber(notes.contentLimit)} photos les plus proches des mots.`
      : null,
    notes.taggedShare !== null && notes.taggedShare < PARTLY_TAGGED
      ? `Scènes reconnues sur ${String(Math.floor(notes.taggedShare * 100))} % des photos pour l’instant.`
      : null,
  ].filter((line): line is string => line !== null);
  if (lines.length === 0) return null;
  return (
    <div role="status" className="-mt-3 mb-5 space-y-1 text-sm text-ink-muted">
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}
