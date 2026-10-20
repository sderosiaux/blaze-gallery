"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { MapPinOff, RotateCcw, RotateCw } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import PhotoGrid, { PhotoGridSkeleton } from "@/components/PhotoGrid";
import {
  Button,
  EmptyState,
  PageHeader,
  PageSkeleton,
  Section,
  Skeleton,
} from "@/components/ui";
import { LoadError } from "@/components/find/LoadError";
import { usePhotoParam } from "@/components/find/usePhotoParam";
import { ContentNotice } from "@/components/find/ContentNotice";
import FilterBar from "@/components/find/FilterBar";
import { useUrlFilter } from "@/components/find/useUrlFilter";
import PeriodBrush from "@/components/map/PeriodBrush";
import { useAreaPhotos } from "@/components/map/useAreaPhotos";
import {
  fetchMapDates,
  fetchMapPoints,
  holdsPhotos,
  readUrlBox,
  readUrlPeriod,
  type MapDates,
  type MapPoints,
} from "@/components/map/mapData";
import { formatCount } from "@/lib/albums";
import { hasUrlFilter, NO_URL_FILTER } from "@/lib/photoFilter";
import type { MapBox, MapPeriod } from "@/lib/mapArea";

// MapLibre needs the browser (WebGL) and weighs about 1 MB: only this page loads it.
const MapView = dynamic(() => import("@/components/map/MapView"), {
  ssr: false,
  loading: () => <Skeleton className="h-[60vh] min-h-[20rem] rounded-lg" />,
});

/** How far below the viewport the next page starts loading. */
const PREFETCH_MARGIN = "0px 0px 1600px 0px";
/** The viewer fetches the next page this many photos before the last one. */
const VIEWER_PREFETCH = 6;

/**
 * Zone and period live in the URL (`s w n e`, `from to`), so a reload or
 * Back restores them. A new entry for each choice, or in place for steps.
 */
function writeParams(
  changes: Record<string, string | null>,
  history: "push" | "replace",
) {
  const url = new URL(window.location.href);
  for (const key of Object.keys(changes)) {
    const value = changes[key];
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  const href = url.pathname + url.search + url.hash;
  if (history === "push") window.history.pushState(null, "", href);
  else window.history.replaceState(null, "", href);
}

/** The same object while its content is, so effects keyed on it stay put. */
function useSettled<T>(value: T): T {
  const ref = useRef(value);
  if (JSON.stringify(ref.current) !== JSON.stringify(value))
    ref.current = value;
  return ref.current;
}

function MapMessage({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center p-6">
      <div
        role="status"
        className="pointer-events-auto flex max-w-sm flex-col items-center gap-3 rounded-lg border border-line bg-paper/95 px-6 py-5 text-center shadow-lift"
      >
        <p className="text-sm font-medium text-ink">{title}</p>
        {action}
      </div>
    </div>
  );
}

function MapContent() {
  const params = useSearchParams();
  const box = useSettled(readUrlBox((key) => params.get(key)));
  const period = useSettled(readUrlPeriod((key) => params.get(key)));
  const filtered = period.from !== null || period.to !== null;
  const [filter, setFilter] = useUrlFilter();
  const colorFiltered = hasUrlFilter(filter);
  const [selectedPhotoId, setPhotoParam] = usePhotoParam();

  const selectBox = useCallback((next: MapBox | null) => {
    writeParams(
      next
        ? {
            s: String(next.south),
            w: String(next.west),
            n: String(next.north),
            e: String(next.east),
          }
        : { s: null, w: null, n: null, e: null },
      "push",
    );
  }, []);

  const changePeriod = useCallback(
    (next: MapPeriod, history: "push" | "replace") => {
      writeParams({ from: next.from, to: next.to }, history);
    },
    [],
  );

  const allDates = () => {
    changePeriod({ from: null, to: null }, "push");
  };

  const allColors = () => {
    setFilter(NO_URL_FILTER);
  };

  const periodRef = useRef(period);
  periodRef.current = period;

  const [datesAttempt, setDatesAttempt] = useState(0);
  // With a zone selected, the brush shows when that place was photographed,
  // day by day for a single trip; the previous bars stay until the new ones
  // come. A period the zone holds no photo of would leave an empty
  // selection: the new bars come with all dates.
  const [dates, setDates] = useState<MapDates | "error" | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetchMapDates(box, filter, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setDates(next);
        // A zone without photos has no bars to fall back on: the period stays.
        if (
          next.dates.length > 0 &&
          !holdsPhotos(next.dates, periodRef.current)
        )
          changePeriod({ from: null, to: null }, "replace");
      })
      .catch(() => {
        if (!controller.signal.aborted) setDates("error");
      });
    return () => {
      controller.abort();
    };
  }, [box, filter, datesAttempt, changePeriod]);

  // The previous period's points stay on the map until the new ones come.
  const [pointsAttempt, setPointsAttempt] = useState(0);
  const [points, setPoints] = useState<MapPoints | null>(null);
  const [pointsFailed, setPointsFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setPointsFailed(false);
    fetchMapPoints(period, filter, controller.signal)
      .then(setPoints)
      .catch(() => {
        if (!controller.signal.aborted) setPointsFailed(true);
      });
    return () => {
      controller.abort();
    };
  }, [period, filter, pointsAttempt]);

  const [attempt, setAttempt] = useState(0);
  const { feed, loadMore, remove } = useAreaPhotos(
    box,
    period,
    filter,
    attempt,
  );
  const { phase, cursor } = feed;

  // Scrolling near the end of the grid brings the next page.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || phase !== "ready" || !cursor) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) loadMore();
      },
      { rootMargin: PREFETCH_MARGIN },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [phase, cursor, loadMore]);

  // The viewer walks every loaded photo: near the last one, fetch the next page.
  const count = feed.items.length;
  const selectedIndex = selectedPhotoId
    ? feed.items.findIndex((p) => String(p.id) === selectedPhotoId)
    : -1;
  useEffect(() => {
    if (selectedIndex !== -1 && selectedIndex >= count - VIEWER_PREFETCH)
      loadMore();
  }, [selectedIndex, count, phase, loadMore]);

  let message: React.ReactNode = null;
  if (pointsFailed) {
    message = (
      <MapMessage
        title="Les lieux des photos n'ont pas pu être chargés."
        action={
          <Button
            size="sm"
            variant="secondary"
            icon={RotateCw}
            onClick={() => {
              setPointsAttempt((n) => n + 1);
            }}
          >
            Réessayer
          </Button>
        }
      />
    );
  } else if (points && points.points.length === 0) {
    const none = `Aucune photo localisée${colorFiltered ? " pour ce filtre" : ""}`;
    message = filtered ? (
      <MapMessage
        title={`${none} sur cette période`}
        action={
          <Button
            size="sm"
            variant="secondary"
            icon={RotateCcw}
            onClick={allDates}
          >
            Toutes les dates
          </Button>
        }
      />
    ) : colorFiltered ? (
      <MapMessage
        title={none}
        action={
          <Button
            size="sm"
            variant="secondary"
            icon={RotateCcw}
            onClick={allColors}
          >
            Effacer le filtre
          </Button>
        }
      />
    ) : (
      <MapMessage title={none} />
    );
  }

  let results: React.ReactNode;
  if (!box) {
    results = (
      <p className="py-12 text-center text-sm text-ink-muted">
        Choisissez une zone sur la carte pour voir ses photos.
      </p>
    );
  } else if (phase === "error") {
    results = (
      <LoadError
        title="Les photos de cette zone n'ont pas pu être chargées"
        onRetry={() => {
          setAttempt((n) => n + 1);
        }}
      />
    );
  } else if (phase === "loading") {
    results = (
      <Section title="Dans cette zone">
        <PhotoGridSkeleton count={8} />
      </Section>
    );
  } else if (count === 0) {
    results = (
      <EmptyState
        icon={MapPinOff}
        title={`Aucune photo dans cette zone${filtered ? " sur cette période" : ""}${colorFiltered ? " pour ce filtre" : ""}`}
        action={
          (filtered || colorFiltered) && (
            <>
              {filtered && (
                <Button variant="secondary" icon={RotateCcw} onClick={allDates}>
                  Toutes les dates
                </Button>
              )}
              {colorFiltered && (
                <Button
                  variant="secondary"
                  icon={RotateCcw}
                  onClick={allColors}
                >
                  Effacer le filtre
                </Button>
              )}
            </>
          )
        }
        className="py-12"
      />
    );
  } else {
    results = (
      <Section
        title="Dans cette zone"
        action={
          <span role="status" className="tabular text-sm text-ink-muted">
            {formatCount(feed.total, "photo")}
          </span>
        }
      >
        <PhotoGrid
          photos={feed.items}
          total={feed.total}
          selectedPhotoId={selectedPhotoId}
          onPhotoUrlChange={setPhotoParam}
          onPhotoDeleted={(deleted) => {
            remove(deleted.id);
          }}
          eagerCount={12}
        />

        <div ref={sentinel} aria-hidden />

        {phase === "more" && (
          <div className="mt-1">
            <PhotoGridSkeleton count={8} />
          </div>
        )}

        {phase === "more-error" && (
          <div className="flex flex-col items-center gap-3 py-12 text-center text-sm text-ink-muted">
            <p>Les photos suivantes n&apos;ont pas pu être chargées.</p>
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
      </Section>
    );
  }

  return (
    <>
      <PageHeader title="Carte" />
      <FilterBar
        filter={filter}
        onChange={setFilter}
        noMenu={["date"]}
        className="mb-4"
      />
      <ContentNotice status={points?.content ?? null} />

      <MapView
        points={points?.points ?? null}
        cell={points?.cell ?? 0}
        box={box}
        onSelect={selectBox}
      >
        {message}
      </MapView>

      {dates === "error" ? (
        <div className="flex items-center justify-between gap-3 pt-4 text-sm text-ink-muted">
          <p>La période n&apos;a pas pu être chargée.</p>
          <Button
            size="sm"
            variant="ghost"
            icon={RotateCw}
            className="-mr-3"
            onClick={() => {
              setDatesAttempt((n) => n + 1);
            }}
          >
            Réessayer
          </Button>
        </div>
      ) : (
        dates && (
          <PeriodBrush dates={dates} period={period} onChange={changePeriod} />
        )
      )}

      {results}
    </>
  );
}

export default function MapPage() {
  return (
    <AppLayout>
      <ProtectedRoute>
        <Suspense fallback={<PageSkeleton />}>
          <MapContent />
        </Suspense>
      </ProtectedRoute>
    </AppLayout>
  );
}
