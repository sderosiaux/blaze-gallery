"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Heart, Library } from "lucide-react";
import type { Photo } from "@/types";
import AppLayout from "@/components/AppLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import PhotoGrid, { PhotoGridSkeleton } from "@/components/PhotoGrid";
import {
  ButtonLink,
  EmptyState,
  PageHeader,
  PageSkeleton,
  useToast,
} from "@/components/ui";
import { LoadError } from "@/components/find/LoadError";
import { setFavorite } from "@/components/find/favorites";
import { usePhotoParam } from "@/components/find/usePhotoParam";
import { asString, readJsonObject } from "@/hooks/apiJson";

/** Newest first; photos whose date hasn't been read yet come last, by name. */
function newestFirst(a: Photo, b: Photo) {
  const da = a.metadata?.date_taken;
  const db = b.metadata?.date_taken;
  if (da && db && da !== db) return da < db ? 1 : -1;
  if (da && !db) return -1;
  if (!da && db) return 1;
  return a.filename.localeCompare(b.filename);
}

const sameId = (a: Pick<Photo, "id">, b: Pick<Photo, "id">) =>
  String(a.id) === String(b.id);

function FavoritesContent() {
  const toast = useToast();
  const [selectedPhotoId, setPhotoParam] = usePhotoParam();
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [photos, setPhotos] = useState<Photo[]>([]);

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
      const data = await readJsonObject(response);
      if (!response.ok || !data.success) throw new Error(asString(data.error));
      if (!Array.isArray(data.photos)) throw new Error("invalid_photos");
      setPhotos([...(data.photos as Photo[])].sort(newestFirst));
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (viewerOpen || pending.current.size === 0) return;
    const gone = pending.current;
    pending.current = new Set();
    setPhotos((all) =>
      all.filter((p) => p.is_favorite || !gone.has(String(p.id))),
    );
  }, [viewerOpen]);

  const restore = useCallback((photo: Photo) => {
    pending.current.delete(String(photo.id));
    setPhotos((all) =>
      all.some((p) => sameId(p, photo))
        ? all.map((p) => (sameId(p, photo) ? { ...p, is_favorite: true } : p))
        : [...all, { ...photo, is_favorite: true }].sort(newestFirst),
    );
  }, []);

  const undo = useCallback(
    async (photo: Photo) => {
      try {
        await setFavorite(photo, true);
        restore(photo);
      } catch {
        toast.show(
          "La photo n'a pas pu être remise dans les favoris.",
          "error",
        );
      }
    },
    [restore, toast],
  );

  const onPhotoUpdated = useCallback(
    (updated: Photo) => {
      if (updated.is_favorite) {
        restore(updated);
        return;
      }
      if (viewerOpenRef.current) {
        pending.current.add(String(updated.id));
        setPhotos((all) =>
          all.map((p) =>
            sameId(p, updated) ? { ...p, is_favorite: false } : p,
          ),
        );
      } else {
        setPhotos((all) => all.filter((p) => !sameId(p, updated)));
      }
      toast.show("Retiré des favoris", "info", {
        action: { label: "Annuler", onClick: () => void undo(updated) },
      });
    },
    [restore, toast, undo],
  );

  const header = <PageHeader title="Favoris" />;

  if (status === "error") {
    return (
      <>
        {header}
        <LoadError
          title="Les favoris n'ont pas pu être chargés"
          onRetry={() => void load()}
        />
      </>
    );
  }

  if (status === "loading") {
    return (
      <>
        {header}
        <PhotoGridSkeleton />
      </>
    );
  }

  if (photos.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={Heart}
          title="Aucun favori"
          body="Touchez le cœur d'une photo pour la retrouver ici."
          action={
            <ButtonLink href="/" variant="secondary" icon={Library}>
              Ouvrir la bibliothèque
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
