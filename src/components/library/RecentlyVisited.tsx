"use client";

import { useEffect, useState } from "react";
import type { Folder } from "@/types";
import AlbumCard from "@/components/photos/AlbumCard";
import { Section } from "@/components/ui";
import { cn } from "@/lib/cn";
import { asArray, asString, readJsonObject } from "@/hooks/apiJson";

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
 * The folders opened last. Last on the page, so it simply appears once known
 * and stays away when nothing has been opened yet or the list can't be read:
 * it is a shortcut, not content.
 */
export default function RecentlyVisited() {
  const [folders, setFolders] = useState<Folder[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/library/recent?limit=${SHOWN}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await readJsonObject(response);
        if (!response.ok || body.success !== true)
          throw new Error(asString(body.error));
        setFolders(asArray(body.folders) as Folder[]);
      })
      .catch(() => {
        // Nothing to show: the section stays away.
      });
    return () => {
      controller.abort();
    };
  }, []);

  if (folders.length === 0) return null;

  return (
    <Section title="Récemment ouverts">
      <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-4 2xl:grid-cols-5">
        {folders.slice(0, SHOWN).map((folder, i) => (
          <li
            key={folder.path}
            className={cn("min-w-0 animate-rise-in", visibleFrom[i])}
            style={{ animationDelay: `${i * 30}ms` }}
          >
            <AlbumCard folder={folder} showPath />
          </li>
        ))}
      </ul>
    </Section>
  );
}
