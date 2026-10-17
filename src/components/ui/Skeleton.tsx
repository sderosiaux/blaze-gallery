import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton rounded", className)} />;
}

/** Page-level loading placeholder shaped like a PageHeader plus content. */
export function PageSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="pt-10">
      <Skeleton className="mb-4 h-3 w-32" />
      <Skeleton className="mb-3 h-12 w-2/3 max-w-xl" />
      <Skeleton className="mb-12 h-4 w-56" />
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full" />
        ))}
      </div>
    </div>
  );
}
