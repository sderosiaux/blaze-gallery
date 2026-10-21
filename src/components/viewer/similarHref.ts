import { setLikeParam } from "@/lib/photoFilter";

/** The views whose list a filter narrows (their FilterBar): « Photos similaires » stays on them. */
const FILTERED_VIEW =
  /^\/(timeline|carte|couleurs|favorites|search|folder(\/.*)?|personnes\/\d+)\/?$/;

/**
 * Where « Photos similaires » of photo `id` goes from the page at
 * `pathname` with query `search`: the same view narrowed to the photos
 * looking like it (`like`, its other filters kept, the open photo
 * closed), or Recherche's from a view without filters (the Corbeille,
 * Doublons).
 */
export function similarHref(
  pathname: string,
  search: string,
  id: number,
): string {
  if (!FILTERED_VIEW.test(pathname)) return `/search?like=${String(id)}`;
  const params = new URLSearchParams(search);
  params.delete("photo");
  return `${pathname}?${setLikeParam(params, id).toString()}`;
}
