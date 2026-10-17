"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui";
import { useElementSize } from "@/components/viewer/useElementSize";
import { monthLabel, type MonthCount } from "@/components/find/timeline";
import type { MapPeriod } from "@/lib/mapArea";
import { cn } from "@/lib/cn";
import { monthsBetween, periodLabel } from "./mapData";

/** First and last month of the range, as indexes into the months shown. */
type Range = [number, number];
type Edge = "from" | "to";

/** Arrow keys settle this long before the map and the photos follow. */
const KEY_SETTLE_MS = 400;

const KEY_STEPS: Partial<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowDown: -1,
  ArrowRight: 1,
  ArrowUp: 1,
  PageDown: -12,
  PageUp: 12,
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const ordinal = (month: string) =>
  Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));

const percent = (value: number, of: number) => `${(value / of) * 100}%`;

interface PeriodBrushProps {
  /** Months holding photos on the map, oldest first */
  months: MonthCount[];
  period: MapPeriod;
  onChange: (period: MapPeriod, history: "push" | "replace") => void;
}

/**
 * Photos per month as slim bars, from the first month on the map to the
 * last. Dragging across them picks a range, a click picks one month, the
 * two handles move either end (also with the arrow keys).
 */
export default function PeriodBrush({
  months,
  period,
  onChange,
}: PeriodBrushProps) {
  const domain = useMemo(() => {
    const first = months[0]?.month;
    const last = months[months.length - 1]?.month;
    return first && last ? monthsBetween(first, last) : [];
  }, [months]);
  const counts = useMemo(() => {
    const byMonth = new Map(months.map((m) => [m.month, m.count]));
    return domain.map((month) => byMonth.get(month) ?? 0);
  }, [domain, months]);
  const max = counts.reduce((a, b) => Math.max(a, b), 1);
  const size = domain.length;
  const lastIndex = size - 1;

  const start = domain[0] ?? "";
  const committed = useMemo<Range>(() => {
    const index = (month: string | null, fallback: number) =>
      month ? clamp(ordinal(month) - ordinal(start), 0, lastIndex) : fallback;
    return [index(period.from, 0), index(period.to, lastIndex)];
  }, [period.from, period.to, start, lastIndex]);

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
    ([from, to]: Range, history: "push" | "replace") => {
      draftRef.current = null;
      setDraft(null);
      if (from === committed[0] && to === committed[1]) return;
      // An end at the edge stays open: photos synced later fall inside.
      onChange(
        {
          from: from === 0 ? null : (domain[from] ?? null),
          to: to === lastIndex ? null : (domain[to] ?? null),
        },
        history,
      );
    },
    [committed, domain, lastIndex, onChange],
  );

  const track = useRef<HTMLDivElement>(null);
  const { width } = useElementSize(track);
  const drag = useRef<{ edge: Edge | null; anchor: number } | null>(null);

  /** Fraction of the track under the pointer, in months. */
  const monthsAt = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return ((clientX - rect.left) / rect.width) * size;
  };

  const follow = (clientX: number) => {
    const current = drag.current;
    if (!current) return;
    const at = monthsAt(clientX);
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
    const anchor = clamp(Math.floor(monthsAt(e.clientX)), 0, lastIndex);
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { edge, anchor };
    showDraft(edge ? [lo, hi] : [anchor, anchor]);
  };

  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    const range = draftRef.current;
    if (range) commit(range, "push");
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
    const step = KEY_STEPS[e.key];
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
      commit(next, "replace");
    }, KEY_SETTLE_MS);
  };

  if (size === 0) return null;

  const filtered = period.from !== null || period.to !== null;
  const narrowed = draft !== null ? lo > 0 || hi < lastIndex : filtered;
  const gap = width / size >= 4 ? 0.2 : 0;

  // Januaries, every year when there is room, else every other or every fifth.
  const perYear = (width * 12) / size;
  const every = perYear >= 40 ? 1 : perYear >= 20 ? 2 : 5;
  const labelRoom = width > 0 ? (32 / width) * size : size;
  const years = domain.flatMap((month, i) => {
    const year = Number(month.slice(0, 4));
    return month.endsWith("-01") && year % every === 0 && i <= size - labelRoom
      ? [{ year, i }]
      : [];
  });

  const handle = (edge: Edge, at: number, index: number) => (
    <div
      role="slider"
      tabIndex={0}
      data-edge={edge}
      aria-label={edge === "from" ? "Début de la période" : "Fin de la période"}
      aria-valuemin={0}
      aria-valuemax={lastIndex}
      aria-valuenow={index}
      aria-valuetext={monthLabel(domain[index] ?? start)}
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
          {periodLabel(domain[lo] ?? start, domain[hi] ?? start)}
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
        className="relative mt-2 h-12 cursor-crosshair touch-none select-none"
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
        className="tabular relative mt-1.5 h-4 text-xs text-ink-muted"
      >
        {years.map(({ year, i }) => (
          <span
            key={year}
            className="absolute top-0"
            style={{ left: percent(i, size) }}
          >
            {year}
          </span>
        ))}
      </div>
    </div>
  );
}
