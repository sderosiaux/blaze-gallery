"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Photo } from "@/types";
import PhotoViewer from "./PhotoViewer";
import JustifiedGrid from "./photos/JustifiedGrid";
import { asString, readJsonObject } from "@/hooks/apiJson";
import PhotoTile from "./photos/PhotoTile";
import { useToast } from "@/components/ui";

interface PhotoGridProps {
  photos: Photo[];
  loading?: boolean;
  selectedPhotoId?: string | null;
  onPhotoUrlChange?: (photoId: string | null) => void;
  onPhotoDeleted?: (photo: Photo) => void;
  /** Lets the page keep its own copy in sync (favorites page drops un-favorited photos). */
  onPhotoUpdated?: (photo: Photo) => void;
  isSharedView?: boolean;
  shareToken?: string;
  allowDownload?: boolean;
  sessionToken?: string;
  /** Number of tiles loaded eagerly, the first screen. */
  eagerCount?: number;
}

export function PhotoGridSkeleton({ count = 12 }: { count?: number }) {
  // Percentages, so a phone shows three or four tiles a row like the real grid.
  const widths = [22, 16, 19, 26, 17, 21, 15, 24, 19, 20, 16, 23];
  return (
    <div
      role="status"
      aria-label="Chargement des photos"
      className="flex flex-wrap gap-1"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          aria-hidden
          className="skeleton h-[110px] flex-grow rounded-sm sm:h-[170px] lg:h-[220px]"
          style={{ flexBasis: `${widths[i % widths.length]}%` }}
        />
      ))}
    </div>
  );
}

export default function PhotoGrid({
  photos,
  loading = false,
  selectedPhotoId,
  onPhotoUrlChange,
  onPhotoDeleted,
  onPhotoUpdated,
  isSharedView = false,
  shareToken,
  allowDownload = true,
  sessionToken,
  eagerCount = 18,
}: PhotoGridProps) {
  const toast = useToast();
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  // The page owns the list (it may refresh it, e.g. as thumbnails get built);
  // what happens here — favourites toggled, photos deleted — is layered on top
  // so a refreshed list never undoes it.
  const [changes, setChanges] = useState<ReadonlyMap<string, Photo>>(
    () => new Map(),
  );
  const [deleted, setDeleted] = useState<ReadonlySet<string>>(() => new Set());
  const items = useMemo(
    () =>
      photos
        .filter((p) => !deleted.has(String(p.id)))
        .map((p) => {
          const local = changes.get(String(p.id));
          return local ? { ...p, is_favorite: local.is_favorite } : p;
        }),
    [photos, changes, deleted],
  );

  useEffect(() => {
    if (!selectedPhotoId) {
      setSelectedPhoto(null);
      return;
    }
    const match = items.find((p) => String(p.id) === selectedPhotoId);
    if (match) setSelectedPhoto(match);
  }, [selectedPhotoId, items]);

  const updateOne = useCallback(
    (updated: Photo) => {
      setChanges((all) => new Map(all).set(String(updated.id), updated));
      onPhotoUpdated?.(updated);
    },
    [onPhotoUpdated],
  );

  const open = useCallback(
    (photo: Photo) => {
      setSelectedPhoto(photo);
      onPhotoUrlChange?.(String(photo.id));
    },
    [onPhotoUrlChange],
  );

  const close = () => {
    setSelectedPhoto(null);
    onPhotoUrlChange?.(null);
  };

  const saveFavorite = useCallback(
    async (photo: Photo) => {
      const optimistic = { ...photo, is_favorite: !photo.is_favorite };
      updateOne(optimistic);
      try {
        const response = await fetch(`/api/photos/${photo.id}/favorite`, {
          method: "POST",
        });
        const data = await readJsonObject(response);
        if (!data.success) throw new Error(asString(data.error));
        const isFavorite = Boolean(data.is_favorite);
        if (isFavorite !== optimistic.is_favorite)
          updateOne({ ...photo, is_favorite: isFavorite });
      } catch {
        updateOne(photo);
        toast.show("Les favoris n'ont pas pu être mis à jour.", "error");
      }
    },
    [toast, updateOne],
  );

  const toggleFavorite = useCallback(
    (photo: Photo) => {
      void saveFavorite(photo);
    },
    [saveFavorite],
  );

  if (loading) return <PhotoGridSkeleton />;
  if (items.length === 0) return null;

  return (
    <>
      <JustifiedGrid
        photos={items}
        renderTile={(photo, size, index) => (
          <PhotoTile
            photo={photo}
            width={size.width}
            height={size.height}
            eager={index < eagerCount}
            order={index}
            shareToken={isSharedView ? shareToken : undefined}
            onOpen={open}
            onToggleFavorite={isSharedView ? undefined : toggleFavorite}
          />
        )}
      />

      {selectedPhoto && (
        <PhotoViewer
          photo={selectedPhoto}
          photos={items}
          onClose={close}
          onFavoriteToggle={isSharedView ? undefined : updateOne}
          onPhotoChange={(next) => {
            setSelectedPhoto(next);
            onPhotoUrlChange?.(String(next.id));
          }}
          onDelete={
            isSharedView
              ? undefined
              : (removed) => {
                  setDeleted((all) => new Set(all).add(String(removed.id)));
                  onPhotoDeleted?.(removed);
                }
          }
          isSharedView={isSharedView}
          shareToken={shareToken}
          allowDownload={allowDownload}
          sessionToken={sessionToken}
        />
      )}
    </>
  );
}
