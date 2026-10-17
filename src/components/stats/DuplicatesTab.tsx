"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, Copy, CornerDownRight } from "lucide-react";
import { albumHref } from "@/components/photos/AlbumCard";
import { Badge, EmptyState, Section, Skeleton, Stat } from "@/components/ui";
import { formatDay, parseAlbumName } from "@/lib/albums";
import { ShowMore } from "./charts";
import { formatNumber, formatSize } from "./format";
import { SectionTitleSkeleton, TabError } from "./TabState";
import type { DuplicateFiles, DuplicateFolders } from "./types";
import {
  useElapsed,
  useStatsResource,
  type Resource,
} from "./useStatsResource";

const cell = "border-t border-line pt-4";

export default function DuplicatesTab({
  active,
  files: libraryFiles,
}: {
  active: boolean;
  files?: number;
}) {
  // Two independent analyses: each one fills in, or fails, on its own.
  const folders = useStatsResource<DuplicateFolders>(
    "/api/stats/duplicate-folders",
    active,
  );
  const files = useStatsResource<DuplicateFiles>(
    "/api/stats/duplicates",
    active,
  );

  const f =
    folders.state.status === "ready" ? folders.state.data.summary : undefined;
  const d =
    files.state.status === "ready" ? files.state.data.summary : undefined;

  return (
    <div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-6 pt-8 sm:pt-10 lg:grid-cols-4">
        <PendingStat
          ready={!!f}
          label="Albums stored twice"
          value={f && formatNumber(f.total_duplicate_folder_groups)}
          hint={
            f && `${formatNumber(f.total_duplicate_folders)} folders in all`
          }
        />
        <PendingStat
          ready={!!f}
          label="Space in album copies"
          value={f && formatSize(f.potential_space_saved_bytes)}
          hint="Freed by keeping one of each"
        />
        <PendingStat
          ready={!!d}
          label="Files with a copy"
          value={d && formatNumber(d.total_duplicate_filenames)}
          hint={d && `${formatNumber(d.total_duplicate_photos)} files in all`}
        />
        <PendingStat
          ready={!!d}
          label="Space in file copies"
          value={d && formatSize(d.potential_space_saved_bytes)}
          hint="Includes the album copies"
        />
      </div>

      <Section
        title="Albums that appear more than once"
        description="Same files, same sizes, in different places. Open both to decide which one to keep."
      >
        <Analysis
          resource={folders.state}
          onRetry={folders.retry}
          what="Comparing the contents of every album"
          failTitle="The album comparison didn't finish"
        >
          {(data) => <FolderGroups data={data} />}
        </Analysis>
      </Section>

      <Section
        title="Files that appear more than once"
        description={`Same name and same size${libraryFiles ? `, across ${formatNumber(libraryFiles)} files` : ""}. Sorted by the space a cleanup would free.`}
      >
        <Analysis
          resource={files.state}
          onRetry={files.retry}
          what="Matching files by name and size"
          failTitle="The file comparison didn't finish"
        >
          {(data) => <FileGroups data={data} />}
        </Analysis>
      </Section>
    </div>
  );
}

function PendingStat({
  ready,
  label,
  value,
  hint,
}: {
  ready: boolean;
  label: string;
  value?: string;
  hint?: string;
}) {
  if (!ready) {
    return (
      <div className={cell} aria-hidden>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-3 h-8 w-20" />
        <Skeleton className="mt-2 h-3 w-28" />
      </div>
    );
  }
  return (
    <Stat
      className={`${cell} animate-fade-in`}
      label={label}
      value={value}
      hint={hint}
    />
  );
}

function Analysis<T>({
  resource,
  onRetry,
  what,
  failTitle,
  children,
}: {
  resource: Resource<T>;
  onRetry: () => void;
  what: string;
  failTitle: string;
  children: (data: T) => React.ReactNode;
}) {
  const elapsed = useElapsed(
    resource.status === "loading" ? resource.startedAt : undefined,
  );
  if (resource.status === "error")
    return (
      <TabError title={failTitle} error={resource.error} onRetry={onRetry} />
    );
  if (resource.status === "ready") {
    return (
      <div className="animate-fade-in">
        {children(resource.data)}
        <p className="tabular mt-4 text-xs text-ink-faint">
          Analysed in {(resource.tookMs / 1000).toFixed(1)} s
        </p>
      </div>
    );
  }
  return (
    <div role="status" aria-live="polite">
      <p className="tabular mb-4 flex items-center gap-2 text-sm text-ink-muted">
        <span
          aria-hidden
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent"
        />
        {what}… {elapsed > 0 ? `${elapsed} s` : ""}
      </p>
      <div aria-hidden className="grid gap-x-12 gap-y-8 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i}>
            <Skeleton className="h-5 w-56 max-w-full" />
            <Skeleton className="mt-2 h-3 w-40" />
            <Skeleton className="mt-4 h-3.5 w-full" />
            <Skeleton className="mt-2 h-3.5 w-5/6" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** "pc-fixe / photos tel a trier / chats", the album itself in ink. */
function Location({
  href,
  path,
  note,
}: {
  href: string;
  path: string;
  note?: string;
}) {
  const parts = path.split("/");
  const name = parts.pop() || "Library";
  return (
    <li>
      <Link
        href={href}
        title={path}
        className="touch-target group flex min-w-0 items-start gap-1.5 rounded-sm py-1 text-sm transition-colors duration-150"
      >
        <CornerDownRight
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint"
          aria-hidden
        />
        <span className="min-w-0 break-words">
          {parts.length > 0 && (
            <span className="text-ink-muted">{parts.join(" / ")} / </span>
          )}
          <span className="text-ink underline decoration-line-strong underline-offset-2 transition-colors group-hover:text-accent-strong group-hover:decoration-accent">
            {name}
          </span>
          {note && <span className="text-ink-muted"> · {note}</span>}
        </span>
      </Link>
    </li>
  );
}

function GroupHeader({
  kicker,
  title,
  copies,
  meta,
}: {
  kicker?: string;
  title: string;
  copies: number;
  meta: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        {kicker && <div className="kicker mb-1 truncate">{kicker}</div>}
        <h3 className="break-words font-display text-lg font-semibold leading-snug text-ink">
          {title}
        </h3>
        <p className="tabular mt-0.5 text-sm text-ink-muted">{meta}</p>
      </div>
      <Badge tone="neutral" icon={Copy} className="mt-0.5 shrink-0">
        {copies} copies
      </Badge>
    </div>
  );
}

function NoneFound({ what }: { what: string }) {
  return (
    <EmptyState
      icon={CheckCircle2}
      title={`No ${what} found`}
      body="Nothing is stored twice. Checked again each time this page loads."
      className="py-8"
    />
  );
}

function FolderGroups({ data }: { data: DuplicateFolders }) {
  const initial = 6;
  const [visible, setVisible] = useState(initial);
  if (data.duplicates.length === 0)
    return <NoneFound what="duplicate albums" />;
  return (
    <>
      <ol className="grid gap-x-12 gap-y-8 lg:grid-cols-2">
        {data.duplicates.slice(0, visible).map((g) => {
          const first = g.folders[0];
          const { title, date, precision } = parseAlbumName(first?.name ?? "");
          return (
            <li key={g.folder_signature} className="min-w-0">
              <GroupHeader
                kicker={
                  date && precision ? formatDay(date, precision) : undefined
                }
                title={title || "Untitled album"}
                copies={g.count}
                meta={`${formatNumber(g.file_count)} files · ${formatSize(g.total_size_bytes)} each · frees ${formatSize(g.total_size_bytes * (g.count - 1))}`}
              />
              <ul className="mt-2">
                {g.folders.map((folder) => (
                  <Location
                    key={folder.id}
                    href={albumHref(folder.path)}
                    path={folder.path}
                  />
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
      <ShowMore
        total={data.duplicates.length}
        visible={visible}
        initial={initial}
        step={8}
        noun="more albums"
        onChange={setVisible}
      />
      <Cap
        shown={data.duplicates.length}
        total={data.summary.total_duplicate_folder_groups}
        noun="albums"
      />
    </>
  );
}

function FileGroups({ data }: { data: DuplicateFiles }) {
  const initial = 6;
  const [visible, setVisible] = useState(initial);
  if (data.duplicates.length === 0) return <NoneFound what="duplicate files" />;
  return (
    <>
      <ol className="grid gap-x-12 gap-y-8 lg:grid-cols-2">
        {data.duplicates.slice(0, visible).map((g) => {
          const hidden = g.count - g.photos.length;
          return (
            <li key={`${g.filename}|${g.size}`} className="min-w-0">
              <GroupHeader
                title={g.filename}
                copies={g.count}
                meta={`${formatSize(g.size)} each · frees ${formatSize(g.size * (g.count - 1))}`}
              />
              <ul className="mt-2">
                {g.photos.map((p) => (
                  <Location
                    key={p.id}
                    href={`${albumHref(p.folder_path)}?photo=${p.id}`}
                    path={p.folder_path}
                  />
                ))}
              </ul>
              {hidden > 0 && (
                <p className="mt-1 pl-5 text-xs text-ink-muted">
                  and {formatNumber(hidden)} more{" "}
                  {hidden === 1 ? "place" : "places"}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <ShowMore
        total={data.duplicates.length}
        visible={visible}
        initial={initial}
        step={8}
        noun="more files"
        onChange={setVisible}
      />
      <Cap
        shown={data.duplicates.length}
        total={data.summary.total_duplicate_filenames}
        noun="files"
      />
    </>
  );
}

function Cap({
  shown,
  total,
  noun,
}: {
  shown: number;
  total: number;
  noun: string;
}) {
  if (total <= shown) return null;
  return (
    <p className="tabular mt-3 text-xs text-ink-muted">
      Listing the {formatNumber(shown)} {noun} that free the most space, of{" "}
      {formatNumber(total)}.
    </p>
  );
}
