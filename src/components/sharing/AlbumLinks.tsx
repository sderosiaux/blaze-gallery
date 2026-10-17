"use client";

import Link from "next/link";
import { ArrowRight, Copy, RotateCw } from "lucide-react";
import { Button, IconButton, Skeleton } from "@/components/ui";
import { shareState, shareUrl, type ShareLink } from "@/lib/shareClient";
import { cn } from "@/lib/cn";
import { ShareBadges } from "./ShareBadges";
import { formatInstant } from "./shareFormat";
import { useCopyLink } from "./useCopyLink";

interface AlbumLinksProps {
  links: ShareLink[] | null;
  error: boolean;
  onRetry: () => void;
  /** The link just created in this dialog, marked so it is easy to find. */
  highlightToken?: string;
}

/** Every link already made for this folder, newest first, so a second one is a deliberate choice. */
export default function AlbumLinks({
  links,
  error,
  onRetry,
  highlightToken,
}: AlbumLinksProps) {
  const copy = useCopyLink();
  if (links && links.length === 0 && !error) return null;

  return (
    <section
      aria-labelledby="album-links-title"
      className="mt-6 border-t border-line pt-5"
    >
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <h3 id="album-links-title" className="text-sm font-medium text-ink">
          Liens de ce dossier
        </h3>
        <Link
          href="/admin/shares"
          className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
        >
          Liens partagés
          <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>

      {error ? (
        <div className="flex items-center justify-between gap-3 py-2 text-sm text-ink-muted">
          <span>Les liens n&apos;ont pas pu être chargés.</span>
          <Button size="sm" variant="ghost" icon={RotateCw} onClick={onRetry}>
            Réessayer
          </Button>
        </div>
      ) : links === null ? (
        <div role="status" aria-label="Chargement" className="space-y-3 py-1">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-4/5" />
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {links.map((link) => {
            const active = shareState(link) === "active";
            return (
              <li
                key={link.share_token}
                className="flex min-h-[3.25rem] items-center gap-3 py-2"
              >
                <div
                  className={cn(
                    "flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1",
                    !active && "opacity-70",
                  )}
                >
                  <ShareBadges share={link} />
                  <span className="tabular text-xs text-ink-muted">
                    Créé le {formatInstant(link.created_at)}
                  </span>
                  {link.share_token === highlightToken && (
                    <span className="text-xs font-medium text-ink">
                      Nouveau
                    </span>
                  )}
                </div>
                {active && (
                  <IconButton
                    icon={Copy}
                    label="Copier le lien"
                    size="sm"
                    onClick={() => void copy(shareUrl(link.share_token))}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
