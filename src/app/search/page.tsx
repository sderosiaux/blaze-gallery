"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Library, RotateCcw, RotateCw, SearchX } from "lucide-react";
import type { Folder, Photo } from "@/types";
import AppLayout from "@/components/AppLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import PhotoGrid, { PhotoGridSkeleton } from "@/components/PhotoGrid";
import { AlbumGrid } from "@/components/photos/AlbumCard";
import {
  Button,
  ButtonLink,
  EmptyState,
  PageHeader,
  PageSkeleton,
  Section,
} from "@/components/ui";
import { AlbumGridSkeleton } from "@/components/find/AlbumGridSkeleton";
import ColorFilterBar from "@/components/find/ColorFilterBar";
import { LoadError } from "@/components/find/LoadError";
import { StartingPoints } from "@/components/find/StartingPoints";
import { useColorFilterParam } from "@/components/find/useColorFilterParam";
import { usePhotoParam } from "@/components/find/usePhotoParam";
import {
  readSearchPage,
  readSearchTotal,
  useSearchFeed,
  type SearchFeedPage,
} from "@/components/find/useSearchFeed";
import { asString, readJsonObject } from "@/hooks/apiJson";
import { formatCount } from "@/lib/albums";
import {
  filterAdjective,
  hasColorFilter,
  NO_COLOR_FILTER,
  setColorParams,
  type ColorFilter,
} from "@/lib/colors";

interface Results {
  photos: SearchFeedPage<Photo>;
  photoTotal: number;
  folders: SearchFeedPage<Folder>;
  folderTotal: number;
  /** The color filter the photos came with */
  colors: ColorFilter;
}

type State =
  | { status: "idle" }
  | { status: "loading"; q: string }
  | { status: "error"; q: string }
  /** `refreshing`: the photos are coming again for another color filter */
  | { status: "ready"; q: string; results: Results; refreshing: boolean };

/** How far below the viewport the next page of photos starts loading. */
const PREFETCH_MARGIN = "0px 0px 1600px 0px";
/** The viewer asks for the next page this many photos before the last one. */
const VIEWER_PREFETCH = 6;

function quoted(q: string) {
  return `«\u00a0${q}\u00a0»`;
}

const colorsKey = (colors: ColorFilter) =>
  `${colors.color ?? ""}|${colors.tone ?? ""}`;

function SearchContent() {
  const q = (useSearchParams().get("q") ?? "").trim();
  const [colors, setColors] = useColorFilterParam();
  const [selectedPhotoId, setPhotoParam] = usePhotoParam();
  const [state, setState] = useState<State>(() =>
    q ? { status: "loading", q } : { status: "idle" },
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!q) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    // Another color for the same words: the folders stay, the photos reload.
    setState((s) =>
      s.status === "ready" && s.q === q
        ? { ...s, refreshing: true }
        : { status: "loading", q },
    );
    const params = setColorParams(new URLSearchParams({ q }), colors);
    fetch(`/api/search?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await readJsonObject(response);
        if (!response.ok || !data.success)
          throw new Error(asString(data.error));
        const photos = readSearchPage<Photo>(data, "photos");
        const folders = readSearchPage<Folder>(data, "folders");
        setState({
          status: "ready",
          q,
          refreshing: false,
          results: {
            photos,
            photoTotal: readSearchTotal(data, "photos", photos.items.length),
            folders,
            folderTotal: readSearchTotal(data, "folders", folders.items.length),
            colors,
          },
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error", q });
      });
    return () => {
      controller.abort();
    };
  }, [q, colors, attempt]);

  if (state.status === "idle") {
    return (
      <>
        <PageHeader title="Rechercher" />
        <StartingPoints />
      </>
    );
  }

  const header = <PageHeader title={quoted(state.q)} />;

  if (state.status === "error") {
    return (
      <>
        {header}
        <LoadError
          title="La recherche n'a pas abouti"
          onRetry={() => {
            setAttempt((n) => n + 1);
          }}
        />
      </>
    );
  }

  if (state.status === "loading") {
    return (
      <>
        {header}
        <div aria-live="polite" className="sr-only">
          Recherche en cours
        </div>
        <Section title="Dossiers">
          <AlbumGridSkeleton count={4} />
        </Section>
        <Section title="Photos">
          <PhotoGridSkeleton count={8} />
        </Section>
      </>
    );
  }

  return (
    <>
      {header}
      <ResultsView
        key={`${state.q}\n${attempt}`}
        q={state.q}
        results={state.results}
        refreshing={state.refreshing}
        colors={colors}
        onColorsChange={setColors}
        selectedPhotoId={selectedPhotoId}
        onPhotoUrlChange={setPhotoParam}
      />
    </>
  );
}

function ResultsView({
  q,
  results,
  refreshing,
  colors,
  onColorsChange,
  selectedPhotoId,
  onPhotoUrlChange,
}: {
  q: string;
  results: Results;
  refreshing: boolean;
  /** The filter in the URL; `results.colors` until the photos for it come */
  colors: ColorFilter;
  onColorsChange: (next: ColorFilter) => void;
  selectedPhotoId: string | null;
  onPhotoUrlChange: (id: string | null) => void;
}) {
  const folders = useSearchFeed(
    q,
    "folders",
    results.folders,
    results.folderTotal,
  );

  const words = useMemo(
    () => Array.from(new Set(q.split(/\s+/).filter((w) => w.length > 1))),
    [q],
  );

  const filtered = hasColorFilter(results.colors);
  if (
    folders.feed.items.length === 0 &&
    results.photoTotal === 0 &&
    !filtered &&
    !refreshing
  ) {
    return (
      <EmptyState
        icon={SearchX}
        title="Aucun résultat"
        body={
          words.length > 1 ? (
            <>
              Essayez un seul mot{"\u00a0: "}
              {words.map((w, i) => (
                <span key={w}>
                  {i > 0 && ", "}
                  <Link
                    href={`/search?q=${encodeURIComponent(w)}`}
                    className="font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
                  >
                    {quoted(w)}
                  </Link>
                </span>
              ))}
              .
            </>
          ) : (
            "Essayez un lieu, un prénom ou une année."
          )
        }
        action={
          <ButtonLink href="/" variant="secondary" icon={Library}>
            Ouvrir la bibliothèque
          </ButtonLink>
        }
        className="pt-10"
      />
    );
  }

  return (
    <>
      {folders.feed.items.length > 0 && (
        <Section
          title="Dossiers"
          action={<Count n={folders.feed.total} one="dossier" />}
        >
          <AlbumGrid folders={folders.feed.items} showPath eagerCount={8} />
          {folders.feed.next && (
            <div className="mt-8 flex flex-col items-center gap-3 text-center">
              {folders.feed.phase === "more-error" && (
                <p className="text-sm text-ink-muted">
                  Les dossiers suivants n&apos;ont pas pu être chargés.
                </p>
              )}
              <Button
                variant="secondary"
                icon={
                  folders.feed.phase === "more-error" ? RotateCw : undefined
                }
                loading={folders.feed.phase === "more"}
                onClick={() => {
                  folders.loadMore(true);
                }}
              >
                {folders.feed.phase === "more-error"
                  ? "Réessayer"
                  : "Afficher plus"}
              </Button>
            </div>
          )}
        </Section>
      )}

      {(results.photoTotal > 0 || filtered || refreshing) && (
        <Section
          title="Photos"
          action={!refreshing && <Count n={results.photoTotal} one="photo" />}
        >
          <ColorFilterBar
            filter={colors}
            onChange={onColorsChange}
            className="mb-4"
          />
          {refreshing ? (
            <PhotoGridSkeleton count={8} />
          ) : (
            <PhotoResults
              key={colorsKey(results.colors)}
              q={q}
              colors={results.colors}
              first={results.photos}
              total={results.photoTotal}
              selectedPhotoId={selectedPhotoId}
              onPhotoUrlChange={onPhotoUrlChange}
              onClearColors={() => {
                onColorsChange(NO_COLOR_FILTER);
              }}
            />
          )}
        </Section>
      )}
    </>
  );
}

/** The photos of one search and one color filter, a page at a time. */
function PhotoResults({
  q,
  colors,
  first,
  total,
  selectedPhotoId,
  onPhotoUrlChange,
  onClearColors,
}: {
  q: string;
  colors: ColorFilter;
  first: SearchFeedPage<Photo>;
  total: number;
  selectedPhotoId: string | null;
  onPhotoUrlChange: (id: string | null) => void;
  onClearColors: () => void;
}) {
  const photos = useSearchFeed(q, "photos", first, total, colors);
  const loadMorePhotos = photos.loadMore;
  const { phase: photoPhase, next: nextPhotos } = photos.feed;

  // Scrolling near the end of the grid brings the next page.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || photoPhase !== "ready" || !nextPhotos) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) loadMorePhotos();
      },
      { rootMargin: PREFETCH_MARGIN },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [photoPhase, nextPhotos, loadMorePhotos]);

  // The viewer walks every loaded photo: near the last one, fetch the next page.
  const photoCount = photos.feed.items.length;
  const selectedIndex = selectedPhotoId
    ? photos.feed.items.findIndex((p) => String(p.id) === selectedPhotoId)
    : -1;
  useEffect(() => {
    if (selectedIndex !== -1 && selectedIndex >= photoCount - VIEWER_PREFETCH)
      loadMorePhotos();
  }, [selectedIndex, photoCount, photoPhase, loadMorePhotos]);

  if (photoCount === 0) {
    return (
      <EmptyState
        title={`Aucune photo ${filterAdjective(colors)} pour cette recherche`}
        action={
          <Button variant="secondary" icon={RotateCcw} onClick={onClearColors}>
            Toutes les couleurs
          </Button>
        }
        className="py-10"
      />
    );
  }

  return (
    <>
      <PhotoGrid
        photos={photos.feed.items}
        total={photos.feed.total}
        selectedPhotoId={selectedPhotoId}
        onPhotoUrlChange={onPhotoUrlChange}
        onPhotoDeleted={(deleted) => {
          photos.remove(deleted.id);
        }}
        eagerCount={12}
      />

      <div ref={sentinel} aria-hidden />

      {photoPhase === "more" && (
        <div className="mt-1">
          <PhotoGridSkeleton count={8} />
        </div>
      )}

      {photoPhase === "more-error" && (
        <div className="flex flex-col items-center gap-3 py-12 text-center text-sm text-ink-muted">
          <p>Les photos suivantes n&apos;ont pas pu être chargées.</p>
          <Button
            variant="secondary"
            size="sm"
            icon={RotateCw}
            onClick={() => {
              loadMorePhotos(true);
            }}
          >
            Réessayer
          </Button>
        </div>
      )}
    </>
  );
}

function Count({ n, one }: { n: number; one: string }) {
  return (
    <span className="tabular text-sm text-ink-muted">
      {formatCount(n, one)}
    </span>
  );
}

export default function SearchPage() {
  return (
    <AppLayout>
      <ProtectedRoute>
        <Suspense fallback={<PageSkeleton />}>
          <SearchContent />
        </Suspense>
      </ProtectedRoute>
    </AppLayout>
  );
}
