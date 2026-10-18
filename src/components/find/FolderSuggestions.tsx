"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import ProgressiveImage from "@/components/photos/ProgressiveImage";
import { albumHref } from "@/components/photos/AlbumCard";
import { asArray, isRecord, readJsonObject } from "@/hooks/apiJson";
import { formatCount } from "@/lib/albums";
import { cn } from "@/lib/cn";
import { previewUrl, thumbnailUrl } from "@/lib/photoUrls";
import { normalizeTextForSearch } from "@/lib/textUtils";

export interface FolderSuggestion {
  name: string;
  path: string;
  coverId: string | null;
}

const MIN_LENGTH = 2;
const DEBOUNCE_MS = 200;
/** Typed prefixes kept for Backspace; beyond this the oldest go. */
const CACHE_SIZE = 50;

function readSuggestions(value: unknown): FolderSuggestion[] {
  return asArray(value).flatMap((item) => {
    if (!isRecord(item)) return [];
    const { name, path, cover_photo_id: cover } = item;
    if (typeof name !== "string" || typeof path !== "string") return [];
    const coverId =
      typeof cover === "number" || typeof cover === "string"
        ? String(cover)
        : null;
    return [{ name, path, coverId }];
  });
}

/**
 * Folders to suggest for what the user typed: nothing under two characters,
 * otherwise the answer for the latest text, fetched 200 ms after the last
 * keystroke. A newer keystroke aborts the request in flight, so an older
 * answer can never replace a newer one; until the new one lands the
 * previous list stays, which avoids flicker while typing.
 */
export function useFolderSuggestions(term: string): FolderSuggestion[] {
  const [folders, setFolders] = useState<FolderSuggestion[]>([]);
  const cache = useRef(new Map<string, FolderSuggestion[]>());

  useEffect(() => {
    const key = normalizeTextForSearch(term);
    if (key.length < MIN_LENGTH) {
      setFolders([]);
      return;
    }
    const cached = cache.current.get(key);
    if (cached) {
      setFolders(cached);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/search/suggest?q=${encodeURIComponent(term)}`, {
        signal: controller.signal,
      })
        .then(readJsonObject)
        .then((data) => {
          if (controller.signal.aborted || !data.success) return;
          const found = readSuggestions(data.folders);
          const known = cache.current;
          known.set(key, found);
          const oldest = known.keys().next();
          if (known.size > CACHE_SIZE && !oldest.done)
            known.delete(oldest.value);
          setFolders(found);
        })
        // Aborted by a newer keystroke, or offline: the full search still works.
        .catch(() => undefined);
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [term]);

  return folders;
}

export function suggestionOptionId(listId: string, index: number) {
  return `${listId}-option-${index}`;
}

/** Where the folder sits: its parents as in the bucket, the last two when deep. */
function parentLabel(path: string) {
  const ancestors = path.split("/").slice(0, -1);
  return (
    ancestors.length > 2 ? ["…", ...ancestors.slice(-2)] : ancestors
  ).join(" / ");
}

interface FolderSuggestionListProps {
  id: string;
  folders: FolderSuggestion[];
  open: boolean;
  /** Highlighted option, -1 for none. */
  active: number;
  onActiveChange: (index: number) => void;
  onPick: () => void;
  /** In the flow under the field (the search palette) rather than floating under it. */
  inline?: boolean;
}

/**
 * The listbox of the search combobox. Focus never leaves the field: options
 * are reached with aria-activedescendant, and a click on one is a plain link.
 */
export function FolderSuggestionList({
  id,
  folders,
  open,
  active,
  onActiveChange,
  onPick,
  inline = false,
}: FolderSuggestionListProps) {
  const expanded = open && folders.length > 0;

  useEffect(() => {
    if (!expanded || active < 0) return;
    document
      .getElementById(suggestionOptionId(id, active))
      ?.scrollIntoView({ block: "nearest" });
  }, [expanded, active, id]);

  return (
    <>
      <div
        id={id}
        role="listbox"
        aria-label="Dossiers"
        hidden={!expanded}
        className={cn(
          "overflow-y-auto bg-surface p-1.5",
          inline
            ? "max-h-[min(60vh,28rem)] border-t border-line"
            : "absolute inset-x-4 top-full z-overlay mt-1 max-h-[min(70vh,30rem)] animate-fade-in rounded-lg border border-line shadow-pop sm:inset-x-0 sm:mt-2",
        )}
      >
        {expanded &&
          folders.map((folder, i) => {
            const parent = parentLabel(folder.path);
            return (
              <Link
                key={folder.path}
                id={suggestionOptionId(id, i)}
                role="option"
                aria-selected={i === active}
                tabIndex={-1}
                href={albumHref(folder.path)}
                // Keeps the focus (and the combobox) in the search field.
                onMouseDown={(e) => {
                  e.preventDefault();
                }}
                onMouseMove={() => {
                  if (i !== active) onActiveChange(i);
                }}
                onClick={onPick}
                className={cn(
                  "flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors duration-150",
                  i === active ? "bg-surface-sunken" : "bg-surface",
                )}
              >
                <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded bg-surface-sunken">
                  {folder.coverId ? (
                    <ProgressiveImage
                      previewSrc={previewUrl(folder.coverId)}
                      thumbSrc={thumbnailUrl(folder.coverId)}
                      displayWidth={40}
                      order={i}
                      alt=""
                      eager
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-ink-faint"
                    >
                      {folder.name.charAt(0)}
                    </span>
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">
                    {folder.name}
                  </span>
                  {parent && (
                    <span className="block truncate text-xs text-ink-muted">
                      {parent}
                    </span>
                  )}
                </span>
              </Link>
            );
          })}
      </div>
      <div aria-live="polite" className="sr-only">
        {expanded ? formatCount(folders.length, "dossier") : ""}
      </div>
    </>
  );
}
