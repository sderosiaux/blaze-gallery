"use client";

import { useEffect, useRef, useState } from "react";
import { ImageOff, RotateCcw, RotateCw, SearchX } from "lucide-react";
import PhotoGrid, { PhotoGridSkeleton } from "@/components/PhotoGrid";
import { Button, EmptyState } from "@/components/ui";
import { FilterNotice } from "@/components/find/FilterNotice";
import { LoadError } from "@/components/find/LoadError";
import { useTimelineFeed } from "@/components/find/useTimelineFeed";
import { filterKey, NO_URL_FILTER, type UrlFilter } from "@/lib/photoFilter";

/** How far below the viewport the next page starts loading. */
const PREFETCH_MARGIN = "0px 0px 1600px 0px";
/** The viewer fetches the next page this many photos before the last one. */
const VIEWER_PREFETCH = 6;

/**
 * A folder's photos and those of its sub-folders passing the filter,
 * newest first, as Chronologie lists them: dated photos of the gallery
 * only, so a folder out of the gallery keeps none.
 */
export default function FilteredPhotos({
  path,
  filter,
  onFilterChange,
  outOfGallery,
  selectedPhotoId,
  onPhotoUrlChange,
}: {
  path: string;
  filter: UrlFilter;
  onFilterChange: (next: UrlFilter) => void;
  outOfGallery: boolean;
  selectedPhotoId: string | null;
  onPhotoUrlChange: (id: string | null) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const { feed, setFeed, loadMore } = useTimelineFeed(
    filter,
    filterKey(filter),
    path,
    null,
    attempt,
  );
  const { phase, cursor, items } = feed;

  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || phase !== "ready" || !cursor) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) loadMore();
      },
      { rootMargin: PREFETCH_MARGIN },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [phase, cursor, loadMore]);

  const count = items.length;
  const selectedIndex = selectedPhotoId
    ? items.findIndex((p) => String(p.id) === selectedPhotoId)
    : -1;
  useEffect(() => {
    if (selectedIndex !== -1 && selectedIndex >= count - VIEWER_PREFETCH)
      loadMore();
  }, [selectedIndex, count, phase, loadMore]);

  if (outOfGallery)
    return (
      <EmptyState
        icon={ImageOff}
        title="Ce dossier est hors galerie : les filtres n’y cherchent pas"
        action={
          <Button
            variant="secondary"
            icon={RotateCcw}
            onClick={() => {
              onFilterChange(NO_URL_FILTER);
            }}
          >
            Effacer le filtre
          </Button>
        }
        className="py-16"
      />
    );
  if (phase === "error")
    return (
      <LoadError
        title="Ces photos n'ont pas pu être chargées"
        onRetry={() => {
          setAttempt((n) => n + 1);
        }}
      />
    );
  if (phase === "loading") return <PhotoGridSkeleton count={12} />;
  if (count === 0)
    return (
      <>
        <FilterNotice notes={feed.notes} />
        <EmptyState
          icon={SearchX}
          title="Aucune photo pour ce filtre dans ce dossier"
          action={
            <Button
              variant="secondary"
              icon={RotateCcw}
              onClick={() => {
                onFilterChange(NO_URL_FILTER);
              }}
            >
              Effacer le filtre
            </Button>
          }
          className="py-16"
        />
      </>
    );

  return (
    <>
      <FilterNotice notes={feed.notes} />
      <PhotoGrid
        photos={items}
        selectedPhotoId={selectedPhotoId}
        onPhotoUrlChange={onPhotoUrlChange}
        onPhotoDeleted={(deleted) => {
          setFeed((f) => ({
            ...f,
            items: f.items.filter((p) => String(p.id) !== String(deleted.id)),
          }));
        }}
      />
      <div ref={sentinel} aria-hidden />
      {phase === "more" && (
        <div className="mt-1">
          <PhotoGridSkeleton count={8} />
        </div>
      )}
      {phase === "more-error" && (
        <div className="flex flex-col items-center gap-3 py-12 text-center text-sm text-ink-muted">
          <p>Les photos suivantes n&apos;ont pas pu être chargées.</p>
          <Button
            variant="secondary"
            size="sm"
            icon={RotateCw}
            onClick={() => {
              loadMore(true);
            }}
          >
            Réessayer
          </Button>
        </div>
      )}
    </>
  );
}
