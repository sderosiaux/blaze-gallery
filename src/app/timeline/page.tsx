"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowUp, CalendarDays, Library, RotateCw } from "lucide-react";
import type { Photo } from "@/types";
import AppLayout from "@/components/AppLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import PhotoViewer from "@/components/PhotoViewer";
import { Button, ButtonLink, EmptyState, MetaDot, PageHeader, PageSkeleton, Skeleton, useToast } from "@/components/ui";
import { LoadError } from "@/components/find/LoadError";
import TimelineMonth, { MonthSkeleton } from "@/components/find/TimelineMonth";
import { YearPicker, YearRail } from "@/components/find/YearIndex";
import { setFavorite } from "@/components/find/favorites";
import { usePhotoParam } from "@/components/find/usePhotoParam";
import {
  endOfYearCursor,
  fetchTimelineSummary,
  groupByMonth,
  monthKey,
  yearsOf,
  type MonthGroup,
  type TimelinePhoto,
  type TimelineSummary,
} from "@/components/find/timeline";

const PAGE_SIZE = 200;
/** How far below the viewport the next page starts loading. */
const PREFETCH_MARGIN = "0px 0px 1600px 0px";
/** A month counts as "current" once its heading passes this line under the top bar. */
const SPY_LINE = 160;

interface Feed {
  items: TimelinePhoto[];
  /** Opaque next_before of the last page; null once the oldest photo is in. */
  cursor: string | null;
  phase: "loading" | "ready" | "more" | "error" | "more-error";
}

async function fetchPage(before: string | null, signal: AbortSignal) {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (before) params.set("before", before);
  const response = await fetch(`/api/timeline?${params}`, { signal });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error ?? `HTTP ${response.status}`);
  return { photos: (data.photos ?? []) as TimelinePhoto[], next: (data.next_before ?? null) as string | null };
}

const sameId = (a: Pick<Photo, "id">, b: Pick<Photo, "id">) => String(a.id) === String(b.id);

/** Pages can overlap if the backfill dates a photo between two requests. */
function unseen(seen: Set<string>, photos: TimelinePhoto[]) {
  return photos.filter((p) => {
    const id = String(p.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function TimelineContent() {
  const toast = useToast();
  const yearParam = useSearchParams()?.get("year") ?? null;
  const startYear = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : null;
  const [selectedPhotoId, setPhotoParam] = usePhotoParam();

  const [summary, setSummary] = useState<TimelineSummary | null>(null);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [feed, setFeed] = useState<Feed>({ items: [], cursor: null, phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const inFlight = useRef<AbortController | null>(null);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    const controller = new AbortController();
    setSummaryFailed(false);
    fetchTimelineSummary(controller.signal)
      .then(setSummary)
      // Counts and the year index are extras: the months still show without them.
      .catch(() => !controller.signal.aborted && setSummaryFailed(true));
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    seen.current = new Set();
    setFeed({ items: [], cursor: null, phase: "loading" });
    fetchPage(startYear ? endOfYearCursor(startYear) : null, controller.signal)
      .then(({ photos, next }) => setFeed({ items: unseen(seen.current, photos), cursor: next, phase: "ready" }))
      .catch(() => {
        if (!controller.signal.aborted) setFeed((f) => ({ ...f, phase: "error" }));
      })
      .finally(() => {
        if (inFlight.current === controller) inFlight.current = null;
      });
    return () => controller.abort();
  }, [startYear, attempt]);

  useEffect(() => () => inFlight.current?.abort(), []);

  const loadMore = useCallback((retry = false) => {
    const { cursor, phase } = feedRef.current;
    if (!cursor || inFlight.current) return;
    if (phase !== "ready" && !(retry && phase === "more-error")) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setFeed((f) => ({ ...f, phase: "more" }));
    fetchPage(cursor, controller.signal)
      .then(({ photos, next }) =>
        setFeed((f) => ({ items: [...f.items, ...unseen(seen.current, photos)], cursor: next, phase: "ready" })),
      )
      .catch(() => {
        if (!controller.signal.aborted) setFeed((f) => ({ ...f, phase: "more-error" }));
      })
      .finally(() => {
        if (inFlight.current === controller) inFlight.current = null;
      });
  }, []);

  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || feed.phase !== "ready" || !feed.cursor) return;
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && loadMore(), {
      rootMargin: PREFETCH_MARGIN,
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [feed.phase, feed.cursor, loadMore]);

  const groupsRef = useRef<MonthGroup[]>([]);
  const groups = useMemo(() => {
    const next = groupByMonth(feed.items, groupsRef.current);
    groupsRef.current = next;
    return next;
  }, [feed.items]);

  const monthCounts = useMemo(() => new Map(summary?.months.map((m) => [m.month, m.count])), [summary]);
  const years = useMemo(() => (summary ? yearsOf(summary.months) : []), [summary]);
  const dated = useMemo(() => summary?.months.reduce((n, m) => n + m.count, 0) ?? 0, [summary]);

  const [activeMonth, setActiveMonth] = useState<string | null>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const sections = document.querySelectorAll<HTMLElement>("[data-month]");
      let current = sections[0]?.dataset.month ?? null;
      for (const section of Array.from(sections)) {
        if (section.getBoundingClientRect().top > SPY_LINE) break;
        current = section.dataset.month ?? current;
      }
      setActiveMonth(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [groups]);
  const activeYear = activeMonth ? Number(activeMonth.slice(0, 4)) : startYear;

  const jump = useCallback(
    (year: number) => {
      const anchor = document.getElementById(`year-${year}`);
      if (anchor) {
        // Instant: a smooth scroll over thousands of pixels is slow, and pages
        // appended on the way cancel it halfway.
        anchor.scrollIntoView({ block: "start" });
        return;
      }
      // Not loaded yet: start the list at that year instead of paging down to it.
      window.scrollTo({ top: 0 });
      setActiveMonth(`${year}-12`);
      window.history.replaceState(null, "", years[0]?.year === year ? "/timeline" : `/timeline?year=${year}`);
    },
    [years],
  );

  const patch = useCallback((id: Photo["id"], changes: Partial<Photo>) => {
    setFeed((f) => ({ ...f, items: f.items.map((p) => (sameId(p, { id }) ? { ...p, ...changes } : p)) }));
  }, []);

  const toggleFavorite = useCallback(
    async (photo: Photo) => {
      const wanted = !photo.is_favorite;
      patch(photo.id, { is_favorite: wanted });
      try {
        const result = await setFavorite(photo, wanted);
        if (result !== wanted) patch(photo.id, { is_favorite: result });
      } catch {
        patch(photo.id, { is_favorite: photo.is_favorite });
        toast.show("Couldn't update favorites. Try again.", "error");
      }
    },
    [patch, toast],
  );

  // The viewer opens at once; the URL follows so Back closes it.
  const [openId, setOpenId] = useState<string | null>(selectedPhotoId);
  useEffect(() => setOpenId(selectedPhotoId), [selectedPhotoId]);
  const selected = openId ? feed.items.find((p) => String(p.id) === openId) ?? null : null;

  const openPhoto = useCallback(
    (photo: Photo) => {
      setOpenId(String(photo.id));
      setPhotoParam(String(photo.id));
    },
    [setPhotoParam],
  );

  const changePhoto = (photo: Photo) => {
    setOpenId(String(photo.id));
    setPhotoParam(String(photo.id));
    const index = feedRef.current.items.findIndex((p) => sameId(p, photo));
    if (index >= feedRef.current.items.length - 6) loadMore();
  };

  const closePhoto = () => {
    setOpenId(null);
    setPhotoParam(null);
  };

  const retryAll = () => setAttempt((n) => n + 1);

  const header = (
    <PageHeader
      kicker="Timeline"
      title="Month by month"
      meta={
        summary ? (
          dated > 0 && (
            <>
              <span className="tabular">{dated.toLocaleString("en-GB")} photos with a date</span>
              {years.length > 0 && (
                <>
                  <MetaDot />
                  <span className="tabular">
                    {years.length > 1 ? `${years[years.length - 1].year} – ${years[0].year}` : years[0].year}
                  </span>
                </>
              )}
            </>
          )
        ) : (
          !summaryFailed && <Skeleton className="h-4 w-52" />
        )
      }
    >
      {summary?.total_photos !== undefined && dated > 0 && dated < summary.total_photos && (
        <p className="mt-3 max-w-2xl text-pretty text-sm leading-relaxed text-ink-muted">
          So far {dated.toLocaleString("en-GB")} of {summary.total_photos.toLocaleString("en-GB")} photos have a date.
          The rest are still being read from their camera data and will join the timeline on their own.
        </p>
      )}
    </PageHeader>
  );

  if (feed.phase === "error") {
    return (
      <>
        {header}
        <LoadError title="The timeline didn't load" onRetry={retryAll} />
      </>
    );
  }

  if (feed.phase === "loading") {
    return (
      <>
        {header}
        <div role="status" aria-label="Loading the timeline">
          <MonthSkeleton first />
          <MonthSkeleton />
        </div>
      </>
    );
  }

  if (feed.items.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={CalendarDays}
          title={startYear ? `Nothing dated in ${startYear} or before` : "No dates read yet"}
          body="The timeline is built from the date each camera wrote into its photos. As those dates are read from the library, months appear here on their own. Albums are always there in the meantime."
          action={
            <>
              <ButtonLink href="/" variant="primary" icon={Library}>
                Open the library
              </ButtonLink>
              {startYear && (
                <ButtonLink href="/timeline" variant="secondary" icon={ArrowUp}>
                  Back to the newest
                </ButtonLink>
              )}
            </>
          }
          className="py-20"
        />
      </>
    );
  }

  let previousYear: number | null = null;

  return (
    <>
      {header}

      <div className="md:grid md:grid-cols-[minmax(0,1fr)_4.5rem] md:gap-8">
        <div className="min-w-0">
          {startYear && (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-y border-line py-2 text-sm text-ink-muted">
              <span>
                Showing <span className="tabular font-medium text-ink">{startYear}</span> and earlier.
              </span>
              <ButtonLink href="/timeline" size="sm" variant="ghost" icon={ArrowUp} className="-mr-3">
                Back to the newest
              </ButtonLink>
            </div>
          )}

          {groups.map((group, i) => {
            const year = Number(group.key.slice(0, 4));
            const yearAnchor = year !== previousYear ? year : undefined;
            previousYear = year;
            return (
              <TimelineMonth
                key={group.key}
                group={group}
                total={monthCounts.get(group.key)}
                yearAnchor={yearAnchor}
                eagerCount={i === 0 ? 12 : 0}
                onOpen={openPhoto}
                onToggleFavorite={toggleFavorite}
              />
            );
          })}

          <div ref={sentinel} aria-hidden />

          {feed.phase === "more" && (
            <div role="status" aria-label="Loading older photos">
              <MonthSkeleton />
            </div>
          )}

          {feed.phase === "more-error" && (
            <div className="flex flex-col items-center gap-3 py-12 text-center text-sm text-ink-muted">
              <p>The next months didn&apos;t load.</p>
              <Button variant="secondary" size="sm" icon={RotateCw} onClick={() => loadMore(true)}>
                Try again
              </Button>
            </div>
          )}

          {feed.phase === "ready" && !feed.cursor && (
            <p className="border-t border-line py-12 text-center text-sm text-ink-muted">
              That is the oldest dated photo so far. Photos without a date are still in their albums.
            </p>
          )}
        </div>

        {years.length > 1 && <YearRail years={years} active={activeYear} onJump={jump} />}
      </div>

      {years.length > 1 && <YearPicker years={years} active={activeYear} onJump={jump} />}

      {selected && (
        <PhotoViewer
          photo={selected}
          photos={feed.items}
          onClose={closePhoto}
          onPhotoChange={changePhoto}
          onFavoriteToggle={(updated) => patch(updated.id, { is_favorite: updated.is_favorite })}
          onDelete={(deleted) =>
            setFeed((f) => ({ ...f, items: f.items.filter((p) => !sameId(p, deleted)) }))
          }
        />
      )}
    </>
  );
}

export default function TimelinePage() {
  return (
    <AppLayout>
      <ProtectedRoute>
        <Suspense fallback={<PageSkeleton />}>
          <TimelineContent />
        </Suspense>
      </ProtectedRoute>
    </AppLayout>
  );
}
