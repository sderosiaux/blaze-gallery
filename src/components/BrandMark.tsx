import { cn } from "@/lib/cn";

/** Serif wordmark; collapses to a monogram in the sidebar rail. */
export default function BrandMark({ compact = false, className }: { compact?: boolean; className?: string }) {
  if (compact) {
    return (
      <span
        aria-label="Blaze Gallery"
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-full bg-ink font-display text-lg italic text-paper",
          className,
        )}
      >
        B<span className="text-accent">.</span>
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-baseline gap-1.5", className)}>
      <span className="font-display text-[1.65rem] font-normal italic leading-none tracking-[-0.01em] text-ink">
        Blaze<span className="text-accent">.</span>
      </span>
      <span className="kicker text-[0.65rem]">Gallery</span>
    </span>
  );
}
