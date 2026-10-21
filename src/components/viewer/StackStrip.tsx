"use client";

import { Check } from "lucide-react";
import type { Photo } from "@/types";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { thumbnailUrl } from "@/lib/photoUrls";
import { userRotation } from "@/lib/rotation";

/**
 * The photos of a stack of near-duplicates, best first, under the photo:
 * one click (or ↑ ↓) shows another in its place. The list stays where it is.
 */
export default function StackStrip({
  photos,
  shown,
  onShow,
  onKeep,
  busy = false,
}: {
  photos: Photo[];
  shown: number;
  onShow: (id: number) => void;
  /** « Garder celle-ci »: the photo shown stays, the others go to the Corbeille */
  onKeep?: () => void;
  busy?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={`Pile de ${photos.length} photos`}
      className="flex max-w-full items-center gap-1 overflow-x-auto rounded-lg bg-surface/90 p-1 shadow-lift backdrop-blur-sm"
    >
      {photos.map((photo, i) => (
        <button
          key={photo.id}
          type="button"
          aria-label={`Photo ${i + 1} sur ${photos.length} de la pile`}
          aria-pressed={i === shown}
          aria-keyshortcuts="ArrowUp ArrowDown"
          onClick={() => {
            onShow(photo.id);
          }}
          className={cn(
            "h-12 w-12 shrink-0 overflow-hidden rounded-md outline-offset-1 transition-opacity duration-200",
            i === shown
              ? "outline outline-2 outline-ink"
              : "opacity-60 hover:opacity-100",
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- 48 px thumbnails the app serves */}
          <img
            src={thumbnailUrl(
              photo.id,
              undefined,
              userRotation(photo.metadata),
            )}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        </button>
      ))}
      {onKeep && (
        <Button
          variant="secondary"
          size="sm"
          icon={Check}
          loading={busy}
          onClick={onKeep}
          className="ml-1 shrink-0"
        >
          Garder celle-ci
        </Button>
      )}
    </div>
  );
}
