const LOCALE = "en-GB";

/**
 * "Saturday 13 January 2018" and "18:02". EXIF wall-clock times are stored
 * with a Z, so they are read back in UTC. A midnight time is usually a date
 * without a time: it is left out.
 */
export function formatTaken(iso: string): { day: string; time?: string } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { day: iso };
  const day = date.toLocaleDateString(LOCALE, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const midnight = date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0;
  const time = midnight
    ? undefined
    : date.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return { day: day.replace(",", ""), time };
}
