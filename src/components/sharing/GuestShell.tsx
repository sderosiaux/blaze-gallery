import type { LucideIcon } from "lucide-react";
import BrandMark from "@/components/BrandMark";
import { cn } from "@/lib/cn";

const GUTTER = "mx-auto w-full max-w-[1600px] px-5 sm:px-8 lg:px-12";

/** The guest's whole world: a wordmark, the album, a quiet footer. No app chrome. */
export function GuestShell({
  centered = false,
  children,
}: {
  centered?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <header
        className={cn(GUTTER, "flex h-16 items-center justify-between sm:h-20")}
      >
        <BrandMark />
        <span className="kicker hidden sm:inline">Shared with you</span>
      </header>
      <main
        className={cn(
          GUTTER,
          "flex-1",
          centered && "flex items-center justify-center",
        )}
      >
        {children}
      </main>
      <footer className={cn(GUTTER, "py-10 text-xs text-ink-faint")}>
        Shared privately with Blaze Gallery
      </footer>
    </div>
  );
}

interface GuestNoticeProps {
  icon: LucideIcon;
  kicker: string;
  title: React.ReactNode;
  body: React.ReactNode;
  action?: React.ReactNode;
}

/** A whole-page message for a guest: what happened and what to do next. */
export function GuestNotice({
  icon: Icon,
  kicker,
  title,
  body,
  action,
}: GuestNoticeProps) {
  return (
    <div className="w-full max-w-md animate-rise-in py-16 text-center">
      <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full border border-line bg-surface text-ink-muted">
        <Icon className="h-6 w-6" aria-hidden />
      </div>
      <div className="kicker mb-3">{kicker}</div>
      <h1 className="text-balance font-display text-display-md font-semibold text-ink">
        {title}
      </h1>
      <p className="mx-auto mt-4 max-w-sm text-pretty text-sm leading-relaxed text-ink-muted">
        {body}
      </p>
      {action && <div className="mt-8 flex justify-center">{action}</div>}
    </div>
  );
}
