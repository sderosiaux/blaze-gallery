"use client";

import Link from "next/link";
import { memo, useMemo } from "react";
import type { Photo } from "@/types";
import JustifiedGrid from "@/components/photos/JustifiedGrid";
import PhotoTile from "@/components/photos/PhotoTile";
import { albumHref } from "@/components/photos/AlbumCard";
import { Skeleton } from "@/components/ui";
import { formatCount, LOCALE, parseAlbumName } from "@/lib/albums";
import { monthLabel, type MonthGroup } from "./timeline";

const FOLDERS_SHOWN = 2;

function lastSegment(path: string): string {
  const last = path.split("/").pop();
  return last !== undefined && last !== "" ? last : path;
}

/**
 * Folders this month's photos come from, the biggest share first. The bucket
 * holds copies of the same folder under different parents: one title, one link.
 */
function foldersOf(group: MonthGroup) {
  const counts = new Map<string, number>();
  for (const p of group.photos)
    counts.set(p.folder_path, (counts.get(p.folder_path) ?? 0) + 1);
  const folders = Array.from(counts, ([path, count]) => ({
    path,
    count,
    title: parseAlbumName(lastSegment(path)).title,
  })).sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));
  const titles = new Set<string>();
  return folders.filter((folder) => {
    const key = folder.title.toLocaleLowerCase(LOCALE);
    if (titles.has(key)) return false;
    titles.add(key);
    return true;
  });
}

interface TimelineMonthProps {
  group: MonthGroup;
  /** First month of its year in the list: carries the year anchor */
  yearAnchor?: number;
  eagerCount?: number;
  onOpen: (photo: Photo) => void;
  onToggleFavorite: (photo: Photo) => void;
}

function TimelineMonth({
  group,
  yearAnchor,
  eagerCount = 0,
  onOpen,
  onToggleFavorite,
}: TimelineMonthProps) {
  const folders = useMemo(() => foldersOf(group), [group]);
  const shown = folders.slice(0, FOLDERS_SHOWN);
  const more = folders.length - shown.length;
  const headingId = `month-${group.key}`;

  return (
    <section
      id={yearAnchor ? `year-${yearAnchor}` : undefined}
      data-month={group.key}
      aria-labelledby={headingId}
      className="scroll-mt-[calc(var(--content-top)+1rem)] pt-10 first:pt-2"
    >
      <header className="mb-4 flex flex-col gap-1 border-b border-line pb-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
        <h2
          id={headingId}
          className="shrink-0 font-display text-display-sm font-semibold text-ink"
        >
          {monthLabel(group.key)}
        </h2>
        {shown.length > 0 && (
          <p className="min-w-0 text-sm text-ink-muted sm:text-right">
            {shown.map((folder, i) => (
              <span key={folder.path}>
                {i > 0 &&
                  (i === shown.length - 1 && more === 0 ? " et " : ", ")}
                <Link
                  href={albumHref(folder.path)}
                  title={folder.path}
                  className="text-ink-soft underline decoration-line-strong underline-offset-4 transition-colors duration-150 hover:text-ink hover:decoration-accent"
                >
                  {folder.title}
                </Link>
              </span>
            ))}
            {more > 0 &&
              ` et ${formatCount(more, "autre dossier", "autres dossiers")}`}
          </p>
        )}
      </header>
      <JustifiedGrid
        photos={group.photos}
        renderTile={(photo, size, index) => (
          <PhotoTile
            photo={photo}
            width={size.width}
            height={size.height}
            eager={index < eagerCount}
            onOpen={onOpen}
            onToggleFavorite={onToggleFavorite}
          />
        )}
      />
    </section>
  );
}

export default memo(TimelineMonth);

/** Placeholder month: heading, folder line and two rows of tiles. */
export function MonthSkeleton({ first = false }: { first?: boolean }) {
  const widths = [260, 180, 300, 220, 240, 200, 280, 190];
  return (
    <div aria-hidden className={first ? "pt-2" : "pt-10"}>
      <div className="mb-4 flex items-baseline justify-between gap-6 border-b border-line pb-3">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="hidden h-4 w-56 sm:block" />
      </div>
      <div className="flex flex-wrap gap-1">
        {widths.map((w, i) => (
          <div
            key={i}
            // Tiles shrink with the row height so a phone shows two or three per row, like the real grid.
            className="skeleton h-[128px] flex-grow basis-[calc(var(--w)*0.5)] rounded-sm sm:h-[170px] sm:basis-[calc(var(--w)*0.75)] lg:h-[220px] lg:basis-[var(--w)]"
            style={{ "--w": `${w}px` } as React.CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}
