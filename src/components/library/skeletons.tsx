import { Skeleton } from "@/components/ui";

/** Same grid as AlbumGrid, so covers land where the placeholders were. */
export function AlbumGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <ul
      role="status"
      aria-label="Chargement des dossiers"
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

// Shares of a row, as landscape and portrait photos fall in a justified grid.
const BASIS = [
  "34%",
  "22%",
  "30%",
  "40%",
  "18%",
  "28%",
  "36%",
  "24%",
  "31%",
  "20%",
  "38%",
  "26%",
];

/**
 * Rows of mixed widths at the grid's own row heights (128 / 170 / 220 px),
 * so photos arrive where the placeholders were instead of a column of bars.
 */
export function JustifiedSkeleton({ count = 15 }: { count?: number }) {
  return (
    <div
      role="status"
      aria-label="Chargement des photos"
      className="flex flex-wrap gap-1"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          aria-hidden
          className="skeleton h-32 flex-grow rounded-sm sm:h-[170px] lg:h-[220px]"
          style={{ flexBasis: BASIS[i % BASIS.length] }}
        />
      ))}
    </div>
  );
}

/** PageHeader-shaped: kicker, display title, meta line. */
export function HeaderSkeleton() {
  return (
    <div aria-hidden className="pb-8 pt-6 sm:pt-10">
      <Skeleton className="mb-4 h-3 w-28" />
      <Skeleton className="h-11 w-2/3 max-w-lg sm:h-14" />
      <Skeleton className="mt-5 h-4 w-56" />
    </div>
  );
}

function SectionHeadSkeleton() {
  return (
    <div aria-hidden className="mb-5 border-b border-line pb-3">
      <Skeleton className="h-6 w-32" />
    </div>
  );
}

/** A folder before its contents arrive (the breadcrumb is already real): header, then covers or photos. */
export function AlbumSkeleton({
  shape = "photos",
}: {
  shape?: "photos" | "albums";
}) {
  return (
    <div aria-busy="true">
      <HeaderSkeleton />
      {shape === "albums" ? (
        <div className="py-8 sm:py-10">
          <SectionHeadSkeleton />
          <AlbumGridSkeleton />
        </div>
      ) : (
        <div className="border-t border-line pt-6">
          <JustifiedSkeleton />
        </div>
      )}
    </div>
  );
}
