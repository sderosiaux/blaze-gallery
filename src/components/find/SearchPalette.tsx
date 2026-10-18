"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { albumHref } from "@/components/photos/AlbumCard";
import {
  FolderSuggestionList,
  suggestionOptionId,
  useFolderSuggestions,
} from "./FolderSuggestions";

/**
 * Search over the page, opened from the sidebar, ⌘K or "/". It takes no room
 * until it's asked for. Enter searches every folder and photo; the arrows
 * pick a suggested folder, which opens directly.
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
  const query = useSearchParams().get("q") ?? "";
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  // What the user typed: suggestions follow it, not the value taken from the URL.
  const [typed, setTyped] = useState("");
  const [active, setActive] = useState(-1);
  const suggestions = useFolderSuggestions(typed);
  const listId = useId();
  const expanded = suggestions.length > 0;
  // Read when the palette opens, not followed while it is open.
  const startRef = useRef("");
  startRef.current = pathname === "/search" ? query : "";

  // Opening on the search page starts from its query, selected so typing replaces it.
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

  // A new list starts with nothing highlighted: Enter runs the full search.
  useEffect(() => {
    setActive(-1);
  }, [suggestions]);

  if (!open || typeof document === "undefined") return null;

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    go(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const count = suggestions.length;
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
      const folder = suggestions[active];
      if (!folder) return; // the form submits: the full search
      e.preventDefault();
      go(albumHref(folder.path));
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Tab") {
      // The field is the only stop: focus stays in the dialog.
      e.preventDefault();
    }
  };

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
            aria-expanded={expanded}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              expanded && active >= 0
                ? suggestionOptionId(listId, active)
                : undefined
            }
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setTyped(e.target.value);
            }}
            onKeyDown={onKeyDown}
            placeholder="Dossiers, photos…"
            aria-label="Rechercher des dossiers et des photos"
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
        <FolderSuggestionList
          id={listId}
          folders={suggestions}
          open
          inline
          active={active}
          onActiveChange={setActive}
          onPick={onClose}
        />
      </div>
    </div>,
    document.body,
  );
}
