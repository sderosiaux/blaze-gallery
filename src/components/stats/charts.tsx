"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

// Chart vocabulary for the stats page. Colours come from the chart tokens via
// Tailwind classes (`bg-chart-5` resolves to rgb(var(--chart-5))), so marks
// follow the theme. One entity, one colour, everywhere on the page: photos (and
// single-series magnitude) wear chart-5, videos chart-1. Validated as a pair
// against the paper surface (CVD ΔE 22, normal ΔE 29). Text never wears them.

export type Series = "photo" | "video";

export const seriesFill: Record<Series, string> = {
  photo: "bg-chart-5",
  video: "bg-chart-1",
};

export const seriesLabel: Record<Series, string> = {
  photo: "Photos",
  video: "Videos",
};

export function Legend({
  series,
  className,
}: {
  series: Series[];
  className?: string;
}) {
  return (
    <ul
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted",
        className,
      )}
    >
      {series.map((s) => (
        <li key={s} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn("h-2.5 w-2.5 rounded-[2px]", seriesFill[s])}
          />
          {seriesLabel[s]}
        </li>
      ))}
    </ul>
  );
}

/** Hover/focus readout for one mark. Same width as its mark, so it can never
 *  push the page sideways on a phone. Every value in it is also on the page. */
export function MarkTooltip({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      role="tooltip"
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-full z-10 mb-2 hidden rounded-md border border-line bg-surface px-3 py-2 text-left text-xs text-ink-soft shadow-pop",
        "group-hover:block group-focus-visible:block",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Tooltip line: value strong first, label after (the reader already knows the mark). */
export function TipRow({
  value,
  label,
}: {
  value: React.ReactNode;
  label: React.ReactNode;
}) {
  return (
    <span className="flex items-baseline justify-between gap-3">
      <span className="text-ink-muted">{label}</span>
      <span className="tabular font-medium text-ink">{value}</span>
    </span>
  );
}

export interface BarItem {
  key: string;
  label: React.ReactNode;
  /** Plain-text name, for the accessible label */
  name: string;
  href?: string;
  kicker?: React.ReactNode;
  value: number;
  valueLabel: React.ReactNode;
  detail?: React.ReactNode;
  series?: Series;
  tooltip?: React.ReactNode;
}

interface BarListProps {
  items: BarItem[];
  initial?: number;
  step?: number;
  /** Scale against this instead of the largest item (e.g. a total). */
  max?: number;
  noun?: string;
  className?: string;
}

/** Ranked horizontal bars: label above, a thin bar from a shared baseline,
 *  the value at the tip side. Capped, with "Show more". */
export function BarList({
  items,
  initial = 8,
  step = 8,
  max,
  noun = "more",
  className,
}: BarListProps) {
  const [visible, setVisible] = useState(initial);
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  const shown = items.slice(0, visible);

  return (
    <div className={className}>
      <ol className="space-y-1">
        {shown.map((item) => {
          const width =
            item.value > 0 ? Math.max(0.6, (item.value / top) * 100) : 0;
          const body = (
            <>
              <span className="flex items-baseline justify-between gap-4">
                <span className="min-w-0">
                  {item.kicker && (
                    <span className="kicker block truncate">{item.kicker}</span>
                  )}
                  <span
                    className={cn(
                      "block truncate text-sm text-ink",
                      item.href &&
                        "transition-colors duration-150 group-hover:text-accent-strong",
                    )}
                  >
                    {item.label}
                  </span>
                </span>
                <span className="tabular shrink-0 text-sm text-ink-soft">
                  {item.valueLabel}
                </span>
              </span>
              <span aria-hidden className="mt-1.5 block h-2">
                <span
                  className={cn(
                    "block h-2 rounded-r-sm transition-opacity duration-150 group-hover:opacity-80",
                    seriesFill[item.series ?? "photo"],
                  )}
                  style={{ width: `${width}%` }}
                />
              </span>
              {item.detail && (
                <span className="tabular mt-1 block truncate text-xs text-ink-muted">
                  {item.detail}
                </span>
              )}
              {item.tooltip && <MarkTooltip>{item.tooltip}</MarkTooltip>}
            </>
          );
          const rowClass =
            "group relative block rounded-md px-2 py-2 -mx-2 transition-colors duration-150 hover:bg-surface-sunken/60";
          return (
            <li key={item.key}>
              {item.href ? (
                <Link href={item.href} className={rowClass}>
                  {body}
                </Link>
              ) : (
                <div
                  tabIndex={item.tooltip ? 0 : undefined}
                  aria-label={item.tooltip ? item.name : undefined}
                  className={rowClass}
                >
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <ShowMore
        total={items.length}
        visible={visible}
        step={step}
        initial={initial}
        noun={noun}
        onChange={setVisible}
      />
    </div>
  );
}

interface ShowMoreProps {
  total: number;
  visible: number;
  initial: number;
  step: number;
  noun?: string;
  onChange: (visible: number) => void;
}

export function ShowMore({
  total,
  visible,
  initial,
  step,
  noun = "more",
  onChange,
}: ShowMoreProps) {
  if (total <= initial) return null;
  const remaining = total - visible;
  return (
    <div className="mt-3">
      {remaining > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          iconRight={ChevronDown}
          onClick={() => onChange(Math.min(total, visible + step))}
        >
          Show {Math.min(step, remaining)} {noun}
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          iconRight={ChevronUp}
          onClick={() => onChange(initial)}
        >
          Show fewer
        </Button>
      )}
    </div>
  );
}

/** Part-to-whole in one thin bar: segments separated by a 2px surface gap. */
export function SplitBar({
  parts,
  label,
  className,
}: {
  parts: Array<{ series: Series; value: number }>;
  label: string;
  className?: string;
}) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total <= 0) return null;
  return (
    <div
      role="img"
      aria-label={label}
      className={cn("flex h-1.5 w-full gap-0.5", className)}
    >
      {parts
        .filter((p) => p.value > 0)
        .map((p, i, arr) => (
          <span
            key={p.series}
            className={cn(
              "h-full min-w-[3px]",
              seriesFill[p.series],
              i === 0 && "rounded-l-sm",
              i === arr.length - 1 && "rounded-r-sm",
            )}
            style={{ flexGrow: p.value, flexBasis: 0 }}
          />
        ))}
    </div>
  );
}

/** A share against a whole. The track is a light step of the same hue. */
export function Meter({
  value,
  total,
  label,
  className,
}: {
  value: number;
  total: number;
  label: string;
  className?: string;
}) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={value}
      className={cn(
        "h-1.5 w-full overflow-hidden rounded-full bg-chart-5/15",
        className,
      )}
    >
      <div
        className="h-full rounded-full bg-chart-5"
        style={{ width: `${pct > 0 ? Math.max(pct, 1) : 0}%` }}
      />
    </div>
  );
}
