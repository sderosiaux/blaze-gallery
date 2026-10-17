"use client";

import { useEffect, useState } from "react";
import type { Folder } from "@/types";
import { AlbumGrid } from "@/components/photos/AlbumCard";
import { ButtonLink, Section } from "@/components/ui";
import { asArray, readJsonObject } from "@/hooks/apiJson";
import { AlbumGridSkeleton } from "./AlbumGridSkeleton";
import { fetchTimelineSummary, yearsOf } from "./timeline";

const RECENT_LIMIT = 4;

interface Data {
  recent: Folder[] | null;
  years: number[] | null;
}

/**
 * Real places to start from: folders opened lately and the years the camera
 * dates cover. Either list is simply left out when its API has nothing.
 */
export function StartingPoints() {
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const recent = fetch(`/api/library/recent?limit=${RECENT_LIMIT}`, {
      signal: controller.signal,
    })
      .then(readJsonObject)
      .then((d) => (d.success ? (asArray(d.folders) as Folder[]) : null))
      .catch(() => null);
    const years = fetchTimelineSummary(controller.signal)
      .then((s) => yearsOf(s.months))
      .catch(() => null);
    // Both promises catch their own failures, so the pair never rejects.
    void Promise.all([recent, years]).then(([r, y]) => {
      if (!controller.signal.aborted) setData({ recent: r, years: y });
    });
    return () => {
      controller.abort();
    };
  }, []);

  if (!data) {
    return (
      <Section title="Récemment ouverts">
        <AlbumGridSkeleton count={RECENT_LIMIT} />
      </Section>
    );
  }

  return (
    <>
      {data.recent && data.recent.length > 0 && (
        <Section title="Récemment ouverts">
          <AlbumGrid folders={data.recent} showPath eagerCount={RECENT_LIMIT} />
        </Section>
      )}
      {data.years && data.years.length > 0 && (
        <Section title="Années">
          <ul className="flex flex-wrap gap-2">
            {data.years.map((year) => (
              <li key={year}>
                <ButtonLink href={`/timeline?year=${year}`} size="sm">
                  <span className="tabular">{year}</span>
                </ButtonLink>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
