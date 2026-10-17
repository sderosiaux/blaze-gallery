import { cn } from "@/lib/cn";

interface PageHeaderProps {
  kicker?: React.ReactNode;
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  size?: "xl" | "lg" | "md";
  className?: string;
  children?: React.ReactNode;
}

const titleSizes = {
  xl: "text-display-xl",
  lg: "text-display-lg",
  md: "text-display-md",
};

export function PageHeader({
  kicker,
  title,
  meta,
  actions,
  size = "lg",
  className,
  children,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-6 pb-8 pt-6 sm:pt-10 lg:flex-row lg:items-end lg:justify-between",
        className,
      )}
    >
      <div className="min-w-0 max-w-4xl animate-rise-in">
        {kicker && <div className="kicker mb-3">{kicker}</div>}
        <h1
          className={cn(
            "text-balance break-words font-display font-light text-ink",
            titleSizes[size],
          )}
        >
          {title}
        </h1>
        {meta && (
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
            {meta}
          </div>
        )}
        {children}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  );
}

/** Dot separator for meta lines. */
export function MetaDot() {
  return (
    <span aria-hidden className="text-ink-faint">
      ·
    </span>
  );
}
