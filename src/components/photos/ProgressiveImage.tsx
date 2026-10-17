"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

interface ProgressiveImageProps {
  /** Embedded EXIF preview: a few KB, fast, sometimes small. */
  previewSrc?: string;
  /** Generated thumbnail: sharp, but costs a full original download the first time. */
  thumbSrc: string;
  /** The thumbnail already exists, so the preview step is pure overhead. */
  thumbReady?: boolean;
  /** Rendered width in CSS px, used to decide whether the preview is sharp enough. */
  displayWidth: number;
  alt: string;
  eager?: boolean;
  className?: string;
  onFailed?: () => void;
}

type Stage = "preview" | "thumb" | "failed";

/**
 * Shows the EXIF preview at once and only pays for the generated thumbnail
 * when the preview would look soft at this size. A soft preview stays slightly
 * blurred until the sharp one has decoded, then the sharp one fades in on top.
 */
export default function ProgressiveImage({
  previewSrc,
  thumbSrc,
  thumbReady = false,
  displayWidth,
  alt,
  eager = false,
  className,
  onFailed,
}: ProgressiveImageProps) {
  const [stage, setStage] = useState<Stage>(
    thumbReady || !previewSrc ? "thumb" : "preview",
  );
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewSoft, setPreviewSoft] = useState(false);
  const [thumbLoaded, setThumbLoaded] = useState(false);
  // Generating a thumbnail downloads the whole original. Native lazy loading
  // starts screens ahead, so that cost is only paid for tiles about to be seen.
  const rootRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(eager);

  useEffect(() => {
    if (nearViewport || thumbReady) return;
    const el = rootRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [nearViewport, thumbReady]);

  // Reset only when the photo changes. Running this on mount would undo an
  // onLoad that a cached image already fired, leaving it invisible.
  const sourceKey = `${previewSrc}|${thumbSrc}|${thumbReady}`;
  const lastSourceKey = useRef(sourceKey);
  useEffect(() => {
    if (lastSourceKey.current === sourceKey) return;
    lastSourceKey.current = sourceKey;
    setStage(thumbReady || !previewSrc ? "thumb" : "preview");
    setPreviewLoaded(false);
    setPreviewSoft(false);
    setThumbLoaded(false);
  }, [sourceKey, thumbReady, previewSrc]);

  useEffect(() => {
    if (stage === "failed") onFailed?.();
  }, [stage, onFailed]);

  const onPreviewLoad = useCallback(
    (img: HTMLImageElement) => {
      const dpr =
        typeof window === "undefined"
          ? 1
          : Math.min(window.devicePixelRatio || 1, 2);
      // Letterboxed 4:3 previews of 16:9 shots need no special case: object-cover
      // crops exactly the bars away in a 16:9 tile.
      setPreviewLoaded(true);
      if (img.naturalWidth < displayWidth * dpr * 0.7) {
        setPreviewSoft(true);
        setStage("thumb");
      }
    },
    [displayWidth],
  );

  const showThumb = stage === "thumb" && (thumbReady || nearViewport);

  // An image served from cache can finish before React attaches onLoad.
  const previewRef = useRef<HTMLImageElement>(null);
  const thumbRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const preview = previewRef.current;
    if (preview?.complete && preview.naturalWidth > 0 && !previewLoaded)
      onPreviewLoad(preview);
    const thumb = thumbRef.current;
    if (thumb?.complete && thumb.naturalWidth > 0 && !thumbLoaded)
      setThumbLoaded(true);
  }, [sourceKey, stage, showThumb, previewLoaded, thumbLoaded, onPreviewLoad]);

  return (
    <div
      ref={rootRef}
      className={cn(
        "absolute inset-0 overflow-hidden bg-surface-sunken",
        className,
      )}
    >
      {previewSrc && stage !== "failed" && !thumbReady && (
        // eslint-disable-next-line @next/next/no-img-element -- already sized by the API; next/image would re-encode it
        <img
          ref={previewRef}
          src={previewSrc}
          alt={showThumb && thumbLoaded ? "" : alt}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          onLoad={(e) => onPreviewLoad(e.currentTarget)}
          onError={() => setStage((s) => (s === "preview" ? "thumb" : s))}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-[opacity,filter,transform] duration-500 ease-out-soft",
            previewLoaded ? "opacity-100" : "opacity-0",
            previewSoft && !thumbLoaded && "scale-[1.03] blur-[3px]",
          )}
        />
      )}
      {showThumb && (
        // eslint-disable-next-line @next/next/no-img-element -- already sized by the API; next/image would re-encode it
        <img
          ref={thumbRef}
          src={thumbSrc}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          onLoad={() => setThumbLoaded(true)}
          onError={() => setStage(previewLoaded ? "preview" : "failed")}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ease-out-soft",
            thumbLoaded ? "opacity-100" : "opacity-0",
          )}
        />
      )}
    </div>
  );
}
