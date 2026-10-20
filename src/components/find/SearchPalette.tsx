"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CornerDownLeft, Search, X } from "lucide-react";
import FaceThumb from "@/components/people/FaceThumb";
import { albumHref } from "@/components/photos/AlbumCard";
import { cn } from "@/lib/cn";
import {
  filterQuery,
  NO_URL_FILTER,
  readUrlFilter,
  writeUrlFilter,
} from "@/lib/photoFilter";
import { HUE_SWATCH } from "./ColorFilterBar";
import { complete, completionsFor, type Completion } from "./completions";
import { filterChips } from "./filterChips";
import { chipIcon, EXPRESSION_ICONS } from "./filterIcons";
import {
  FolderSuggestionList,
  suggestionOptionId,
  useFolderSuggestions,
} from "./FolderSuggestions";
import { useFilterVocabulary } from "./useFilterVocabulary";

/** Views of photos the search box narrows in place, and what Enter says there. */
const PHOTO_VIEWS: { match: (path: string) => boolean; label: string }[] = [
  { match: (p) => p.startsWith("/timeline"), label: "la chronologie" },
  { match: (p) => p.startsWith("/couleurs"), label: "les couleurs" },
  { match: (p) => /^\/personnes\/\d+/.test(p), label: "ses photos" },
  { match: (p) => p.startsWith("/folder/"), label: "ce dossier" },
  { match: (p) => p.startsWith("/carte"), label: "la carte" },
  { match: (p) => p.startsWith("/favorites"), label: "les favoris" },
  // A new search: the words replace the previous ones, the other conditions stay
  { match: (p) => p.startsWith("/search"), label: "" },
];

const KIND_LABELS: Record<Completion["kind"], string> = {
  person: "Personne",
  look: "Expression",
  tag: "Scène",
  color: "Couleur",
  tone: "Ton",
};

/**
 * Search over the page, opened from the sidebar, ⌘K or "/". It takes no room
 * until it's asked for. Typing suggests people, looks, scenes and colors to
 * finish the word, and folders; the chips under the field show how the
 * words read. On a view of photos, Enter narrows that view (the words go
 * into its filter, lib/photoFilter.ts); elsewhere, and with « Chercher
 * partout », it searches every folder and photo. Picking a folder opens it.
 */
export function SearchPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const vocabulary = useFilterVocabulary();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  // What the user typed: suggestions follow it, not the value taken from the URL.
  const [typed, setTyped] = useState("");
  const [active, setActive] = useState(-1);
  const folders = useFolderSuggestions(typed);
  const completions = useMemo(
    () => (typed ? completionsFor(value, vocabulary) : []),
    [typed, value, vocabulary],
  );
  const listId = useId();
  const completionsId = useId();
  const count = completions.length + folders.length;
  const view = PHOTO_VIEWS.find((v) => v.match(pathname));
  const pageFilter = readUrlFilter(new URLSearchParams(search.toString()));
  // Read when the palette opens, not followed while it is open.
  const startRef = useRef("");
  startRef.current = view ? pageFilter.q : "";

  // Opening on a view of photos starts from its words, selected so typing replaces them.
  useEffect(() => {
    if (!open) return;
    setValue(startRef.current);
    setTyped("");
    setActive(-1);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [open]);

  // A new list starts with nothing highlighted: Enter runs the search.
  useEffect(() => {
    setActive(-1);
  }, [completions, folders]);

  const preview = useMemo(
    () => filterChips({ ...NO_URL_FILTER, q: value }, vocabulary),
    [value, vocabulary],
  );

  if (!open || typeof document === "undefined") return null;

  const searchEverywhere = (q: string) => {
    onClose();
    const params = filterQuery({ ...pageFilter, q });
    const query = params.toString();
    router.push(query ? `/search?${query}` : "/search");
  };

  // The words become the view's: its other conditions and its place stay
  const narrowHere = (q: string) => {
    onClose();
    const url = new URL(window.location.href);
    writeUrlFilter(url.searchParams, { ...pageFilter, q });
    url.searchParams.delete("photo");
    window.history.pushState(null, "", url.pathname + url.search + url.hash);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    if (view) narrowHere(q);
    else searchEverywhere(q);
  };

  const accept = (completion: Completion) => {
    const next = complete(value, completion);
    setValue(next);
    setTyped(next);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && count > 0) {
      e.preventDefault();
      const down = e.key === "ArrowDown";
      // -1 is the field itself, between the last option and the first.
      setActive((i) =>
        down
          ? ((i + 2) % (count + 1)) - 1
          : ((i + count + 1) % (count + 1)) - 1,
      );
    } else if (e.key === "Enter") {
      const completion = completions[active];
      if (completion) {
        e.preventDefault();
        accept(completion);
        return;
      }
      const folder = folders[active - completions.length];
      if (!folder) return; // the form submits
      e.preventDefault();
      onClose();
      router.push(albumHref(folder.path));
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Tab") {
      // The field is the only stop; Tab finishes the word with the first suggestion.
      e.preventDefault();
      const first = completions[active] ?? completions[0];
      if (first && !e.shiftKey) accept(first);
    }
  };

  const activeId =
    active < 0
      ? undefined
      : active < completions.length
        ? suggestionOptionId(completionsId, active)
        : suggestionOptionId(listId, active - completions.length);

  return createPortal(
    <div className="fixed inset-0 z-dialog flex justify-center px-4 pt-[12vh]">
      <div
        aria-hidden
        className="absolute inset-0 animate-fade-in bg-scrim/40 backdrop-blur-[2px]"
        onMouseDown={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Rechercher"
        className="relative h-max w-full max-w-xl animate-rise-in overflow-hidden rounded-xl bg-surface shadow-pop"
      >
        <form role="search" onSubmit={submit} className="relative">
          <Search
            className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted"
            aria-hidden
          />
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded={count > 0}
            aria-controls={`${completionsId} ${listId}`}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setTyped(e.target.value);
            }}
            onKeyDown={onKeyDown}
            placeholder="Céline qui sourit, plage en été, dossiers…"
            aria-label="Rechercher des personnes, des scènes, des dossiers et des photos"
            className="h-14 w-full bg-transparent pl-12 pr-14 text-base text-ink placeholder:text-ink-muted focus:outline-none"
          />
          {value ? (
            <button
              type="button"
              aria-label="Effacer la recherche"
              onClick={() => {
                setValue("");
                setTyped("");
                inputRef.current?.focus();
              }}
              className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 rounded border border-line bg-paper px-1.5 py-0.5 font-sans text-[11px] text-ink-muted sm:block">
              Échap
            </kbd>
          )}
        </form>

        {preview.length > 0 && (
          <ul
            aria-label="Recherche comprise"
            className="flex flex-wrap gap-1.5 border-t border-line px-4 py-2.5"
          >
            {preview.map((chip) => {
              const Icon = chipIcon(chip);
              return (
                <li
                  key={chip.key}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full bg-surface-sunken pl-1 pr-2.5 text-[13px] font-medium text-ink"
                >
                  {chip.kind === "person" ? (
                    <FaceThumb
                      faceId={chip.faceId ?? null}
                      className="h-5 w-5 rounded-full"
                    />
                  ) : chip.hue ? (
                    <span
                      aria-hidden
                      className={cn(
                        "ml-1.5 h-2.5 w-2.5 rounded-full ring-1 ring-inset ring-ink/15",
                        HUE_SWATCH[chip.hue],
                      )}
                    />
                  ) : Icon ? (
                    <Icon
                      className="ml-1.5 h-3.5 w-3.5 text-ink-muted"
                      aria-hidden
                    />
                  ) : null}
                  {chip.label}
                </li>
              );
            })}
          </ul>
        )}

        <div
          id={completionsId}
          role="listbox"
          aria-label="Suggestions"
          hidden={completions.length === 0}
          className="border-t border-line p-1.5"
        >
          {completions.map((completion, i) => {
            const Icon =
              completion.kind === "look" && completion.expression
                ? EXPRESSION_ICONS[completion.expression]
                : null;
            return (
              <div
                key={`${completion.kind}-${completion.label}`}
                id={suggestionOptionId(completionsId, i)}
                role="option"
                aria-selected={i === active}
                tabIndex={-1}
                onMouseDown={(e) => {
                  e.preventDefault();
                }}
                onMouseMove={() => {
                  if (i !== active) setActive(i);
                }}
                onClick={() => {
                  accept(completion);
                }}
                onKeyDown={() => undefined}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 transition-colors duration-150",
                  i === active ? "bg-surface-sunken" : "bg-surface",
                )}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center">
                  {completion.kind === "person" ? (
                    <FaceThumb
                      faceId={completion.faceId ?? null}
                      className="h-8 w-8 rounded-full"
                    />
                  ) : completion.hue ? (
                    <span
                      aria-hidden
                      className={cn(
                        "h-4 w-4 rounded-full ring-1 ring-inset ring-ink/15",
                        HUE_SWATCH[completion.hue],
                      )}
                    />
                  ) : Icon ? (
                    <Icon className="h-4 w-4 text-ink-muted" aria-hidden />
                  ) : (
                    <Search className="h-4 w-4 text-ink-faint" aria-hidden />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                  {completion.label}
                </span>
                <span className="text-xs text-ink-muted">
                  {KIND_LABELS[completion.kind]}
                </span>
              </div>
            );
          })}
        </div>

        <FolderSuggestionList
          id={listId}
          folders={folders}
          open
          inline
          active={active - completions.length}
          onActiveChange={(i) => {
            setActive(i + completions.length);
          }}
          onPick={onClose}
        />

        {view?.label && value.trim() !== "" && (
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2 text-[13px] text-ink-muted">
            <span className="inline-flex items-center gap-1.5">
              <CornerDownLeft className="h-3.5 w-3.5" aria-hidden />
              Filtrer {view.label}
            </span>
            <button
              type="button"
              onClick={() => {
                searchEverywhere(value.trim());
              }}
              className="touch-target rounded-full px-2 py-1 font-medium text-ink-soft underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink hover:decoration-ink"
            >
              Chercher partout
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
