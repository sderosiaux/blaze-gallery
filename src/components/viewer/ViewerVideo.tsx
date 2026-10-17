"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Film } from "lucide-react";
import type { Photo } from "@/types";
import { Button } from "@/components/ui";
import { useSessionImage } from "@/hooks/useSessionImage";
import { fitBox, useElementSize } from "./useElementSize";
import { photoRatio, type ViewerSources } from "./sources";

// Containers no browser plays. Others (MOV, 3GP) are worth a try: Chrome plays
// many of them despite an empty canPlayType().
const UNPLAYABLE = [
  "video/x-msvideo",
  "video/avi",
  "video/msvideo",
  "video/mp2t",
  "video/x-ms-wmv",
  "video/x-flv",
];

interface ViewerVideoProps {
  photo: Photo;
  sources: ViewerSources;
  sessionToken?: string;
  allowDownload: boolean;
  onDownload: () => void;
  /** Lets a slideshow move on when the video is over or can't play. */
  onSettled: (outcome: "playing" | "ended" | "failed") => void;
}

function extensionOf(filename: string) {
  return filename.includes(".")
    ? filename.split(".").pop()!.toUpperCase()
    : "these";
}

export default function ViewerVideo({
  photo,
  sources,
  sessionToken,
  allowDownload,
  onDownload,
  onSettled,
}: ViewerVideoProps) {
  const areaRef = useRef<HTMLDivElement>(null);
  const area = useElementSize(areaRef);
  const [failed, setFailed] = useState(() =>
    UNPLAYABLE.includes(photo.mime_type.toLowerCase()),
  );
  const [natural, setNatural] = useState<number | undefined>(undefined);
  const media = useSessionImage(failed ? null : sources.full, sessionToken);

  useEffect(() => {
    if (failed || media.status === "error") onSettled("failed");
  }, [failed, media.status, onSettled]);

  const ratio = natural ?? photoRatio(photo) ?? 16 / 9;
  const box = fitBox(area, ratio);

  if (failed || media.status === "error") {
    return (
      <div
        ref={areaRef}
        data-backdrop
        className="absolute inset-0 flex items-center justify-center p-4"
      >
        <div className="flex max-w-md animate-fade-in flex-col items-center rounded-lg border border-line bg-surface px-6 py-10 text-center">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-sunken text-ink-soft">
            <Film className="h-5 w-5" aria-hidden />
          </span>
          <h2 className="font-display text-display-sm font-normal text-ink">
            This video can&rsquo;t play here
          </h2>
          <p className="mt-2 text-pretty text-sm text-ink-muted">
            {`Browsers don’t play ${extensionOf(photo.filename)} files. `}
            {allowDownload
              ? "Download it and open it on your computer."
              : "Ask the person who shared this album for a copy."}
          </p>
          {allowDownload && (
            <Button icon={Download} className="mt-6" onClick={onDownload}>
              Download video
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={areaRef}
      data-backdrop
      className="absolute inset-0 flex items-center justify-center"
    >
      <div
        className={
          media.status === "ready"
            ? "relative overflow-hidden rounded-sm bg-surface-sunken shadow-lift"
            : "skeleton rounded-sm"
        }
        style={{ width: box.width, height: box.height }}
      >
        {media.status === "ready" && media.src && (
          <video
            src={media.src}
            controls
            autoPlay
            playsInline
            preload="metadata"
            aria-label={photo.filename}
            className="absolute inset-0 h-full w-full bg-surface-sunken object-contain"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth && v.videoHeight)
                setNatural(v.videoWidth / v.videoHeight);
            }}
            onPlaying={() => onSettled("playing")}
            onEnded={() => onSettled("ended")}
            onError={() => setFailed(true)}
          />
        )}
      </div>
    </div>
  );
}
