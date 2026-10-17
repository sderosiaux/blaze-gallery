"use client";

import { CloudOff, RotateCw } from "lucide-react";
import { Button, EmptyState, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";

/** A failed endpoint degrades only its own block: what happened, and a retry. */
export function TabError({
  title,
  error,
  onRetry,
  className,
}: {
  title: string;
  error: string;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={className}>
      <EmptyState
        icon={CloudOff}
        title={title}
        body={
          <>
            The rest of the page still works, and nothing in the library
            changed. Try again in a moment.
            <span className="mt-2 block font-mono text-xs text-ink-faint">
              {error}
            </span>
          </>
        }
        action={
          <Button
            variant="secondary"
            size="sm"
            icon={RotateCw}
            onClick={onRetry}
          >
            Try again
          </Button>
        }
        className="py-6"
      />
    </div>
  );
}

/** Section placeholder shaped like a heading plus ranked bars. */
export function BarsSkeleton({
  rows = 6,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div aria-hidden className={cn("space-y-4", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i}>
          <div className="flex justify-between gap-4">
            <Skeleton className="h-3.5 w-40 max-w-[60%]" />
            <Skeleton className="h-3.5 w-14" />
          </div>
          <Skeleton className="mt-2 h-2" />
        </div>
      ))}
    </div>
  );
}

export function StatsRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div
      aria-hidden
      className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="border-t border-line pt-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-8 w-24" />
        </div>
      ))}
    </div>
  );
}

export function SectionTitleSkeleton() {
  return (
    <div aria-hidden className="mb-5 border-b border-line pb-3">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="mt-2 h-3.5 w-72 max-w-full" />
    </div>
  );
}
