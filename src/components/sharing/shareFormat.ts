import type { ShareLink } from "@/lib/shareClient";

// Share timestamps are real instants (created, opened, expires), unlike EXIF
// wall-clock dates, so they are shown in the viewer's own time zone.

const LOCALE = "en-GB";

export function formatInstant(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 86400],
  ["month", 30 * 86400],
  ["week", 7 * 86400],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 60) return "just now";
  const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
  const [unit, size] =
    UNITS.find(([, s]) => abs >= s) ?? UNITS[UNITS.length - 1];
  return rtf.format(Math.round(seconds / size), unit);
}

/** "Today", "Yesterday", "9 Dec", "Dec 2025": short enough for a big number slot. */
export function shortDay(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const dayStart = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((dayStart(now) - dayStart(d)) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.getFullYear() === now.getFullYear()
    ? d.toLocaleDateString(LOCALE, { day: "numeric", month: "short" })
    : d.toLocaleDateString(LOCALE, { month: "short", year: "numeric" });
}

export function expiryLabel(
  share: Pick<ShareLink, "expires_at">,
  now = Date.now(),
): string {
  if (!share.expires_at) return "Never expires";
  const when = formatInstant(share.expires_at);
  return new Date(share.expires_at).getTime() <= now
    ? `Expired ${when}`
    : `Expires ${when}`;
}

export function lastOpenedLabel(
  share: Pick<ShareLink, "last_accessed">,
): string {
  return share.last_accessed
    ? `Last opened ${relativeTime(share.last_accessed)}`
    : "Not opened yet";
}
