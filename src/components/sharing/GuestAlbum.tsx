"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ImageIcon, Link2Off, RotateCw, WifiOff } from "lucide-react";
import PhotoGrid, { PhotoGridSkeleton } from "@/components/PhotoGrid";
import { Button, EmptyState, MetaDot, Skeleton } from "@/components/ui";
import { albumDateLabel, formatCount, isVideo, parseAlbumName, photoDateRange } from "@/lib/albums";
import { openShare, type GuestResult, type SharedAlbum } from "@/lib/shareClient";
import { GuestNotice, GuestShell } from "./GuestShell";
import PasswordGate from "./PasswordGate";
import { formatInstant } from "./shareFormat";

type View = { kind: "loading" } | GuestResult;

export default function GuestAlbum({ token }: { token: string }) {
  const [view, setView] = useState<View>({ kind: "loading" });

  const load = useCallback(async () => {
    setView({ kind: "loading" });
    setView(await openShare(token));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  switch (view.kind) {
    case "loading":
      return <GuestAlbumSkeleton />;
    case "album":
      return <AlbumView token={token} album={view.album} sessionToken={view.sessionToken} />;
    case "password":
      return (
        <GuestShell centered>
          <PasswordGate token={token} albumName={view.albumName} onResult={setView} />
        </GuestShell>
      );
    case "unavailable":
      return (
        <GuestShell centered>
          <GuestNotice
            icon={Link2Off}
            kicker="Link unavailable"
            title="This album is no longer shared"
            body="The link may have expired, been turned off by the person who sent it, or been copied only in part. If you'd still like to see the photos, ask them for a new link."
          />
        </GuestShell>
      );
    case "error":
      return (
        <GuestShell centered>
          <GuestNotice
            icon={WifiOff}
            kicker="Something went wrong"
            title="We couldn't open this album"
            body="The photos are fine. The page just didn't load. Check your connection and try again."
            action={
              <Button variant="primary" icon={RotateCw} onClick={load}>
                Try again
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
      <div role="status" aria-label="Loading the album" className="pb-10 pt-8 sm:pb-14 sm:pt-16">
        <Skeleton className="mb-5 h-3 w-36" />
        <Skeleton className="mb-3 h-14 w-4/5 max-w-2xl sm:h-20" />
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="border-t border-line pt-6 sm:pt-8">
        <PhotoGridSkeleton />
      </div>
    </GuestShell>
  );
}

function AlbumView({ token, album, sessionToken }: { token: string; album: SharedAlbum; sessionToken?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedPhotoId = searchParams.get("photo");
  const { share, folder, photos } = album;

  const { title } = parseAlbumName(folder.name);
  const { dateLabel, counts } = useMemo(() => {
    const range = photoDateRange(photos);
    const videos = photos.filter(isVideo).length;
    const stills = photos.length - videos;
    return {
      dateLabel: albumDateLabel({ name: folder.name, date_from: range.from ?? null, date_to: range.to ?? null }),
      counts: [stills > 0 && formatCount(stills, "photo"), videos > 0 && formatCount(videos, "video")].filter(Boolean).join(" · "),
    };
  }, [folder.name, photos]);

  useEffect(() => {
    document.title = `${title} · Shared album`;
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
      <header className="max-w-4xl animate-rise-in pb-10 pt-8 sm:pb-14 sm:pt-16">
        <div className="kicker mb-4">{dateLabel ?? "A shared album"}</div>
        <h1 className="text-balance break-words font-display text-display-xl font-light text-ink">{title}</h1>
        {share.description && (
          <figure className="mt-8 max-w-2xl border-l border-line-strong pl-5 sm:pl-6">
            <blockquote className="whitespace-pre-line text-pretty font-display text-xl font-light italic leading-relaxed text-ink-soft sm:text-2xl">
              {share.description}
            </blockquote>
            <figcaption className="mt-2 text-xs text-ink-muted">A note from the person who shared this album</figcaption>
          </figure>
        )}
        <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
          {counts && <span className="tabular">{counts}</span>}
          {counts && <MetaDot />}
          <span>{share.allow_download ? "Open a photo to download it" : "View only"}</span>
          {share.expires_at && (
            <>
              <span className="hidden sm:inline">
                <MetaDot />
              </span>
              {/* Own line on phones, so no dot is left dangling at the end of a row. */}
              <span className="w-full sm:w-auto">Link open until {formatInstant(share.expires_at)}</span>
            </>
          )}
        </div>
      </header>

      <section aria-label="Photos" className="border-t border-line pt-6 sm:pt-8">
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
            icon={ImageIcon}
            title="No photos here yet"
            body="This album is empty for now. The person who shared it may still be adding photos, so try the link again a little later."
          />
        )}
      </section>
    </GuestShell>
  );
}
