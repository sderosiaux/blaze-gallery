import {
  LOCALE,
  albumDateLabel,
  formatDay,
  formatNumber,
  parseAlbumName,
} from "@/lib/albums";

export { formatNumber };

// French byte units (octets). The number and its unit never split across lines.
export const BYTE_UNITS = ["o", "Ko", "Mo", "Go", "To", "Po"];
const NBSP = "\u00A0";

const decimals = [0, 1, 2].map(
  (digits) =>
    new Intl.NumberFormat(LOCALE, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }),
);

/** Three significant digits ("1,04 To", "954 Go", "26,2 Go"), so a 1.04 TB
 *  library never rounds down to "1 To". */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return `0${NBSP}o`;
  const i = Math.min(
    BYTE_UNITS.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const v = bytes / 1024 ** i;
  const digits = i === 0 ? 0 : v < 10 ? 2 : v < 100 ? 1 : 0;
  return `${decimals[digits].format(v)}${NBSP}${BYTE_UNITS[i]}`;
}

const percent = new Intl.NumberFormat(LOCALE, {
  style: "percent",
  maximumFractionDigits: 0,
});

/** Whole percent, with "< 1 %" so a small non-zero share never reads as nothing. */
export function formatPercent(part: number, whole: number): string {
  if (whole <= 0) return "–";
  const p = part / whole;
  if (p > 0 && p < 0.01) return `<${NBSP}${percent.format(0.01)}`;
  if (p < 1 && p > 0.99) return `>${NBSP}${percent.format(0.99)}`;
  return percent.format(p);
}

/** Elapsed time with one decimal: "4,2 s". */
export function formatSeconds(ms: number): string {
  return `${decimals[1].format(ms / 1000)}${NBSP}s`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const relative = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });

/** "à l’instant", "il y a 3 heures", "il y a 10 mois". */
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  const steps: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [30, "day"],
    [12, "month"],
    [Infinity, "year"],
  ];
  let value = s;
  for (const [size, unit] of steps) {
    if (value < size) {
      if (unit === "second") return "à l’instant";
      return relative.format(-Math.floor(value), unit);
    }
    value /= size;
  }
  return "";
}

/** Extension as shown to people: "jpg" → "JPG", missing → "Sans extension". */
export function formatExtension(ext: string): string {
  return ext === "none" ? "Sans extension" : ext.toUpperCase();
}

/** The kicker over a folder name: its own date when the name carries one (as
 *  on folder cards), otherwise where it sits ("Quebec · 2019"), because
 *  generic names like "Reflex" or "105D7200" only make sense next to their
 *  parent. Names keep their bucket spelling; only a leading date moves out. */
export function folderKicker(path: string, name: string): string | undefined {
  // Admin rows carry no EXIF range, so only a date in the name counts.
  const ownDate = albumDateLabel({ name, date_from: null, date_to: null });
  if (ownDate) return ownDate;
  const parent = path.split("/").slice(0, -1).pop();
  if (!parent) return undefined;
  const p = parseAlbumName(parent);
  const year = p.date ? formatDay(p.date, "year") : undefined;
  return [p.title, year].filter(Boolean).join(" · ");
}
