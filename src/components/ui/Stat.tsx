import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

interface StatProps {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
}

export function Stat({ label, value, hint, icon: Icon, className }: StatProps) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.08em] text-ink-muted">
        {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
        {label}
      </div>
      <div className="tabular mt-1.5 truncate font-display text-display-md font-semibold text-ink">
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-ink-muted">{hint}</div>}
    </div>
  );
}
