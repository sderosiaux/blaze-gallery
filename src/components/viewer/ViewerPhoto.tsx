"use client";

/* eslint-disable @next/next/no-img-element -- originals come straight from storage: the Next optimizer would fetch and re-encode every one */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Photo } from "@/types";
import { cn } from "@/lib/cn";
import { useImageLoading } from "@/hooks/useImageLoading";
import CachedImage from "./CachedImage";
import { fitBox, useElementSize } from "./useElementSize";
import { photoRatio, placeholderSources, type ViewerSources } from "./sources";

export type FullStatus = "loading" | "ready" | "error" | "unavailable";
/** Whether a soft stand-in is on screen: still coming, shown, or there is none to be had. */
export type PlaceholderState = "pending" | "shown" | "none";

type Layer = { width: number; height: number } | "failed" | null;

interface ViewerPhotoProps {
  photo: Photo;
  sources: ViewerSources;
  sessionToken?: string;
  zoomed: boolean;
  onZoomedChange: (zoomed: boolean) => void;
  /** Where the original stands, and whether anything is on screen meanwhile. */
  onStatus: (status: FullStatus, placeholder: PlaceholderState) => void;
  /** Bump to retry a failed original. */
  retryKey: number;
}

const DOUBLE_TAP_MS = 300;

function ratioOf(layer: Layer): number | undefined {
  return layer && layer !== "failed" && layer.height > 0 ? layer.width / layer.height : undefined;
}

/** Blur that hides the blockiness of a small image blown up to the stage. */
function softness(layer: Layer, boxWidth: number): number {
  if (!layer || layer === "failed" || layer.width === 0) return 6;
  const upscale = boxWidth / layer.width;
  return upscale <= 1.2 ? 0 : Math.min(12, Math.round(upscale * 9) / 10);
}

/**
 * One photo on the stage. Whatever is already in the browser (EXIF preview,
 * the tile's thumbnail) shows at once at full size, softened; the original
 * fades in on top once it is decoded. Zoom swaps the fitted box for the
 * original at pixel size inside a scroller.
 */
export default function ViewerPhoto({
  photo,
  sources,
  sessionToken,
  zoomed,
  onZoomedChange,
  onStatus,
  retryKey,
}: ViewerPhotoProps) {
  const areaRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const area = useElementSize(areaRef);

  // Decided once when the photo opens: what the page already holds.
  const [layers] = useState(() => placeholderSources(photo, sources));
  const [preview, setPreview] = useState<Layer>(null);
  const [thumb, setThumb] = useState<Layer>(null);
  const [thumbFallback, setThumbFallback] = useState(false);

  const full = useImageLoading(sources.full, { sessionToken });
  const [readyAtOpen] = useState(() => full.status === "ready");
  const fullReady = Boolean(sources.full && full.status === "ready" && full.element);

  // Once the original has faded in, the soft layers go: a transparent PNG
  // must not show a blurred copy of itself underneath.
  const [settled, setSettled] = useState(readyAtOpen);
  useEffect(() => {
    if (!fullReady) return;
    const timer = setTimeout(() => setSettled(true), 400);
    return () => clearTimeout(timer);
  }, [fullReady]);

  const thumbSrc = layers.thumb ?? (thumbFallback ? sources.thumb : undefined);
  const previewShown = Boolean(layers.preview) && preview !== null && preview !== "failed";
  const thumbShown = Boolean(thumbSrc) && thumb !== null && thumb !== "failed";
  const hasPlaceholder = previewShown || thumbShown;

  // Nothing cheap on hand (no EXIF preview): the generated thumbnail is the
  // next best thing, even if the server has to make it.
  useEffect(() => {
    if (!layers.thumb && (!layers.preview || preview === "failed") && !fullReady) setThumbFallback(true);
  }, [layers, preview, fullReady]);

  const status: FullStatus = !sources.full ? "unavailable" : full.status;
  const previewGone = !layers.preview || preview === "failed";
  const thumbGone = thumbSrc ? thumb === "failed" : !layers.thumb && thumbFallback;
  const placeholder: PlaceholderState = hasPlaceholder ? "shown" : previewGone && thumbGone ? "none" : "pending";
  useEffect(() => onStatus(status, placeholder), [status, placeholder, onStatus]);

  const { retry } = full;
  useEffect(() => {
    if (retryKey > 0) retry();
  }, [retryKey, retry]);

  const dims = photo.metadata?.dimensions;
  const ratio =
    (full.width && full.height ? full.width / full.height : undefined) ??
    photoRatio(photo) ??
    ratioOf(thumb) ??
    ratioOf(preview) ??
    4 / 3;
  const naturalWidth = full.width ?? dims?.width;
  // Small originals stop at twice their size rather than turning to mush.
  const box = fitBox(area, ratio, naturalWidth ? naturalWidth * 2 : Infinity);

  // Zoom: the original at its own pixels, at least twice the fitted size.
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const zoomWidth = Math.round(Math.min(Math.max((full.width ?? box.width) / dpr, box.width * 2), box.width * 4));
  const zoomHeight = Math.round(zoomWidth / ratio);
  const zoomOrigin = useRef<{ x: number; y: number } | null>(null);
  const isZoomed = zoomed && fullReady;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!isZoomed || !el) return;
    const origin = zoomOrigin.current;
    zoomOrigin.current = null;
    // Bring the double-clicked point to the centre; from the keyboard, start centred.
    const fx = origin ? origin.x : 0.5;
    const fy = origin ? origin.y : 0.5;
    el.scrollLeft = fx * zoomWidth - el.clientWidth / 2;
    el.scrollTop = fy * zoomHeight - el.clientHeight / 2;
    // Only on entering zoom: panning is the user's afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isZoomed]);

  const toggleZoomAt = (clientX: number, clientY: number, target: HTMLElement) => {
    if (!fullReady) return;
    if (!zoomed) {
      const rect = target.getBoundingClientRect();
      zoomOrigin.current = {
        x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
        y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
      };
    }
    onZoomedChange(!zoomed);
  };

  // Touch has no dblclick worth trusting: detect the second tap ourselves.
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const tapStart = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === "touch") tapStart.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    const start = tapStart.current;
    tapStart.current = null;
    if (e.pointerType !== "touch" || !start) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) return;
    const now = Date.now();
    const prev = lastTap.current;
    if (prev && now - prev.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 30) {
      lastTap.current = null;
      toggleZoomAt(e.clientX, e.clientY, e.currentTarget);
    } else {
      lastTap.current = { t: now, x: e.clientX, y: e.clientY };
    }
  };

  // Mouse drag pans the zoomed photo; touch and trackpads scroll natively.
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const onPanStart = (e: React.PointerEvent<HTMLDivElement>) => {
    onPointerDown(e);
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    const el = e.currentTarget;
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    el.setPointerCapture(e.pointerId);
  };
  const onPanMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    e.currentTarget.scrollLeft = d.left - (e.clientX - d.x);
    e.currentTarget.scrollTop = d.top - (e.clientY - d.y);
  };
  const onPanEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    onPointerUp(e);
  };

  const zoomHint = fullReady ? (zoomed ? "zoom-out" : "zoom-in") : undefined;

  return (
    <div ref={areaRef} data-backdrop className="absolute inset-0">
      {isZoomed && full.element ? (
        <div
          ref={scrollRef}
          className="scrollbar-none absolute inset-0 cursor-grab overflow-auto overscroll-contain active:cursor-grabbing"
          onDoubleClick={(e) => toggleZoomAt(e.clientX, e.clientY, e.currentTarget)}
          onPointerDown={onPanStart}
          onPointerMove={onPanMove}
          onPointerUp={onPanEnd}
          onPointerCancel={() => (drag.current = null)}
        >
          <div className="flex h-max min-h-full w-max min-w-full items-center justify-center">
            <CachedImage
              element={full.element}
              alt={photo.filename}
              className="max-w-none select-none"
              width={zoomWidth}
              height={zoomHeight}
            />
          </div>
        </div>
      ) : (
        <div data-backdrop className="absolute inset-0 flex items-center justify-center">
          {/* Nothing displayable is coming: the viewer shows its own explanation instead. */}
          {placeholder === "none" && status !== "loading" && !fullReady ? null : (
            <div
              className={cn(
                "relative overflow-hidden shadow-lift sm:rounded-sm",
                !settled && "bg-surface-sunken",
                !hasPlaceholder && !fullReady && "skeleton",
              )}
              style={{ width: box.width, height: box.height, cursor: zoomHint }}
              onDoubleClick={(e) => toggleZoomAt(e.clientX, e.clientY, e.currentTarget)}
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
            >
              {layers.preview && preview !== "failed" && !settled && (
                <img
                  src={layers.preview}
                  alt=""
                  draggable={false}
                  decoding="async"
                  onLoad={(e) =>
                    setPreview({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })
                  }
                  onError={() => setPreview("failed")}
                  className={cn(
                    "absolute inset-0 h-full w-full select-none object-cover",
                    softness(preview, box.width) > 0 && "scale-[1.04]",
                  )}
                  style={{ filter: `blur(${softness(preview, box.width)}px)` }}
                />
              )}
              {thumbSrc && thumb !== "failed" && !settled && (
                <img
                  src={thumbSrc}
                  alt=""
                  draggable={false}
                  decoding="async"
                  onLoad={(e) =>
                    setThumb({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })
                  }
                  onError={() => setThumb("failed")}
                  className={cn(
                    "absolute inset-0 h-full w-full select-none object-cover",
                    softness(thumb, box.width) > 0 && "scale-[1.02]",
                  )}
                  style={{ filter: `blur(${softness(thumb, box.width)}px)` }}
                />
              )}
              {fullReady && full.element && (
                <CachedImage
                  element={full.element}
                  alt={photo.filename}
                  className={cn(
                    "absolute inset-0 h-full w-full select-none object-contain",
                    !readyAtOpen && "animate-fade-in",
                  )}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
