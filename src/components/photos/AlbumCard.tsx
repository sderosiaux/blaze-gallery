"use client";

import Link from "next/link";
import type { Folder } from "@/types";
import ProgressiveImage from "./ProgressiveImage";
import { albumDateLabel, formatCount, parseAlbumName } from "@/lib/albums";
import { cn } from "@/lib/cn";
import { previewUrl, thumbnailUrl } from "@/lib/photoUrls";

export function albumHref(path: string) {
  return `/folder/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function countsLine(folder: Folder) {
  const parts: string[] = [];
  if (folder.photo_count > 0)
    parts.push(formatCount(Number(folder.photo_count), "photo"));
  if (folder.subfolder_count > 0)
    parts.push(formatCount(Number(folder.subfolder_count), "dossier"));
  return parts.join(" · ") || "Vide";
}

/**
 * The folder's colors, as wide as their share of its photos. Sits in the
 * gap above the title, so cards with and without one line up.
 */
function PaletteStrip({
  palette,
}: {
  palette: NonNullable<Folder["palette"]>;
}) {
  return (
    <div
      aria-hidden
      className="absolute inset-x-0 top-1 flex h-1 gap-px overflow-hidden rounded-full"
    >
      {palette.map(({ hex, share }) => (
        <span
          key={hex}
          // The faint edge keeps a white segment visible on the white page
          className="h-full min-w-[3px] ring-1 ring-inset ring-ink/5"
          // The photos' own measured colors: data, not theme
          style={{ backgroundColor: hex, flexGrow: share }}
        />
      ))}
    </div>
  );
}

interface AlbumCardProps {
  folder: Folder;
  eager?: boolean;
  /** Shows the parent path, for search results where albums come from anywhere. */
  showPath?: boolean;
  shareToken?: string;
  /** Defaults to the library route; the public share page passes its own. */
  href?: string;
  size?: "md" | "lg";
  /** Position in the grid: covers load in reading order. */
  order?: number;
  /** Says « Hors galerie » on a folder out of the gallery (excluded_folders). */
  markExcluded?: boolean;
}

export default function AlbumCard({
  folder,
  eager,
  showPath,
  shareToken,
  href,
  size = "md",
  order,
  markExcluded = true,
}: AlbumCardProps) {
  const { title } = parseAlbumName(folder.name);
  const dateLabel = albumDateLabel(folder);
  const outOfGallery = markExcluded && folder.excluded === true && !shareToken;
  const coverId = folder.cover_photo_id;
  // The nearest parents say the most; deep paths keep only the last two.
  // Parents are shown exactly as in the bucket: they locate the folder.
  const ancestors = folder.path.split("/").slice(0, -1);
  const parent = (
    ancestors.length > 2 ? ["…", ...ancestors.slice(-2)] : ancestors
  ).join(" / ");

  return (
    <Link
      href={href ?? albumHref(folder.path)}
      className="group block rounded-md focus-visible:outline-offset-4"
      aria-label={`${title}${dateLabel ? `, ${dateLabel}` : ""}, ${outOfGallery ? "hors galerie, " : ""}${countsLine(folder)}`}
    >
      <div className="relative aspect-[4/3] overflow-hidden rounded-md bg-surface-sunken">
        {coverId ? (
          <ProgressiveImage
            previewSrc={previewUrl(coverId, shareToken)}
            thumbSrc={thumbnailUrl(coverId, shareToken)}
            displayWidth={size === "lg" ? 480 : 340}
            order={order}
            alt=""
            eager={eager}
            className="transition-transform duration-700 ease-out-soft group-hover:scale-[1.035]"
          />
        ) : (
          <div
            aria-hidden
            className="absolute inset-0 flex items-center justify-center"
          >
            <span className="select-none font-display text-[5rem] font-semibold leading-none text-ink-faint/70 transition-transform duration-700 ease-out-soft group-hover:scale-105">
              {title.charAt(0)}
            </span>
          </div>
        )}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-md ring-1 ring-inset ring-ink/5"
        />
      </div>
      <div className="relative pt-3">
        {folder.palette && <PaletteStrip palette={folder.palette} />}
        {/* The kicker line is always there so titles align across a row */}
        <div className="kicker mb-1 min-h-4 truncate">{dateLabel}</div>
        <h3
          className={cn(
            "line-clamp-2 font-display font-semibold leading-snug text-ink transition-colors [overflow-wrap:anywhere] group-hover:text-accent-strong",
            size === "lg" ? "text-xl" : "text-lg",
          )}
          title={folder.name}
        >
          {title}
        </h3>
        <p className="tabular mt-0.5 truncate text-sm text-ink-muted">
          {showPath && parent ? (
            <span className="text-ink-soft">{parent} · </span>
          ) : null}
          {outOfGallery && "Hors galerie · "}
          {countsLine(folder)}
        </p>
      </div>
    </Link>
  );
}

interface AlbumGridProps {
  folders: Folder[];
  eagerCount?: number;
  showPath?: boolean;
  shareToken?: string;
  hrefFor?: (folder: Folder) => string;
  markExcluded?: boolean;
}

export function AlbumGrid({
  folders,
  eagerCount = 8,
  showPath,
  shareToken,
  hrefFor,
  markExcluded,
}: AlbumGridProps) {
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-4 2xl:grid-cols-5">
      {folders.map((folder, i) => (
        <li
          key={folder.path}
          className="min-w-0 animate-rise-in"
          style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
        >
          <AlbumCard
            folder={folder}
            eager={i < eagerCount}
            showPath={showPath}
            shareToken={shareToken}
            href={hrefFor?.(folder)}
            order={i}
            markExcluded={markExcluded}
          />
        </li>
      ))}
    </ul>
  );
}
