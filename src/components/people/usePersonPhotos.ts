"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PersonPhoto } from "@/lib/people";
import { asArray, asString, isRecord, readJsonObject } from "@/hooks/apiJson";
import { filterQuery, type UrlFilter } from "@/lib/photoFilter";

const PAGE_SIZE = 200;

export interface PersonFeed {
  items: PersonPhoto[];
  /** Opaque cursor of the next page; null once the oldest photo is in */
  next: string | null;
  /** Photos of the whole list, and per year (newest first, undated last) */
  total: number;
  years: { year: number | null; count: number }[];
  phase: "loading" | "ready" | "more" | "error" | "more-error";
  content: "ok" | "unavailable" | null;
}

const START: PersonFeed = {
  items: [],
  next: null,
  total: 0,
  years: [],
  phase: "loading",
  content: null,
};

function readYears(value: unknown): PersonFeed["years"] {
  return asArray(value).flatMap((y) =>
    isRecord(y) &&
    (typeof y.year === "number" || y.year === null) &&
    typeof y.count === "number"
      ? [{ year: y.year, count: y.count }]
      : [],
  );
}

async function fetchPage(
  personId: number,
  filter: UrlFilter,
  after: string | { year: number } | null,
  signal: AbortSignal,
) {
  const params = filterQuery(filter);
  params.set("limit", String(PAGE_SIZE));
  if (typeof after === "string") params.set("after", after);
  else if (after) params.set("year", String(after.year));
  const response = await fetch(
    `/api/people/${String(personId)}/photos?${params.toString()}`,
    { signal },
  );
  const data = await readJsonObject(response);
  if (!response.ok || !data.success)
    throw new Error(asString(data.error) ?? `HTTP ${response.status}`);
  return {
    photos: asArray(data.photos) as PersonPhoto[],
    next: typeof data.next === "string" ? data.next : null,
    total: typeof data.total === "number" ? data.total : null,
    years: readYears(data.years),
    content:
      data.content === "ok" || data.content === "unavailable"
        ? (data.content as PersonFeed["content"])
        : null,
  };
}

/**
 * The person's photos passing the filter, newest first, a page at a time,
 * from `startYear` and older when given: starts over when the person, the
 * filter (by `filterKey`), the year or `attempt` changes; `loadMore`
 * appends the next page (one request at a time, again after a failure only
 * with `retry`). The first page brings the counts of the whole list.
 */
export function usePersonPhotos(
  personId: number | null,
  filter: UrlFilter,
  filterKey: string,
  startYear: number | null,
  attempt: number,
) {
  const [feed, setFeed] = useState<PersonFeed>(START);
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => {
    inFlight.current?.abort();
    setFeed(START);
    if (personId === null) return;
    const controller = new AbortController();
    inFlight.current = controller;
    fetchPage(
      personId,
      filterRef.current,
      startYear === null ? null : { year: startYear },
      controller.signal,
    )
      .then(({ photos, next, total, years, content }) => {
        setFeed({
          items: photos,
          next,
          total: total ?? photos.length,
          years,
          phase: "ready",
          content,
        });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setFeed((f) => ({ ...f, phase: "error" }));
      })
      .finally(() => {
        if (inFlight.current === controller) inFlight.current = null;
      });
    return () => {
      controller.abort();
    };
  }, [personId, filterKey, startYear, attempt]);

  useEffect(() => () => inFlight.current?.abort(), []);

  const loadMore = useCallback(
    (retry = false) => {
      const { next, phase } = feedRef.current;
      if (personId === null || !next || inFlight.current) return;
      if (phase !== "ready" && !(retry && phase === "more-error")) return;
      const controller = new AbortController();
      inFlight.current = controller;
      setFeed((f) => ({ ...f, phase: "more" }));
      fetchPage(personId, filterRef.current, next, controller.signal)
        .then(({ photos, next: following }) => {
          setFeed((f) => {
            const known = new Set(f.items.map((p) => p.id));
            return {
              ...f,
              items: [...f.items, ...photos.filter((p) => !known.has(p.id))],
              next: following,
              phase: "ready",
            };
          });
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setFeed((f) => ({ ...f, phase: "more-error" }));
        })
        .finally(() => {
          if (inFlight.current === controller) inFlight.current = null;
        });
    },
    [personId],
  );

  return { feed, setFeed, loadMore };
}
