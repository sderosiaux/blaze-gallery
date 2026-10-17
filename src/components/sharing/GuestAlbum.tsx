"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Link2Off, RotateCw, WifiOff } from "lucide-react";
import PhotoGrid, { PhotoGridSkeleton } from "@/components/PhotoGrid";
import { Button, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import {
  albumDateLabel,
  formatCount,
  parseAlbumName,
  photoDateRange,
} from "@/lib/albums";
import {
  openShare,
  type GuestResult,
  type SharedAlbum,
} from "@/lib/shareClient";
import { GuestNotice, GuestShell } from "./GuestShell";
import PasswordGate from "./PasswordGate";

type View = { kind: "loading" } | GuestResult;

export default function GuestAlbum({ token }: { token: string }) {
  const [view, setView] = useState<View>({ kind: "loading" });

  const load = useCallback(async () => {
    setView({ kind: "loading" });
    setView(await openShare(token));
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  switch (view.kind) {
    case "loading":
      return <GuestAlbumSkeleton />;
    case "album":
      return (
        <AlbumView
          token={token}
          album={view.album}
          sessionToken={view.sessionToken}
          onReload={() => void load()}
        />
      );
    case "password":
      return (
        <GuestShell centered>
          <PasswordGate
            token={token}
            albumName={view.albumName}
            onResult={setView}
          />
        </GuestShell>
      );
    // Expired, revoked and unknown links all answer 404: the guest can't tell them apart either.
    case "unavailable":
      return (
        <GuestShell centered>
          <GuestNotice
            icon={Link2Off}
            title="Ce lien n'est pas disponible"
            body="Demandez un nouveau lien à la personne qui vous l'a envoyé."
          />
        </GuestShell>
      );
    case "error":
      return (
        <GuestShell centered>
          <GuestNotice
            icon={WifiOff}
            title="Le dossier n'a pas pu s'ouvrir"
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
        </GuestShell>
      );
  }
}

export function GuestAlbumSkeleton() {
  return (
    <GuestShell>
      <div role="status" aria-label="Chargement" className="pb-8 pt-6 sm:pt-10">
        <Skeleton className="mb-4 h-3 w-36" />
        <Skeleton className="mb-4 h-12 w-3/5 max-w-xl sm:h-14" />
        <Skeleton className="h-4 w-20" />
      </div>
      <PhotoGridSkeleton />
    </GuestShell>
  );
}

function AlbumView({
  token,
  album,
  sessionToken,
  onReload,
}: {
  token: string;
  album: SharedAlbum;
  sessionToken?: string;
  onReload: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedPhotoId = searchParams.get("photo");
  const { share, folder, photos } = album;

  const { title } = parseAlbumName(folder.name);
  const dateLabel = useMemo(() => {
    const range = photoDateRange(photos);
    return albumDateLabel({
      name: folder.name,
      date_from: range.from ?? null,
      date_to: range.to ?? null,
    });
  }, [folder.name, photos]);

  useEffect(() => {
    document.title = title;
  }, [title]);

  // The open photo lives in the URL, so the back button closes the viewer.
  const onPhotoUrlChange = useCallback(
    (photoId: string | null) => {
      const params = new URLSearchParams(window.location.search);
      if (photoId) params.set("photo", photoId);
      else params.delete("photo");
      const query = params.toString();
      router.push(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
    },
    [router, pathname],
  );

  return (
    <GuestShell>
      {/* Same count as the folder cards in the library: everything in the folder, as photos. */}
      <PageHeader
        kicker={dateLabel}
        title={title}
        meta={
          photos.length > 0 && (
            <span className="tabular">
              {formatCount(photos.length, "photo")}
            </span>
          )
        }
      >
        {share.description && (
          <p className="mt-6 max-w-2xl whitespace-pre-line text-pretty border-l-2 border-line-strong pl-4 text-base leading-relaxed text-ink-soft sm:text-lg">
            {share.description}
          </p>
        )}
      </PageHeader>

      {photos.length > 0 ? (
        <PhotoGrid
          photos={photos}
          selectedPhotoId={selectedPhotoId}
          onPhotoUrlChange={onPhotoUrlChange}
          isSharedView
          shareToken={token}
          allowDownload={share.allow_download}
          sessionToken={sessionToken}
        />
      ) : (
        <EmptyState
          title="Ce dossier est vide pour l'instant"
          action={
            <Button variant="secondary" icon={RotateCw} onClick={onReload}>
              Réessayer
            </Button>
          }
        />
      )}
    </GuestShell>
  );
}
