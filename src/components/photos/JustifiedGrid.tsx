"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Photo } from "@/types";
import { aspectRatio } from "@/lib/albums";

interface Row {
  height: number;
  items: Array<{ photo: Photo; width: number; index: number }>;
}

/**
 * Rows that fill the width exactly while keeping every photo's own shape.
 * Greedy: add photos until the row at target height overflows, then shrink the
 * row to fit. The last row keeps the target height instead of stretching.
 */
export function layoutRows(photos: Photo[], containerWidth: number, targetHeight: number, gap: number): Row[] {
  const rows: Row[] = [];
  let current: Row["items"] = [];
  let ratioSum = 0;

  const flush = (height: number) => {
    rows.push({
      height,
      items: current.map((item) => ({ ...item, width: item.width * height })),
    });
    current = [];
    ratioSum = 0;
  };

  photos.forEach((photo, index) => {
    const ratio = aspectRatio(photo);
    current.push({ photo, width: ratio, index });
    ratioSum += ratio;
    const gaps = gap * (current.length - 1);
    if (ratioSum * targetHeight + gaps >= containerWidth) {
      flush((containerWidth - gaps) / ratioSum);
    }
  });
  if (current.length) {
    const gaps = gap * (current.length - 1);
    flush(Math.min(targetHeight, (containerWidth - gaps) / ratioSum));
  }

  // Integer widths summing to the container width, so rows end flush.
  return rows.map((row, r) => {
    const isLast = r === rows.length - 1;
    const widths = row.items.map((it) => Math.floor(it.width));
    if (!isLast || row.height < targetHeight) {
      const total = widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1);
      let leftover = Math.round(containerWidth - total);
      for (let i = 0; leftover > 0 && widths.length; i = (i + 1) % widths.length, leftover--) widths[i] += 1;
    }
    return {
      height: Math.round(row.height),
      items: row.items.map((it, i) => ({ ...it, width: widths[i] })),
    };
  });
}

function targetHeightFor(width: number) {
  if (width < 520) return 128;
  if (width < 900) return 170;
  if (width < 1400) return 220;
  return 250;
}

interface JustifiedGridProps {
  photos: Photo[];
  renderTile: (photo: Photo, size: { width: number; height: number }, index: number) => React.ReactNode;
  gap?: number;
  className?: string;
}

export default function JustifiedGrid({ photos, renderTile, gap = 4, className }: JustifiedGridProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.floor(entry.contentRect.width);
      setWidth((prev) => (Math.abs(prev - next) >= 1 ? next : prev));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const rows = useMemo(
    () => (width > 0 ? layoutRows(photos, width, targetHeightFor(width), gap) : []),
    [photos, width, gap],
  );

  // One flat list keyed by photo id: a resize moves tiles between rows without
  // remounting them (and re-requesting their images). Integer widths sum to the
  // measured width, so flex-wrap breaks exactly where layoutRows did.
  return (
    <div ref={ref} className={className}>
      <div role="list" className="flex flex-wrap" style={{ columnGap: gap, rowGap: gap }}>
        {rows.flatMap((row) =>
          row.items.map((item) => (
            <div role="listitem" key={String(item.photo.id)} style={{ width: item.width, height: row.height }}>
              {renderTile(item.photo, { width: item.width, height: row.height }, item.index)}
            </div>
          )),
        )}
      </div>
    </div>
  );
}
