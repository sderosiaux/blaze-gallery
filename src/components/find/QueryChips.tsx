"use client";

import { X } from "lucide-react";
import type { ColorTone, Hue } from "@/lib/colors";
import type { Span } from "@/lib/searchQuery";
import { cn } from "@/lib/cn";
import { HUE_SWATCH } from "./ColorFilterBar";

/** A part of the query as /api/search understood it (`understood.parts`). */
export interface UnderstoodPart {
  kind: "person" | "date" | "color" | "tone";
  label: string;
  spans: Span[];
  person_id?: number;
  color?: Hue;
  tone?: ColorTone;
}

/**
 * How the query was read: a chip per person, date, color or tone, each
 * removable, then the words searched in the photos' content, if any.
 */
export function QueryChips({
  parts,
  text,
  onRemove,
  className,
}: {
  parts: UnderstoodPart[];
  /** The words left for the content, as typed */
  text: string | null;
  onRemove: (part: UnderstoodPart) => void;
  className?: string;
}) {
  if (parts.length === 0) return null;
  return (
    <ul
      aria-label="Recherche comprise"
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      {parts.map((part) => (
        <li key={`${part.kind}-${String(part.spans[0]?.[0] ?? 0)}`}>
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-surface-sunken pl-2.5 pr-1 text-[13px] font-medium text-ink">
            {part.color && (
              <span
                aria-hidden
                className={cn(
                  "h-2.5 w-2.5 rounded-full ring-1 ring-inset ring-ink/15",
                  HUE_SWATCH[part.color],
                )}
              />
            )}
            {part.label}
            <button
              type="button"
              aria-label={`Retirer «\u00a0${part.label}\u00a0»`}
              title={`Retirer «\u00a0${part.label}\u00a0»`}
              onClick={() => {
                onRemove(part);
              }}
              className="touch-target inline-flex h-5 w-5 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-line hover:text-ink"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </span>
        </li>
      ))}
      {text && (
        <li>
          <span className="inline-flex h-7 items-center rounded-full border border-line px-2.5 text-[13px] font-medium text-ink-soft">
            {`«\u00a0${text}\u00a0»`}
          </span>
        </li>
      )}
    </ul>
  );
}
