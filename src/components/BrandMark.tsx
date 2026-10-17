import { cn } from "@/lib/cn";

/** Wordmark; collapses to a monogram in the sidebar rail. */
export default function BrandMark({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  if (compact) {
    return (
      <span
        aria-label="Blaze Gallery"
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-full bg-ink text-base font-semibold text-paper",
          className,
        )}
      >
        B
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-baseline gap-1.5", className)}>
      <span className="text-xl font-semibold leading-none tracking-tight text-ink">
        Blaze
      </span>
      <span className="text-sm leading-none text-ink-muted">Gallery</span>
    </span>
  );
}
