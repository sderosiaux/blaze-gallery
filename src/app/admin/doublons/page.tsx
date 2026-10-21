"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Layers, RotateCw, Trash2 } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import {
  Button,
  Dialog,
  EmptyState,
  PageHeader,
  Skeleton,
  Switch,
  Tabs,
  useToast,
} from "@/components/ui";
import { asArray, readJsonObject } from "@/hooks/apiJson";
import { aspectRatio, formatCount } from "@/lib/albums";
import { cn } from "@/lib/cn";
import { thumbnailUrl } from "@/lib/photoUrls";
import { userRotation } from "@/lib/rotation";
import {
  keepInStacks,
  previewKeep,
  restoreFromTrash,
  TrashError,
} from "@/lib/trashClient";
import type { Photo } from "@/types";

type Kind = "all" | "bursts" | "copies";

/** px, the h-32 of a stack's thumbnails */
const TILE_HEIGHT = 128;

type StackPhoto = Photo & { folder_path: string; rank: number };

interface Stack {
  id: number;
  photos: StackPhoto[];
  copies: boolean;
}

interface Page {
  stacks: Stack[];
  next: { taken: string; id: number } | null;
  total: { stacks: number; extra: number };
}

async function fetchStacks(kind: Kind, after: Page["next"]): Promise<Page> {
  const params = new URLSearchParams({ kind });
  if (after) {
    params.set("taken", after.taken);
    params.set("id", String(after.id));
  }
  const response = await fetch(`/api/stacks?${params.toString()}`);
  const data = await readJsonObject(response);
  if (!response.ok || data.success !== true) throw new Error("stacks");
  return {
    stacks: asArray(data.stacks) as Stack[],
    next: (data.next as Page["next"]) ?? null,
    total: data.total as Page["total"],
  };
}

export default function DuplicatesPage() {
  return (
    <AppLayout>
      <ProtectedRoute>
        <Duplicates />
      </ProtectedRoute>
    </AppLayout>
  );
}

function Duplicates() {
  const toast = useToast();
  const [kind, setKind] = useState<Kind>("all");
  const [page, setPage] = useState<Page | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Per stack, the photo kept (the proposed one until clicked) and whether it is settled now
  const [kept, setKept] = useState<ReadonlyMap<number, number>>(new Map());
  const [skipped, setSkipped] = useState<ReadonlySet<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(async (which: Kind) => {
    setFailed(false);
    setPage(null);
    setKept(new Map());
    setSkipped(new Set());
    try {
      setPage(await fetchStacks(which, null));
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    document.title = "Doublons · Blaze Gallery";
  }, []);
  useEffect(() => {
    void load(kind);
  }, [kind, load]);

  const more = async () => {
    if (!page?.next || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await fetchStacks(kind, page.next);
      setPage((p) =>
        p ? { ...next, stacks: [...p.stacks, ...next.stacks] } : next,
      );
    } catch {
      toast.show("La suite n’a pas pu être chargée", "error");
    } finally {
      setLoadingMore(false);
    }
  };

  // Per photo kept, what keeping it throws away: the server's pair rule
  // (lib/keep.ts), so a photo too far from the one kept stays
  const [preview, setPreview] = useState<{
    keepers: string;
    going: ReadonlyMap<number, number[]>;
  } | null>(null);
  const allKeepers = useMemo(
    () =>
      (page?.stacks ?? []).map((s) => kept.get(s.id) ?? s.photos[0]?.id ?? 0),
    [page, kept],
  );
  const keepersKey = allKeepers.join(",");
  useEffect(() => {
    if (allKeepers.length === 0) return;
    let live = true;
    previewKeep(allKeepers)
      .then((going) => {
        if (live) setPreview({ keepers: keepersKey, going });
      })
      .catch(() => {
        if (live) toast.show("Le compte des photos à jeter a échoué", "error");
      });
    return () => {
      live = false;
    };
    // keepersKey stands for allKeepers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keepersKey, toast]);
  const goingByKeep = preview?.keepers === keepersKey ? preview.going : null;

  const chosen = useMemo(
    () => (page?.stacks ?? []).filter((s) => !skipped.has(s.id)),
    [page, skipped],
  );
  const keepers = chosen.map((s) => kept.get(s.id) ?? s.photos[0]?.id ?? 0);
  const going = goingByKeep
    ? keepers.flatMap((id) => goingByKeep.get(id) ?? [])
    : [];

  const send = async () => {
    setSending(true);
    try {
      const trashed = await keepInStacks(keepers, going);
      // The next stacks come up in place of the settled ones
      void load(kind);
      setConfirming(false);
      toast.show(
        `${formatCount(trashed.length, "photo")} dans la corbeille`,
        "success",
        {
          action: {
            label: "Annuler",
            onClick: () => {
              restoreFromTrash(trashed)
                .then(() => load(kind))
                .catch(() => {
                  toast.show("Les photos ne sont pas revenues", "error");
                });
            },
          },
        },
      );
    } catch (error) {
      setConfirming(false);
      toast.show(
        error instanceof TrashError
          ? error.message
          : "Rien n’a été mis à la corbeille",
        "error",
      );
      if (error instanceof TrashError && error.code === "STACKS_CHANGED")
        void load(kind);
    } finally {
      setSending(false);
    }
  };

  const header = (
    <PageHeader
      title="Doublons"
      meta="Rafales, reprises, retouches et copies d’un même fichier. Dans chaque pile, la photo cochée reste ; ses copies et ses rafales vont à la corbeille, pour 30 jours."
      actions={
        going.length > 0 && (
          <Button
            variant="danger"
            icon={Trash2}
            onClick={() => {
              setConfirming(true);
            }}
          >
            {`Mettre ${formatCount(going.length, "photo")} à la corbeille`}
          </Button>
        )
      }
    >
      <Tabs<Kind>
        label="Type de doublons"
        value={kind}
        onChange={setKind}
        className="mt-6"
        tabs={[
          { id: "all", label: "Toutes" },
          { id: "bursts", label: "Rafales et reprises" },
          { id: "copies", label: "Copies identiques" },
        ]}
      />
    </PageHeader>
  );

  if (failed && !page)
    return (
      <>
        {header}
        <EmptyState
          icon={AlertCircle}
          title="Les doublons n'ont pas pu être chargés"
          action={
            <Button
              variant="primary"
              icon={RotateCw}
              onClick={() => void load(kind)}
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
        <ul role="status" aria-label="Chargement" className="space-y-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="flex gap-2">
              {Array.from({ length: 4 }).map((__, j) => (
                <Skeleton key={j} className="h-32 w-40 rounded-md" />
              ))}
            </li>
          ))}
        </ul>
      </>
    );

  return (
    <>
      {header}
      {page.stacks.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="Aucune pile à trier"
          body="Les rafales et les copies se regroupent au passage hebdomadaire du worker, qui les empile ici."
        />
      ) : (
        <>
          <p className="tabular mb-4 text-sm text-ink-muted">
            {formatCount(page.total.stacks, "pile")} ·{" "}
            {formatCount(page.total.extra, "photo en trop", "photos en trop")}
          </p>
          <ul className="divide-y divide-line border-y border-line">
            {page.stacks.map((stack) => (
              <StackRow
                key={stack.id}
                stack={stack}
                keep={kept.get(stack.id) ?? stack.photos[0]?.id ?? 0}
                going={
                  goingByKeep?.get(
                    kept.get(stack.id) ?? stack.photos[0]?.id ?? 0,
                  ) ?? null
                }
                skipped={skipped.has(stack.id)}
                onKeep={(id) => {
                  setKept((all) => new Map(all).set(stack.id, id));
                }}
                onSkip={(skip) => {
                  setSkipped((all) => {
                    const next = new Set(all);
                    if (skip) next.add(stack.id);
                    else next.delete(stack.id);
                    return next;
                  });
                }}
              />
            ))}
          </ul>
          {page.next && (
            <div className="mt-6 flex justify-center">
              <Button loading={loadingMore} onClick={() => void more()}>
                Afficher la suite
              </Button>
            </div>
          )}
        </>
      )}

      <Dialog
        open={confirming}
        onClose={() => {
          if (!sending) setConfirming(false);
        }}
        size="sm"
        title={`Mettre ${formatCount(going.length, "photo")} à la corbeille ?`}
        description={`Dans ${formatCount(chosen.length, "pile")}, la photo cochée reste, et celles marquées « Reste » avec elle. Les autres quittent la galerie et restent 30 jours dans la corbeille, d’où vous pouvez les restaurer.`}
        footer={
          <>
            <Button
              data-autofocus
              disabled={sending}
              onClick={() => {
                setConfirming(false);
              }}
            >
              Annuler
            </Button>
            <Button
              variant="danger"
              loading={sending}
              onClick={() => void send()}
            >
              Mettre à la corbeille
            </Button>
          </>
        }
      />
    </>
  );
}

function StackRow({
  stack,
  keep,
  going,
  skipped,
  onKeep,
  onSkip,
}: {
  stack: Stack;
  keep: number;
  /** What keeping `keep` throws away; null until the server said */
  going: readonly number[] | null;
  skipped: boolean;
  onKeep: (id: number) => void;
  onSkip: (skip: boolean) => void;
}) {
  return (
    <li
      className={cn(
        "py-4 transition-opacity duration-200",
        skipped && "opacity-50",
      )}
    >
      <div className="flex flex-wrap items-start gap-2">
        {stack.photos.map((photo) => {
          const on = photo.id === keep;
          return (
            <button
              key={photo.id}
              type="button"
              aria-pressed={on}
              aria-label={`Garder ${photo.filename}`}
              disabled={skipped}
              onClick={() => {
                onKeep(photo.id);
              }}
              className={cn(
                "group relative flex flex-col items-start gap-1 rounded-md text-left outline-offset-2 transition-transform duration-200 enabled:hover:-translate-y-0.5",
              )}
            >
              <span
                className={cn(
                  "relative block overflow-hidden rounded-md outline outline-2 outline-offset-2 transition-[outline-color] duration-200",
                  on ? "outline-ink" : "outline-transparent",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- the app's 400 px thumbnails */}
                <img
                  src={thumbnailUrl(
                    photo.id,
                    undefined,
                    userRotation(photo.metadata),
                  )}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  // Sized before it loads: a lazy image of no width never comes into view
                  style={{
                    width: Math.min(
                      256,
                      Math.round(TILE_HEIGHT * aspectRatio(photo)),
                    ),
                  }}
                  className={cn(
                    "h-32 bg-surface-sunken object-cover",
                    !on && "opacity-80",
                  )}
                />
                {on && (
                  <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-ink text-paper">
                    <Check className="h-3.5 w-3.5" aria-hidden />
                  </span>
                )}
              </span>
              {stack.copies && (
                <span
                  className="max-w-[16rem] truncate text-xs text-ink-muted"
                  title={photo.folder_path}
                >
                  {photo.folder_path}
                </span>
              )}
              {!on && going !== null && !going.includes(photo.id) && (
                <span
                  className="text-xs text-ink-muted"
                  title="Trop différente de la photo cochée : elle reste dans la pile"
                >
                  Reste
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Switch
          id={`skip-${stack.id}`}
          checked={skipped}
          onChange={(value: boolean) => {
            onSkip(value);
          }}
          label="Laisser cette pile telle quelle"
        />
      </div>
    </li>
  );
}
