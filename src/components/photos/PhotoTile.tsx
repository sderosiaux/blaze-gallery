"use client";

import { memo, useState } from "react";
import { Film, Heart, ImageOff } from "lucide-react";
import type { Photo } from "@/types";
import ProgressiveImage from "./ProgressiveImage";
import { formatDay, isVideo } from "@/lib/albums";
import { formatFileSize } from "@/lib/format";
import { cn } from "@/lib/cn";

const RAW_EXTENSIONS = [
  ".nef",
  ".cr2",
  ".cr3",
  ".arw",
  ".dng",
  ".raf",
  ".orf",
  ".rw2",
  ".pef",
  ".srw",
  ".x3f",
];

export function photoSources(photo: Photo, shareToken?: string) {
  const id = String(photo.id);
  return shareToken
    ? {
        preview: `/api/shares/${shareToken}/preview/${id}`,
        thumb: `/api/shares/${shareToken}/thumbnail/${id}`,
      }
    : { preview: `/api/photos/${id}/preview`, thumb: photo.thumbnail_url };
}

interface PhotoTileProps {
  photo: Photo;
  width: number;
  height: number;
  eager?: boolean;
  shareToken?: string;
  onOpen: (photo: Photo) => void;
  onToggleFavorite?: (photo: Photo) => void;
}

function PhotoTile({
  photo,
  width,
  height,
  eager,
  shareToken,
  onOpen,
  onToggleFavorite,
}: PhotoTileProps) {
  const [failed, setFailed] = useState(false);
  const video = isVideo(photo);
  const sources = photoSources(photo, shareToken);
  const taken = photo.metadata?.date_taken;
  const label = `${video ? "Play video" : "Open photo"} ${photo.filename}${taken ? `, ${formatDay(taken)}` : ""}`;
  const isRaw = RAW_EXTENSIONS.some((ext) =>
    photo.filename.toLowerCase().endsWith(ext),
  );

  return (
    <div
      className="group relative shrink-0 overflow-hidden rounded-sm bg-surface-sunken"
      style={{ width, height }}
    >
      {video ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface-sunken p-3 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full border border-line-strong bg-surface text-ink-soft transition-transform duration-300 ease-out-soft group-hover:scale-105">
            <Film className="h-5 w-5" aria-hidden />
          </span>
          <span className="max-w-full truncate px-2 text-xs font-medium text-ink-soft">
            {photo.filename}
          </span>
          <span className="tabular text-[11px] text-ink-muted">
            {formatFileSize(photo.size)}
          </span>
        </div>
      ) : failed ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-3 text-center text-ink-muted">
          <ImageOff className="h-5 w-5" aria-hidden />
          <span className="text-xs font-medium">
            {isRaw ? "RAW file" : "No preview"}
          </span>
          <span className="max-w-full truncate px-2 text-[11px]">
            {photo.filename}
          </span>
        </div>
      ) : (
        <ProgressiveImage
          previewSrc={sources.preview}
          thumbSrc={sources.thumb}
          thumbReady={photo.thumbnail_status === "generated"}
          displayWidth={width}
          alt={photo.filename}
          eager={eager}
          onFailed={() => setFailed(true)}
          className="transition-transform duration-700 ease-out-soft group-hover:scale-[1.025]"
        />
      )}

      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-t from-scrim/35 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      />

      <button
        type="button"
        onClick={() => onOpen(photo)}
        aria-label={label}
        className="absolute inset-0 rounded-sm focus-visible:outline-offset-[-2px]"
      />

      {onToggleFavorite && (
        <button
          type="button"
          onClick={() => onToggleFavorite(photo)}
          aria-label={
            photo.is_favorite
              ? `Remove ${photo.filename} from favorites`
              : `Add ${photo.filename} to favorites`
          }
          aria-pressed={photo.is_favorite}
          className={cn(
            "absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full transition-[opacity,background-color,transform] duration-200 active:scale-90",
            photo.is_favorite
              ? "bg-surface/90 text-favorite opacity-100 shadow-lift"
              : "bg-scrim/35 text-on-photo opacity-0 backdrop-blur-sm hover:bg-scrim/55 focus-visible:opacity-100 group-hover:opacity-100",
          )}
        >
          <Heart
            className={cn("h-4 w-4", photo.is_favorite && "fill-current")}
            aria-hidden
          />
        </button>
      )}
    </div>
  );
}

export default memo(PhotoTile);
