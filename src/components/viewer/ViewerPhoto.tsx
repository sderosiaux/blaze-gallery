"use client";

/* eslint-disable @next/next/no-img-element -- originals come straight from storage: the Next optimizer would fetch and re-encode every one */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Photo } from "@/types";
import { cn } from "@/lib/cn";
import { useImageLoading } from "@/hooks/useImageLoading";
import { userRotation } from "@/lib/rotation";
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
  /** Where the sharp image stands, and whether anything is on screen meanwhile. */
  onStatus: (status: FullStatus, placeholder: PlaceholderState) => void;
  /** Bump to retry a failed sharp image. */
  retryKey: number;
}

const DOUBLE_TAP_MS = 300;

function ratioOf(layer: Layer): number | undefined {
  return layer && layer !== "failed" && layer.height > 0
    ? layer.width / layer.height
    : undefined;
}

/** Blur that hides the blockiness of a small image blown up to the stage. */
function softness(layer: Layer, boxWidth: number): number {
  if (!layer || layer === "failed" || layer.width === 0) return 6;
  const upscale = boxWidth / layer.width;
  return upscale <= 1.2 ? 0 : Math.min(12, Math.round(upscale * 9) / 10);
}

/**
 * One photo on the stage. Whatever is already in the browser (EXIF preview,
 * the tile's thumbnail) shows at once at full size, softened; the 2048 px
 * rendition fades in on top once it is decoded (the original instead when
 * there is no rendition). Zoom swaps the fitted box for a scroller, and
 * fetches the original only when it has more pixels than the rendition.
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

  // The stage shows the rendition; when there is none or it failed, the
  // original stands in, if a browser can display it. Not for a photo turned
  // by hand: the original's pixels aren't turned, only the rendition's.
  const turned = userRotation(photo.metadata) !== 0;
  const originalSrc = turned ? null : sources.full;
  const display = useImageLoading(sources.display, { sessionToken });
  const displayFailed = !sources.display || display.status === "error";
  const fallback = useImageLoading(displayFailed ? originalSrc : null, {
    sessionToken,
  });
  const stageSrc = displayFailed ? originalSrc : sources.display;
  const stage = displayFailed ? fallback : display;
  const [readyAtOpen] = useState(() => stage.status === "ready");
  const stageReady = Boolean(
    stageSrc && stage.status === "ready" && stage.element,
  );

  // Once the sharp image has faded in, the soft layers go: a transparent PNG
  // must not show a blurred copy of itself underneath.
  const [settled, setSettled] = useState(readyAtOpen);
  useEffect(() => {
    if (!stageReady) return;
    const timer = setTimeout(() => {
      setSettled(true);
    }, 400);
    return () => {
      clearTimeout(timer);
    };
  }, [stageReady]);

  const thumbSrc = layers.thumb ?? (thumbFallback ? sources.thumb : undefined);
  const previewShown =
    Boolean(layers.preview) && preview !== null && preview !== "failed";
  const thumbShown = Boolean(thumbSrc) && thumb !== null && thumb !== "failed";
  const hasPlaceholder = previewShown || thumbShown;

  // Nothing cheap on hand (no EXIF preview): the generated thumbnail is the
  // next best thing, even if the server has to make it.
  useEffect(() => {
    if (
      !layers.thumb &&
      (!layers.preview || preview === "failed") &&
      !stageReady
    )
      setThumbFallback(true);
  }, [layers, preview, stageReady]);

  // A turned photo whose rendition failed could be shown: that's a retry,
  // not a format the browser can't display.
  const status: FullStatus = stageSrc
    ? stage.status
    : turned && sources.full
      ? "error"
      : "unavailable";
  const previewGone = !layers.preview || preview === "failed";
  const thumbGone = thumbSrc
    ? thumb === "failed"
    : !layers.thumb && thumbFallback;
  const placeholder: PlaceholderState = hasPlaceholder
    ? "shown"
    : previewGone && thumbGone
      ? "none"
      : "pending";
  useEffect(() => {
    onStatus(status, placeholder);
  }, [status, placeholder, onStatus]);

  // A retry asks for the rendition again, then the original if it fails anew.
  const { retry: retryDisplay } = display;
  const { retry: retryFallback } = fallback;
  useEffect(() => {
    if (retryKey === 0) return;
    retryDisplay();
    retryFallback();
  }, [retryKey, retryDisplay, retryFallback]);

  // Asked for on the first zoom that goes past the rendition, then kept.
  const [originalWanted, setOriginalWanted] = useState(false);
  const original = useImageLoading(originalWanted ? originalSrc : null, {
    sessionToken,
  });
  const originalShown = Boolean(
    originalWanted && original.status === "ready" && original.element,
  );

  const dims = photo.metadata?.dimensions;
  const ratio =
    (stage.width && stage.height ? stage.width / stage.height : undefined) ??
    photoRatio(photo) ??
    ratioOf(thumb) ??
    ratioOf(preview) ??
    4 / 3;
  const originalWidth =
    original.width ?? (displayFailed ? stage.width : undefined) ?? dims?.width;
  // The most pixels zoom can show: the original's when a browser displays
  // it, the rendition's otherwise (RAW, HEIC, a photo turned by hand).
  const zoomableWidth = originalSrc
    ? (originalWidth ?? stage.width)
    : stage.width;
  // Small photos stop at twice their size rather than turning to mush.
  const box = fitBox(area, ratio, zoomableWidth ? zoomableWidth * 2 : Infinity);

  // Zoom: the photo at its own pixels, at least twice the fitted size.
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const zoomWidth = Math.round(
    Math.min(
      Math.max((zoomableWidth ?? box.width) / dpr, box.width * 2),
      box.width * 4,
    ),
  );
  const zoomHeight = Math.round(zoomWidth / ratio);
  const zoomOrigin = useRef<{ x: number; y: number } | null>(null);
  const isZoomed = zoomed && stageReady;

  const renditionShort =
    !displayFailed &&
    Boolean(originalSrc) &&
    display.width !== undefined &&
    display.width < zoomWidth * dpr &&
    (originalWidth === undefined || display.width < originalWidth);
  if (isZoomed && renditionShort && !originalWanted) setOriginalWanted(true);
  const zoomSize = useRef({ width: zoomWidth, height: zoomHeight });
  zoomSize.current = { width: zoomWidth, height: zoomHeight };

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!isZoomed || !el) return;
    const origin = zoomOrigin.current;
    zoomOrigin.current = null;
    // Bring the double-clicked point to the centre; from the keyboard, start centred.
    const fx = origin ? origin.x : 0.5;
    const fy = origin ? origin.y : 0.5;
    el.scrollLeft = fx * zoomSize.current.width - el.clientWidth / 2;
    el.scrollTop = fy * zoomSize.current.height - el.clientHeight / 2;
    // Only on entering zoom: panning is the user's afterwards.
  }, [isZoomed]);

  const toggleZoomAt = (
    clientX: number,
    clientY: number,
    target: HTMLElement,
  ) => {
    if (!stageReady) return;
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
    if (e.pointerType === "touch")
      tapStart.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    const start = tapStart.current;
    tapStart.current = null;
    if (e.pointerType !== "touch" || !start) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) return;
    const now = Date.now();
    const prev = lastTap.current;
    if (
      prev &&
      now - prev.t < DOUBLE_TAP_MS &&
      Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 30
    ) {
      lastTap.current = null;
      toggleZoomAt(e.clientX, e.clientY, e.currentTarget);
    } else {
      lastTap.current = { t: now, x: e.clientX, y: e.clientY };
    }
  };

  // Mouse drag pans the zoomed photo; touch and trackpads scroll natively.
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const onPanStart = (e: React.PointerEvent<HTMLDivElement>) => {
    onPointerDown(e);
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    const el = e.currentTarget;
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      left: el.scrollLeft,
      top: el.scrollTop,
    };
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

  const zoomHint = stageReady ? (zoomed ? "zoom-out" : "zoom-in") : undefined;

  return (
    <div ref={areaRef} data-backdrop className="absolute inset-0">
      {isZoomed && stage.element ? (
        <div
          ref={scrollRef}
          role="presentation"
          className="scrollbar-none absolute inset-0 cursor-grab overflow-auto overscroll-contain active:cursor-grabbing"
          onDoubleClick={(e) => {
            toggleZoomAt(e.clientX, e.clientY, e.currentTarget);
          }}
          onPointerDown={onPanStart}
          onPointerMove={onPanMove}
          onPointerUp={onPanEnd}
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
          <div className="flex h-max min-h-full w-max min-w-full items-center justify-center">
            <div
              className="relative shrink-0"
              style={{ width: zoomWidth, height: zoomHeight }}
            >
              <CachedImage
                element={stage.element}
                alt={originalShown ? "" : photo.filename}
                className="max-w-none select-none"
                width={zoomWidth}
                height={zoomHeight}
              />
              {originalShown && original.element && (
                <CachedImage
                  element={original.element}
                  alt={photo.filename}
                  className="absolute inset-0 max-w-none animate-fade-in select-none"
                  width={zoomWidth}
                  height={zoomHeight}
                />
              )}
            </div>
          </div>
        </div>
      ) : (
        <div
          data-backdrop
          className="absolute inset-0 flex items-center justify-center"
        >
          {/* Nothing displayable is coming: the viewer shows its own explanation instead. */}
          {placeholder === "none" &&
          status !== "loading" &&
          !stageReady ? null : (
            <div
              className={cn(
                "relative overflow-hidden shadow-lift sm:rounded-sm",
                !settled && "bg-surface-sunken",
                !hasPlaceholder && !stageReady && "skeleton",
              )}
              role="presentation"
              style={{ width: box.width, height: box.height, cursor: zoomHint }}
              onDoubleClick={(e) => {
                toggleZoomAt(e.clientX, e.clientY, e.currentTarget);
              }}
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
            >
              {layers.preview && preview !== "failed" && !settled && (
                <img
                  src={layers.preview}
                  alt=""
                  draggable={false}
                  decoding="async"
                  onLoad={(e) => {
                    setPreview({
                      width: e.currentTarget.naturalWidth,
                      height: e.currentTarget.naturalHeight,
                    });
                  }}
                  onError={() => {
                    setPreview("failed");
                  }}
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
                  onLoad={(e) => {
                    setThumb({
                      width: e.currentTarget.naturalWidth,
                      height: e.currentTarget.naturalHeight,
                    });
                  }}
                  onError={() => {
                    setThumb("failed");
                  }}
                  className={cn(
                    "absolute inset-0 h-full w-full select-none object-cover",
                    softness(thumb, box.width) > 0 && "scale-[1.02]",
                  )}
                  style={{ filter: `blur(${softness(thumb, box.width)}px)` }}
                />
              )}
              {stageReady && stage.element && (
                <CachedImage
                  element={stage.element}
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
