import { formatDay, parseAlbumName } from "@/lib/albums";

const LOCALE = "en-GB";
const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

/** Three significant digits ("1.04 TB", "954 GB", "26.2 GB"): `formatBytes`
 *  keeps one decimal, which rounds a 1.04 TB library down to "1 TB". */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / 1024 ** i;
  const digits = i === 0 ? 0 : v < 10 ? 2 : v < 100 ? 1 : 0;
  return `${v.toFixed(digits)} ${UNITS[i]}`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString(LOCALE);
}

/** Whole percent, with "<1%" so a small non-zero share never reads as nothing. */
export function formatPercent(part: number, whole: number): string {
  if (whole <= 0) return "–";
  const p = (part / whole) * 100;
  if (p > 0 && p < 1) return "<1%";
  if (p < 100 && p > 99) return ">99%";
  return `${Math.round(p)}%`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
}

/** "just now", "3 hours ago", "10 months ago". */
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  const steps: Array<[number, string]> = [
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
      const n = Math.floor(value);
      if (unit === "second") return "just now";
      return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
    }
    value /= size;
  }
  return "";
}

/** Extension as shown to people: "jpg" → "JPG", missing → "No extension". */
export function formatExtension(ext: string): string {
  return ext === "none" ? "No extension" : ext.toUpperCase();
}

/** Where the album sits ("Quebec · 2019"): generic names like "Reflex" or
 *  "105D7200" only make sense next to their parent album. */
export function albumKicker(path: string, albumDate?: string): string | undefined {
  const parent = path.split("/").slice(0, -1).pop();
  if (!parent) return albumDate;
  const p = parseAlbumName(parent);
  const date = albumDate ?? (p.date ? new Date(p.date).getUTCFullYear().toString() : undefined);
  return [p.title, date].filter(Boolean).join(" · ");
}

/** The date carried by an album's own name, formatted at its precision. */
export function ownDate(name: string): string | undefined {
  const { date, precision } = parseAlbumName(name);
  return date && precision ? formatDay(date, precision) : undefined;
}
