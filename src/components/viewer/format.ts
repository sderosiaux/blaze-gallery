import { LOCALE } from "@/lib/albums";

/**
 * "samedi 13 janvier 2018". EXIF wall-clock times are stored with a Z, so
 * they are read back in UTC.
 */
export function formatTakenDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(LOCALE, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

const UNITS = ["o", "Ko", "Mo", "Go", "To"];

/** "3,4 Mo": French units and decimal comma. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 o";
  const i = Math.min(
    UNITS.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** i;
  return `${value.toLocaleString(LOCALE, { maximumFractionDigits: i === 0 ? 0 : 1 })} ${UNITS[i]}`;
}

/** "43,6047° N, 1,4442° E". */
export function formatCoordinates(latitude: number, longitude: number): string {
  const part = (value: number, positive: string, negative: string) =>
    `${Math.abs(value).toLocaleString(LOCALE, {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    })}° ${value >= 0 ? positive : negative}`;
  return `${part(latitude, "N", "S")}, ${part(longitude, "E", "O")}`;
}
