"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Palette, X } from "lucide-react";
import {
  COLOR_TONES,
  filterLabel,
  hasColorFilter,
  HUE_LABELS,
  HUES,
  NO_COLOR_FILTER,
  TONE_LABELS,
  type ColorFilter,
  type Hue,
} from "@/lib/colors";
import { cn } from "@/lib/cn";

/** Static class names, so Tailwind generates each hue token. */
export const HUE_SWATCH: Record<Hue, string> = {
  red: "bg-hue-red",
  orange: "bg-hue-orange",
  yellow: "bg-hue-yellow",
  green: "bg-hue-green",
  teal: "bg-hue-teal",
  blue: "bg-hue-blue",
  purple: "bg-hue-purple",
  pink: "bg-hue-pink",
  brown: "bg-hue-brown",
  black: "bg-hue-black",
  grey: "bg-hue-grey",
  white: "bg-hue-white",
};

/** Swatches light enough that their check mark is drawn in ink, not white. */
const LIGHT_HUES: ReadonlySet<Hue> = new Set(["yellow", "pink", "white"]);

interface ColorFilterBarProps {
  filter: ColorFilter;
  onChange: (next: ColorFilter) => void;
  className?: string;
}

/** Chip positions in the toolbar: the hues, then the tones, then "Effacer". */
const TONE_AT = HUES.length;
const CLEAR_AT = HUES.length + COLOR_TONES.length;

/**
 * One color and one tone at most, each chip pressed again to let go.
 * Folded to a single button until opened or until a filter is set. A
 * toolbar: one Tab stop, arrow keys (Home, End) move between the chips.
 */
export default function ColorFilterBar({
  filter,
  onChange,
  className,
}: ColorFilterBarProps) {
  const active = hasColorFilter(filter);
  const [open, setOpen] = useState(active);
  const panelId = useId();
  // The chip Tab lands on: the last one focused, at first the chosen color or tone
  const [current, setCurrent] = useState(() =>
    filter.color
      ? HUES.indexOf(filter.color)
      : filter.tone
        ? TONE_AT + COLOR_TONES.indexOf(filter.tone)
        : 0,
  );
  const tabStop = Math.min(current, active ? CLEAR_AT : CLEAR_AT - 1);
  const chipProps = (index: number) => ({
    "data-chip": index,
    tabIndex: index === tabStop ? 0 : -1,
    onFocus: () => {
      setCurrent(index);
    },
  });

  // A link or Back may bring a filter in: show what is applied.
  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);

  // On a phone the row scrolls: bring a chosen tone, past the swatches, into view.
  const toolbarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = toolbarRef.current;
    if (!bar || !open || bar.scrollWidth <= bar.clientWidth) return;
    const pressed = bar.querySelectorAll<HTMLElement>('[aria-pressed="true"]');
    const last = pressed[pressed.length - 1];
    if (!last) return;
    const right = last.offsetLeft + last.offsetWidth + 8;
    if (right > bar.scrollLeft + bar.clientWidth)
      bar.scrollLeft = right - bar.clientWidth;
  }, [open, filter.color, filter.tone]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(e.key)) return;
    const chips = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-chip]"),
    );
    const i = chips.findIndex((chip) => chip === document.activeElement);
    if (i === -1) return;
    e.preventDefault();
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? chips.length - 1
          : (i + (e.key === "ArrowRight" ? 1 : chips.length - 1)) %
            chips.length;
    chips[next]?.focus();
  };

  return (
    <div
      className={cn("flex flex-wrap items-center gap-x-2 gap-y-1", className)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((o) => !o);
        }}
        className="touch-target -ml-1 inline-flex h-8 items-center gap-1.5 rounded-full px-1.5 text-sm font-medium text-ink-soft transition-colors hover:text-ink"
      >
        <Palette className="h-4 w-4" aria-hidden />
        Couleurs
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-ink-muted transition-transform duration-200 ease-out-soft",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {!open && active && (
        <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-surface-sunken pl-2.5 pr-1 text-[13px] font-medium text-ink">
          {filter.color && (
            <span
              aria-hidden
              className={cn(
                "h-2.5 w-2.5 rounded-full ring-1 ring-inset ring-ink/15",
                HUE_SWATCH[filter.color],
              )}
            />
          )}
          {filterLabel(filter)}
          <button
            type="button"
            aria-label="Retirer le filtre de couleur"
            title="Retirer le filtre de couleur"
            onClick={() => {
              onChange(NO_COLOR_FILTER);
            }}
            className="touch-target inline-flex h-5 w-5 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-line hover:text-ink"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </span>
      )}

      <div
        ref={toolbarRef}
        id={panelId}
        hidden={!open}
        role="toolbar"
        aria-label="Filtrer par couleur"
        onKeyDown={onKeyDown}
        className={cn(
          // A phone gets one row that scrolls sideways, not four that wrap
          "scrollbar-none relative -mx-1 w-[calc(100%+0.5rem)] items-center gap-x-1 gap-y-1 overflow-x-auto p-1 sm:mx-0 sm:w-auto sm:flex-wrap sm:overflow-visible sm:p-0",
          // A display class would override the hidden attribute
          open ? "flex animate-fade-in" : "hidden",
        )}
      >
        <div className="flex shrink-0 items-center sm:flex-wrap">
          {HUES.map((hue, i) => {
            const pressed = filter.color === hue;
            return (
              <button
                key={hue}
                type="button"
                {...chipProps(i)}
                aria-pressed={pressed}
                aria-label={HUE_LABELS[hue]}
                title={HUE_LABELS[hue]}
                onClick={() => {
                  onChange({ ...filter, color: pressed ? null : hue });
                }}
                className="touch-target group flex h-8 w-8 items-center justify-center rounded-full"
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full transition-transform duration-150 ease-out-soft group-hover:scale-110",
                    HUE_SWATCH[hue],
                    pressed
                      ? "scale-110 ring-2 ring-ink ring-offset-2 ring-offset-paper"
                      : "ring-1 ring-inset ring-ink/15",
                  )}
                >
                  {/* The check tells pressed from merely focused */}
                  {pressed && (
                    <Check
                      strokeWidth={3}
                      className={cn(
                        "h-3 w-3",
                        LIGHT_HUES.has(hue) ? "text-ink" : "text-on-photo",
                      )}
                    />
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <span aria-hidden className="mx-1.5 h-5 w-px shrink-0 bg-line" />
        <div className="flex shrink-0 items-center gap-1.5 sm:flex-wrap">
          {COLOR_TONES.map((tone, i) => {
            const pressed = filter.tone === tone;
            return (
              <button
                key={tone}
                type="button"
                {...chipProps(TONE_AT + i)}
                aria-pressed={pressed}
                onClick={() => {
                  onChange({ ...filter, tone: pressed ? null : tone });
                }}
                className={cn(
                  "touch-target inline-flex h-7 items-center whitespace-nowrap rounded-full border px-2.5 text-[13px] font-medium transition-colors duration-150",
                  pressed
                    ? "border-ink bg-ink text-paper"
                    : "border-line text-ink-soft hover:border-ink-muted hover:text-ink",
                )}
              >
                {TONE_LABELS[tone]}
              </button>
            );
          })}
        </div>
        {active && (
          <button
            type="button"
            {...chipProps(CLEAR_AT)}
            onClick={() => {
              onChange(NO_COLOR_FILTER);
            }}
            className="touch-target ml-1 inline-flex h-7 shrink-0 items-center rounded-full px-2 text-[13px] font-medium text-ink-muted underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink hover:decoration-ink"
          >
            Effacer
          </button>
        )}
      </div>
    </div>
  );
}
