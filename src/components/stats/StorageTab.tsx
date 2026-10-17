"use client";

import FolderHeatmap from "@/components/FolderHeatmap";
import { albumHref } from "@/components/photos/AlbumCard";
import { Section, Skeleton } from "@/components/ui";
import { formatCount, parseAlbumName } from "@/lib/albums";
import { BarList, Legend, TipRow, type BarItem } from "./charts";
import {
  folderKicker,
  formatExtension,
  formatNumber,
  formatPercent,
  formatSize,
} from "./format";
import { BarsSkeleton, SectionTitleSkeleton, TabError } from "./TabState";
import type { StorageStats } from "./types";
import { useStatsResource } from "./useStatsResource";

export default function StorageTab({
  active,
  totalBytes,
}: {
  active: boolean;
  totalBytes?: number;
}) {
  const { state, retry } = useStatsResource<StorageStats>(
    "/api/stats/storage",
    active,
  );

  if (state.status === "error") {
    return (
      <TabError
        title="Les chiffres du stockage n’ont pas chargé"
        error={state.error}
        onRetry={retry}
        className="py-6"
      />
    );
  }

  if (state.status !== "ready") {
    return (
      <div role="status" aria-label="Chargement du stockage">
        <div className="py-8 sm:py-10">
          <SectionTitleSkeleton />
          <div className="grid grid-cols-2 gap-0.5 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-sm" />
            ))}
          </div>
        </div>
        <div className="grid gap-x-12 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="py-8 sm:py-10">
              <SectionTitleSkeleton />
              <BarsSkeleton />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const { largest_by_size, largest_by_count, file_types } = state.data;
  const typesTotal = file_types.reduce((sum, t) => sum + t.total_size_bytes, 0);
  const library = totalBytes ?? typesTotal;

  const typeItems: BarItem[] = file_types.map((t) => {
    const name = `${formatExtension(t.extension)} ${t.kind === "video" ? "vidéos" : "photos"}`;
    return {
      key: `${t.kind}-${t.extension}`,
      name,
      label: (
        <>
          {formatExtension(t.extension)}
          <span className="text-ink-muted">
            {" "}
            · {t.kind === "video" ? "vidéo" : "photo"}
          </span>
        </>
      ),
      value: t.total_size_bytes,
      valueLabel: formatSize(t.total_size_bytes),
      detail: `${formatCount(t.count, "fichier")} · ${formatPercent(t.total_size_bytes, typesTotal)} de l’espace`,
      series: t.kind,
      tooltip: (
        <>
          <TipRow label="Espace" value={formatSize(t.total_size_bytes)} />
          <TipRow label="Fichiers" value={formatNumber(t.count)} />
          <TipRow
            label="Taille moyenne"
            value={formatSize(t.total_size_bytes / Math.max(1, t.count))}
          />
        </>
      ),
    };
  });

  const countItems: BarItem[] = largest_by_count.map((a) => {
    const { title } = parseAlbumName(a.name);
    const files = a.photo_count + a.video_count;
    return {
      key: String(a.id),
      name: title,
      href: albumHref(a.path),
      kicker: folderKicker(a.path, a.name),
      label: title,
      value: files,
      valueLabel: formatNumber(files),
      detail:
        a.video_count > 0
          ? `${formatCount(a.photo_count, "photo")} · ${formatCount(a.video_count, "vidéo")} · ${formatSize(a.total_size)}`
          : formatSize(a.total_size),
    };
  });

  return (
    <div className="animate-fade-in">
      <Section
        title="Dossiers les plus lourds"
        description={`Les ${formatNumber(largest_by_size.length)} premiers, sur ${formatSize(library)} au total`}
      >
        <FolderHeatmap
          albums={largest_by_size}
          metric="size"
          totalBytes={library}
        />
      </Section>

      <div className="grid gap-x-12 lg:grid-cols-2">
        <Section
          title="Types de fichiers"
          action={<Legend series={["photo", "video"]} />}
        >
          <BarList items={typeItems} initial={6} step={10} />
        </Section>

        <Section
          title="Dossiers les plus remplis"
          description="Par nombre de photos et vidéos"
        >
          <BarList items={countItems} initial={8} step={8} />
        </Section>
      </div>
    </div>
  );
}
