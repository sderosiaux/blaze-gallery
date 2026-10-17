"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import {
  observeVisibility,
  requestImage,
  type ImageRequest,
  type Lane,
  type Priority,
} from "./imageScheduler";

interface ProgressiveImageProps {
  /** Embedded EXIF preview: a few KB, fast, sometimes small. Omit when the file has none (RAW). */
  previewSrc?: string;
  /** Generated thumbnail: sharp, but may cost a generation the first time. */
  thumbSrc: string;
  /** The thumbnail already exists, so the preview step is pure overhead. */
  thumbReady?: boolean;
  /** Rendered width in CSS px, used to decide whether the preview is sharp enough. */
  displayWidth: number;
  alt: string;
  /** Load before the tile is observed in view (first screen). */
  eager?: boolean;
  /** Reading order on the page: lower loads first among tiles of equal visibility. */
  order?: number;
  className?: string;
  onFailed?: () => void;
}

/** Wait this long in view before paying for a thumbnail generation, so fast scrolling costs nothing. */
const GENERATION_DWELL_MS = 250;

/**
 * Shows the EXIF preview first and only asks for the thumbnail when the
 * preview would look soft at this size, or when there is no preview. All
 * requests go through the page-wide scheduler: in-view tiles first, then the
 * next screen, in reading order; anything that scrolls away is cancelled.
 */
export default function ProgressiveImage({
  previewSrc,
  thumbSrc,
  thumbReady = false,
  displayWidth,
  alt,
  eager = false,
  order = 0,
  className,
  onFailed,
}: ProgressiveImageProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(eager);
  const [visible, setVisible] = useState(eager);
  const [dwelled, setDwelled] = useState(eager);

  const [previewObjectUrl, setPreviewObjectUrl] = useState<string | null>(null);
  const [previewMissing, setPreviewMissing] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewSoft, setPreviewSoft] = useState(false);

  const [thumbObjectUrl, setThumbObjectUrl] = useState<string | null>(null);
  const [thumbFailed, setThumbFailed] = useState(false);
  const [thumbLoaded, setThumbLoaded] = useState(false);

  const priority: Priority = visible ? 0 : 1;
  const priorityRef = useRef(priority);
  priorityRef.current = priority;
  const previewJob = useRef<ImageRequest | null>(null);
  const thumbJob = useRef<ImageRequest | null>(null);

  // A new photo in the same tile starts over.
  const sourceKey = `${previewSrc}|${thumbSrc}|${thumbReady}`;
  const lastSourceKey = useRef(sourceKey);
  useEffect(() => {
    if (lastSourceKey.current === sourceKey) return;
    lastSourceKey.current = sourceKey;
    setPreviewObjectUrl(null);
    setPreviewMissing(false);
    setPreviewLoaded(false);
    setPreviewSoft(false);
    setThumbObjectUrl(null);
    setThumbFailed(false);
    setThumbLoaded(false);
  }, [sourceKey]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    return observeVisibility(el, (state) => {
      setNear(state.near || eager);
      setVisible(state.visible);
    });
  }, [eager]);

  useEffect(() => {
    if (!visible) {
      setDwelled(eager);
      return;
    }
    const timer = setTimeout(() => {
      setDwelled(true);
    }, GENERATION_DWELL_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [visible, eager]);

  // Keep queued work ordered as the tile moves in and out of view.
  useEffect(() => {
    previewJob.current?.setPriority(priority);
    thumbJob.current?.setPriority(priority);
  }, [priority]);

  const wantsPreview = Boolean(previewSrc) && !thumbReady;
  const needsThumb =
    thumbReady || !wantsPreview || previewMissing || previewSoft;
  // Generations download originals: only for tiles actually looked at.
  const thumbLane: Lane = thumbReady ? "fast" : "slow";
  const mayLoadThumb = thumbLane === "fast" ? near : visible && dwelled;

  useEffect(() => {
    if (!near || !wantsPreview || previewObjectUrl || previewMissing) return;
    const job = requestImage(previewSrc!, "fast", priorityRef.current, order);
    previewJob.current = job;
    let active = true;
    job.promise.then((result) => {
      if (!active) {
        if (result.ok) URL.revokeObjectURL(result.objectUrl);
        return;
      }
      if (result.ok) setPreviewObjectUrl(result.objectUrl);
      else if (result.status !== "aborted") setPreviewMissing(true);
    });
    return () => {
      active = false;
      job.cancel();
      previewJob.current = null;
    };
  }, [near, wantsPreview, previewSrc, previewObjectUrl, previewMissing, order]);

  useEffect(() => {
    if (!mayLoadThumb || !needsThumb || thumbObjectUrl || thumbFailed) return;
    const job = requestImage(thumbSrc, thumbLane, priorityRef.current, order);
    thumbJob.current = job;
    let active = true;
    job.promise.then((result) => {
      if (!active) {
        if (result.ok) URL.revokeObjectURL(result.objectUrl);
        return;
      }
      if (result.ok) setThumbObjectUrl(result.objectUrl);
      else if (result.status !== "aborted") setThumbFailed(true);
    });
    return () => {
      active = false;
      job.cancel();
      thumbJob.current = null;
    };
  }, [
    mayLoadThumb,
    needsThumb,
    thumbSrc,
    thumbLane,
    thumbObjectUrl,
    thumbFailed,
    order,
  ]);

  // Object URLs hold the blobs: release them with the tile.
  useEffect(
    () => () => {
      if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    },
    [previewObjectUrl],
  );
  useEffect(
    () => () => {
      if (thumbObjectUrl) URL.revokeObjectURL(thumbObjectUrl);
    },
    [thumbObjectUrl],
  );

  const failed =
    thumbFailed && (!wantsPreview || previewMissing || !previewObjectUrl);
  useEffect(() => {
    if (failed) onFailed?.();
  }, [failed, onFailed]);

  const onPreviewLoad = useCallback(
    (img: HTMLImageElement) => {
      const dpr =
        typeof window === "undefined"
          ? 1
          : Math.min(window.devicePixelRatio || 1, 2);
      setPreviewLoaded(true);
      // Letterboxed 4:3 previews of 16:9 shots need no special case: object-cover
      // crops exactly the bars away in a 16:9 tile.
      if (img.naturalWidth < displayWidth * dpr * 0.7) setPreviewSoft(true);
    },
    [displayWidth],
  );

  return (
    <div
      ref={rootRef}
      className={cn(
        "absolute inset-0 overflow-hidden bg-surface-sunken",
        className,
      )}
    >
      {previewObjectUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- blob of an image already sized by the API
        <img
          src={previewObjectUrl}
          data-src={previewSrc}
          alt={thumbLoaded ? "" : alt}
          decoding="async"
          draggable={false}
          onLoad={(e) => {
            onPreviewLoad(e.currentTarget);
          }}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-[opacity,filter,transform] duration-500 ease-out-soft",
            previewLoaded ? "opacity-100" : "opacity-0",
            previewSoft && !thumbLoaded && "scale-[1.03] blur-[3px]",
          )}
        />
      )}
      {thumbObjectUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- blob of an image already sized by the API
        <img
          src={thumbObjectUrl}
          data-src={thumbSrc}
          alt={alt}
          decoding="async"
          draggable={false}
          onLoad={() => {
            setThumbLoaded(true);
          }}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ease-out-soft",
            thumbLoaded ? "opacity-100" : "opacity-0",
          )}
        />
      )}
    </div>
  );
}
