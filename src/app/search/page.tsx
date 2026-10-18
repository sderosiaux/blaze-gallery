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
import FaceThumb from "@/components/people/FaceThumb";
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
import { QueryChips, type UnderstoodPart } from "@/components/find/QueryChips";
import { StartingPoints } from "@/components/find/StartingPoints";
import { useColorFilterParam } from "@/components/find/useColorFilterParam";
import { usePhotoParam } from "@/components/find/usePhotoParam";
import {
  readFilteredPage,
  readSearchPage,
  readSearchTotal,
  readSemanticPage,
  searchListSource,
  searchParamsOf,
  useSearchFeed,
  type FeedSource,
  type SearchFeed,
  type SearchFeedPage,
} from "@/components/find/useSearchFeed";
import { asString, isRecord, readJsonObject } from "@/hooks/apiJson";
import { formatCount } from "@/lib/albums";
import {
  filterAdjective,
  hasColorFilter,
  NO_COLOR_FILTER,
  type ColorFilter,
} from "@/lib/colors";
import { isStopword, removeParts } from "@/lib/searchQuery";

type SemanticStatus = "ok" | "unavailable" | "not_indexed";

interface PersonMatch {
  id: number;
  name: string;
  photo_count: number;
  cover_face_id: number | null;
}

/** How /api/search read the query (`understood`) */
interface Understood {
  parts: UnderstoodPart[];
  /** The words left for the content, as typed */
  text: string | null;
  /** What the photos were ranked by; null when only filters remain */
  content: string | null;
}

interface Results {
  photos: SearchFeedPage<Photo>;
  photoTotal: number;
  folders: SearchFeedPage<Folder>;
  folderTotal: number;
  semantic: SearchFeedPage<Photo>;
  semanticStatus: SemanticStatus;
  /** The photos the understood filters keep, when nothing ranked them */
  filtered: SearchFeedPage<Photo>;
  understood: Understood;
  people: PersonMatch[];
  /** The color filter of the URL the photos came with */
  colors: ColorFilter;
}

type State<R> =
  | { status: "idle" }
  | { status: "loading"; key: string }
  | { status: "error"; key: string }
  /** `refreshing`: the same key is being fetched again with other parameters */
  | { status: "ready"; key: string; results: R; refreshing: boolean };

/** How far below the viewport the next page of photos starts loading. */
const PREFETCH_MARGIN = "0px 0px 1600px 0px";
/** The viewer asks for the next page this many photos before the last one. */
const VIEWER_PREFETCH = 6;

function quoted(q: string) {
  return `«\u00a0${q}\u00a0»`;
}

const colorsKey = (colors: ColorFilter) =>
  `${colors.color ?? ""}|${colors.tone ?? ""}`;

function readSemanticStatus(data: Record<string, unknown>): SemanticStatus {
  const status = isRecord(data.semantic) ? data.semantic.status : undefined;
  return status === "ok" || status === "not_indexed" ? status : "unavailable";
}

function readUnderstood(data: Record<string, unknown>, q: string): Understood {
  const understood = isRecord(data.understood) ? data.understood : {};
  const { parts, text, content } = understood;
  return {
    parts: (Array.isArray(parts) ? parts : []) as UnderstoodPart[],
    text: typeof text === "string" ? text : null,
    content: typeof content === "string" || content === null ? content : q,
  };
}

/**
 * The colors the photos are narrowed to: the color bar's (the URL), else
 * those the query says ("photos rouges").
 */
function effectiveColors(
  url: ColorFilter,
  parts: UnderstoodPart[],
): ColorFilter {
  return {
    color: url.color ?? parts.find((p) => p.kind === "color")?.color ?? null,
    tone: url.tone ?? parts.find((p) => p.kind === "tone")?.tone ?? null,
  };
}

/** A new search entry in the history: the query and the color bar's filter. */
function pushSearch(q: string, colors: ColorFilter) {
  const params = new URLSearchParams(searchParamsOf(q, colors));
  window.history.pushState(
    null,
    "",
    q === "" ? "/search" : `/search?${params.toString()}`,
  );
}

/**
 * Fetches `url` whenever it changes (or on retry) and reads the response; an
 * empty key is the idle state. A new url for the same key (another color
 * filter for the same words) keeps the results shown while it loads.
 */
function useSearchRequest<R>(
  key: string,
  url: string,
  read: (data: Record<string, unknown>) => R,
) {
  const [state, setState] = useState<State<R>>(() =>
    key ? { status: "loading", key } : { status: "idle" },
  );
  const [attempt, setAttempt] = useState(0);
  const readRef = useRef(read);
  readRef.current = read;

  useEffect(() => {
    if (!key) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    setState((s) =>
      s.status === "ready" && s.key === key
        ? { ...s, refreshing: true }
        : { status: "loading", key },
    );
    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        const data = await readJsonObject(response);
        if (!response.ok || !data.success)
          throw new Error(asString(data.error));
        setState({
          status: "ready",
          key,
          results: readRef.current(data),
          refreshing: false,
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error", key });
      });
    return () => {
      controller.abort();
    };
  }, [key, url, attempt]);

  return {
    state,
    attempt,
    retry: () => {
      setAttempt((n) => n + 1);
    },
  };
}

function SearchContent() {
  const params = useSearchParams();
  return <QueryContent q={(params.get("q") ?? "").trim()} />;
}

function QueryContent({ q }: { q: string }) {
  const [colors, setColors] = useColorFilterParam();
  const [selectedPhotoId, setPhotoParam] = usePhotoParam();
  const { state, attempt, retry } = useSearchRequest(
    q,
    `/api/search?${new URLSearchParams(searchParamsOf(q, colors)).toString()}`,
    (data): Results => {
      const photos = readSearchPage<Photo>(data, "photos");
      const folders = readSearchPage<Folder>(data, "folders");
      return {
        photos,
        photoTotal: readSearchTotal(data, "photos", photos.items.length),
        folders,
        folderTotal: readSearchTotal(data, "folders", folders.items.length),
        semantic: readSemanticPage<Photo>(data),
        semanticStatus: readSemanticStatus(data),
        filtered: readFilteredPage<Photo>(data),
        understood: readUnderstood(data, q),
        people: (Array.isArray(data.people)
          ? data.people
          : []) as PersonMatch[],
        colors,
      };
    },
  );
  const parts = state.status === "ready" ? state.results.understood.parts : [];

  // The bar shows the query's color too; changing it takes that word out
  const changeColors = (next: ColorFilter) => {
    const colorPart = parts.find((p) => p.kind === "color");
    const tonePart = parts.find((p) => p.kind === "tone");
    const dropped = [
      colorPart && next.color !== colorPart.color ? colorPart : null,
      tonePart && next.tone !== tonePart.tone ? tonePart : null,
    ].filter((part) => part !== null);
    const url: ColorFilter = {
      color: colorPart && !dropped.includes(colorPart) ? null : next.color,
      tone: tonePart && !dropped.includes(tonePart) ? null : next.tone,
    };
    if (dropped.length === 0) setColors(url);
    else pushSearch(removeParts(q, dropped), url);
  };

  if (state.status === "idle") {
    return (
      <>
        <PageHeader title="Rechercher" />
        <StartingPoints />
      </>
    );
  }

  const header = (
    <PageHeader title={quoted(state.key)}>
      {state.status === "ready" && (
        <QueryChips
          parts={parts}
          text={state.results.understood.text}
          onRemove={(part) => {
            pushSearch(removeParts(q, [part]), colors);
          }}
          className="mt-5"
        />
      )}
    </PageHeader>
  );

  if (state.status === "error") {
    return (
      <>
        {header}
        <LoadError title="La recherche n'a pas abouti" onRetry={retry} />
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
        key={`${state.key}\n${attempt}`}
        q={state.key}
        results={state.results}
        refreshing={state.refreshing}
        colors={effectiveColors(colors, parts)}
        onColorsChange={changeColors}
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
  /** The filter in effect, the URL's or the query's; the photos' until those for it come */
  colors: ColorFilter;
  onColorsChange: (next: ColorFilter) => void;
  selectedPhotoId: string | null;
  onPhotoUrlChange: (id: string | null) => void;
}) {
  const folders = useSearchFeed(
    searchListSource<Folder>(q, "folders"),
    results.folders,
    results.folderTotal,
  );

  // Suggested alone, stopwords find nothing a person means: only the words that carry the query are offered
  const words = useMemo(
    () =>
      Array.from(
        new Set(q.split(/\s+/).filter((w) => w.length > 1 && !isStopword(w))),
      ),
    [q],
  );

  const { content } = results.understood;
  const understood = results.understood.parts.length > 0;
  const notice =
    results.semanticStatus === "unavailable" && content !== null
      ? understood
        ? `La recherche par le contenu des photos ne répond pas pour l'instant : photos non triées selon ${quoted(content)}.`
        : "La recherche par le contenu des photos ne répond pas pour l'instant : résultats par nom de dossier et de fichier."
      : results.semanticStatus === "not_indexed"
        ? "Les photos sont en cours d'analyse ; la recherche par le contenu arrive bientôt."
        : null;
  const noticeLine = notice && (
    <p className="mt-2 text-sm text-ink-muted" role="status">
      {notice}
    </p>
  );

  const narrowed = hasColorFilter(colors) || understood;
  const hasPhotos =
    results.semantic.items.length > 0 ||
    results.filtered.items.length > 0 ||
    results.photoTotal > 0;
  if (
    folders.feed.items.length === 0 &&
    !hasPhotos &&
    results.people.length === 0 &&
    !narrowed &&
    !refreshing
  ) {
    return (
      <>
        {noticeLine}
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
      </>
    );
  }

  return (
    <>
      {noticeLine}

      {results.people.length > 0 && <PeopleRow people={results.people} />}

      {folders.feed.items.length > 0 && (
        <Section
          title="Dossiers"
          action={<Count n={folders.feed.total} one="dossier" />}
        >
          <AlbumGrid folders={folders.feed.items} showPath eagerCount={8} />
          {folders.feed.next && (
            <MoreButton
              phase={folders.feed.phase}
              failed="Les dossiers suivants n'ont pas pu être chargés."
              onClick={() => {
                folders.loadMore(true);
              }}
            />
          )}
        </Section>
      )}

      {(hasPhotos || narrowed || refreshing) && (
        <Section title="Photos">
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
              results={results}
              colors={colors}
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

/** The search's photo lists that can hold the open photo. */
type PhotoList = "semantic" | "filtered" | "names";

/**
 * The photos of one search and one color filter: those showing what the
 * query describes, ranked (or, with nothing to rank by, those its filters
 * keep), then those whose file or folder name matches.
 */
function PhotoResults({
  q,
  results,
  colors: shownColors,
  selectedPhotoId,
  onPhotoUrlChange,
  onClearColors,
}: {
  q: string;
  results: Results;
  /** The filter in effect, the URL's or the query's */
  colors: ColorFilter;
  selectedPhotoId: string | null;
  onPhotoUrlChange: (id: string | null) => void;
  onClearColors: () => void;
}) {
  // Later pages repeat the URL's filter: the server reads the query's again
  const { colors } = results;
  const photos = useSearchFeed(
    searchListSource<Photo>(q, "photos", colors),
    results.photos,
    results.photoTotal,
  );
  const semanticSource: FeedSource<Photo> = {
    params: searchParamsOf(q, colors),
    after: "semantic_after",
    read: readSemanticPage,
  };
  // Ranked pages have no total: the feed counts what it has loaded.
  const semantic = useSearchFeed(
    semanticSource,
    results.semantic,
    results.semantic.items.length,
  );
  const filteredSource: FeedSource<Photo> = {
    params: searchParamsOf(q, colors),
    after: "filtered_after",
    read: readFilteredPage,
  };
  const filtered = useSearchFeed(
    filteredSource,
    results.filtered,
    results.filtered.items.length,
  );

  // A photo can be in two lists: only the list it was opened from shows it.
  const [opener, setOpener] = useState<PhotoList | null>(null);
  const holds = (feed: SearchFeed<Photo>) =>
    feed.items.some((p) => String(p.id) === selectedPhotoId);
  const viewerList: PhotoList | null = !selectedPhotoId
    ? null
    : (opener ??
      (holds(semantic.feed)
        ? "semantic"
        : holds(filtered.feed)
          ? "filtered"
          : "names"));
  const urlChangeFrom = (list: PhotoList) => (id: string | null) => {
    setOpener(id ? list : null);
    onPhotoUrlChange(id);
  };

  const showSemantic = semantic.feed.items.length > 0;
  const showFiltered = filtered.feed.items.length > 0;
  const showNames = photos.feed.items.length > 0;
  if (!showSemantic && !showFiltered && !showNames) {
    return hasColorFilter(shownColors) ? (
      <EmptyState
        title={`Aucune photo ${filterAdjective(shownColors)} pour cette recherche`}
        action={
          <Button variant="secondary" icon={RotateCcw} onClick={onClearColors}>
            Toutes les couleurs
          </Button>
        }
        className="py-10"
      />
    ) : (
      <EmptyState
        title="Aucune photo pour cette recherche"
        body="Retirez un filtre pour élargir."
        className="py-10"
      />
    );
  }
  // The last list of the page brings its next pages by scrolling
  const mainMore = showNames ? "button" : "scroll";

  const names = showNames && (
    <PhotoFeed
      feed={photos.feed}
      loadMore={photos.loadMore}
      remove={photos.remove}
      selectedPhotoId={viewerList === "names" ? selectedPhotoId : null}
      onPhotoUrlChange={urlChangeFrom("names")}
      more="scroll"
    />
  );

  return (
    <>
      {showSemantic && (
        <PhotoFeed
          feed={semantic.feed}
          loadMore={semantic.loadMore}
          remove={semantic.remove}
          selectedPhotoId={viewerList === "semantic" ? selectedPhotoId : null}
          onPhotoUrlChange={urlChangeFrom("semantic")}
          more={mainMore}
        />
      )}
      {showFiltered && (
        <PhotoFeed
          feed={filtered.feed}
          loadMore={filtered.loadMore}
          remove={filtered.remove}
          selectedPhotoId={viewerList === "filtered" ? selectedPhotoId : null}
          onPhotoUrlChange={urlChangeFrom("filtered")}
          more={mainMore}
        />
      )}
      {(showSemantic || showFiltered) && showNames ? (
        <Section
          title="Noms de fichiers et dossiers"
          action={<Count n={photos.feed.total} one="photo" />}
        >
          {names}
        </Section>
      ) : (
        names
      )}
    </>
  );
}

/**
 * One photo list with its next pages: brought by scrolling near its end
 * (the last list of the page) or by a button (a list with others below it),
 * and by the viewer reaching its last photos either way.
 */
function PhotoFeed({
  feed,
  loadMore,
  remove,
  selectedPhotoId,
  onPhotoUrlChange,
  more,
}: {
  feed: SearchFeed<Photo>;
  loadMore: (retry?: boolean) => void;
  remove: (id: number | string) => void;
  selectedPhotoId: string | null;
  onPhotoUrlChange: (id: string | null) => void;
  more: "scroll" | "button";
}) {
  const { phase, next, items } = feed;

  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (more !== "scroll" || !el || phase !== "ready" || !next) return;
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
  }, [more, phase, next, loadMore]);

  const count = items.length;
  const selectedIndex = selectedPhotoId
    ? items.findIndex((p) => String(p.id) === selectedPhotoId)
    : -1;
  useEffect(() => {
    if (selectedIndex !== -1 && selectedIndex >= count - VIEWER_PREFETCH)
      loadMore();
  }, [selectedIndex, count, phase, loadMore]);

  return (
    <>
      <PhotoGrid
        photos={items}
        total={feed.total}
        selectedPhotoId={selectedPhotoId}
        onPhotoUrlChange={onPhotoUrlChange}
        onPhotoDeleted={(deleted) => {
          remove(deleted.id);
        }}
        eagerCount={12}
      />

      {more === "button" ? (
        next && (
          <MoreButton
            phase={phase}
            failed="Les photos suivantes n'ont pas pu être chargées."
            onClick={() => {
              loadMore(true);
            }}
          />
        )
      ) : (
        <>
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
        </>
      )}
    </>
  );
}

function MoreButton({
  phase,
  failed,
  onClick,
}: {
  phase: SearchFeed<unknown>["phase"];
  failed: string;
  onClick: () => void;
}) {
  return (
    <div className="mt-8 flex flex-col items-center gap-3 text-center">
      {phase === "more-error" && (
        <p className="text-sm text-ink-muted">{failed}</p>
      )}
      <Button
        variant="secondary"
        icon={phase === "more-error" ? RotateCw : undefined}
        loading={phase === "more"}
        onClick={onClick}
      >
        {phase === "more-error" ? "Réessayer" : "Afficher plus"}
      </Button>
    </div>
  );
}

/** Named people the query is about, each leading to their page (/personnes). */
function PeopleRow({ people }: { people: PersonMatch[] }) {
  return (
    <section aria-label="Personnes" className="pt-8">
      <ul className="flex flex-wrap gap-3">
        {people.map((person) => (
          <li key={person.id}>
            <Link
              href={`/personnes/${person.id}`}
              className="flex items-center gap-3 rounded-full border border-line bg-surface py-1.5 pl-1.5 pr-5 transition-colors hover:border-line-strong hover:bg-surface-sunken"
            >
              <FaceThumb
                faceId={person.cover_face_id}
                className="h-10 w-10 rounded-full"
              />
              <span className="flex flex-col leading-tight">
                <span className="font-medium text-ink">{person.name}</span>
                <span className="tabular text-xs text-ink-muted">
                  {formatCount(person.photo_count, "photo")}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
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
