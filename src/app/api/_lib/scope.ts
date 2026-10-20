import type { FilterScope } from "@/lib/filterResolver";

/** `folder`: a list of the photos in that folder and below it (a folder's filtered view). */
export function folderScope(params: URLSearchParams): FilterScope {
  const folder = params.get("folder");
  return folder ? { folder } : {};
}
