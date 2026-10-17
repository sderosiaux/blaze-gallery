"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { IconButton, MetaDot, PageHeader, Select } from "@/components/ui";
import type {
  AuditLogPage,
  AuditOperation,
  AuditSeries,
  AuditSummary,
} from "./types";
import { RANGES, formatMoment, rangeById, type RangeId } from "./format";
import { useAuditData } from "./useAuditData";
import { SummaryStats } from "./SummaryStats";
import { TrafficCharts } from "./TrafficCharts";
import { OperationsTable } from "./OperationsTable";
import { RecentRequests, type PageSize } from "./RecentRequests";
import { ThumbnailStorage } from "./ThumbnailStorage";

interface Period {
  start: string;
  end: string;
}

function periodFor(id: RangeId): Period {
  const end = Date.now();
  return {
    start: new Date(end - rangeById(id).ms).toISOString(),
    end: new Date(end).toISOString(),
  };
}

function periodQuery({ start, end }: Period) {
  return `start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}`;
}

function isRangeId(value: string | null): value is RangeId {
  return RANGES.some((r) => r.id === value);
}

export function StorageAudit() {
  const [rangeId, setRangeId] = useState<RangeId>("24h");
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [refreshes, setRefreshes] = useState(0);
  // Pinned when the range is picked or the page refreshed, so every section
  // describes the same slice of time. Set after mount: "now" differs on the server.
  const [period, setPeriod] = useState<Period | null>(null);
  // The range lives in the URL (?range=), like the stats tabs, so a view can be linked.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("range");
    const initial: RangeId = isRangeId(fromUrl) ? fromUrl : "24h";
    setRangeId(initial);
    setPeriod(periodFor(initial));
  }, []);

  const range = rangeById(rangeId);
  const q = period && periodQuery(period);

  const summary = useAuditData<AuditSummary>(q && `/api/audit/stats?${q}`);
  const series = useAuditData<AuditSeries>(
    q && `/api/audit/performance?${q}&bucket_seconds=${range.bucketSeconds}`,
  );
  const operations = useAuditData<{ operations: AuditOperation[] }>(
    q && `/api/audit/operations?${q}`,
  );
  const logs = useAuditData<AuditLogPage>(
    q && `/api/audit/logs?${q}&limit=${pageSize}`,
  );

  const anyLoading =
    summary.loading || series.loading || operations.loading || logs.loading;

  const changeRange = (id: RangeId) => {
    setRangeId(id);
    setPeriod(periodFor(id));
    const url = new URL(window.location.href);
    url.searchParams.set("range", id);
    window.history.replaceState(null, "", url);
  };

  // The log may not reach back to the start of the range: say so, and
  // average over what it covers.
  const firstLogged = summary.data?.first_request_at
    ? Date.parse(summary.data.first_request_at)
    : null;
  const periodStart = period ? Date.parse(period.start) : null;
  const periodEnd = period ? Date.parse(period.end) : null;
  const partial =
    firstLogged !== null &&
    periodStart !== null &&
    firstLogged - periodStart > range.ms * 0.05;
  const coveredMs =
    periodEnd !== null && periodStart !== null
      ? periodEnd - (partial ? firstLogged : periodStart)
      : range.ms;
  const refresh = () => {
    setPeriod(periodFor(rangeId));
    setRefreshes((n) => n + 1);
  };

  return (
    <>
      <PageHeader
        title="Audit stockage"
        meta={
          <>
            <span>{range.label}</span>
            {period && (
              <>
                <MetaDot />
                <span className="tabular">
                  {formatMoment(Date.parse(period.start))} –{" "}
                  {formatMoment(Date.parse(period.end))}
                </span>
              </>
            )}
            {partial && (
              <>
                <MetaDot />
                <span className="tabular">
                  Données depuis {formatMoment(firstLogged)}
                </span>
              </>
            )}
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            <label htmlFor="audit-range" className="sr-only">
              Période
            </label>
            <Select
              id="audit-range"
              value={rangeId}
              onChange={(e) => {
                changeRange(e.target.value as RangeId);
              }}
              className="w-auto min-w-[11rem]"
            >
              {RANGES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </Select>
            <IconButton
              icon={RefreshCw}
              label="Actualiser"
              variant="secondary"
              loading={anyLoading && period !== null}
              onClick={refresh}
            />
          </div>
        }
      />

      <SummaryStats
        summary={summary.data}
        loading={summary.loading}
        error={summary.error}
        onRetry={summary.retry}
        range={range}
        coveredMs={coveredMs}
      />

      <TrafficCharts
        series={series.data}
        loading={series.loading}
        error={series.error}
        onRetry={series.retry}
        range={range}
      />

      <OperationsTable
        operations={operations.data?.operations ?? null}
        loading={operations.loading}
        error={operations.error}
        onRetry={operations.retry}
      />

      <RecentRequests
        page={logs.data}
        loading={logs.loading}
        error={logs.error}
        onRetry={logs.retry}
        pageSize={pageSize}
        onPageSizeChange={setPageSize}
      />

      <ThumbnailStorage reloadKey={refreshes} />
    </>
  );
}
