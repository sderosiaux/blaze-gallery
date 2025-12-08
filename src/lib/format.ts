/**
 * Format bytes into human-readable string (KB, MB, GB, etc.)
 */
export function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes === 0 || isNaN(bytes) || bytes < 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  // Ensure i is within bounds
  const sizeIndex = Math.max(0, Math.min(i, sizes.length - 1));

  return `${parseFloat((bytes / Math.pow(k, sizeIndex)).toFixed(1))} ${sizes[sizeIndex]}`;
}

/**
 * Alias for formatBytes - for backward compatibility
 */
export const formatFileSize = formatBytes;
