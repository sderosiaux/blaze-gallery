"use client";

import { useLayoutEffect, useRef } from "react";

interface CachedImageProps {
  /** An already decoded element from the image cache. */
  element: HTMLImageElement;
  alt: string;
  className: string;
  width?: number;
  height?: number;
}

/**
 * Puts a decoded <img> from the cache on the page as is. A new element with
 * the same src would start the download again (see imageCache), this one
 * paints at once. The host is `display: contents`, so the image is laid out
 * as a child of the host's parent.
 */
export default function CachedImage({
  element,
  alt,
  className,
  width,
  height,
}: CachedImageProps) {
  const host = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    element.alt = alt;
    element.className = className;
    element.draggable = false;
    element.style.width = width ? `${width}px` : "";
    element.style.height = height ? `${height}px` : "";
    el.appendChild(element);
    return () => {
      if (element.parentNode === el) el.removeChild(element);
    };
  }, [element, alt, className, width, height]);

  return <span ref={host} className="contents" />;
}
