"use client";

import { Badge, Section, Select, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import type { AuditLogEntry, AuditLogPage } from "./types";
import {
  formatCount,
  formatDay,
  formatDuration,
  formatTimeWithSeconds,
  isSameLocalDay,
  operationLabel,
  statusLook,
} from "./format";
import { SectionError } from "./SectionError";

export const PAGE_SIZES = [20, 100, 500] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

interface RecentRequestsProps {
  page: AuditLogPage | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  pageSize: PageSize;
  onPageSizeChange: (size: PageSize) => void;
}

const th = "pb-3 text-xs font-medium uppercase tracking-[0.08em] text-ink-muted";

/** Endpoint plus the bucket and object behind it, for the hover title. */
function fullTarget(log: AuditLogEntry) {
  return [log.endpoint, log.key ? `${log.bucket}/${log.key}` : log.bucket].join("\n");
}

/** Requests without a page behind them (sync, scans) log "system": name the bucket instead. */
function Endpoint({ log, className }: { log: AuditLogEntry; className?: string }) {
  return (
    <span className={cn("block truncate font-mono text-xs text-ink-soft", className)} title={fullTarget(log)}>
      {log.endpoint}
      {log.endpoint === "system" && (
        <span className="text-ink-muted"> · {log.key ? `${log.bucket}/${log.key}` : log.bucket}</span>
      )}
    </span>
  );
}

function When({ iso, now, stacked }: { iso: string; now: number; stacked?: boolean }) {
  const t = Date.parse(iso);
  return (
    <time dateTime={iso} className="whitespace-nowrap">
      {!isSameLocalDay(t, now) && (
        <span className={cn("text-ink-muted", stacked && "block text-xs")}>{formatDay(t)} </span>
      )}
      {formatTimeWithSeconds(t)}
    </time>
  );
}

function StatusBadge({ code }: { code: number }) {
  const look = statusLook(code);
  return (
    <Badge tone={look.tone} icon={look.icon}>
      {look.label}
    </Badge>
  );
}

export function RecentRequests({ page, loading, error, onRetry, pageSize, onPageSizeChange }: RecentRequestsProps) {
  const now = Date.now();

  const sizeControl = (
    <div className="flex items-center gap-2">
      <label htmlFor="audit-page-size" className="text-sm text-ink-muted">
        Show
      </label>
      <Select
        id="audit-page-size"
        value={pageSize}
        onChange={(e) => onPageSizeChange(Number(e.target.value) as PageSize)}
        className="w-auto"
      >
        {PAGE_SIZES.map((n) => (
          <option key={n} value={n}>
            {n} requests
          </option>
        ))}
      </Select>
    </div>
  );

  let body: React.ReactNode;
  if (error) {
    body = <SectionError title="The request log did not load" error={error} onRetry={onRetry} />;
  } else if (!page) {
    body = (
      <div role="status" aria-label="Loading requests" className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  } else if (page.logs.length === 0) {
    body = (
      <p className="py-6 text-sm text-ink-muted">
        No requests in this period. Pick a longer time range, or open an album to see requests arrive.
      </p>
    );
  } else {
    body = (
      <div aria-busy={loading || undefined} className={cn("transition-opacity duration-200", loading && "opacity-60")}>
        <p className="mb-4 text-sm text-ink-muted">
          Newest first. Showing {formatCount(page.logs.length)} of {formatCount(page.total_count)} in this period.
        </p>

        <table className="hidden w-full table-fixed text-sm md:table">
          <thead>
            <tr className="border-b border-line text-left">
              <th scope="col" className={cn(th, "w-[13%]")}>Time</th>
              <th scope="col" className={cn(th, "w-[16%]")}>Operation</th>
              <th scope="col" className={cn(th, "w-[17%]")}>Status</th>
              <th scope="col" className={cn(th, "w-[10%] text-right")}>Duration</th>
              <th scope="col" className={cn(th, "w-[10%] text-right")}>Size</th>
              <th scope="col" className={cn(th, "pl-6")}>Endpoint</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {page.logs.map((log) => (
              <tr key={log.id} className="border-b border-line align-top last:border-b-0">
                <td className="py-2.5 pr-3 text-ink-soft">
                  <When iso={log.timestamp} now={now} stacked />
                </td>
                <td className="truncate py-2.5 pr-3 text-ink" title={log.operation}>
                  {operationLabel(log.operation)}
                </td>
                <td className="py-2.5 pr-3">
                  <StatusBadge code={log.status_code} />
                </td>
                <td className="py-2.5 text-right text-ink">{formatDuration(log.duration_ms)}</td>
                <td className="py-2.5 text-right text-ink">
                  {log.bytes_transferred ? formatBytes(log.bytes_transferred) : <span className="text-ink-faint">–</span>}
                </td>
                <td className="min-w-0 py-2.5 pl-6">
                  <Endpoint log={log} className="leading-5" />
                  {log.error_message && (
                    <span className="block truncate text-xs text-danger" title={log.error_message}>
                      {log.error_message}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <ul className="divide-y divide-line md:hidden">
          {page.logs.map((log) => (
            <li key={log.id} className="min-w-0 py-3 first:pt-0">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm font-medium text-ink" title={log.operation}>
                  {operationLabel(log.operation)}
                </span>
                <StatusBadge code={log.status_code} />
              </div>
              <Endpoint log={log} className="mt-1" />
              {log.error_message && (
                <span className="block truncate text-xs text-danger" title={log.error_message}>
                  {log.error_message}
                </span>
              )}
              <div className="tabular mt-1 flex flex-wrap gap-x-3 text-xs text-ink-muted">
                <When iso={log.timestamp} now={now} />
                <span>{formatDuration(log.duration_ms)}</span>
                {log.bytes_transferred ? <span>{formatBytes(log.bytes_transferred)}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <Section id="requests" title="Recent requests" action={sizeControl}>
      {body}
    </Section>
  );
}
