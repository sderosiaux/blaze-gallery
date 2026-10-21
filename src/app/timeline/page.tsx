"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowUp,
  CalendarDays,
  Library,
  RotateCcw,
  RotateCw,
  SearchX,
} from "lucide-react";
import type { Photo } from "@/types";
import AppLayout from "@/components/AppLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import PhotoViewer from "@/components/PhotoViewer";
import { usePhotoSlots } from "@/hooks/usePhotoSlots";
import {
  Button,
  ButtonLink,
  EmptyState,
  PageHeader,
  PageSkeleton,
  useToast,
} from "@/components/ui";
import { LoadError } from "@/components/find/LoadError";
import TimelineMonth, { MonthSkeleton } from "@/components/find/TimelineMonth";
import { YearPicker, YearRail } from "@/components/find/YearIndex";
import { setFavorite } from "@/components/find/favorites";
import { applyPhotoPatch, type PhotoPatch } from "@/lib/photoPatch";
import { usePhotoParam } from "@/components/find/usePhotoParam";
import FilterBar from "@/components/find/FilterBar";
import { FilterNotice } from "@/components/find/FilterNotice";
import { useUrlFilter } from "@/components/find/useUrlFilter";
import { useTimelineFeed } from "@/components/find/useTimelineFeed";
import {
  filterKey,
  filterQuery,
  hasUrlFilter,
  NO_URL_FILTER,
  type UrlFilter,
} from "@/lib/photoFilter";
import {
  endOfMonthCursor,
  countsOf,
  endOfYearCursor,
  fetchTimelineSummary,
  groupByMonth,
  monthsOfYear,
  yearsOf,
  type MonthCount,
  type MonthGroup,
} from "@/components/find/timeline";

/** How far below the viewport the next page starts loading. */
const PREFETCH_MARGIN = "0px 0px 1600px 0px";
/** A month counts as "current" once its heading passes this line under the top bar. */
const SPY_LINE = 160;

const sameId = (a: Pick<Photo, "id">, b: Pick<Photo, "id">) =>
  String(a.id) === String(b.id);

/** `/timeline` at a year or month, keeping the filter. */
function timelineHref(filter: UrlFilter, at: Record<string, string> = {}) {
  const params = filterQuery(filter);
  for (const [key, value] of Object.entries(at)) params.set(key, value);
  const query = params.toString();
  return query ? `/timeline?${query}` : "/timeline";
}

function TimelineContent() {
  const toast = useToast();
  const params = useSearchParams();
  const yearParam = params.get("year") ?? null;
  const monthParam = params.get("month") ?? null;
  const startMonth =
    monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : null;
  const startYear = startMonth
    ? Number(startMonth.slice(0, 4))
    : yearParam && /^\d{4}$/.test(yearParam)
      ? Number(yearParam)
      : null;
  const [selectedPhotoId, setPhotoParam] = usePhotoParam();
  const [filter, setFilter] = useUrlFilter();
  const key = filterKey(filter);
  const filtered = hasUrlFilter(filter);

  const [years, setYears] = useState<number[]>([]);
  const [summaryMonths, setSummaryMonths] = useState<MonthCount[]>([]);
  const [attempt, setAttempt] = useState(0);
  const { feed, setFeed, loadMore } = useTimelineFeed(
    filter,
    key,
    null,
    startMonth
      ? endOfMonthCursor(startMonth)
      : startYear
        ? endOfYearCursor(startYear)
        : null,
    attempt,
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchTimelineSummary(controller.signal, filter)
      .then((summary) => {
        setYears(yearsOf(summary.months));
        setSummaryMonths(summary.months);
      })
      // The year index is an extra: the months still show without it.
      .catch(() => {
        // Deliberately ignored, see above.
      });
    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key says when the filter changed
  }, [attempt, key]);

  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || feed.phase !== "ready" || !feed.cursor) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) loadMore();
      },
      {
        rootMargin: PREFETCH_MARGIN,
      },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [feed.phase, feed.cursor, loadMore]);

  const groupsRef = useRef<MonthGroup[]>([]);
  // A photo sent to the Corbeille leaves its slot, or gives it to the next of its stack
  const slots = usePhotoSlots(feed.items);
  const items = slots.items;
  const groups = useMemo(() => {
    const next = groupByMonth(items, groupsRef.current);
    groupsRef.current = next;
    return next;
  }, [items]);

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
      // pushState: Back returns to where the jump started, not out of the page.
      window.history.pushState(
        null,
        "",
        timelineHref(filter, years[0] === year ? {} : { year: String(year) }),
      );
    },
    [years, filter],
  );

  const jumpMonth = useCallback(
    (month: string) => {
      const section = document.querySelector<HTMLElement>(
        `[data-month="${month}"]`,
      );
      if (section) {
        section.scrollIntoView({ block: "start" });
        return;
      }
      // Not loaded yet: start the list at that month.
      window.scrollTo({ top: 0 });
      setActiveMonth(month);
      window.history.pushState(null, "", timelineHref(filter, { month }));
    },
    [filter],
  );

  const counts = useMemo(() => countsOf(summaryMonths), [summaryMonths]);
  const activeYearMonths = useMemo(
    () => (activeYear === null ? [] : monthsOfYear(summaryMonths, activeYear)),
    [summaryMonths, activeYear],
  );

  const { patch: patchSlot } = slots;
  const patch = useCallback(
    (id: Photo["id"], changes: PhotoPatch) => {
      setFeed((f) => ({
        ...f,
        items: f.items.map((p) =>
          sameId(p, { id }) ? applyPhotoPatch(p, changes) : p,
        ),
      }));
      patchSlot(id, changes);
    },
    [setFeed, patchSlot],
  );

  const toggleFavorite = useCallback(
    async (photo: Photo) => {
      const wanted = !photo.is_favorite;
      patch(photo.id, { is_favorite: wanted });
      try {
        const result = await setFavorite(photo, wanted);
        if (result !== wanted) patch(photo.id, { is_favorite: result });
      } catch {
        patch(photo.id, { is_favorite: photo.is_favorite });
        toast.show("Les favoris n'ont pas pu être mis à jour.", "error");
      }
    },
    [patch, toast],
  );

  // The viewer opens at once; the URL follows so Back closes it.
  const [openId, setOpenId] = useState<string | null>(selectedPhotoId);
  useEffect(() => {
    setOpenId(selectedPhotoId);
  }, [selectedPhotoId]);
  const selected = openId
    ? (items.find((p) => String(p.id) === openId) ?? null)
    : null;

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
  };

  // The viewer walks every loaded photo: near the end of them, fetch the next page.
  const selectedIndex = selected ? items.indexOf(selected) : -1;
  useEffect(() => {
    if (selectedIndex !== -1 && selectedIndex >= items.length - 6) loadMore();
  }, [selectedIndex, items.length, feed.phase, loadMore]);

  const closePhoto = () => {
    setOpenId(null);
    setPhotoParam(null);
  };

  const retryAll = () => {
    setAttempt((n) => n + 1);
  };

  const latestHref = timelineHref(filter);
  const header = (
    <>
      <PageHeader title="Chronologie" />
      <FilterBar filter={filter} onChange={setFilter} className="mb-6" />
      <FilterNotice notes={feed.notes} />
    </>
  );

  if (feed.phase === "error") {
    return (
      <>
        {header}
        <LoadError
          title="La chronologie n'a pas pu être chargée"
          onRetry={retryAll}
        />
      </>
    );
  }

  if (feed.phase === "loading") {
    return (
      <>
        {header}
        <div role="status" aria-label="Chargement de la chronologie">
          <MonthSkeleton first />
          <MonthSkeleton />
        </div>
      </>
    );
  }

  if (feed.items.length === 0) {
    const what = filtered ? "pour ce filtre" : "datée";
    return (
      <>
        {header}
        <EmptyState
          icon={filtered ? SearchX : CalendarDays}
          title={
            startYear
              ? `Aucune photo ${what} en ${startYear} ou avant`
              : `Aucune photo ${what}`
          }
          action={
            filtered ? (
              <Button
                variant="secondary"
                icon={RotateCcw}
                onClick={() => {
                  setFilter(NO_URL_FILTER);
                }}
              >
                Effacer le filtre
              </Button>
            ) : startYear ? (
              <ButtonLink href={latestHref} variant="secondary" icon={ArrowUp}>
                Revenir au plus récent
              </ButtonLink>
            ) : (
              <ButtonLink href="/" variant="secondary" icon={Library}>
                Ouvrir la bibliothèque
              </ButtonLink>
            )
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

      <div className="md:grid md:grid-cols-[minmax(0,1fr)_6rem] md:gap-8">
        <div className="min-w-0">
          {startYear && (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-y border-line py-2 text-sm text-ink-muted">
              <span>
                <span className="tabular font-medium text-ink">
                  {startYear}
                </span>{" "}
                et avant
              </span>
              <ButtonLink
                href={latestHref}
                size="sm"
                variant="ghost"
                icon={ArrowUp}
                className="-mr-3"
              >
                Revenir au plus récent
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
                yearAnchor={yearAnchor}
                eagerCount={i === 0 ? 12 : 0}
                onOpen={openPhoto}
                onToggleFavorite={(photo) => void toggleFavorite(photo)}
                onReplace={slots.replace}
              />
            );
          })}

          <div ref={sentinel} aria-hidden />

          {feed.phase === "more" && (
            <div role="status" aria-label="Chargement des mois précédents">
              <MonthSkeleton />
            </div>
          )}

          {feed.phase === "more-error" && (
            <div className="flex flex-col items-center gap-3 py-12 text-center text-sm text-ink-muted">
              <p>Les mois précédents n&apos;ont pas pu être chargés.</p>
              <Button
                variant="secondary"
                size="sm"
                icon={RotateCw}
                onClick={() => {
                  loadMore(true);
                }}
              >
                Réessayer
              </Button>
            </div>
          )}
        </div>

        {years.length > 1 && (
          <YearRail
            years={years}
            counts={counts}
            active={activeYear}
            activeYearMonths={activeYearMonths}
            activeMonth={activeMonth}
            onJump={jump}
            onJumpMonth={jumpMonth}
          />
        )}
      </div>

      {years.length > 1 && (
        <YearPicker
          years={years}
          counts={counts}
          active={activeYear}
          activeYearMonths={activeYearMonths}
          activeMonth={activeMonth}
          onJump={jump}
          onJumpMonth={jumpMonth}
        />
      )}

      {selected && (
        <PhotoViewer
          photo={selected}
          photos={items}
          onClose={closePhoto}
          onPhotoChange={changePhoto}
          onPhotoUpdate={patch}
          onPhotoReplace={slots.replace}
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
