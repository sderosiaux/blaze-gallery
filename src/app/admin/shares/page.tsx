"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Copy,
  ExternalLink,
  RotateCw,
  Share2,
} from "lucide-react";
import AppLayout from "@/components/AppLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import {
  Button,
  ButtonLink,
  EmptyState,
  IconButton,
  PageHeader,
  Skeleton,
  useToast,
} from "@/components/ui";
import ProgressiveImage from "@/components/photos/ProgressiveImage";
import { albumHref } from "@/components/photos/AlbumCard";
import RevokeDialog from "@/components/sharing/RevokeDialog";
import { ShareBadges } from "@/components/sharing/ShareBadges";
import {
  formatInstant,
  lastOpenedLabel,
} from "@/components/sharing/shareFormat";
import { useCopyLink } from "@/components/sharing/useCopyLink";
import { albumDateLabel, formatCount, parseAlbumName } from "@/lib/albums";
import { cn } from "@/lib/cn";
import { previewUrl, thumbnailUrl } from "@/lib/photoUrls";
import {
  folderNameOf,
  listShares,
  shareState,
  shareUrl,
  type ShareLink,
} from "@/lib/shareClient";

export default function SharedLinksPage() {
  return (
    <AppLayout>
      <ProtectedRoute>
        <SharedLinks />
      </ProtectedRoute>
    </AppLayout>
  );
}

/** Links that still work first, newest first within each group. */
function byUsefulness(shares: ShareLink[]): ShareLink[] {
  const rank = (s: ShareLink) => (shareState(s) === "active" ? 0 : 1);
  return [...shares].sort((a, b) => rank(a) - rank(b));
}

function SharedLinks() {
  const toast = useToast();
  const [shares, setShares] = useState<ShareLink[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [revoking, setRevoking] = useState<ShareLink | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      // Sorted once: a link revoked here stays in place instead of jumping down the list.
      setShares(byUsefulness(await listShares()));
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    document.title = "Liens partagés · Blaze Gallery";
    void load();
  }, [load]);

  const onRevoked = (revoked: ShareLink) => {
    setShares(
      (all) =>
        all?.map((s) =>
          s.share_token === revoked.share_token
            ? { ...s, is_active: false }
            : s,
        ) ?? all,
    );
    setRevoking(null);
    toast.show("Lien révoqué", "success");
  };

  if (failed && !shares) {
    return (
      <>
        <Header />
        <EmptyState
          icon={AlertCircle}
          title="Les liens n'ont pas pu être chargés"
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
  }

  if (!shares) return <SharedLinksSkeleton />;

  if (shares.length === 0) {
    return (
      <>
        <Header />
        <EmptyState
          icon={Share2}
          title="Aucun lien partagé"
          action={
            <ButtonLink href="/" variant="primary">
              Ouvrir la bibliothèque
            </ButtonLink>
          }
        />
      </>
    );
  }

  return (
    <>
      <Header />
      <ul className="divide-y divide-line border-y border-line">
        {shares.map((share, i) => (
          <ShareRow
            key={share.share_token}
            share={share}
            index={i}
            onRevoke={setRevoking}
          />
        ))}
      </ul>
      <RevokeDialog
        share={revoking}
        onClose={() => {
          setRevoking(null);
        }}
        onRevoked={onRevoked}
      />
    </>
  );
}

function Header() {
  return <PageHeader title="Liens partagés" />;
}

/** Name, then state and activity, then actions; stacked under the name on phones. */
const COLUMNS =
  "md:grid md:grid-cols-[minmax(0,1fr)_14rem_9.5rem] md:items-center md:gap-6";

function FolderThumb({ share, title }: { share: ShareLink; title: string }) {
  const [failed, setFailed] = useState(false);
  const cover = failed ? null : share.cover_photo_id;
  return (
    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-surface-sunken">
      {cover ? (
        <ProgressiveImage
          previewSrc={previewUrl(cover)}
          thumbSrc={thumbnailUrl(cover)}
          displayWidth={56}
          alt=""
          onFailed={() => {
            setFailed(true);
          }}
        />
      ) : (
        <span
          aria-hidden
          className="absolute inset-0 flex select-none items-center justify-center text-xl font-semibold text-ink-faint"
        >
          {title.charAt(0)}
        </span>
      )}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-md ring-1 ring-inset ring-ink/5"
      />
    </div>
  );
}

function ShareRow({
  share,
  index,
  onRevoke,
}: {
  share: ShareLink;
  index: number;
  onRevoke: (share: ShareLink) => void;
}) {
  const copy = useCopyLink();
  const name =
    share.folder_name !== undefined &&
    share.folder_name !== null &&
    share.folder_name !== ""
      ? share.folder_name
      : folderNameOf(share.folder_path);
  const { title } = parseAlbumName(name);
  const dateLabel = albumDateLabel({
    name,
    date_from: share.date_from ?? null,
    date_to: share.date_to ?? null,
  });
  const parent = share.folder_path.split("/").slice(0, -1).join(" / ");
  const active = shareState(share) === "active";
  const url = () => shareUrl(share.share_token);

  return (
    <li
      data-share-token={share.share_token}
      className="flex animate-rise-in items-start gap-4 py-4 md:items-center"
      style={{ animationDelay: `${Math.min(index, 10) * 25}ms` }}
    >
      <FolderThumb share={share} title={title} />
      <div className={cn("flex min-w-0 flex-1 flex-col gap-2", COLUMNS)}>
        <div className={cn("min-w-0", !active && "opacity-70")}>
          {dateLabel && (
            <div className="kicker mb-0.5 truncate">{dateLabel}</div>
          )}
          <h2 className="truncate text-base font-semibold leading-snug text-ink">
            <Link
              href={albumHref(share.folder_path)}
              className="underline-offset-4 hover:underline"
              title={share.folder_path}
            >
              {title}
            </Link>
          </h2>
          {parent && (
            <p className="truncate text-xs text-ink-muted">{parent}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <ShareBadges share={share} />
            {active && share.expires_at && (
              <span className="text-xs text-ink-muted">
                jusqu&apos;au {formatInstant(share.expires_at)}
              </span>
            )}
          </div>
          <p className="tabular text-xs text-ink-muted">
            {share.view_count > 0 && (
              <>
                <span className="text-ink-soft">
                  {formatCount(share.view_count, "vue")}
                </span>{" "}
                ·{" "}
              </>
            )}
            {lastOpenedLabel(share)}
          </p>
        </div>

        {active && (
          <div className="-ml-2.5 flex items-center gap-1 md:ml-0 md:justify-end">
            <IconButton
              icon={Copy}
              label="Copier le lien"
              onClick={() => void copy(url())}
            />
            <IconButton
              icon={ExternalLink}
              label="Ouvrir"
              onClick={() =>
                window.open(url(), "_blank", "noopener,noreferrer")
              }
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onRevoke(share);
              }}
            >
              Révoquer
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

function SharedLinksSkeleton() {
  return (
    <>
      <Header />
      <ul
        role="status"
        aria-label="Chargement"
        className="divide-y divide-line border-y border-line"
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i} className="flex items-center gap-4 py-4">
            <Skeleton className="h-14 w-14 rounded-md" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-4 w-56 max-w-full" />
            </div>
            <Skeleton className="hidden h-5 w-40 md:block" />
          </li>
        ))}
      </ul>
    </>
  );
}
