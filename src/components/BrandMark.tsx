import { cn } from "@/lib/cn";

/** Wordmark; a shorter one in the sidebar rail and the phone header. */
export default function BrandMark({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  // A dark disc with a letter read as a user avatar: the word stays a word.
  if (compact) {
    return (
      <span
        className={cn(
          "text-base font-semibold leading-none tracking-tight text-ink",
          className,
        )}
      >
        Blaze
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
