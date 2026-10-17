import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: React.ReactNode;
  body?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

/** Says what is missing and what to do next, never just "nothing here". */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "mx-auto flex max-w-md flex-col items-center px-6 py-16 text-center animate-fade-in",
        className,
      )}
    >
      {Icon && (
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-line bg-surface text-ink-muted">
          <Icon className="h-6 w-6" aria-hidden />
        </div>
      )}
      <h2 className="text-balance font-display text-display-sm font-normal text-ink">
        {title}
      </h2>
      {body && (
        <p className="mt-2 text-pretty text-sm leading-relaxed text-ink-muted">
          {body}
        </p>
      )}
      {action && (
        <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div>
      )}
    </div>
  );
}
