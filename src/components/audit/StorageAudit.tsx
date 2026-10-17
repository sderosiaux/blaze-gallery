"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { IconButton, MetaDot, PageHeader, Select } from "@/components/ui";
import type { AuditLogPage, AuditOperation, AuditSeries, AuditSummary } from "./types";
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
  return { start: new Date(end - rangeById(id).ms).toISOString(), end: new Date(end).toISOString() };
}

function periodQuery({ start, end }: Period) {
  return `start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}`;
}

export function StorageAudit() {
  const [rangeId, setRangeId] = useState<RangeId>("24h");
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [refreshes, setRefreshes] = useState(0);
  // Pinned when the range is picked or the page refreshed, so every section
  // describes the same slice of time. Set after mount: "now" differs on the server.
  const [period, setPeriod] = useState<Period | null>(null);
  useEffect(() => setPeriod(periodFor("24h")), []);

  const range = rangeById(rangeId);
  const q = period && periodQuery(period);

  const summary = useAuditData<AuditSummary>(q && `/api/audit/stats?${q}`);
  const series = useAuditData<AuditSeries>(q && `/api/audit/performance?${q}&bucket_seconds=${range.bucketSeconds}`);
  const operations = useAuditData<{ operations: AuditOperation[] }>(q && `/api/audit/operations?${q}`);
  const logs = useAuditData<AuditLogPage>(q && `/api/audit/logs?${q}&limit=${pageSize}`);

  const anyLoading = summary.loading || series.loading || operations.loading || logs.loading;

  const changeRange = (id: RangeId) => {
    setRangeId(id);
    setPeriod(periodFor(id));
  };
  const refresh = () => {
    setPeriod(periodFor(rangeId));
    setRefreshes((n) => n + 1);
  };

  return (
    <>
      <PageHeader
        kicker="Admin"
        title="Storage audit"
        meta={
          <>
            <span>{range.label}</span>
            {period && (
              <>
                <MetaDot />
                <span className="tabular">
                  {formatMoment(Date.parse(period.start))} to {formatMoment(Date.parse(period.end))}
                </span>
              </>
            )}
          </>
        }
        actions={
          <>
            <label htmlFor="audit-range" className="sr-only">
              Time range
            </label>
            <Select
              id="audit-range"
              value={rangeId}
              onChange={(e) => changeRange(e.target.value as RangeId)}
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
              label="Refresh"
              variant="secondary"
              loading={anyLoading && period !== null}
              onClick={refresh}
            />
          </>
        }
      />

      <SummaryStats summary={summary.data} loading={summary.loading} error={summary.error} onRetry={summary.retry} range={range} />

      <TrafficCharts series={series.data} loading={series.loading} error={series.error} onRetry={series.retry} range={range} />

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
