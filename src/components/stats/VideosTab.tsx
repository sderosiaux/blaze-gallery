"use client";

import Link from "next/link";
import { useState } from "react";
import { Film } from "lucide-react";
import { albumHref } from "@/components/photos/AlbumCard";
import { EmptyState, Section, Stat } from "@/components/ui";
import { albumDateLabel, formatCount, parseAlbumName } from "@/lib/albums";
import { BarList, ShowMore, type BarItem } from "./charts";
import {
  folderKicker,
  formatExtension,
  formatNumber,
  formatPercent,
  formatSize,
} from "./format";
import {
  BarsSkeleton,
  SectionTitleSkeleton,
  StatsRowSkeleton,
  TabError,
} from "./TabState";
import type { VideoStats } from "./types";
import { useStatsResource } from "./useStatsResource";

const cell = "border-t border-line pt-4";

export default function VideosTab({ active }: { active: boolean }) {
  const { state, retry } = useStatsResource<VideoStats>(
    "/api/stats/videos",
    active,
  );

  if (state.status === "error") {
    return (
      <TabError
        title="Les chiffres des vidéos n’ont pas chargé"
        error={state.error}
        onRetry={retry}
        className="py-6"
      />
    );
  }

  if (state.status !== "ready") {
    return (
      <div
        role="status"
        aria-label="Chargement des vidéos"
        className="pt-8 sm:pt-10"
      >
        <StatsRowSkeleton />
        <div className="grid gap-x-12 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="py-8 sm:py-10">
              <SectionTitleSkeleton />
              <BarsSkeleton rows={5} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const { summary, formats, largest, albums } = state.data;

  if (summary.total_videos === 0) {
    return <EmptyState icon={Film} title="Aucune vidéo" className="py-12" />;
  }

  const formatItems: BarItem[] = formats.map((f) => ({
    key: f.format,
    name: formatExtension(f.format),
    label: formatExtension(f.format),
    value: f.count,
    valueLabel: formatNumber(f.count),
    detail: `${formatSize(f.total_size_bytes)} · ${formatPercent(f.count, summary.total_videos)} des vidéos`,
    series: "video",
  }));

  const albumItems: BarItem[] = albums.map((a) => {
    const { title } = parseAlbumName(a.name);
    return {
      key: String(a.id),
      name: title,
      href: albumHref(a.path),
      kicker: folderKicker(a.path, a.name),
      label: title,
      value: a.video_count,
      valueLabel: formatNumber(a.video_count),
      detail: formatSize(a.total_size_bytes),
      series: "video",
    };
  });

  return (
    <div className="animate-fade-in">
      <div className="grid grid-cols-2 gap-x-6 gap-y-6 pt-8 sm:pt-10 lg:grid-cols-4">
        <Stat
          className={cell}
          label="Vidéos"
          value={formatNumber(summary.total_videos)}
          hint={`dans ${formatCount(summary.albums_with_videos, "dossier")}`}
        />
        <Stat
          className={cell}
          label="Espace occupé"
          value={formatSize(summary.total_size_bytes)}
        />
        <Stat
          className={cell}
          label="Taille moyenne"
          value={formatSize(summary.avg_size_bytes)}
        />
        <Stat
          className={cell}
          label="La plus lourde"
          value={formatSize(summary.max_size_bytes)}
          hint={largest[0]?.filename}
        />
      </div>

      <div className="grid gap-x-12 lg:grid-cols-2">
        <Section title="Formats" description="Par nombre de vidéos">
          <BarList items={formatItems} initial={6} step={10} />
        </Section>
        <Section title="Dossiers avec le plus de vidéos">
          <BarList items={albumItems} initial={6} step={8} />
        </Section>
      </div>

      <Section title="Vidéos les plus lourdes">
        <LargestVideos videos={largest} />
      </Section>
    </div>
  );
}

function LargestVideos({ videos }: { videos: VideoStats["largest"] }) {
  const initial = 8;
  const [visible, setVisible] = useState(initial);
  return (
    <>
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-medium uppercase tracking-[0.08em] text-ink-muted">
              <th scope="col" className="px-4 py-2.5 font-medium">
                Vidéo
              </th>
              <th
                scope="col"
                className="hidden px-4 py-2.5 font-medium md:table-cell"
              >
                Dossier
              </th>
              <th
                scope="col"
                className="hidden w-20 px-4 py-2.5 font-medium sm:table-cell"
              >
                Format
              </th>
              <th
                scope="col"
                className="w-24 px-4 py-2.5 text-right font-medium"
              >
                Taille
              </th>
            </tr>
          </thead>
          <tbody>
            {videos.slice(0, visible).map((v) => {
              const album = parseAlbumName(v.folder_name).title;
              const date = albumDateLabel({
                name: v.folder_name,
                date_from: null,
                date_to: null,
              });
              return (
                <tr key={v.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      href={`${albumHref(v.folder_path)}?photo=${v.id}`}
                      className="block truncate text-ink transition-colors hover:text-accent-strong"
                      title={v.filename}
                    >
                      {v.filename}
                    </Link>
                    <Link
                      href={albumHref(v.folder_path)}
                      className="mt-0.5 block truncate text-xs text-ink-muted hover:text-ink md:hidden"
                      title={v.folder_path}
                    >
                      {date ? `${album} · ${date}` : album}
                    </Link>
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">
                    <Link
                      href={albumHref(v.folder_path)}
                      className="block truncate text-ink-soft transition-colors hover:text-accent-strong"
                      title={v.folder_path}
                    >
                      {date && (
                        <span className="kicker block truncate">{date}</span>
                      )}
                      {album}
                    </Link>
                  </td>
                  <td className="hidden px-4 py-3 text-ink-muted sm:table-cell">
                    {formatExtension(v.format)}
                  </td>
                  <td className="tabular px-4 py-3 text-right text-ink-soft">
                    {formatSize(v.size)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ShowMore
        total={videos.length}
        visible={visible}
        initial={initial}
        step={8}
        onChange={setVisible}
      />
    </>
  );
}
