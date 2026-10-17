"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, ScanLine } from "lucide-react";
import { Badge, Skeleton, Stat, type Tone } from "@/components/ui";
import type { LucideIcon } from "lucide-react";
import { Meter, SplitBar } from "./charts";
import { formatNumber, formatPercent, formatSize, timeAgo } from "./format";
import type { StatsSummary } from "./types";
import type { Resource } from "./useStatsResource";
import { TabError } from "./TabState";
import type { StatsTab } from "./tabs";

interface StatsOverviewProps {
  summary: Resource<StatsSummary>;
  onRetry: () => void;
  onOpenTab: (tab: StatsTab) => void;
}

const cell = "border-t border-line pt-4";

export default function StatsOverview({ summary, onRetry, onOpenTab }: StatsOverviewProps) {
  if (summary.status === "error") {
    return (
      <TabError
        title="The headline numbers didn't load"
        error={summary.error}
        onRetry={onRetry}
        className="border-y border-line"
      />
    );
  }

  if (summary.status !== "ready") {
    return (
      <div role="status" aria-label="Loading the headline numbers">
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={cell}>
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-3 h-9 w-28" />
              <Skeleton className="mt-2 h-3 w-24" />
            </div>
          ))}
        </div>
        <Skeleton className="mt-6 h-5 w-80 max-w-full" />
      </div>
    );
  }

  const s = summary.data;
  const photoBytes = Math.max(0, s.storage_bytes - s.video_bytes);
  const { images, with_dimensions, with_date, pending } = s.metadata;

  return (
    <div className="animate-fade-in">
      <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3 xl:grid-cols-6">
        <Stat className={cell} label="Photos" value={formatNumber(s.photos)} hint={formatSize(photoBytes)} />
        <Stat className={cell} label="Videos" value={formatNumber(s.videos)} hint={formatSize(s.video_bytes)} />
        <Stat
          className={cell}
          label="Storage used"
          value={formatSize(s.storage_bytes)}
          hint={
            <>
              <SplitBar
                className="mb-1.5 mt-2"
                label={`Photos ${formatSize(photoBytes)}, videos ${formatSize(s.video_bytes)}`}
                parts={[
                  { series: "photo", value: photoBytes },
                  { series: "video", value: s.video_bytes },
                ]}
              />
              Videos take {formatPercent(s.video_bytes, s.storage_bytes)}
            </>
          }
        />
        <Stat className={cell} label="Albums" value={formatNumber(s.albums)} hint={`in ${formatNumber(s.folders)} folders`} />
        <Stat
          className={cell}
          label="Favorites"
          value={formatNumber(s.favorites)}
          hint={
            s.favorites > 0 ? (
              <Link href="/favorites" className="underline decoration-line-strong underline-offset-2 hover:text-ink">
                Open favorites
              </Link>
            ) : (
              "Tap the heart on a photo to keep it here"
            )
          }
        />
        <Stat
          className={cell}
          label="Metadata"
          value={formatPercent(with_dimensions, images)}
          hint={
            <>
              <Meter
                className="mb-1.5 mt-2"
                value={with_dimensions}
                total={images}
                label={`${formatNumber(with_dimensions)} of ${formatNumber(images)} photos have their size and date read`}
              />
              <span className="tabular">
                {formatNumber(with_dimensions)} of {formatNumber(images)} read
              </span>
            </>
          }
        />
      </div>

      <Attention summary={s} withDate={with_date} pending={pending} onOpenTab={onOpenTab} />
    </div>
  );
}

interface AttentionItem {
  key: string;
  tone: Tone;
  icon: LucideIcon;
  badge: string;
  text: string;
  tab: StatsTab;
}

function Attention({
  summary,
  pending,
  withDate,
  onOpenTab,
}: {
  summary: StatsSummary;
  pending: number;
  withDate: number;
  onOpenTab: (tab: StatsTab) => void;
}) {
  const items: AttentionItem[] = [];
  const { stale_folders, last_synced } = summary.sync;

  if (stale_folders > 0) {
    items.push({
      key: "sync",
      tone: "warning",
      icon: AlertTriangle,
      badge: "Sync",
      text: last_synced
        ? `Last sync ${timeAgo(last_synced)}. New photos in the bucket won't show until the next one.`
        : "The library has never been synced with the bucket.",
      tab: "health",
    });
  }
  if (pending > 0) {
    items.push({
      key: "metadata",
      tone: "info",
      icon: ScanLine,
      badge: "Metadata",
      text: `${formatNumber(pending)} photos still to read for sizes and dates (${formatNumber(withDate)} dated so far).`,
      tab: "health",
    });
  }

  return (
    <div className="mt-6 border-t border-line pt-4">
      <h2 className="kicker mb-2">Needs attention</h2>
      {items.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-ink-soft">
          <Badge tone="success" icon={CheckCircle2}>
            All clear
          </Badge>
          Sync and metadata are up to date.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => onOpenTab(item.tab)}
                className="touch-target group flex w-full items-start gap-2.5 rounded-md py-1.5 text-left text-sm text-ink-soft transition-colors duration-150 hover:text-ink sm:items-center"
              >
                <Badge tone={item.tone} icon={item.icon} className="mt-px shrink-0 sm:mt-0">
                  {item.badge}
                </Badge>
                <span className="min-w-0 flex-1 text-pretty">{item.text}</span>
                <span className="hidden shrink-0 items-center gap-1 text-ink-muted transition-colors group-hover:text-accent-strong sm:inline-flex">
                  Health
                  <ArrowRight className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
