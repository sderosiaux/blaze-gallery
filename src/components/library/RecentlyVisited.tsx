"use client";

import { useEffect, useState } from "react";
import type { Folder } from "@/types";
import AlbumCard from "@/components/photos/AlbumCard";
import { Section, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";

const SHOWN = 5;

// Exactly one row at every width: the grid's column count, item by item.
const visibleFrom = [
  "",
  "",
  "hidden sm:block",
  "hidden lg:block",
  "hidden 2xl:block",
];

/**
 * The albums opened last, to pick up where you left off. Hidden when nothing
 * has been visited yet or the list can't be read: it is a shortcut, not content.
 */
export default function RecentlyVisited() {
  const [folders, setFolders] = useState<Folder[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/library/recent?limit=${SHOWN}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.error);
        setFolders(body.folders as Folder[]);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFolders([]);
      });
    return () => controller.abort();
  }, []);

  if (folders && folders.length === 0) return null;

  // While loading, one row of placeholders holds the space, so the section
  // below doesn't jump when the covers arrive; it folds away if there are none.
  return (
    <Section
      title="Recently visited"
      description="Albums you opened last, to pick up where you left off."
    >
      <ul
        aria-busy={!folders || undefined}
        className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-4 2xl:grid-cols-5"
      >
        {folders
          ? folders.slice(0, SHOWN).map((folder, i) => (
              <li
                key={folder.path}
                className={cn("min-w-0 animate-rise-in", visibleFrom[i])}
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <AlbumCard folder={folder} showPath />
              </li>
            ))
          : visibleFrom.map((visibility, i) => (
              <li key={i} aria-hidden className={visibility}>
                <Skeleton className="aspect-[4/3] w-full rounded-md" />
                <Skeleton className="mt-3 h-3 w-20" />
                <Skeleton className="mt-2 h-5 w-3/4" />
                <Skeleton className="mt-2 h-3.5 w-1/2" />
              </li>
            ))}
      </ul>
    </Section>
  );
}
