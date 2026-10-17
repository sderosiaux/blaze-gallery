"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Heart, Library } from "lucide-react";
import type { Photo } from "@/types";
import AppLayout from "@/components/AppLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import PhotoGrid, { PhotoGridSkeleton } from "@/components/PhotoGrid";
import { ButtonLink, EmptyState, MetaDot, PageHeader, PageSkeleton, Skeleton, useToast } from "@/components/ui";
import { LoadError } from "@/components/find/LoadError";
import { setFavorite } from "@/components/find/favorites";
import { usePhotoParam } from "@/components/find/usePhotoParam";
import { formatCount, formatDateRange, photoDateRange } from "@/lib/albums";

type FavoritePhoto = Photo & { folder_path?: string | null };

/** Newest first; photos whose date hasn't been read yet come last, by name. */
function newestFirst(a: Photo, b: Photo) {
  const da = a.metadata?.date_taken;
  const db = b.metadata?.date_taken;
  if (da && db && da !== db) return da < db ? 1 : -1;
  if (da && !db) return -1;
  if (!da && db) return 1;
  return a.filename.localeCompare(b.filename);
}

const sameId = (a: Pick<Photo, "id">, b: Pick<Photo, "id">) => String(a.id) === String(b.id);

function FavoritesContent() {
  const toast = useToast();
  const [selectedPhotoId, setPhotoParam] = usePhotoParam();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [photos, setPhotos] = useState<FavoritePhoto[]>([]);

  // Un-hearted while the viewer is open: they stay put until it closes, so
  // previous/next keep working on the list the viewer was opened with.
  const pending = useRef(new Set<string>());
  const viewerOpen = selectedPhotoId !== null;
  const viewerOpenRef = useRef(viewerOpen);
  viewerOpenRef.current = viewerOpen;

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const response = await fetch("/api/favorites");
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error);
      setPhotos([...(data.photos as FavoritePhoto[])].sort(newestFirst));
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (viewerOpen || pending.current.size === 0) return;
    const gone = pending.current;
    pending.current = new Set();
    setPhotos((all) => all.filter((p) => p.is_favorite || !gone.has(String(p.id))));
  }, [viewerOpen]);

  const restore = useCallback((photo: FavoritePhoto) => {
    pending.current.delete(String(photo.id));
    setPhotos((all) =>
      all.some((p) => sameId(p, photo))
        ? all.map((p) => (sameId(p, photo) ? { ...p, is_favorite: true } : p))
        : [...all, { ...photo, is_favorite: true }].sort(newestFirst),
    );
  }, []);

  const undo = useCallback(
    async (photo: FavoritePhoto) => {
      try {
        await setFavorite(photo, true);
        restore(photo);
        toast.show("Back in your favorites.", "success");
      } catch {
        toast.show("Couldn't put it back. Try again.", "error");
      }
    },
    [restore, toast],
  );

  const onPhotoUpdated = useCallback(
    (updated: FavoritePhoto) => {
      if (updated.is_favorite) {
        restore(updated);
        return;
      }
      if (viewerOpenRef.current) {
        pending.current.add(String(updated.id));
        setPhotos((all) => all.map((p) => (sameId(p, updated) ? { ...p, is_favorite: false } : p)));
      } else {
        setPhotos((all) => all.filter((p) => !sameId(p, updated)));
      }
      toast.show("Removed from favorites.", "info", { action: { label: "Undo", onClick: () => undo(updated) } });
    },
    [restore, toast, undo],
  );

  const kept = useMemo(() => photos.filter((p) => p.is_favorite), [photos]);
  const albumCount = useMemo(() => new Set(kept.map((p) => p.folder_path ?? "")).size, [kept]);
  const span = useMemo(() => {
    const { from, to } = photoDateRange(kept);
    return formatDateRange(from, to);
  }, [kept]);

  if (status === "error") {
    return (
      <>
        <PageHeader title="Favorites" />
        <LoadError title="Your favorites didn't load" onRetry={load} />
      </>
    );
  }

  if (status === "loading") {
    return (
      <>
        <PageHeader title="Favorites" meta={<Skeleton className="h-4 w-48" />} />
        <PhotoGridSkeleton />
      </>
    );
  }

  if (photos.length === 0) {
    return (
      <>
        <PageHeader title="Favorites" />
        <EmptyState
          icon={Heart}
          title="Nothing kept here yet"
          body="Tap the heart on any photo, in an album or in the viewer, and it will wait for you here."
          action={
            <>
              <ButtonLink href="/" variant="primary" icon={Library}>
                Open the library
              </ButtonLink>
              <ButtonLink href="/timeline" variant="secondary" icon={CalendarDays}>
                Browse by date
              </ButtonLink>
            </>
          }
          className="py-20"
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Favorites"
        meta={
          <>
            <span className="tabular inline-flex items-center gap-1.5">
              <Heart className="h-3.5 w-3.5 fill-current text-favorite" aria-hidden />
              {formatCount(kept.length, "photo")}
            </span>
            {albumCount > 0 && (
              <>
                <MetaDot />
                <span className="tabular">from {formatCount(albumCount, "album")}</span>
              </>
            )}
            {span && (
              <>
                <MetaDot />
                <span>{span}</span>
              </>
            )}
          </>
        }
      />
      <PhotoGrid
        photos={photos}
        selectedPhotoId={selectedPhotoId}
        onPhotoUrlChange={setPhotoParam}
        onPhotoUpdated={onPhotoUpdated}
      />
    </>
  );
}

export default function FavoritesPage() {
  return (
    <AppLayout>
      <ProtectedRoute>
        <Suspense fallback={<PageSkeleton />}>
          <FavoritesContent />
        </Suspense>
      </ProtectedRoute>
    </AppLayout>
  );
}
