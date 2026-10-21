"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Layers, RotateCcw, Sparkles } from "lucide-react";
import { Badge, Button, IconButton, Skeleton, useToast } from "@/components/ui";
import { asArray, readJsonObject } from "@/hooks/apiJson";
import { aspectRatio, formatCount } from "@/lib/albums";
import { cn } from "@/lib/cn";
import { thumbnailUrl } from "@/lib/photoUrls";
import { userRotation } from "@/lib/rotation";
import PhotoViewer from "@/components/PhotoViewer";
import { restoreFromTrash } from "@/lib/trashClient";
import type { Photo } from "@/types";
import TrashProofPanel, { forgetProof, restoreShown } from "./TrashProof";

/** A lot of the Corbeille (lib/trash.ts TrashLotSummary). */
export interface Lot {
  batch: string;
  by: "owner" | "auto";
  photos: number;
  stacks: number;
  trashed_at: string;
}

type LotPhoto = Photo & { folder_path: string };

interface LotStack {
  kept: (LotPhoto & { trashed: boolean }) | null;
  trashed: LotPhoto[];
}

/** px, the h-28 of a lot's thumbnails */
const TILE_HEIGHT = 112;

/** What the lot was, from its id (lib/trash.ts newLot): who, then what. */
export function lotTitle(lot: Lot): string {
  const what = lot.batch.split("-")[1] ?? "";
  if (lot.by === "auto") {
    if (!what.startsWith("copies")) return "Quasi-doublons";
    if (what.endsWith(".same")) return "Copies identiques, même dossier";
    if (what.endsWith(".other")) return "Copies identiques, autre dossier";
    return "Copies identiques";
  }
  return what === "stacks" ? "Piles réglées" : "Photos";
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export async function fetchLots(): Promise<Lot[]> {
  const response = await fetch("/api/trash/lots");
  const data = await readJsonObject(response);
  if (!response.ok || data.success !== true) throw new Error("lots");
  return asArray(data.lots) as Lot[];
}

/** The lots, last first: open one, or put it back whole. */
export function LotList({
  lots,
  onOpen,
  onRestore,
}: {
  lots: Lot[];
  onOpen: (lot: Lot) => void;
  onRestore: (lot: Lot) => void;
}) {
  return (
    <ul className="mb-8 divide-y divide-line rounded-lg border border-line">
      {lots.map((lot) => (
        <li
          key={lot.batch}
          className="flex flex-wrap items-center gap-3 px-4 py-3"
        >
          <Badge
            tone={lot.by === "auto" ? "info" : "neutral"}
            icon={lot.by === "auto" ? Sparkles : Layers}
          >
            {lot.by === "auto" ? "Automatique" : "Vous"}
          </Badge>
          <button
            type="button"
            onClick={() => {
              onOpen(lot);
            }}
            className="min-w-0 flex-1 text-left transition-colors duration-200 hover:text-ink-soft"
          >
            <span className="font-medium text-ink">{lotTitle(lot)}</span>
            <span className="tabular ml-2 text-sm text-ink-muted">
              {formatCount(lot.photos, "photo")}
              {lot.stacks > 0 && ` · ${formatCount(lot.stacks, "pile")}`} ·{" "}
              {when(lot.trashed_at)}
            </span>
          </button>
          <Button
            size="sm"
            onClick={() => {
              onOpen(lot);
            }}
          >
            Voir
          </Button>
          <Button
            size="sm"
            icon={RotateCcw}
            onClick={() => {
              onRestore(lot);
            }}
          >
            Restaurer le lot
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** A lot's stacks, each beside the photo kept in its place. */
export function LotView({
  lot,
  onBack,
  onRestore,
}: {
  lot: Lot;
  onBack: () => void;
  onRestore: (lot: Lot) => void;
}) {
  const toast = useToast();
  const [stacks, setStacks] = useState<LotStack[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [open, setOpen] = useState<Photo | null>(null);
  // The viewer walks the lot's photos in the Corbeille, stack after stack
  const shown = useMemo(
    () => (stacks ?? []).flatMap((stack) => stack.trashed),
    [stacks],
  );

  const load = useCallback(
    async (after: number | null) => {
      const query = after === null ? "" : `?after=${after}`;
      const response = await fetch(
        `/api/trash/lots/${encodeURIComponent(lot.batch)}${query}`,
      );
      const data = await readJsonObject(response);
      if (!response.ok || data.success !== true) throw new Error("lot");
      return {
        stacks: asArray(data.stacks) as LotStack[],
        next: typeof data.next === "number" ? data.next : null,
      };
    },
    [lot.batch],
  );

  useEffect(() => {
    load(null)
      .then((page) => {
        setStacks(page.stacks);
        setNext(page.next);
      })
      .catch(() => {
        toast.show("Le lot n’a pas pu être chargé", "error");
      });
  }, [load, toast]);

  const more = async () => {
    if (next === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await load(next);
      setStacks((s) => [...(s ?? []), ...page.stacks]);
      setNext(page.next);
    } catch {
      toast.show("La suite n’a pas pu être chargée", "error");
    } finally {
      setLoadingMore(false);
    }
  };

  const restoreOne = async (photo: LotPhoto) => {
    setStacks((s) =>
      (s ?? [])
        .map((stack) => ({
          ...stack,
          trashed: stack.trashed.filter((p) => p.id !== photo.id),
        }))
        .filter((stack) => stack.trashed.length > 0),
    );
    try {
      await restoreFromTrash([photo.id]);
      toast.show("Restaurée", "success");
    } catch {
      toast.show("La photo n’est pas revenue", "error");
    }
  };

  const restoreViewed = (photo: Photo) => {
    const at = shown.findIndex((p) => String(p.id) === String(photo.id));
    const where = (stacks ?? []).findIndex((stack) =>
      stack.trashed.some((p) => String(p.id) === String(photo.id)),
    );
    const before = stacks?.[where];
    void restoreShown(toast, photo, {
      gone: () => {
        setOpen(shown[at + 1] ?? shown[at - 1] ?? null);
        setStacks((s) =>
          (s ?? [])
            .map((stack) => ({
              ...stack,
              trashed: stack.trashed.filter(
                (p) => String(p.id) !== String(photo.id),
              ),
            }))
            .filter((stack) => stack.trashed.length > 0),
        );
      },
      back: () => {
        if (!before) return;
        forgetProof(photo.id);
        setStacks((s) => {
          const list = s ?? [];
          const key = (stack: LotStack) =>
            String(stack.kept?.id ?? stack.trashed[0]?.id);
          const i = list.findIndex((stack) => key(stack) === key(before));
          // Its stack as it was: still there with the others, or back alone
          if (i === -1) {
            const copy = [...list];
            copy.splice(Math.min(where, copy.length), 0, before);
            return copy;
          }
          return list.map((stack, j) => (j === i ? before : stack));
        });
      },
    });
  };

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Button icon={ArrowLeft} size="sm" onClick={onBack}>
          Toute la corbeille
        </Button>
        <span className="font-medium text-ink">{lotTitle(lot)}</span>
        <span className="tabular text-sm text-ink-muted">
          {formatCount(lot.photos, "photo")} · {when(lot.trashed_at)}
        </span>
        <Button
          size="sm"
          icon={RotateCcw}
          className="ml-auto"
          onClick={() => {
            onRestore(lot);
          }}
        >
          Restaurer le lot
        </Button>
      </div>
      {stacks === null ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {stacks.map((stack) => (
            <li
              key={stack.kept?.id ?? stack.trashed[0]?.id}
              className="flex flex-wrap items-start gap-2 py-4"
            >
              {stack.kept && (
                <Tile photo={stack.kept} kept>
                  <Badge tone="success" className="absolute left-1.5 top-1.5">
                    {stack.kept.trashed ? "Gardée, puis jetée" : "Gardée"}
                  </Badge>
                </Tile>
              )}
              {stack.trashed.map((photo) => (
                <Tile
                  key={photo.id}
                  photo={photo}
                  onOpen={() => {
                    setOpen(photo);
                  }}
                >
                  <IconButton
                    icon={RotateCcw}
                    label={`Restaurer ${photo.filename}`}
                    size="sm"
                    variant="overlay"
                    onClick={() => void restoreOne(photo)}
                    className="absolute right-1.5 top-1.5"
                  />
                </Tile>
              ))}
            </li>
          ))}
        </ul>
      )}
      {next !== null && (
        <div className="mt-6 flex justify-center">
          <Button loading={loadingMore} onClick={() => void more()}>
            Afficher la suite
          </Button>
        </div>
      )}
      {open && (
        <PhotoViewer
          photo={open}
          photos={shown}
          onClose={() => {
            setOpen(null);
          }}
          onPhotoChange={setOpen}
          aside={(photo) => (
            <TrashProofPanel photo={photo} onRestore={restoreViewed} />
          )}
        />
      )}
    </>
  );
}

function Tile({
  photo,
  kept = false,
  onOpen,
  children,
}: {
  photo: LotPhoto;
  kept?: boolean;
  /** Opens the photo in the viewer */
  onOpen?: () => void;
  children: React.ReactNode;
}) {
  // Sized before it loads: a lazy image of no width never comes into view
  const width = Math.min(224, Math.round(TILE_HEIGHT * aspectRatio(photo)));
  return (
    <figure className="flex flex-col gap-1" style={{ width }}>
      <span
        className={cn(
          "relative block overflow-hidden rounded-md outline outline-2 outline-offset-2",
          kept ? "outline-ink" : "outline-transparent",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- the app's 400 px thumbnails */}
        <img
          src={thumbnailUrl(photo.id, undefined, userRotation(photo.metadata))}
          alt=""
          loading="lazy"
          decoding="async"
          className={cn(
            "h-28 w-full bg-surface-sunken object-cover",
            !kept && "opacity-70",
          )}
        />
        {onOpen && (
          <button
            type="button"
            aria-label={`Ouvrir ${photo.filename}`}
            onClick={onOpen}
            className="absolute inset-0 rounded-md outline-offset-2 cursor-zoom-in"
          />
        )}
        {children}
      </span>
      <figcaption
        className="truncate text-xs text-ink-muted"
        title={`${photo.folder_path}/${photo.filename}`}
      >
        {photo.folder_path}
      </figcaption>
    </figure>
  );
}
