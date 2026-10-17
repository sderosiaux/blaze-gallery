/** Byte sizes in French units ("3,4 Mo"), binary multiples as before. */
export function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes === 0 || isNaN(bytes) || bytes < 0) return "0 o";

  const k = 1024;
  const sizes = ["o", "Ko", "Mo", "Go", "To"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const sizeIndex = Math.max(0, Math.min(i, sizes.length - 1));
  const value = bytes / Math.pow(k, sizeIndex);

  return `${value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}\u00a0${sizes[sizeIndex]}`;
}

/**
 * Alias for formatBytes - for backward compatibility
 */
export const formatFileSize = formatBytes;
