import { CircleCheck, CircleX, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import type { Tone } from "@/components/ui";

// Audit timestamps are real instants (not EXIF wall-clock), so they are shown
// in the reader's own time zone.
const LOCALE = "en-GB";

export type RangeId = "1h" | "6h" | "24h" | "7d" | "30d";

export interface TimeRange {
  id: RangeId;
  label: string;
  ms: number;
  /** Chart bucket width; keeps every range between 60 and 100 buckets. */
  bucketSeconds: number;
  bucketLabel: string;
}

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

export const RANGES: TimeRange[] = [
  { id: "1h", label: "Last hour", ms: HOUR, bucketSeconds: 60, bucketLabel: "minute" },
  { id: "6h", label: "Last 6 hours", ms: 6 * HOUR, bucketSeconds: 300, bucketLabel: "5 minutes" },
  { id: "24h", label: "Last 24 hours", ms: DAY, bucketSeconds: 900, bucketLabel: "15 minutes" },
  { id: "7d", label: "Last 7 days", ms: 7 * DAY, bucketSeconds: 7200, bucketLabel: "2 hours" },
  { id: "30d", label: "Last 30 days", ms: 30 * DAY, bucketSeconds: 43200, bucketLabel: "12 hours" },
];

export function rangeById(id: RangeId): TimeRange {
  return RANGES.find((r) => r.id === id) ?? RANGES[2];
}

const integer = new Intl.NumberFormat(LOCALE);
const compact = new Intl.NumberFormat(LOCALE, { notation: "compact", maximumFractionDigits: 1 });

export const formatCount = (n: number) => integer.format(n);
export const formatCompact = (n: number) => compact.format(n);

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "–";
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${parseFloat((ms / 1000).toFixed(1))} s`;
  return `${Math.round(ms / 1000)} s`;
}

/** Share 0..1 as a percentage with just enough precision to be honest. */
export function formatShare(share: number): string {
  const pct = share * 100;
  if (pct === 0 || pct === 100) return `${pct}%`;
  if (pct < 0.01) return "<0.01%";
  if (pct > 99.99) return ">99.99%";
  if (pct < 10 || pct > 99) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(1)}%`;
}

const timeFmt = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit" });
const secondsFmt = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const dayFmt = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short" });
const fullDayFmt = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric" });

export const formatTime = (t: number | Date) => timeFmt.format(t);
export const formatTimeWithSeconds = (t: number | Date) => secondsFmt.format(t);
export const formatDay = (t: number | Date) => dayFmt.format(t);
export const formatFullDay = (t: number | Date) => fullDayFmt.format(t);
export const formatMoment = (t: number | Date) => `${dayFmt.format(t)}, ${timeFmt.format(t)}`;

export function isSameLocalDay(a: number | Date, b: number | Date) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/** "17 Oct, 01:30–01:45" for a chart bucket. */
export function formatBucket(start: number, bucketSeconds: number): string {
  const end = start + bucketSeconds * 1000;
  return isSameLocalDay(start, end - 1)
    ? `${formatMoment(start)}–${formatTime(end)}`
    : `${formatMoment(start)} – ${formatMoment(end)}`;
}

/** Axis ticks fall on the first bucket of each local hour, day or week. */
function tickKey(t: number, range: RangeId): string {
  const d = new Date(t);
  switch (range) {
    case "1h":
      return `${d.getHours()}:${Math.floor(d.getMinutes() / 10)}`;
    case "6h":
      return `${d.toDateString()} ${d.getHours()}`;
    case "24h":
      return `${d.toDateString()} ${Math.floor(d.getHours() / 4)}`;
    case "7d":
      return d.toDateString();
    case "30d": {
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return monday.toDateString();
    }
  }
}

export function axisTicks(times: number[], range: RangeId): number[] {
  return times.filter((t, i) => i > 0 && tickKey(t, range) !== tickKey(times[i - 1], range));
}

export function formatTick(t: number, range: RangeId): string {
  if (range === "7d" || range === "30d") return formatDay(t);
  const d = new Date(t);
  return d.getHours() === 0 && d.getMinutes() === 0 ? formatDay(t) : formatTime(t);
}

export interface StatusLook {
  tone: Tone;
  icon: LucideIcon;
  label: string;
}

const STATUS_WORDS: Record<number, string> = {
  200: "OK",
  201: "Created",
  204: "No content",
  206: "Partial",
  304: "Not modified",
  400: "Bad request",
  401: "Unauthorised",
  403: "Forbidden",
  404: "Not found",
  409: "Conflict",
  416: "Bad range",
  429: "Throttled",
  500: "Server error",
  502: "Bad gateway",
  503: "Unavailable",
  504: "Timed out",
};

export function statusLook(code: number): StatusLook {
  const word = STATUS_WORDS[code] ?? (code >= 500 ? "Server error" : code >= 400 ? "Failed" : "");
  const label = word ? `${code} ${word}` : String(code);
  if (code >= 400) return { tone: "danger", icon: CircleX, label };
  if (code >= 300) return { tone: "info", icon: Info, label };
  return { tone: "success", icon: CircleCheck, label };
}

/** Error rate thresholds: a few failures are noise, above 1% is a pattern. */
export function errorRateLook(rate: number, total: number): StatusLook {
  if (total === 0) return { tone: "neutral", icon: Info, label: "No requests" };
  if (rate > 0.05) return { tone: "danger", icon: CircleX, label: "Above 5%" };
  if (rate > 0.01) return { tone: "warning", icon: TriangleAlert, label: "Above 1%" };
  return { tone: "success", icon: CircleCheck, label: rate === 0 ? "No errors" : "Under 1%" };
}

export function successLook(rate: number): StatusLook {
  const label = formatShare(rate);
  if (rate >= 0.99) return { tone: "success", icon: CircleCheck, label };
  if (rate >= 0.95) return { tone: "warning", icon: TriangleAlert, label };
  return { tone: "danger", icon: CircleX, label };
}

const OPERATION_LABELS: Record<string, string> = {
  GetObject: "Downloads",
  HeadObject: "Metadata checks",
  GetObjectMetadata: "Metadata reads",
  ListObjects: "Listings",
  ListBuckets: "Bucket listings",
  GetBucketLocation: "Bucket lookups",
  GeneratePresignedUrl: "Signed links",
  PutObject: "Uploads",
  UploadFile: "File uploads",
  DownloadFile: "File downloads",
  DeleteObject: "Deletions",
  CreateMultipartUpload: "Multipart starts",
  UploadPart: "Multipart parts",
  CompleteMultipartUpload: "Multipart finishes",
  AbortMultipartUpload: "Multipart aborts",
};

export const operationLabel = (operation: string) => OPERATION_LABELS[operation] ?? operation;

/**
 * Round axis ticks from 0 to just above `max`, about `steps` intervals of
 * 1, 2, 2.5 or 5 x 10^n. Bytes step within their own 1024 unit so the labels
 * read "500 MB", not "476.8 MB".
 */
export function niceTicks(max: number, { binary = false, integer = false, steps = 3 } = {}): number[] {
  const top = max > 0 ? max : 1;
  const unit = binary ? Math.pow(1024, Math.max(0, Math.floor(Math.log(top) / Math.log(1024)))) : 1;
  const raw = top / unit / steps;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / magnitude;
  const factor = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  let step = factor * magnitude * unit;
  if (integer) step = Math.max(1, Math.ceil(step));
  const count = Math.max(1, Math.ceil(top / step - 1e-9));
  return Array.from({ length: count + 1 }, (_, i) => i * step);
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];

/** Byte axis labels all in the unit of the top tick: "0.5 GB, 1 GB", not "512 MB, 1 GB". */
export function byteAxisFormatter(ticks: number[]): (n: number) => string {
  const top = ticks[ticks.length - 1] || 1;
  const i = Math.min(BYTE_UNITS.length - 1, Math.max(0, Math.floor(Math.log(top) / Math.log(1024))));
  return (n) => `${parseFloat((n / Math.pow(1024, i)).toFixed(2))} ${BYTE_UNITS[i]}`;
}
