import {
  Activity,
  ArrowDownToLine,
  CircleAlert,
  Timer,
  Wallet,
} from "lucide-react";
import { Badge, Skeleton, Stat } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import type { AuditSummary } from "./types";
import {
  errorRateLook,
  formatCount,
  formatDuration,
  formatShare,
  type TimeRange,
} from "./format";
import { SectionError } from "./SectionError";

interface SummaryStatsProps {
  summary: AuditSummary | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  range: TimeRange;
}

const band = "grid grid-cols-2 gap-x-6 gap-y-8 border-y border-line py-6";

function perHour(total: number, range: TimeRange) {
  return total / (range.ms / 3_600_000);
}

export function SummaryStats({
  summary,
  loading,
  error,
  onRetry,
  range,
}: SummaryStatsProps) {
  if (error) {
    return (
      <div className="border-y border-line">
        <SectionError
          title="The headline numbers did not load"
          error={error}
          onRetry={onRetry}
        />
      </div>
    );
  }

  if (!summary) {
    return (
      <div
        role="status"
        aria-label="Loading summary"
        className={cn(band, "md:grid-cols-4")}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i}>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-9 w-28" />
            <Skeleton className="mt-2 h-3 w-32" />
          </div>
        ))}
      </div>
    );
  }

  const look = errorRateLook(summary.error_rate, summary.total_requests);
  const hasCost = summary.estimated_cost_usd != null;
  const hourly = perHour(summary.total_requests, range);

  return (
    <div
      aria-busy={loading || undefined}
      className={cn(
        band,
        hasCost ? "md:grid-cols-3 lg:grid-cols-5" : "md:grid-cols-4",
        "transition-opacity duration-200",
        loading && "opacity-60",
      )}
    >
      <Stat
        icon={Activity}
        label="Requests"
        value={formatCount(summary.total_requests)}
        hint={
          range.ms > 3_600_000
            ? `About ${formatCount(Math.round(hourly))} an hour`
            : "In the last hour"
        }
      />
      <Stat
        icon={Timer}
        label="Average latency"
        value={formatDuration(summary.avg_duration_ms)}
        hint={
          summary.p95_duration_ms != null
            ? `95% under ${formatDuration(summary.p95_duration_ms)}`
            : "No requests yet"
        }
      />
      <Stat
        icon={ArrowDownToLine}
        label="Transferred"
        value={formatBytes(summary.total_bytes)}
        hint={
          summary.total_requests > 0
            ? `About ${formatBytes(summary.total_bytes / summary.total_requests)} per request`
            : "Nothing moved yet"
        }
      />
      <Stat
        icon={CircleAlert}
        label="Error rate"
        value={formatShare(summary.error_rate)}
        hint={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge tone={look.tone} icon={look.icon}>
              {look.label}
            </Badge>
            {summary.error_count > 0 && (
              <span>{formatCount(summary.error_count)} failed</span>
            )}
          </span>
        }
      />
      {hasCost && (
        <Stat
          icon={Wallet}
          label="Estimated cost"
          value={`$${summary.estimated_cost_usd!.toFixed(summary.estimated_cost_usd! < 1 ? 4 : 2)}`}
          hint="From per-request estimates"
        />
      )}
    </div>
  );
}
