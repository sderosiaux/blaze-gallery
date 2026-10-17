"use client";

import Link from "next/link";
import { useState } from "react";
import { albumHref } from "@/components/photos/AlbumCard";
import { MarkTooltip, ShowMore, TipRow } from "@/components/stats/charts";
import {
  folderKicker,
  formatNumber,
  formatPercent,
  formatSize,
} from "@/components/stats/format";
import type { AlbumStat } from "@/components/stats/types";
import { formatCount, parseAlbumName } from "@/lib/albums";
import { cn } from "@/lib/cn";

// Single-hue sequential scale: chart-5 at rising opacity over the paper, light
// to dark. Five steps stay distinguishable; text flips to on-photo only on the
// darkest step, where ink would lose contrast (ink ≥ 5.6:1 on steps 1–4,
// on-photo ≥ 5.2:1 on step 5).
const STEPS = [
  "bg-chart-5/10",
  "bg-chart-5/25",
  "bg-chart-5/45",
  "bg-chart-5/65",
  "bg-chart-5/90",
];
const DARK_STEP = STEPS.length - 1;

interface FolderHeatmapProps {
  albums: AlbumStat[];
  metric: "size" | "count";
  /** Share of the library each tile is compared against, for the tooltip */
  totalBytes?: number;
  initial?: number;
  step?: number;
}

const valueOf = (a: AlbumStat, metric: "size" | "count") =>
  metric === "size" ? a.total_size : a.photo_count + a.video_count;

const formatValue = (v: number, metric: "size" | "count") =>
  metric === "size" ? formatSize(v) : formatCount(v, "fichier");

export default function FolderHeatmap({
  albums,
  metric,
  totalBytes,
  initial = 12,
  step = 12,
}: FolderHeatmapProps) {
  const [visible, setVisible] = useState(initial);
  if (albums.length === 0) return null;

  // The scale spans every folder returned, not just the visible ones, so a
  // tile keeps its shade when "Afficher plus" reveals smaller folders. Sizes are
  // heavily skewed (one folder can weigh ten of the others), so the steps are
  // spread on a log scale; the exact value is printed on every tile.
  const values = albums.map((a) => Math.max(1, valueOf(a, metric)));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.log(max) - Math.log(min);
  const stepOf = (v: number) =>
    span === 0
      ? DARK_STEP
      : Math.min(
          DARK_STEP,
          Math.floor(
            ((Math.log(Math.max(1, v)) - Math.log(min)) / span) * STEPS.length,
          ),
        );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <p className="text-xs text-ink-muted">
          {metric === "size"
            ? "Plus foncé, plus lourd"
            : "Plus foncé, plus de fichiers"}
        </p>
        <div
          className="flex items-center gap-2 text-xs text-ink-muted"
          aria-hidden
        >
          <span className="tabular">{formatValue(min, metric)}</span>
          <span className="flex gap-0.5">
            {STEPS.map((s) => (
              <span
                key={s}
                className={cn(
                  "h-2.5 w-5 first:rounded-l-sm last:rounded-r-sm",
                  s,
                )}
              />
            ))}
          </span>
          <span className="tabular">{formatValue(max, metric)}</span>
        </div>
      </div>

      <ol className="grid grid-cols-2 gap-0.5 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
        {albums.slice(0, visible).map((album, i) => {
          const value = valueOf(album, metric);
          const s = stepOf(value);
          const dark = s === DARK_STEP;
          const { title } = parseAlbumName(album.name);
          const kicker = folderKicker(album.path, album.name);
          const files = album.photo_count + album.video_count;
          return (
            <li key={album.id} className="min-w-0">
              <Link
                href={albumHref(album.path)}
                aria-label={`${title}, ${formatSize(album.total_size)}, ${formatCount(files, "fichier")}`}
                className={cn(
                  "group relative flex h-full min-h-[96px] flex-col justify-between rounded-sm p-3 ring-1 ring-inset ring-transparent",
                  "transition-[box-shadow] duration-150 ease-out-soft hover:ring-ink/30 focus-visible:ring-ink/40",
                  STEPS[s],
                  dark ? "text-on-photo" : "text-ink",
                )}
              >
                <span className="min-w-0">
                  <span className="tabular mb-1 flex items-baseline justify-between gap-2 text-[11px] font-semibold uppercase tracking-[0.1em]">
                    <span className="truncate">{kicker}</span>
                    <span aria-hidden>{i + 1}</span>
                  </span>
                  <span
                    className="line-clamp-2 text-base leading-snug [overflow-wrap:anywhere]"
                    title={album.name}
                  >
                    {title}
                  </span>
                </span>
                <span className="tabular mt-2 text-sm font-medium">
                  {formatValue(value, metric)}
                </span>
                <MarkTooltip>
                  <span className="mb-1.5 block truncate font-medium text-ink">
                    {album.path}
                  </span>
                  <TipRow label="Taille" value={formatSize(album.total_size)} />
                  {totalBytes ? (
                    <TipRow
                      label="Part du total"
                      value={formatPercent(album.total_size, totalBytes)}
                    />
                  ) : null}
                  <TipRow
                    label="Photos"
                    value={formatNumber(album.photo_count)}
                  />
                  {album.video_count > 0 && (
                    <TipRow
                      label="Vidéos"
                      value={formatNumber(album.video_count)}
                    />
                  )}
                </MarkTooltip>
              </Link>
            </li>
          );
        })}
      </ol>

      <ShowMore
        total={albums.length}
        visible={visible}
        initial={initial}
        step={step}
        onChange={setVisible}
      />
    </div>
  );
}
