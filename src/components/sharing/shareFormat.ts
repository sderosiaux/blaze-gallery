import { LOCALE } from "@/lib/albums";
import type { ShareLink } from "@/lib/shareClient";

// Share timestamps are real instants (created, opened, expires), unlike EXIF
// wall-clock dates, so they are shown in the viewer's own time zone: albums.ts
// formats in UTC, which would move an evening expiry to the next day.

export function formatInstant(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86400],
  ["month", 30 * 86400],
  ["week", 7 * 86400],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

/** "il y a 3 jours", "hier", "à l'instant". */
export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 60) return "à l'instant";
  const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
  const [unit, size] =
    UNITS.find(([, s]) => abs >= s) ?? UNITS[UNITS.length - 1];
  return rtf.format(Math.round(seconds / size), unit);
}

export function lastOpenedLabel(
  share: Pick<ShareLink, "last_accessed">,
): string {
  return share.last_accessed
    ? `Ouvert ${relativeTime(share.last_accessed)}`
    : "Jamais ouvert";
}
