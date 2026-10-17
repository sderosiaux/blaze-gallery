import type { LucideIcon } from "lucide-react";
import BrandMark from "@/components/BrandMark";
import { cn } from "@/lib/cn";

const GUTTER = "mx-auto w-full max-w-[1600px] px-5 sm:px-8 lg:px-12";

/** The guest's whole world: a wordmark and the folder. No app chrome. */
export function GuestShell({
  centered = false,
  children,
}: {
  centered?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <header className={cn(GUTTER, "flex h-14 items-center sm:h-16")}>
        <BrandMark />
      </header>
      <main
        className={cn(
          GUTTER,
          "flex-1 pb-16",
          centered && "flex items-center justify-center",
        )}
      >
        {children}
      </main>
    </div>
  );
}

interface GuestNoticeProps {
  icon: LucideIcon;
  title: React.ReactNode;
  body?: React.ReactNode;
  action?: React.ReactNode;
}

/** A whole-page message for a guest: what happened, then what to do. */
export function GuestNotice({
  icon: Icon,
  title,
  body,
  action,
}: GuestNoticeProps) {
  return (
    <div className="w-full max-w-md animate-rise-in py-16 text-center">
      <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full border border-line bg-surface text-ink-muted">
        <Icon className="h-6 w-6" aria-hidden />
      </div>
      <h1 className="text-balance text-display-sm font-semibold text-ink">
        {title}
      </h1>
      {body && (
        <p className="mx-auto mt-3 max-w-sm text-pretty text-sm leading-relaxed text-ink-muted">
          {body}
        </p>
      )}
      {action && <div className="mt-8 flex justify-center">{action}</div>}
    </div>
  );
}
