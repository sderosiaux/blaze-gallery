"use client";

import { useEffect, useRef } from "react";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/cn";
import { Select } from "@/components/ui";
import { monthLabel, shortMonthLabel } from "./timeline";

interface YearIndexProps {
  years: number[];
  active: number | null;
  /** Months with photos in the active year ("YYYY-MM", newest first) */
  activeYearMonths: string[];
  activeMonth: string | null;
  onJump: (year: number) => void;
  onJumpMonth: (month: string) => void;
}

/**
 * Slim column of years beside the months, from md up. The year being read
 * unfolds into its months, so moving inside a year is one click too.
 */
export function YearRail({
  years,
  active,
  activeYearMonths,
  activeMonth,
  onJump,
  onJumpMonth,
}: YearIndexProps) {
  // Keep the year being read, and its months, inside the rail's own scroll.
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-current="true"]')
      ?.closest("li")
      ?.scrollIntoView({ block: "nearest" });
  }, [active, activeYearMonths.length]);

  return (
    <nav aria-label="Aller à une année ou un mois" className="hidden md:block">
      <ol
        ref={listRef}
        className="scrollbar-none sticky top-[calc(var(--topbar-height)+1.5rem)] max-h-[calc(100dvh-var(--topbar-height)-3rem)] overflow-y-auto border-l border-line py-1"
      >
        {years.map((year) => {
          const current = year === active;
          return (
            <li key={year}>
              <button
                type="button"
                onClick={() => {
                  onJump(year);
                }}
                aria-current={current ? "true" : undefined}
                className={cn(
                  "touch-target relative -ml-px flex h-7 w-full items-center border-l-2 pl-3 text-left text-xs tabular transition-colors duration-150",
                  current
                    ? "border-accent font-semibold text-ink"
                    : "border-transparent text-ink-muted hover:border-line-strong hover:text-ink",
                )}
              >
                {year}
              </button>
              {current && activeYearMonths.length > 0 && (
                <ol aria-label={`Mois de ${year}`} className="pb-1">
                  {activeYearMonths.map((month) => {
                    const here = month === activeMonth;
                    return (
                      <li key={month}>
                        <button
                          type="button"
                          onClick={() => {
                            onJumpMonth(month);
                          }}
                          aria-current={here ? "true" : undefined}
                          aria-label={monthLabel(month)}
                          className={cn(
                            "touch-target -ml-px flex h-6 w-full items-center border-l-2 pl-6 text-left text-xs transition-colors duration-150",
                            here
                              ? "border-ink-soft font-medium text-ink"
                              : "border-transparent text-ink-muted hover:text-ink",
                          )}
                        >
                          {shortMonthLabel(month)}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Floating picker for narrow screens, always within thumb reach: the years,
 * with the months of the year being read listed under it.
 */
export function YearPicker({
  years,
  active,
  activeYearMonths,
  activeMonth,
  onJump,
  onJumpMonth,
}: YearIndexProps) {
  const value =
    activeMonth && activeYearMonths.includes(activeMonth)
      ? `m:${activeMonth}`
      : active !== null
        ? `y:${active}`
        : "";
  return (
    <div className="fixed bottom-5 right-4 z-topbar w-36 md:hidden">
      <label htmlFor="timeline-year" className="sr-only">
        Aller à une année ou un mois
      </label>
      <CalendarDays
        className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-ink-muted"
        aria-hidden
      />
      <Select
        id="timeline-year"
        value={value}
        onChange={(e) => {
          const [kind, target] = e.target.value.split(":");
          if (kind === "m" && target) onJumpMonth(target);
          else if (kind === "y" && target) onJump(Number(target));
        }}
        className="tabular h-11 rounded-full pl-9 font-medium shadow-pop"
      >
        {value === "" && <option value="">Année</option>}
        {years.map((year) => [
          <option key={year} value={`y:${year}`}>
            {year}
          </option>,
          ...(year === active
            ? activeYearMonths.map((month) => (
                <option key={month} value={`m:${month}`}>
                  {`\u00a0\u00a0${monthLabel(month)}`}
                </option>
              ))
            : []),
        ])}
      </Select>
    </div>
  );
}
