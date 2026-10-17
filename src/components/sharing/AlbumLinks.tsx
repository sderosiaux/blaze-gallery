"use client";

import Link from "next/link";
import { ArrowRight, Copy, RotateCw } from "lucide-react";
import { Button, IconButton, Skeleton } from "@/components/ui";
import { formatCount } from "@/lib/albums";
import { shareState, shareUrl, type ShareLink } from "@/lib/shareClient";
import { cn } from "@/lib/cn";
import { ShareBadges } from "./ShareBadges";
import { expiryLabel, relativeTime } from "./shareFormat";
import { useCopyLink } from "./useCopyLink";

interface AlbumLinksProps {
  links: ShareLink[] | null;
  error: boolean;
  onRetry: () => void;
  /** The link just created in this dialog, marked so it is easy to find. */
  highlightToken?: string;
}

/** Every link ever made for one album, newest first, so a second share is a deliberate choice. */
export default function AlbumLinks({ links, error, onRetry, highlightToken }: AlbumLinksProps) {
  const copy = useCopyLink();

  return (
    <section aria-labelledby="album-links-title" className="mt-6 border-t border-line pt-5">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h3 id="album-links-title" className="kicker">
          Links for this album
        </h3>
        <Link
          href="/admin/shares"
          className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
        >
          All shared links
          <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>

      {error ? (
        <div className="flex items-center justify-between gap-3 py-2 text-sm text-ink-muted">
          <span>Existing links didn&apos;t load.</span>
          <Button size="sm" variant="ghost" icon={RotateCw} onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : links === null ? (
        <div role="status" aria-label="Loading links" className="space-y-3 py-1">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-4/5" />
        </div>
      ) : links.length === 0 ? (
        <p className="py-2 text-sm text-ink-muted">No links yet. The one you create here will be the first.</p>
      ) : (
        <ul className="divide-y divide-line">
          {links.map((link) => {
            const state = shareState(link);
            const active = state === "active";
            const isNew = link.share_token === highlightToken;
            return (
              <li key={link.share_token} className={cn("flex items-center gap-3 py-2.5", !active && "opacity-70")}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ShareBadges share={link} />
                    {isNew && <span className="text-xs font-medium text-accent-strong">Just created</span>}
                  </div>
                  <p className="tabular mt-1 text-xs text-ink-muted">
                    Created {relativeTime(link.created_at)} · {formatCount(link.view_count, "view")}
                    {state !== "revoked" && <> · {expiryLabel(link)}</>}
                  </p>
                </div>
                {active && (
                  <IconButton icon={Copy} label="Copy link" size="sm" onClick={() => copy(shareUrl(link.share_token))} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
