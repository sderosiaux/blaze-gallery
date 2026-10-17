import { cn } from "@/lib/cn";

interface SectionProps {
  title?: React.ReactNode;
  kicker?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
  id?: string;
}

export function Section({
  title,
  kicker,
  description,
  action,
  className,
  children,
  id,
}: SectionProps) {
  return (
    <section id={id} className={cn("py-8 sm:py-10", className)}>
      {(Boolean(title) || Boolean(action)) && (
        <div className="mb-5 flex items-end justify-between gap-4 border-b border-line pb-3">
          <div className="min-w-0">
            {kicker && <div className="kicker mb-1.5">{kicker}</div>}
            {title && (
              <h2 className="font-display text-display-sm font-semibold text-ink">
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-1 max-w-2xl text-sm text-ink-muted">
                {description}
              </p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
