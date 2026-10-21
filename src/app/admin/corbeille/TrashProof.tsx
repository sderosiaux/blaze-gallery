"use client";

import { useEffect, useState } from "react";
import {
  Check,
  CircleHelp,
  RotateCcw,
  ScanSearch,
  Trash2,
  X,
} from "lucide-react";
import type { Photo } from "@/types";
import {
  Badge,
  Button,
  ButtonLink,
  Skeleton,
  type useToast,
} from "@/components/ui";
import { formatSize } from "@/components/viewer/format";
import { formatNumber, LOCALE } from "@/lib/albums";
import { cn } from "@/lib/cn";
import { thumbnailUrl } from "@/lib/photoUrls";
import { userRotation } from "@/lib/rotation";
import {
  fetchProof,
  putBackInTrash,
  restoreFromTrash,
  type ProofPhoto,
  type TrashProof,
} from "@/lib/trashClient";

/** Read once per opening of the Corbeille: a photo's proof does not change while it waits. */
const proofs = new Map<string, Promise<TrashProof>>();

export function forgetProof(id: Photo["id"]): void {
  proofs.delete(String(id));
}

function proofOf(id: Photo["id"]): Promise<TrashProof> {
  const key = String(id);
  let proof = proofs.get(key);
  if (!proof) {
    proof = fetchProof(id);
    proofs.set(key, proof);
    proof.catch(() => proofs.delete(key));
  }
  return proof;
}

type Toast = ReturnType<typeof useToast>;

/**
 * « Restaurer celle-ci » from the viewer: the photo comes back, `gone`
 * takes it off the page's list; « Annuler » puts it back in the Corbeille
 * as the proof showed it (its lot, its photo kept, its date), and `back`
 * returns it to the list.
 */
export async function restoreShown(
  toast: Toast,
  photo: Photo,
  proof: TrashProof,
  list: { gone: () => void; back: () => void },
): Promise<void> {
  try {
    await restoreFromTrash([Number(photo.id)]);
  } catch {
    toast.show("La photo n’est pas revenue", "error");
    return;
  }
  forgetProof(photo.id);
  list.gone();
  toast.show("Restaurée", "success", {
    action: {
      label: "Annuler",
      onClick: () => {
        putBackInTrash(proof)
          .then((back) => {
            if (back) list.back();
            else
              toast.show(
                "Elle a été jetée à nouveau entre-temps : rien n’a changé",
                "info",
              );
          })
          .catch(() => {
            toast.show("La photo n’est pas retournée à la corbeille", "error");
          });
      },
    },
  });
}

/** On a tile of the Corbeille: the photo kept in its place, larger while the tile is hovered. */
export function KeptBadge({
  kept,
}: {
  kept: { id: number; trashed: boolean; rotation: number };
}) {
  return (
    <span
      className="pointer-events-none absolute bottom-1.5 right-1.5"
      title="Gardée à sa place"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- the app's 400 px thumbnails */}
      <img
        src={thumbnailUrl(kept.id, undefined, kept.rotation)}
        alt="Gardée à sa place"
        loading="lazy"
        decoding="async"
        className={cn(
          "h-7 w-7 rounded-md bg-surface-sunken object-cover shadow-lift ring-2 ring-surface transition-[width,height] duration-200",
          "group-hover:h-20 group-hover:w-20 group-focus-within:h-20 group-focus-within:w-20",
          kept.trashed && "opacity-60",
        )}
      />
    </span>
  );
}

/** "7 déc. 2008, 14:03:21": EXIF wall-clock times, stored with a Z, read in UTC. */
function formatTaken(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC",
  });
}

const dimensions = (p: ProofPhoto) =>
  p.width && p.height
    ? `${formatNumber(p.width)} × ${formatNumber(p.height)}`
    : "—";

/**
 * Beside a photo in the Corbeille, the photo kept in its place and what
 * tells them apart: the bucket's fingerprint, weight, dimensions, date and
 * folder of each. « Restaurer celle-ci » brings it back; « Photos
 * similaires » looks further than its stack.
 */
export default function TrashProofPanel({
  photo,
  onRestore,
}: {
  photo: Photo;
  /** Restore the photo shown; the proof it was shown with, for « Annuler » */
  onRestore: (photo: Photo, proof: TrashProof) => void;
}) {
  const [state, setState] = useState<{
    id: string;
    proof: TrashProof | null;
    failed: boolean;
  } | null>(null);
  const key = String(photo.id);

  useEffect(() => {
    let live = true;
    proofOf(photo.id)
      .then((proof) => {
        if (live) setState({ id: key, proof, failed: false });
      })
      .catch(() => {
        if (live) setState({ id: key, proof: null, failed: true });
      });
    return () => {
      live = false;
    };
  }, [photo.id, key]);

  const proof = state?.id === key ? state.proof : null;
  const failed = state?.id === key && state.failed;

  return (
    <aside
      aria-label="Gardée à sa place"
      className={cn(
        "absolute inset-x-0 bottom-0 z-10 flex max-h-[62%] animate-rise-in flex-col rounded-t-xl bg-surface shadow-pop",
        "md:static md:max-h-none md:w-80 md:shrink-0 md:animate-fade-in md:rounded-none md:border-l md:border-line md:shadow-none",
      )}
    >
      <div className="px-5 pb-2 pt-4">
        <h2 className="kicker">Gardée à sa place</h2>
      </div>
      <div className="overflow-y-auto px-5 pb-6 pt-2">
        {failed ? (
          <p className="text-sm text-ink-muted">
            La photo gardée n’a pas pu être lue.
          </p>
        ) : !proof ? (
          <div className="space-y-3" aria-busy="true">
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <Proof proof={proof} />
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          <Button
            size="sm"
            icon={RotateCcw}
            disabled={!proof}
            onClick={() => {
              if (proof) onRestore(photo, proof);
            }}
          >
            Restaurer celle-ci
          </Button>
          <ButtonLink
            size="sm"
            icon={ScanSearch}
            href={`/search?like=${encodeURIComponent(key)}`}
          >
            Photos similaires
          </ButtonLink>
        </div>
      </div>
    </aside>
  );
}

function Proof({ proof }: { proof: TrashProof }) {
  const { photo, kept } = proof;
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Thumb photo={photo}>
          <Badge icon={Trash2}>Dans la corbeille</Badge>
        </Thumb>
        {kept ? (
          <Thumb photo={kept}>
            {proof.kept_state === "trashed" ? (
              <Badge icon={Trash2}>Jetée aussi</Badge>
            ) : (
              <Badge tone="success" icon={Check}>
                Gardée
              </Badge>
            )}
          </Thumb>
        ) : (
          <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-line px-2 text-center text-xs text-ink-muted">
            {proof.kept_state === "gone"
              ? "La photo gardée n’existe plus"
              : "Jetée seule, sans photo gardée"}
          </div>
        )}
      </div>

      {kept && (
        <p className="mt-4 flex items-center gap-1.5 text-sm font-medium text-ink">
          {proof.same_bytes === true ? (
            <>
              <Check className="h-4 w-4 text-success" aria-hidden />
              Même fichier (MD5)
            </>
          ) : proof.same_bytes === false ? (
            <>
              <X className="h-4 w-4 text-ink-muted" aria-hidden />
              Fichiers différents
            </>
          ) : (
            <>
              <CircleHelp className="h-4 w-4 text-ink-muted" aria-hidden />
              Empreinte inconnue
            </>
          )}
        </p>
      )}

      <dl className="mt-3 text-sm">
        <Compare
          label="Poids"
          values={[photo, kept].map((p) => (p ? formatSize(p.size) : null))}
        />
        <Compare
          label="Dimensions"
          values={[photo, kept].map((p) => (p ? dimensions(p) : null))}
        />
        <Compare
          label="Date"
          values={[photo, kept].map((p) => (p ? formatTaken(p.taken) : null))}
        />
        <Compare
          label="Dossier"
          values={[photo, kept].map((p) => (p ? p.folder_path : null))}
          wrap
        />
      </dl>
    </>
  );
}

function Thumb({
  photo,
  children,
}: {
  photo: ProofPhoto;
  children: React.ReactNode;
}) {
  return (
    <figure className="flex min-w-0 flex-col gap-1.5">
      {/* eslint-disable-next-line @next/next/no-img-element -- the app's 400 px thumbnails */}
      <img
        src={thumbnailUrl(photo.id, undefined, userRotation(photo.metadata))}
        alt=""
        decoding="async"
        className="h-24 w-full rounded-md bg-surface-sunken object-contain"
      />
      <figcaption className="flex min-w-0 flex-col items-start gap-1">
        {children}
        <span
          className="w-full truncate text-xs text-ink-muted"
          title={photo.filename}
        >
          {photo.filename}
        </span>
      </figcaption>
    </figure>
  );
}

/** A row of the comparison: this photo's value, then the kept one's; muted when they agree. */
function Compare({
  label,
  values,
  wrap = false,
}: {
  label: string;
  values: (string | null)[];
  wrap?: boolean;
}) {
  const [mine, kept] = values;
  const same = kept !== null && kept !== undefined && mine === kept;
  return (
    <div className="border-t border-line py-2.5 first:border-t-0">
      <dt className="kicker mb-1">{label}</dt>
      <dd
        className={cn(
          "grid grid-cols-2 gap-3",
          same ? "text-ink-muted" : "text-ink",
        )}
      >
        {values.map((value, i) => (
          <span
            key={i}
            className={cn("tabular min-w-0", wrap ? "break-words" : "truncate")}
            title={value ?? undefined}
          >
            {value ?? (i === 1 ? "" : "—")}
          </span>
        ))}
      </dd>
    </div>
  );
}
