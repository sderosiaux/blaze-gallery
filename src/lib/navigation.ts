/**
 * Breadcrumb item for folder navigation
 */
export interface BreadcrumbItem {
  name: string;
  path: string;
}

/**
 * Build breadcrumb trail from bucket name and current path
 *
 * @param bucketName - The root bucket name (displayed as first breadcrumb)
 * @param currentPath - The current folder path (empty string for root)
 * @returns Array of breadcrumb items from root to current folder
 */
export function buildBreadcrumbs(
  bucketName: string,
  currentPath: string,
): BreadcrumbItem[] {
  // Start with root bucket
  const breadcrumbs: BreadcrumbItem[] = [{ name: bucketName, path: "" }];

  // If at root, just return the bucket
  if (!currentPath) {
    return breadcrumbs;
  }

  // Split path and build cumulative breadcrumbs
  const pathParts = currentPath.split("/").filter((part) => part);
  let buildPath = "";

  for (const part of pathParts) {
    buildPath = buildPath ? `${buildPath}/${part}` : part;
    breadcrumbs.push({ name: part, path: buildPath });
  }

  return breadcrumbs;
}

/**
 * Get the current folder name from a path
 *
 * @param path - The folder path
 * @param fallback - Fallback name if path is empty
 * @returns The folder name (last segment of path)
 */
export function getFolderNameFromPath(
  path: string,
  fallback: string = "Gallery",
): string {
  if (!path) return fallback;
  return path.split("/").pop() || fallback;
}
