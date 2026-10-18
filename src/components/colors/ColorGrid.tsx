"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Palette, RotateCw } from "lucide-react";
import PhotoGrid, { PhotoGridSkeleton } from "@/components/PhotoGrid";
import { Button, ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import ColorFilterBar from "@/components/find/ColorFilterBar";
import { LoadError } from "@/components/find/LoadError";
import { usePhotoParam } from "@/components/find/usePhotoParam";
import { filterAdjective, filterLabel, type ColorFilter } from "@/lib/colors";
import { useColorPhotos } from "./useColorPhotos";

/** How far below the viewport the next page starts loading. */
const PREFETCH_MARGIN = "0px 0px 1600px 0px";
/** The viewer fetches the next page this many photos before the last one. */
const VIEWER_PREFETCH = 6;

/** Every photo holding a color, or in a tone, most marked first. */
export default function ColorGrid({
  colors,
  onColorsChange,
}: {
  colors: ColorFilter;
  onColorsChange: (next: ColorFilter) => void;
}) {
  const [selectedPhotoId, setPhotoParam] = usePhotoParam();
  const [attempt, setAttempt] = useState(0);
  const { feed, loadMore, remove } = useColorPhotos(colors, attempt);
  const { phase, cursor } = feed;

  // Scrolling near the end of the grid brings the next page.
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

  // The viewer walks every loaded photo: near the last one, fetch the next page.
  const count = feed.items.length;
  const selectedIndex = selectedPhotoId
    ? feed.items.findIndex((p) => String(p.id) === selectedPhotoId)
    : -1;
  useEffect(() => {
    if (selectedIndex !== -1 && selectedIndex >= count - VIEWER_PREFETCH)
      loadMore();
  }, [selectedIndex, count, phase, loadMore]);

  const header = (
    <>
      <PageHeader
        kicker={
          <Link
            href="/couleurs"
            className="inline-flex items-center gap-1 transition-colors hover:text-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Couleurs
          </Link>
        }
        title={filterLabel(colors)}
      />
      <ColorFilterBar
        filter={colors}
        onChange={onColorsChange}
        className="mb-6"
      />
    </>
  );

  if (phase === "error") {
    return (
      <>
        {header}
        <LoadError
          title="Ces photos n'ont pas pu être chargées"
          onRetry={() => {
            setAttempt((n) => n + 1);
          }}
        />
      </>
    );
  }

  if (phase === "loading") {
    return (
      <>
        {header}
        <PhotoGridSkeleton />
      </>
    );
  }

  if (count === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={Palette}
          title={`Aucune photo ${filterAdjective(colors)} pour l'instant`}
          action={
            <ButtonLink href="/couleurs" variant="secondary" icon={ArrowLeft}>
              Toutes les couleurs
            </ButtonLink>
          }
          className="py-20"
        />
      </>
    );
  }

  return (
    <>
      {header}
      <PhotoGrid
        photos={feed.items}
        selectedPhotoId={selectedPhotoId}
        onPhotoUrlChange={setPhotoParam}
        onPhotoDeleted={(deleted) => {
          remove(deleted.id);
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
