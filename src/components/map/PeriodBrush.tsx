"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui";
import { useElementSize } from "@/components/viewer/useElementSize";
import { shortMonthLabel } from "@/components/find/timeline";
import { firstDay, isDay, lastDay, type MapPeriod } from "@/lib/mapArea";
import { cn } from "@/lib/cn";
import {
  dateLabel,
  datesBetween,
  periodLabel,
  type DateUnit,
  type MapDates,
} from "./mapData";

/** First and last bar of the range, as indexes into the dates shown. */
type Range = [number, number];
type Edge = "from" | "to";

/** Arrow keys settle this long before the map and the photos follow. */
const KEY_SETTLE_MS = 400;

const KEY_STEPS: Partial<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowDown: -1,
  ArrowRight: 1,
  ArrowUp: 1,
};

/** Page Up and Page Down: a year of months, a week of days. */
const PAGE_STEPS: Record<DateUnit, number> = { month: 12, day: 7 };

/** A few bars don't stretch across the strip: they stay this wide, centred. */
const MAX_BAR_PX = 28;

/** Rough width of an axis label character, and the room between labels. */
const LABEL_CHAR_PX = 6.5;
const LABEL_GAP_PX = 8;

const DAY_MS = 86_400_000;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Days or months since 1970: where a date falls on the strip. */
const ordinal = (date: string, unit: DateUnit) =>
  unit === "day"
    ? Date.parse(`${date}T00:00:00.000Z`) / DAY_MS
    : Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7));

const percent = (value: number, of: number) => `${(value / of) * 100}%`;

interface Tick {
  key: string;
  text: string;
  /** Pixels from the strip's left edge */
  at: number;
  /** Centred on its bar, else starting at it */
  centred?: boolean;
}

/**
 * The labels that fit, earlier ones first: a centred label moves inside the
 * strip, one that would overlap a label already kept is dropped.
 */
function fitTicks(wanted: Tick[], width: number): Tick[] {
  const kept: { tick: Tick; end: number }[] = [];
  for (const tick of wanted) {
    const size = tick.text.length * LABEL_CHAR_PX;
    const at = tick.centred
      ? clamp(tick.at - size / 2, 0, width - size)
      : tick.at;
    const end = at + size;
    if (at < 0 || end > width) continue;
    const clear = kept.every(
      (k) => at >= k.end + LABEL_GAP_PX || end + LABEL_GAP_PX <= k.tick.at,
    );
    if (clear) kept.push({ tick: { ...tick, at }, end });
  }
  return kept.map((k) => k.tick);
}

/** Januaries, every year when there is room, else every other or every fifth. */
function yearTicks(domain: string[], barPx: number): Tick[] {
  const perYear = barPx * 12;
  const every = perYear >= 40 ? 1 : perYear >= 20 ? 2 : 5;
  const januaries = domain.flatMap((month, i) =>
    month.endsWith("-01") && Number(month.slice(0, 4)) % every === 0
      ? [{ key: month, text: month.slice(0, 4), at: i * barPx }]
      : [],
  );
  const first = domain[0];
  // Months within a single year still say which one.
  return januaries.length > 0 || !first
    ? januaries
    : [{ key: first, text: first.slice(0, 4), at: 0 }];
}

/**
 * Each day when there is room, else every other day, every Monday or every
 * other Monday. A 1st names its month, the period above names the first one.
 */
function dayTicks(domain: string[], barPx: number): Tick[] {
  const every = [1, 2, 7, 14].find((n) => n * barPx >= 24) ?? 28;
  const shown = (day: string) => {
    if (every === 1) return true;
    if (every === 2) return Number(day.slice(8)) % 2 === 1;
    const n = ordinal(day, "day");
    // 1970-01-01 was a Thursday: Mondays fall on n ≡ 4 (mod 7).
    return n % 7 === 4 && Math.floor(n / 7) % (every / 7) === 0;
  };
  const tick = (day: string, i: number): Tick => ({
    key: day,
    text: day.endsWith("-01")
      ? `1 ${shortMonthLabel(day.slice(0, 7))}`
      : String(Number(day.slice(8))),
    at: (i + 0.5) * barPx,
    centred: true,
  });
  // Month starts come first: they keep their place over the days next to them.
  const named = domain.flatMap((day, i) =>
    day.endsWith("-01") ? [tick(day, i)] : [],
  );
  const numbered = domain.flatMap((day, i) =>
    !day.endsWith("-01") && shown(day) ? [tick(day, i)] : [],
  );
  return [...named, ...numbered];
}

interface PeriodBrushProps {
  /** Photos per day or per month on the map, oldest first */
  dates: MapDates;
  period: MapPeriod;
  onChange: (period: MapPeriod, history: "push" | "replace") => void;
}

/**
 * Photos per month as slim bars, from the first month on the map to the
 * last, or per day when they all fit in a few months (a single trip).
 * Dragging across them picks a range, a click picks one bar, the two
 * handles move either end (also with the arrow keys).
 */
export default function PeriodBrush({
  dates: { unit, dates },
  period,
  onChange,
}: PeriodBrushProps) {
  const domain = useMemo(() => {
    const first = dates[0]?.date;
    const last = dates[dates.length - 1]?.date;
    return first && last ? datesBetween(first, last, unit) : [];
  }, [dates, unit]);
  const counts = useMemo(() => {
    const byDate = new Map(dates.map((d) => [d.date, d.count]));
    return domain.map((date) => byDate.get(date) ?? 0);
  }, [domain, dates]);
  const max = counts.reduce((a, b) => Math.max(a, b), 1);
  const size = domain.length;
  const lastIndex = size - 1;

  const start = domain[0] ?? "";
  // A period in the other unit lands on the bars holding it: a month spans
  // its days, a day falls in its month.
  const committed = useMemo<Range>(() => {
    const index = (edge: Edge, bound: string | null, fallback: number) => {
      if (!bound) return fallback;
      const date =
        unit === "month"
          ? bound.slice(0, 7)
          : edge === "from"
            ? firstDay(bound)
            : lastDay(bound);
      return clamp(ordinal(date, unit) - ordinal(start, unit), 0, lastIndex);
    };
    return [index("from", period.from, 0), index("to", period.to, lastIndex)];
  }, [period.from, period.to, start, lastIndex, unit]);

  // The range being dragged or stepped, before the URL takes it. Pointer
  // events can outrun renders: handlers read it from the ref.
  const [draft, setDraft] = useState<Range | null>(null);
  const draftRef = useRef<Range | null>(null);
  const showDraft = (next: Range | null) => {
    draftRef.current = next;
    setDraft(next);
  };
  const [lo, hi] = draft ?? committed;

  const commit = useCallback(
    ([from, to]: Range, history: "push" | "replace", moved: Edge | null) => {
      draftRef.current = null;
      setDraft(null);
      // An end at the edge stays open: photos synced later fall inside.
      // Moving a handle leaves the other end as it was, a day even on a
      // month strip.
      const keep = moved !== null;
      const next: MapPeriod = {
        from:
          keep && from === committed[0]
            ? period.from
            : from === 0
              ? null
              : (domain[from] ?? null),
        to:
          keep && to === committed[1]
            ? period.to
            : to === lastIndex
              ? null
              : (domain[to] ?? null),
      };
      if (next.from === period.from && next.to === period.to) return;
      onChange(next, history);
    },
    [committed, domain, lastIndex, onChange, period.from, period.to],
  );

  const track = useRef<HTMLDivElement>(null);
  const { width } = useElementSize(track);
  const drag = useRef<{ edge: Edge | null; anchor: number } | null>(null);

  /** Fraction of the track under the pointer, in bars. */
  const barsAt = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return ((clientX - rect.left) / rect.width) * size;
  };

  const follow = (clientX: number) => {
    const current = drag.current;
    if (!current) return;
    const at = barsAt(clientX);
    const [from, to] = draftRef.current ?? committed;
    // Handles sit between bars: they snap to the nearest boundary.
    if (current.edge === "from") showDraft([clamp(Math.round(at), 0, to), to]);
    else if (current.edge === "to")
      showDraft([from, clamp(Math.round(at) - 1, from, lastIndex)]);
    else {
      const index = clamp(Math.floor(at), 0, lastIndex);
      showDraft([
        Math.min(current.anchor, index),
        Math.max(current.anchor, index),
      ]);
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !e.isPrimary) return;
    const handle = (e.target as HTMLElement).closest<HTMLElement>(
      "[data-edge]",
    );
    const edge = (handle?.dataset.edge as Edge | undefined) ?? null;
    const anchor = clamp(Math.floor(barsAt(e.clientX)), 0, lastIndex);
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { edge, anchor };
    showDraft(edge ? [lo, hi] : [anchor, anchor]);
  };

  const onPointerUp = () => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    const range = draftRef.current;
    if (range) commit(range, "push", current.edge);
  };

  const onPointerCancel = () => {
    drag.current = null;
    showDraft(null);
  };

  const keyTimer = useRef<number>();
  useEffect(
    () => () => {
      window.clearTimeout(keyTimer.current);
    },
    [],
  );

  const onKeyDown = (edge: Edge) => (e: React.KeyboardEvent) => {
    const [from, to] = draftRef.current ?? committed;
    const current = edge === "from" ? from : to;
    const page = PAGE_STEPS[unit];
    const step =
      e.key === "PageUp"
        ? page
        : e.key === "PageDown"
          ? -page
          : KEY_STEPS[e.key];
    let target: number;
    if (e.key === "Home") target = edge === "from" ? 0 : from;
    else if (e.key === "End") target = edge === "from" ? to : lastIndex;
    else if (step !== undefined) target = current + step;
    else return;
    e.preventDefault();
    const next: Range =
      edge === "from"
        ? [clamp(target, 0, to), to]
        : [from, clamp(target, from, lastIndex)];
    showDraft(next);
    window.clearTimeout(keyTimer.current);
    keyTimer.current = window.setTimeout(() => {
      commit(next, "replace", edge);
    }, KEY_SETTLE_MS);
  };

  if (size === 0) return null;

  const filtered = period.from !== null || period.to !== null;
  const narrowed = draft !== null ? lo > 0 || hi < lastIndex : filtered;
  const barPx = width / size;
  // One pixel between bars wide enough to spare it.
  const gap = barPx >= 4 ? 1 / barPx : 0;
  const ticks =
    width > 0
      ? fitTicks(
          unit === "day" ? dayTicks(domain, barPx) : yearTicks(domain, barPx),
          width,
        )
      : [];
  const stripWidth = `min(100%, ${size * MAX_BAR_PX}px)`;

  // Once committed, the label tells the period itself: a day picked on a
  // day strip stays exact on a month strip.
  const bound = (value: string | null, index: number) => {
    const bar = domain[index] ?? start;
    return draft === null &&
      unit === "month" &&
      value !== null &&
      isDay(value) &&
      value.startsWith(bar)
      ? value
      : bar;
  };

  const handle = (edge: Edge, at: number, index: number) => (
    <div
      role="slider"
      tabIndex={0}
      data-edge={edge}
      aria-label={edge === "from" ? "Début de la période" : "Fin de la période"}
      aria-valuemin={0}
      aria-valuemax={lastIndex}
      aria-valuenow={index}
      aria-valuetext={dateLabel(domain[index] ?? start)}
      onKeyDown={onKeyDown(edge)}
      className="touch-target group absolute inset-y-0 z-[1] flex w-4 -translate-x-1/2 cursor-ew-resize items-center justify-center rounded-sm"
      style={{ left: percent(at, size) }}
    >
      <span aria-hidden className="absolute inset-y-0 w-0.5 bg-ink" />
      <span
        aria-hidden
        className="relative h-5 w-2.5 rounded-full border border-ink bg-paper shadow-lift transition-transform duration-150 group-hover:scale-110"
      />
    </div>
  );

  return (
    <div className="pt-4">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <p
          className={cn(
            "tabular text-sm",
            narrowed ? "font-medium text-ink" : "text-ink-muted",
          )}
        >
          {periodLabel(bound(period.from, lo), bound(period.to, hi))}
        </p>
        {filtered && (
          <Button
            size="sm"
            variant="ghost"
            icon={RotateCcw}
            className="-mr-3"
            onClick={() => {
              onChange({ from: null, to: null }, "push");
            }}
          >
            Toutes les dates
          </Button>
        )}
      </div>

      <div
        ref={track}
        className="relative mx-auto mt-2 h-12 cursor-crosshair touch-none select-none"
        style={{ width: stripWidth }}
        onPointerDown={onPointerDown}
        onPointerMove={(e) => {
          follow(e.clientX);
        }}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <svg
          aria-hidden
          className="absolute inset-0 h-full w-full"
          viewBox={`0 0 ${size} 100`}
          preserveAspectRatio="none"
          shapeRendering="crispEdges"
        >
          {counts.map((count, i) => {
            if (count === 0) return null;
            // Square root: a busy summer doesn't flatten the quiet months.
            const height = Math.max(4, Math.sqrt(count / max) * 100);
            return (
              <rect
                key={i}
                x={i + gap / 2}
                width={1 - gap}
                y={100 - height}
                height={height}
                className={cn(
                  "transition-[fill] duration-150",
                  i >= lo && i <= hi ? "fill-ink" : "fill-line-strong",
                )}
              />
            );
          })}
        </svg>
        {narrowed && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 bg-ink/5"
            style={{
              left: percent(lo, size),
              width: percent(hi - lo + 1, size),
            }}
          />
        )}
        {handle("from", lo, lo)}
        {handle("to", hi + 1, hi)}
      </div>

      <div
        aria-hidden
        className="tabular relative mx-auto mt-1.5 h-4 text-xs text-ink-muted"
        style={{ width: stripWidth }}
      >
        {ticks.map(({ key, text, at }) => (
          <span
            key={key}
            className="absolute top-0 whitespace-nowrap"
            style={{ left: at }}
          >
            {text}
          </span>
        ))}
      </div>
    </div>
  );
}
