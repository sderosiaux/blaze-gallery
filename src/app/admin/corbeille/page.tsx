"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, RotateCcw, RotateCw, Trash2 } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import PhotoViewer from "@/components/PhotoViewer";
import JustifiedGrid from "@/components/photos/JustifiedGrid";
import PhotoTile from "@/components/photos/PhotoTile";
import { PhotoGridSkeleton } from "@/components/PhotoGrid";
import {
  Button,
  Dialog,
  EmptyState,
  IconButton,
  PageHeader,
  useToast,
} from "@/components/ui";
import { asArray, readJsonObject } from "@/hooks/apiJson";
import { formatCount } from "@/lib/albums";
import { restoreFromTrash, TrashError } from "@/lib/trashClient";
import type { Photo } from "@/types";

/** Days a photo waits in the Corbeille (lib/trash.ts TRASH_DAYS). */
const TRASH_DAYS = 30;

type TrashedPhoto = Photo & { trashed_at: string };

interface Page {
  photos: TrashedPhoto[];
  total: number;
  /** When the server counted `total`: the cutoff of « Vider » */
  asOf: string;
  next: { trashedAt: string; id: number } | null;
}

async function fetchTrash(after: Page["next"]): Promise<Page> {
  const query = after
    ? `?after=${encodeURIComponent(after.trashedAt)}&id=${after.id}`
    : "";
  const response = await fetch(`/api/trash${query}`);
  const data = await readJsonObject(response);
  if (!response.ok || data.success !== true) throw new Error("trash");
  return {
    photos: asArray(data.photos) as TrashedPhoto[],
    total: Number(data.total),
    asOf: String(data.as_of),
    next: (data.next as Page["next"]) ?? null,
  };
}

/** Whole days left before the purge erases it, 0 on its last day. */
function daysLeft(trashedAt: string): number {
  const elapsed = (Date.now() - Date.parse(trashedAt)) / 86_400_000;
  return Math.max(0, Math.ceil(TRASH_DAYS - elapsed));
}

export default function TrashPage() {
  return (
    <AppLayout>
      <ProtectedRoute>
        <Trash />
      </ProtectedRoute>
    </AppLayout>
  );
}

function Trash() {
  const toast = useToast();
  const [page, setPage] = useState<Page | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [open, setOpen] = useState<Photo | null>(null);
  const [emptying, setEmptying] = useState<{
    expected: number;
    cutoff: string;
  } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setPage(await fetchTrash(null));
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    document.title = "Corbeille · Blaze Gallery";
    void load();
  }, [load]);

  const more = async () => {
    if (!page?.next || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await fetchTrash(page.next);
      setPage((p) =>
        p ? { ...next, photos: [...p.photos, ...next.photos] } : next,
      );
    } catch {
      toast.show("La suite n’a pas pu être chargée", "error");
    } finally {
      setLoadingMore(false);
    }
  };

  const restore = async (photo: TrashedPhoto) => {
    setPage((p) =>
      p
        ? {
            ...p,
            photos: p.photos.filter((x) => x.id !== photo.id),
            total: p.total - 1,
          }
        : p,
    );
    try {
      await restoreFromTrash([photo.id]);
      toast.show("Restaurée", "success");
    } catch {
      toast.show("La photo n’est pas revenue", "error");
      void load();
    }
  };

  const restoreAll = async () => {
    try {
      const n = await restoreFromTrash("all");
      setPage((p) => p && { ...p, photos: [], total: 0, next: null });
      toast.show(
        formatCount(n, "photo restaurée", "photos restaurées"),
        "success",
      );
    } catch {
      toast.show("Les photos ne sont pas revenues", "error");
      void load();
    }
  };

  // « Vider »: a batch per request until none is left, never more than confirmed
  const empty = async (confirmed: { expected: number; cutoff: string }) => {
    setProgress(0);
    let done = 0;
    try {
      for (;;) {
        const response = await fetch("/api/trash/empty", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(confirmed),
        });
        const data = await readJsonObject(response);
        done += Number(data.purged ?? 0);
        setProgress(done);
        if (!response.ok || data.success !== true)
          throw new TrashError(
            typeof data.error === "string"
              ? data.error
              : "La corbeille n’a pas été vidée",
          );
        if (Number(data.remaining) === 0) break;
        // What is left is another purge's, running now
        if (Number(data.purged) === 0)
          throw new TrashError(
            "Une autre suppression est en cours. Réessayez dans un moment.",
          );
      }
      toast.show(
        formatCount(done, "photo effacée", "photos effacées"),
        "success",
      );
    } catch (error) {
      toast.show(
        error instanceof TrashError
          ? error.message
          : "La corbeille n’a pas été vidée",
        "error",
      );
    } finally {
      setEmptying(null);
      setProgress(null);
      void load();
    }
  };

  const total = page?.total ?? 0;
  const header = (
    <PageHeader
      title="Corbeille"
      meta={`Les photos y restent ${TRASH_DAYS} jours, puis sont effacées du stockage.`}
      actions={
        total > 0 && (
          <>
            <Button icon={RotateCcw} onClick={() => void restoreAll()}>
              Tout restaurer
            </Button>
            <Button
              variant="danger"
              icon={Trash2}
              onClick={() => {
                if (page) setEmptying({ expected: total, cutoff: page.asOf });
              }}
            >
              Vider la corbeille
            </Button>
          </>
        )
      }
    />
  );

  if (failed && !page)
    return (
      <>
        {header}
        <EmptyState
          icon={AlertCircle}
          title="La corbeille n'a pas pu être chargée"
          action={
            <Button
              variant="primary"
              icon={RotateCw}
              onClick={() => void load()}
            >
              Réessayer
            </Button>
          }
        />
      </>
    );

  if (!page)
    return (
      <>
        {header}
        <PhotoGridSkeleton />
      </>
    );

  return (
    <>
      {header}
      {page.photos.length === 0 ? (
        <EmptyState
          icon={Trash2}
          title="La corbeille est vide"
          body={`Une photo mise à la corbeille y reste ${TRASH_DAYS} jours, le temps de changer d’avis.`}
        />
      ) : (
        <>
          <p className="tabular mb-3 text-sm text-ink-muted">
            {formatCount(total, "photo")}
          </p>
          <JustifiedGrid
            photos={page.photos}
            renderTile={(photo, size) => (
              <div
                className="group relative"
                style={{ width: size.width, height: size.height }}
              >
                <PhotoTile
                  photo={photo}
                  width={size.width}
                  height={size.height}
                  onOpen={setOpen}
                />
                <span className="tabular pointer-events-none absolute bottom-1.5 left-1.5 rounded-full bg-scrim/45 px-1.5 py-0.5 text-[11px] font-medium leading-none text-on-photo backdrop-blur-sm">
                  {daysLeft((photo as TrashedPhoto).trashed_at)} j
                </span>
                <IconButton
                  icon={RotateCcw}
                  label={`Restaurer ${photo.filename}`}
                  size="sm"
                  variant="overlay"
                  onClick={() => void restore(photo as TrashedPhoto)}
                  className="absolute right-1.5 top-1.5 opacity-0 transition-opacity duration-200 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                />
              </div>
            )}
          />
          {page.next && (
            <div className="mt-6 flex justify-center">
              <Button loading={loadingMore} onClick={() => void more()}>
                Afficher la suite
              </Button>
            </div>
          )}
        </>
      )}

      {open && (
        <PhotoViewer
          photo={open}
          photos={page.photos}
          onClose={() => {
            setOpen(null);
          }}
          onPhotoChange={setOpen}
        />
      )}

      <Dialog
        open={emptying !== null}
        onClose={() => {
          // Once started it goes on: each batch is erased for good
          if (progress === null) setEmptying(null);
        }}
        size="sm"
        title={"Vider la corbeille ?"}
        description={
          progress === null
            ? `${formatCount(emptying?.expected ?? 0, "photo sera effacée", "photos seront effacées")} du stockage, définitivement.`
            : `Effacement : ${progress} sur ${emptying?.expected ?? 0}`
        }
        footer={
          <>
            <Button
              data-autofocus
              disabled={progress !== null}
              onClick={() => {
                setEmptying(null);
              }}
            >
              Garder
            </Button>
            <Button
              variant="danger"
              loading={progress !== null}
              onClick={() => {
                if (emptying) void empty(emptying);
              }}
            >
              Effacer
            </Button>
          </>
        }
      />
    </>
  );
}
