"use client";

import { useEffect, useState } from "react";
import type { Folder } from "@/types";
import { AlbumGrid } from "@/components/photos/AlbumCard";
import { ButtonLink, Section } from "@/components/ui";
import { AlbumGridSkeleton } from "./AlbumGridSkeleton";
import { fetchTimelineSummary, yearsOf, type YearCount } from "./timeline";

interface Data {
  recent: Folder[] | null;
  years: YearCount[] | null;
}

/**
 * Real places to start from: albums opened lately and the years the camera
 * dates cover. Either list is simply left out when its API has nothing.
 */
export function StartingPoints({ albumLimit = 8 }: { albumLimit?: number }) {
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const recent = fetch(`/api/library/recent?limit=${albumLimit}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((d) => (d.success ? (d.folders as Folder[]) : null))
      .catch(() => null);
    const years = fetchTimelineSummary(controller.signal)
      .then((s) => yearsOf(s.months))
      .catch(() => null);
    Promise.all([recent, years]).then(([r, y]) => {
      if (!controller.signal.aborted) setData({ recent: r, years: y });
    });
    return () => controller.abort();
  }, [albumLimit]);

  if (!data) {
    return (
      <Section title="Recently opened">
        <AlbumGridSkeleton count={4} />
      </Section>
    );
  }

  return (
    <>
      {data.recent && data.recent.length > 0 && (
        <Section
          title="Recently opened"
          description="Albums you looked at lately, newest first."
        >
          <AlbumGrid folders={data.recent} showPath eagerCount={4} />
        </Section>
      )}
      {data.years && data.years.length > 0 && (
        <Section
          title="Go by year"
          description="Every year the cameras wrote into the photos. Opens the timeline there."
        >
          <ul className="flex flex-wrap gap-2">
            {data.years.map(({ year, count }) => (
              <li key={year}>
                <ButtonLink
                  href={`/timeline?year=${year}`}
                  size="sm"
                  aria-label={`${year}, ${count.toLocaleString("en-GB")} photos`}
                >
                  <span className="tabular">{year}</span>
                  <span className="tabular text-xs font-normal text-ink-muted">
                    {count.toLocaleString("en-GB")}
                  </span>
                </ButtonLink>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
