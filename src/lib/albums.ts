import type { Folder, Photo } from "@/types";

// Folder names in the bucket carry their date in many shapes
// ("2018-01-15 toulouse", "07-12-2008-disneyland", "20100416_Anni Dadou").
// Pulling it out lets the date read as a kicker and the place or event as the title.

export interface AlbumName {
  title: string;
  /** ISO date (UTC midnight) when the name started with a recognisable date */
  date?: string;
  /** "day" | "month" | "year" precision of `date` */
  precision?: "day" | "month" | "year";
}

const SEP = String.raw`[\s_\-.@]*`;
const PATTERNS: Array<{ re: RegExp; pick: (m: RegExpMatchArray) => [number, number?, number?] }> = [
  // A "00" day means the month is known but not the day.
  { re: new RegExp(String.raw`^(\d{4})-(\d{2})-(\d{2})(?=\b|_|\s|$)${SEP}(.*)$`), pick: (m) => [+m[1], +m[2], +m[3] || undefined] },
  { re: new RegExp(String.raw`^(\d{2})-(\d{2})-(\d{4})(?=\b|_|\s|$)${SEP}(.*)$`), pick: (m) => [+m[3], +m[2], +m[1]] },
  { re: new RegExp(String.raw`^(\d{4})(\d{2})(\d{2})(?=_|\s|-|$)${SEP}(.*)$`), pick: (m) => [+m[1], +m[2], +m[3]] },
  { re: new RegExp(String.raw`^(\d{4})-(\d{2})(?=\b|_|\s|$)${SEP}(.*)$`), pick: (m) => [+m[1], +m[2]] },
];

function validDate(y: number, mo?: number, d?: number) {
  if (y < 1900 || y > 2100) return false;
  if (mo !== undefined && (mo < 1 || mo > 12)) return false;
  if (d !== undefined && (d < 1 || d > 31)) return false;
  return true;
}

function tidy(title: string) {
  let t = title.replace(/_/g, " ").replace(/\s{2,}/g, " ").replace(/^[\s\-–—@.:]+/, "").trim();
  // Slug-style names ("journée-plopsaland") read as words.
  if (!/\s/.test(t) && /\p{L}-\p{L}/u.test(t)) t = t.replace(/-/g, " ");
  return t ? t.charAt(0).toLocaleUpperCase("fr-FR") + t.slice(1) : t;
}

export function parseAlbumName(name: string): AlbumName {
  for (const { re, pick } of PATTERNS) {
    const m = name.match(re);
    if (!m) continue;
    const [y, mo, d] = pick(m);
    if (!validDate(y, mo, d)) continue;
    const rest = m[m.length - 1] ?? "";
    const iso = new Date(Date.UTC(y, (mo ?? 1) - 1, d ?? 1)).toISOString();
    const precision = d !== undefined ? "day" : mo !== undefined ? "month" : "year";
    const title = tidy(rest);
    return { title: title || formatDay(iso, precision), date: iso, precision };
  }
  return { title: tidy(name) || name };
}

const LOCALE = "en-GB";

export function formatDay(iso: string, precision: "day" | "month" | "year" = "day"): string {
  const opts: Intl.DateTimeFormatOptions =
    precision === "day"
      ? { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }
      : precision === "month"
        ? { month: "long", year: "numeric", timeZone: "UTC" }
        : { year: "numeric", timeZone: "UTC" };
  return new Date(iso).toLocaleDateString(LOCALE, opts);
}

/** "7 December 2008", "December 2008", "Jan – Mar 2018", "2016 – 2019". */
export function formatDateRange(from?: string | null, to?: string | null): string | undefined {
  if (!from && !to) return undefined;
  const a = new Date(from ?? to!);
  const b = new Date(to ?? from!);
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const sameMonth = sameYear && a.getUTCMonth() === b.getUTCMonth();
  const sameDay = sameMonth && a.getUTCDate() === b.getUTCDate();
  if (sameDay) return formatDay(a.toISOString(), "day");
  if (sameMonth) {
    const days = b.getUTCDate() - a.getUTCDate();
    return days <= 6
      ? `${a.getUTCDate()}–${formatDay(b.toISOString(), "day")}`
      : formatDay(a.toISOString(), "month");
  }
  if (sameYear) {
    const m = (d: Date) => d.toLocaleDateString(LOCALE, { month: "short", timeZone: "UTC" });
    return `${m(a)} – ${m(b)} ${b.getUTCFullYear()}`;
  }
  return `${a.getUTCFullYear()} – ${b.getUTCFullYear()}`;
}

/** The date line shown under an album: the folder name wins, then EXIF dates. */
export function albumDateLabel(folder: Pick<Folder, "name" | "date_from" | "date_to">): string | undefined {
  const parsed = parseAlbumName(folder.name);
  if (parsed.date && parsed.precision) return formatDay(parsed.date, parsed.precision);
  return formatDateRange(folder.date_from, folder.date_to);
}

export function photoDateRange(photos: Photo[]): { from?: string; to?: string } {
  let from: string | undefined;
  let to: string | undefined;
  for (const p of photos) {
    const d = p.metadata?.date_taken;
    if (!d) continue;
    if (!from || d < from) from = d;
    if (!to || d > to) to = d;
  }
  return { from, to };
}

export function formatCount(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString(LOCALE)} ${n === 1 ? one : many}`;
}

export function isVideo(photo: Pick<Photo, "mime_type">): boolean {
  return photo.mime_type.startsWith("video/");
}

/** Width / height, clamped so panoramas and slivers don't wreck a row. */
export function aspectRatio(photo: Photo): number {
  const dims = photo.metadata?.dimensions;
  if (dims && dims.width > 0 && dims.height > 0) {
    return Math.min(3, Math.max(0.5, dims.width / dims.height));
  }
  return isVideo(photo) ? 16 / 9 : 4 / 3;
}
