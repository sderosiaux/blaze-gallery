"use client";

/* eslint-disable @next/next/no-img-element -- the crop route already serves a small JPEG made for this */

import { useState } from "react";
import { UserRound } from "lucide-react";
import { faceCropUrl } from "@/lib/faces";
import { cn } from "@/lib/cn";

interface FaceThumbProps {
  faceId: number | null;
  className?: string;
  /** Decorative next to a name; otherwise say whose face it is. */
  alt?: string;
  eager?: boolean;
}

/** A face, cropped square and upright by the server. */
export default function FaceThumb({
  faceId,
  className,
  alt = "",
  eager = false,
}: FaceThumbProps) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  return (
    <span
      className={cn(
        "relative block shrink-0 overflow-hidden bg-surface-sunken",
        state === "loading" && faceId !== null && "skeleton",
        className,
      )}
    >
      {faceId !== null && state !== "failed" ? (
        <img
          src={faceCropUrl(faceId)}
          alt={alt}
          draggable={false}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          onLoad={() => {
            setState("ready");
          }}
          onError={() => {
            setState("failed");
          }}
          className={cn(
            "h-full w-full select-none object-cover transition-opacity duration-300",
            state === "ready" ? "opacity-100" : "opacity-0",
          )}
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-ink-faint">
          <UserRound className="h-1/3 w-1/3" aria-hidden />
        </span>
      )}
    </span>
  );
}
