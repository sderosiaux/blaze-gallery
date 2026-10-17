"use client";

import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/cn";
import { Select } from "@/components/ui";

interface YearIndexProps {
  years: number[];
  active: number | null;
  onJump: (year: number) => void;
}

/** Slim column of years beside the months, from md up. */
export function YearRail({ years, active, onJump }: YearIndexProps) {
  return (
    <nav aria-label="Aller à une année" className="hidden md:block">
      <ol className="scrollbar-none sticky top-[calc(var(--topbar-height)+1.5rem)] max-h-[calc(100dvh-var(--topbar-height)-3rem)] overflow-y-auto border-l border-line py-1">
        {years.map((year) => {
          const current = year === active;
          return (
            <li key={year}>
              <button
                type="button"
                onClick={() => onJump(year)}
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
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Floating year picker for narrow screens, always within thumb reach. */
export function YearPicker({ years, active, onJump }: YearIndexProps) {
  return (
    <div className="fixed bottom-5 right-4 z-topbar w-32 md:hidden">
      <label htmlFor="timeline-year" className="sr-only">
        Aller à une année
      </label>
      <CalendarDays
        className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-ink-muted"
        aria-hidden
      />
      <Select
        id="timeline-year"
        value={active ?? ""}
        onChange={(e) => onJump(Number(e.target.value))}
        className="tabular h-11 rounded-full pl-9 font-medium shadow-pop"
      >
        {active === null && <option value="">Année</option>}
        {years.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </Select>
    </div>
  );
}
