"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity } from "lucide-react";
import { EmptyState, Section, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { AuditBucket, AuditSeries } from "./types";
import {
  axisTicks,
  byteAxisFormatter,
  formatBucket,
  formatBytes,
  formatCompact,
  formatCount,
  formatDuration,
  formatTick,
  niceTicks,
  type TimeRange,
} from "./format";
import { SectionError } from "./SectionError";

// Recharts paints SVG attributes, which cannot take Tailwind classes, so the
// colours are read from the same CSS variables the classes use.
const TOKENS = [
  "chart-1",
  "chart-5",
  "danger",
  "line",
  "line-strong",
  "ink",
  "ink-muted",
  "paper",
] as const;
type Token = (typeof TOKENS)[number];
type Paint = (token: Token, alpha?: number) => string;

function useTokenPaint(): Paint | null {
  const [channels, setChannels] = useState<Record<Token, string> | null>(null);
  useEffect(() => {
    const style = getComputedStyle(document.documentElement);
    setChannels(
      Object.fromEntries(
        TOKENS.map((t) => [t, style.getPropertyValue(`--${t}`).trim()]),
      ) as Record<Token, string>,
    );
  }, []);
  return useMemo(
    () =>
      channels
        ? (token: Token, alpha = 1) => `rgb(${channels[token]} / ${alpha})`
        : null,
    [channels],
  );
}

type MetricKey =
  | "request_count"
  | "error_count"
  | "bytes_transferred"
  | "avg_duration_ms"
  | "p95_duration_ms";

interface SeriesSpec {
  key: MetricKey;
  label: string;
  token: Token;
  /** Literal class so Tailwind generates it; mirrors `token`. */
  swatch: string;
}

type Row = AuditBucket & { t: number };

interface ChartProps {
  title: string;
  headline: React.ReactNode;
  rows: Row[];
  ticks: number[];
  range: TimeRange;
  bucketSeconds: number;
  kind: "bar" | "line";
  series: SeriesSpec[];
  formatAxis: (n: number) => string;
  formatValue: (n: number) => string;
  /** How the y-axis rounds: bytes step in 1024 units, counts in integers. */
  scale: "count" | "duration" | "bytes";
  /** Shown over an all-zero plot, so an empty chart still says why. */
  emptyNote?: string;
  paint: Paint;
}

const PLOT_HEIGHT = 208; // plot + x-axis band, so tick labels are never cut off

function ChartTooltip({
  active,
  payload,
  label,
  series,
  formatValue,
  bucketSeconds,
}: {
  active?: boolean;
  payload?: readonly { payload?: Row }[];
  label?: number | string;
  series: SeriesSpec[];
  formatValue: (n: number) => string;
  bucketSeconds: number;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="min-w-[10rem] rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-pop">
      <div className="mb-1.5 text-ink-muted">
        {formatBucket(Number(label ?? row.t), bucketSeconds)}
      </div>
      <ul className="space-y-1">
        {series.map((s) => {
          const value = row[s.key];
          return (
            <li key={s.key} className="flex items-center gap-2">
              <span
                aria-hidden
                className={cn("h-0.5 w-3 shrink-0 rounded-full", s.swatch)}
              />
              <span className="tabular font-semibold text-ink">
                {value == null ? "Aucune requête" : formatValue(value)}
              </span>
              <span className="text-ink-muted">{s.label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TimeChart({
  title,
  headline,
  rows,
  ticks,
  range,
  bucketSeconds,
  kind,
  series,
  formatAxis,
  formatValue,
  scale,
  emptyNote,
  paint,
}: ChartProps) {
  const isEmpty = rows.every((r) => series.every((s) => !r[s.key]));
  const max = Math.max(
    0,
    ...rows.flatMap((r) => series.map((s) => r[s.key] ?? 0)),
  );
  const yTicks = niceTicks(max, {
    binary: scale === "bytes",
    integer: scale === "count",
  });
  const axisFormat = scale === "bytes" ? byteAxisFormatter(yTicks) : formatAxis;
  // Non-breaking spaces: Recharts wraps tick text at spaces when it runs out of room.
  const yLabel = (n: number) =>
    n === 0 ? "0" : axisFormat(n).replace(/ /g, "\u00A0");
  const firstKey = series[0]?.key;
  const pointCount = rows.filter(
    (r) => firstKey !== undefined && r[firstKey] != null,
  ).length;
  const axisTick = { fill: paint("ink-muted"), fontSize: 11 };

  return (
    <figure className="min-w-0">
      <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-sm font-medium text-ink">{title}</span>
          {/* Legend sits in the caption so paired charts keep their plots level. */}
          {series.length > 1 && (
            <span className="flex flex-wrap gap-x-3 text-xs text-ink-muted">
              {series.map((s) => (
                <span key={s.key} className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className={cn("h-0.5 w-4 rounded-full", s.swatch)}
                  />
                  {s.label}
                </span>
              ))}
            </span>
          )}
        </span>
        <span className="tabular text-sm text-ink-muted">{headline}</span>
      </figcaption>
      {/* Clip x: on the first hover frame Recharts places the tooltip before it
          has measured it, which can poke past the page edge for a frame. The
          focusable plot keeps the browser's blue ring after a mouse click;
          keyboard focus still gets the ink ring. */}
      <div
        className="tabular relative overflow-x-clip [&_.recharts-surface:focus:not(:focus-visible)]:outline-none"
        style={{ height: PLOT_HEIGHT }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={rows}
            margin={{ top: 6, right: 6, bottom: 0, left: 0 }}
            barCategoryGap={1}
          >
            <CartesianGrid vertical={false} stroke={paint("line")} />
            <XAxis
              dataKey="t"
              ticks={ticks}
              interval="preserveStartEnd"
              minTickGap={20}
              tickFormatter={(t: number) => formatTick(t, range.id)}
              tick={axisTick}
              tickLine={false}
              tickMargin={8}
              axisLine={{ stroke: paint("line-strong") }}
            />
            <YAxis
              width="auto"
              ticks={yTicks}
              domain={[0, yTicks[yTicks.length - 1] ?? "auto"]}
              interval={0}
              tickFormatter={yLabel}
              tick={axisTick}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              isAnimationActive={false}
              cursor={
                kind === "bar"
                  ? { fill: paint("ink", 0.05) }
                  : { stroke: paint("line-strong"), strokeWidth: 1 }
              }
              content={(props) => (
                <ChartTooltip
                  active={props.active}
                  payload={
                    props.payload as readonly { payload?: Row }[] | undefined
                  }
                  label={props.label}
                  series={series}
                  formatValue={formatValue}
                  bucketSeconds={bucketSeconds}
                />
              )}
            />
            {series.map((s) =>
              kind === "bar" ? (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  fill={paint(s.token)}
                  radius={[2, 2, 0, 0]}
                  maxBarSize={24}
                  isAnimationActive={false}
                />
              ) : (
                <Line
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  type="monotone"
                  stroke={paint(s.token)}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  connectNulls
                  dot={
                    pointCount <= 24
                      ? {
                          r: 3,
                          fill: paint(s.token),
                          stroke: paint("paper"),
                          strokeWidth: 2,
                        }
                      : false
                  }
                  activeDot={{
                    r: 4,
                    fill: paint(s.token),
                    stroke: paint("paper"),
                    strokeWidth: 2,
                  }}
                  isAnimationActive={false}
                />
              ),
            )}
          </ComposedChart>
        </ResponsiveContainer>
        {isEmpty && emptyNote && (
          <p className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-sm text-ink-muted">
            {emptyNote}
          </p>
        )}
      </div>
    </figure>
  );
}

function ChartsSkeleton() {
  return (
    <div
      role="status"
      aria-label="Chargement des graphiques"
      className="grid gap-x-12 gap-y-10 lg:grid-cols-2"
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i}>
          <div className="mb-3 flex justify-between">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-20" />
          </div>
          <Skeleton className="h-[208px] w-full" />
        </div>
      ))}
    </div>
  );
}

interface TrafficChartsProps {
  series: AuditSeries | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  range: TimeRange;
}

export function TrafficCharts({
  series,
  loading,
  error,
  onRetry,
  range,
}: TrafficChartsProps) {
  const paint = useTokenPaint();

  const rows = useMemo<Row[]>(
    () =>
      (series?.metrics ?? []).map((m) => ({
        ...m,
        t: Date.parse(m.time_period),
      })),
    [series],
  );
  const ticks = useMemo(
    () =>
      axisTicks(
        rows.map((r) => r.t),
        range.id,
      ),
    [rows, range.id],
  );

  const totals = useMemo(() => {
    const sum = (key: "request_count" | "error_count" | "bytes_transferred") =>
      rows.reduce((acc, r) => acc + r[key], 0);
    const busiest = rows.reduce<Row | null>(
      (best, r) => (!best || r.request_count > best.request_count ? r : best),
      null,
    );
    const slowest = rows.reduce<Row | null>(
      (worst, r) =>
        r.p95_duration_ms != null &&
        (!worst || r.p95_duration_ms > (worst.p95_duration_ms ?? 0))
          ? r
          : worst,
      null,
    );
    return {
      requests: sum("request_count"),
      errors: sum("error_count"),
      bytes: sum("bytes_transferred"),
      busiest,
      slowest,
    };
  }, [rows]);

  const bucketSeconds = series?.bucket_seconds ?? range.bucketSeconds;
  const bucketLabel =
    bucketSeconds === range.bucketSeconds
      ? range.bucketLabel
      : `${formatCount(Math.round(bucketSeconds / 60))} minutes`;

  let body: React.ReactNode;
  if (error) {
    body = (
      <SectionError
        title="Les graphiques de trafic n’ont pas chargé"
        error={error}
        onRetry={onRetry}
      />
    );
  } else if (!series || !paint) {
    body = <ChartsSkeleton />;
  } else if (totals.requests === 0) {
    body = (
      <EmptyState
        icon={Activity}
        title="Aucune requête de stockage sur cette période"
        body="Choisir une période plus longue."
        className="py-10"
      />
    );
  } else {
    const common = { rows, ticks, range, bucketSeconds, paint };
    body = (
      <div
        aria-busy={loading || undefined}
        className={cn(
          "grid gap-x-12 gap-y-10 transition-opacity duration-200 lg:grid-cols-2",
          loading && "opacity-60",
        )}
      >
        <TimeChart
          {...common}
          title="Requêtes"
          headline={
            totals.busiest
              ? `${formatCount(totals.requests)} au total · pic de ${formatCount(totals.busiest.request_count)} par ${bucketLabel}`
              : formatCount(totals.requests)
          }
          kind="bar"
          series={[
            {
              key: "request_count",
              label: "requêtes",
              token: "chart-5",
              swatch: "bg-chart-5",
            },
          ]}
          formatAxis={formatCompact}
          formatValue={formatCount}
          scale="count"
        />
        <TimeChart
          {...common}
          title="Latence"
          headline={
            totals.slowest
              ? `pire p95 ${formatDuration(totals.slowest.p95_duration_ms)}`
              : "–"
          }
          kind="line"
          series={[
            {
              key: "avg_duration_ms",
              label: "Moyenne",
              token: "chart-5",
              swatch: "bg-chart-5",
            },
            {
              key: "p95_duration_ms",
              label: "p95",
              token: "chart-1",
              swatch: "bg-chart-1",
            },
          ]}
          formatAxis={(n) => formatDuration(n)}
          formatValue={(n) => formatDuration(n)}
          scale="duration"
        />
        <TimeChart
          {...common}
          title="Données transférées"
          headline={`${formatBytes(totals.bytes)} au total`}
          kind="bar"
          series={[
            {
              key: "bytes_transferred",
              label: "transférés",
              token: "chart-5",
              swatch: "bg-chart-5",
            },
          ]}
          formatAxis={formatBytes}
          formatValue={formatBytes}
          scale="bytes"
        />
        <TimeChart
          {...common}
          title="Requêtes en échec"
          headline={`${formatCount(totals.errors)} en échec`}
          kind="bar"
          series={[
            {
              key: "error_count",
              label: "en échec",
              token: "danger",
              swatch: "bg-danger",
            },
          ]}
          formatAxis={formatCompact}
          formatValue={formatCount}
          scale="count"
          emptyNote="Aucun échec sur cette période"
        />
      </div>
    );
  }

  return (
    <Section
      id="traffic"
      title="Trafic"
      description={`Par ${bucketLabel}, heure locale`}
    >
      {body}
    </Section>
  );
}
