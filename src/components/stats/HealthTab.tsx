"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Badge, Section, Skeleton, Stat } from "@/components/ui";
import { Meter } from "./charts";
import {
  formatDate,
  formatNumber,
  formatPercent,
  formatSize,
  timeAgo,
} from "./format";
import {
  BarsSkeleton,
  SectionTitleSkeleton,
  StatsRowSkeleton,
  TabError,
} from "./TabState";
import type { HealthStats, IgnoredFiles } from "./types";
import { useStatsResource } from "./useStatsResource";

const cell = "border-t border-line pt-4";

export default function HealthTab({ active }: { active: boolean }) {
  const health = useStatsResource<HealthStats>("/api/stats/health", active);
  const ignored = useStatsResource<IgnoredFiles>(
    "/api/stats/ignored-files",
    active,
  );

  return (
    <div>
      {health.state.status === "error" ? (
        <TabError
          title="Health figures didn't load"
          error={health.state.error}
          onRetry={health.retry}
          className="py-6"
        />
      ) : health.state.status !== "ready" ? (
        <div
          role="status"
          aria-label="Loading health"
          className="grid gap-x-12 lg:grid-cols-2"
        >
          {[0, 1].map((i) => (
            <div key={i} className="py-8 sm:py-10">
              <SectionTitleSkeleton />
              {i === 0 ? <BarsSkeleton rows={4} /> : <StatsRowSkeleton />}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid animate-fade-in gap-x-12 lg:grid-cols-2">
          <MetadataSection data={health.state.data.metadata} />
          <SyncSection data={health.state.data.sync} />
        </div>
      )}

      <Section
        title="Ignored files"
        description="Left out of duplicate detection: system files, thumbnails other apps made, and files too small to be photos."
      >
        {ignored.state.status === "error" ? (
          <TabError
            title="The ignored files didn't load"
            error={ignored.state.error}
            onRetry={ignored.retry}
          />
        ) : ignored.state.status !== "ready" ? (
          <div
            role="status"
            aria-label="Loading ignored files"
            className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4"
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={cell}>
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-3 h-6 w-20" />
                <Skeleton className="mt-3 h-3 w-full" />
              </div>
            ))}
          </div>
        ) : (
          <IgnoredList data={ignored.state.data} />
        )}
      </Section>
    </div>
  );
}

function MetadataSection({ data }: { data: HealthStats["metadata"] }) {
  const rows = [
    { label: "Size", value: data.with_dimensions },
    { label: "Date taken", value: data.with_date },
    { label: "Camera", value: data.with_camera },
    { label: "Location", value: data.with_location },
  ];
  return (
    <Section
      title="Metadata"
      description="Read from each photo's header. The ones still to read are picked up by the metadata backfill, so these numbers grow: reload to see where it is."
    >
      <ul className="space-y-4">
        {rows.map((r) => (
          <li key={r.label}>
            <div className="mb-1.5 flex items-baseline justify-between gap-4 text-sm">
              <span className="text-ink">{r.label}</span>
              <span className="tabular text-ink-soft">
                {formatPercent(r.value, data.images)}
                <span className="text-ink-muted">
                  {" "}
                  · {formatNumber(r.value)}
                </span>
              </span>
            </div>
            <Meter
              value={r.value}
              total={data.images}
              label={`${r.label}: ${formatNumber(r.value)} of ${formatNumber(data.images)} photos`}
            />
          </li>
        ))}
      </ul>
      <div className="mt-8 grid grid-cols-3 gap-x-6">
        <Stat
          className={cell}
          label="Still to read"
          value={formatNumber(data.pending)}
        />
        <Stat
          className={cell}
          label="Unreadable"
          value={formatNumber(data.failed)}
          hint="No usable header"
        />
        <Stat
          className={cell}
          label="Videos"
          value={formatNumber(data.videos)}
          hint="Not read for now"
        />
      </div>
    </Section>
  );
}

function SyncSection({ data }: { data: HealthStats["sync"] }) {
  const outOfDate = data.stale + data.never_synced > 0;
  return (
    <Section
      title="Sync"
      description="A sync compares the library with the bucket, and picks up files added or removed there."
      action={
        outOfDate ? (
          <Badge tone="warning" icon={AlertTriangle}>
            Out of date
          </Badge>
        ) : (
          <Badge tone="success" icon={CheckCircle2}>
            Up to date
          </Badge>
        )
      }
    >
      <div className="grid grid-cols-2 gap-x-6 gap-y-8">
        <Stat
          label="Last sync"
          value={data.last_synced ? timeAgo(data.last_synced) : "Never"}
          hint={data.last_synced ? formatDate(data.last_synced) : undefined}
        />
        <Stat label="Folders" value={formatNumber(data.total_folders)} />
        <Stat
          label="Checked this week"
          value={formatNumber(data.synced_last_week)}
          hint={`${formatNumber(data.synced_last_day)} today`}
        />
        <Stat
          label="Out of date"
          value={formatNumber(data.stale + data.never_synced)}
          hint={
            data.never_synced > 0
              ? `Not checked for a week, ${formatNumber(data.never_synced)} never`
              : "Not checked for a week"
          }
        />
      </div>
      {outOfDate && (
        <p className="mt-6 max-w-xl text-pretty text-sm text-ink-soft">
          {data.last_synced
            ? `Photos added to the bucket after ${formatDate(data.last_synced)} won't appear until the next sync. Run a full sync to catch up.`
            : "Run a full sync to bring the library in line with the bucket."}
        </p>
      )}
    </Section>
  );
}

function IgnoredList({ data }: { data: IgnoredFiles }) {
  if (data.breakdown.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-soft">
        <Badge tone="success" icon={CheckCircle2}>
          None
        </Badge>
        Every file in the library is taken into account.
      </p>
    );
  }
  return (
    <div className="animate-fade-in">
      <p className="tabular mb-5 text-sm text-ink-soft">
        {formatNumber(data.summary.total_ignored_files)} files,{" "}
        {formatSize(data.summary.total_ignored_size_bytes)} in all.
      </p>
      <ul className="grid gap-x-6 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
        {data.breakdown.map((c) => (
          <li key={c.category} className={`${cell} min-w-0`}>
            <div className="text-sm text-ink">{c.label}</div>
            <div className="tabular mt-1 font-display text-2xl font-semibold text-ink">
              {formatNumber(c.count)}
            </div>
            <div className="tabular text-xs text-ink-muted">
              {formatSize(c.total_size_bytes)}
            </div>
            {c.examples.length > 0 && (
              <ul className="mt-3 space-y-0.5">
                {c.examples.map((e) => (
                  <li
                    key={e}
                    className="truncate font-mono text-xs text-ink-muted"
                    title={e}
                  >
                    {e}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
