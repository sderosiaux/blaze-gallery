import { Skeleton } from "@/components/ui";

/** Same grid as AlbumGrid, so results land where the placeholders were. */
export function AlbumGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <ul
      role="status"
      aria-label="Loading albums"
      className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-4 2xl:grid-cols-5"
    >
      {Array.from({ length: count }).map((_, i) => (
        <li key={i} aria-hidden>
          <Skeleton className="aspect-[4/3] w-full rounded-md" />
          <Skeleton className="mt-3 h-3 w-20" />
          <Skeleton className="mt-2 h-5 w-3/4" />
          <Skeleton className="mt-2 h-3.5 w-1/2" />
        </li>
      ))}
    </ul>
  );
}
