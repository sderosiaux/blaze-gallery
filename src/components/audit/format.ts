import {
  CircleCheck,
  CircleX,
  Info,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { Tone } from "@/components/ui";
import { BYTE_UNITS, formatSize } from "@/components/stats/format";
import { LOCALE } from "@/lib/albums";

// Audit timestamps are real instants (not EXIF wall-clock), so they are shown
// in the reader's own time zone, unlike `formatDay` which reads UTC.

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

const DEFAULT_RANGE: TimeRange = {
  id: "24h",
  label: "Dernières 24 h",
  ms: DAY,
  bucketSeconds: 900,
  bucketLabel: "15 minutes",
};

export const RANGES: TimeRange[] = [
  {
    id: "1h",
    label: "Dernière heure",
    ms: HOUR,
    bucketSeconds: 60,
    bucketLabel: "minute",
  },
  {
    id: "6h",
    label: "Dernières 6 h",
    ms: 6 * HOUR,
    bucketSeconds: 300,
    bucketLabel: "5 minutes",
  },
  DEFAULT_RANGE,
  {
    id: "7d",
    label: "7 derniers jours",
    ms: 7 * DAY,
    bucketSeconds: 7200,
    bucketLabel: "2 heures",
  },
  {
    id: "30d",
    label: "30 derniers jours",
    ms: 30 * DAY,
    bucketSeconds: 43200,
    bucketLabel: "12 heures",
  },
];

export function rangeById(id: RangeId): TimeRange {
  return RANGES.find((r) => r.id === id) ?? DEFAULT_RANGE;
}

const integer = new Intl.NumberFormat(LOCALE);
const compact = new Intl.NumberFormat(LOCALE, {
  notation: "compact",
  maximumFractionDigits: 1,
});

export const formatCount = (n: number) => integer.format(n);
export const formatCompact = (n: number) => compact.format(n);
export const formatBytes = (n: number | undefined) => formatSize(n ?? 0);

/** Costs under a dollar keep four decimals: per-request prices are tiny. */
export function formatUsd(usd: number): string {
  const digits = usd < 1 ? 4 : 2;
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(usd);
}

const NBSP = "\u00A0";
const fixed = (digits: number) =>
  new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits });
const oneDecimal = fixed(1);

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "–";
  if (ms < 1) return `<${NBSP}1${NBSP}ms`;
  if (ms < 1000) return `${Math.round(ms)}${NBSP}ms`;
  if (ms < 10_000) return `${oneDecimal.format(ms / 1000)}${NBSP}s`;
  return `${Math.round(ms / 1000)}${NBSP}s`;
}

const percent = (digits: number) =>
  new Intl.NumberFormat(LOCALE, {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
const pct0 = percent(0);
const pct1 = percent(1);
const pct2 = percent(2);

export const formatWholePercent = (share: number) => pct0.format(share);

/** Share 0..1 as a percentage with just enough precision to be honest. */
export function formatShare(share: number): string {
  if (share === 0 || share === 1) return pct0.format(share);
  if (share < 0.0001) return `<${NBSP}${pct2.format(0.0001)}`;
  if (share > 0.9999) return `>${NBSP}${pct2.format(0.9999)}`;
  if (share < 0.1 || share > 0.99) return pct2.format(share);
  return pct1.format(share);
}

const timeFmt = new Intl.DateTimeFormat(LOCALE, {
  hour: "2-digit",
  minute: "2-digit",
});
const secondsFmt = new Intl.DateTimeFormat(LOCALE, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const dayFmt = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
});
const fullDayFmt = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export const formatTime = (t: number | Date) => timeFmt.format(t);
export const formatTimeWithSeconds = (t: number | Date) => secondsFmt.format(t);
export const formatDay = (t: number | Date) => dayFmt.format(t);
export const formatFullDay = (t: number | Date) => fullDayFmt.format(t);
export const formatMoment = (t: number | Date) =>
  `${dayFmt.format(t)} ${timeFmt.format(t)}`;

export function isSameLocalDay(a: number | Date, b: number | Date) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/** "17 oct. 01:30–01:45" for a chart bucket. */
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
  return times.filter((t, i) => {
    const previous = times[i - 1];
    return (
      previous !== undefined && tickKey(t, range) !== tickKey(previous, range)
    );
  });
}

export function formatTick(t: number, range: RangeId): string {
  if (range === "7d" || range === "30d") return formatDay(t);
  const d = new Date(t);
  return d.getHours() === 0 && d.getMinutes() === 0
    ? formatDay(t)
    : formatTime(t);
}

export interface StatusLook {
  tone: Tone;
  icon: LucideIcon;
  label: string;
}

const STATUS_WORDS: Record<number, string> = {
  200: "OK",
  201: "Créé",
  204: "Sans contenu",
  206: "Partiel",
  304: "Non modifié",
  400: "Requête invalide",
  401: "Non autorisé",
  403: "Interdit",
  404: "Introuvable",
  409: "Conflit",
  416: "Plage invalide",
  429: "Limité",
  500: "Erreur serveur",
  502: "Passerelle invalide",
  503: "Indisponible",
  504: "Délai dépassé",
};

export function statusLook(code: number): StatusLook {
  const word =
    STATUS_WORDS[code] ??
    (code >= 500 ? "Erreur serveur" : code >= 400 ? "Échec" : "");
  const label = word ? `${code} ${word}` : String(code);
  if (code >= 400) return { tone: "danger", icon: CircleX, label };
  if (code >= 300) return { tone: "info", icon: Info, label };
  return { tone: "success", icon: CircleCheck, label };
}

/** Error rate thresholds: a few failures are noise, above 1% is a pattern. */
export function errorRateLook(rate: number, total: number): StatusLook {
  if (total === 0)
    return { tone: "neutral", icon: Info, label: "Aucune requête" };
  if (rate > 0.05)
    return {
      tone: "danger",
      icon: CircleX,
      label: `Plus de ${pct0.format(0.05)}`,
    };
  if (rate > 0.01)
    return {
      tone: "warning",
      icon: TriangleAlert,
      label: `Plus de ${pct0.format(0.01)}`,
    };
  return {
    tone: "success",
    icon: CircleCheck,
    label: rate === 0 ? "Aucune erreur" : `Moins de ${pct0.format(0.01)}`,
  };
}

export function successLook(rate: number): StatusLook {
  const label = formatShare(rate);
  if (rate >= 0.99) return { tone: "success", icon: CircleCheck, label };
  if (rate >= 0.95) return { tone: "warning", icon: TriangleAlert, label };
  return { tone: "danger", icon: CircleX, label };
}

const OPERATION_LABELS: Record<string, string> = {
  GetObject: "Téléchargements",
  HeadObject: "Contrôles de métadonnées",
  GetObjectMetadata: "Lectures de métadonnées",
  ListObjects: "Listages",
  ListBuckets: "Listages de buckets",
  GetBucketLocation: "Localisations de bucket",
  GeneratePresignedUrl: "Liens signés",
  PutObject: "Envois",
  UploadFile: "Envois de fichiers",
  DownloadFile: "Téléchargements de fichiers",
  DeleteObject: "Suppressions",
  CreateMultipartUpload: "Débuts d’envoi en parties",
  UploadPart: "Parties envoyées",
  CompleteMultipartUpload: "Fins d’envoi en parties",
  AbortMultipartUpload: "Envois en parties annulés",
};

export const operationLabel = (operation: string) =>
  OPERATION_LABELS[operation] ?? operation;

/**
 * Round axis ticks from 0 to just above `max`, about `steps` intervals of
 * 1, 2, 2.5 or 5 x 10^n. Bytes step within their own 1024 unit so the labels
 * read "500 Mo", not "476,8 Mo".
 */
export function niceTicks(
  max: number,
  { binary = false, integer = false, steps = 3 } = {},
): number[] {
  const top = max > 0 ? max : 1;
  const unit = binary
    ? Math.pow(1024, Math.max(0, Math.floor(Math.log(top) / Math.log(1024))))
    : 1;
  const raw = top / unit / steps;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / magnitude;
  const factor =
    norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  let step = factor * magnitude * unit;
  if (integer) step = Math.max(1, Math.ceil(step));
  const count = Math.max(1, Math.ceil(top / step - 1e-9));
  return Array.from({ length: count + 1 }, (_, i) => i * step);
}

/** Byte axis labels all in the unit of the top tick: "0,5 Go, 1 Go", not "512 Mo, 1 Go". */
export function byteAxisFormatter(ticks: number[]): (n: number) => string {
  const last = ticks[ticks.length - 1];
  const top = last !== undefined && last !== 0 ? last : 1;
  const i = Math.min(
    BYTE_UNITS.length - 1,
    Math.max(0, Math.floor(Math.log(top) / Math.log(1024))),
  );
  const number = fixed(2);
  return (n) =>
    `${number.format(n / Math.pow(1024, i))}${NBSP}${BYTE_UNITS[i]}`;
}
