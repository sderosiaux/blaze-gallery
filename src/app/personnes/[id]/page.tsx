"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  ImageOff,
  RotateCcw,
  RotateCw,
  SearchX,
  UsersRound,
} from "lucide-react";
import type { Photo } from "@/types";
import type { PersonPhoto, PersonRow } from "@/lib/people";
import AppLayout from "@/components/AppLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import PhotoViewer from "@/components/PhotoViewer";
import { usePhotoSlots } from "@/hooks/usePhotoSlots";
import { PhotoGridSkeleton } from "@/components/PhotoGrid";
import JustifiedGrid from "@/components/photos/JustifiedGrid";
import PhotoTile from "@/components/photos/PhotoTile";
import FaceThumb from "@/components/people/FaceThumb";
import ReviewQueue from "@/components/people/ReviewQueue";
import { usePersonPhotos } from "@/components/people/usePersonPhotos";
import {
  Button,
  ButtonLink,
  EmptyState,
  MetaDot,
  PageHeader,
  PageSkeleton,
  Tabs,
  useToast,
} from "@/components/ui";
import ColorFilterBar from "@/components/find/ColorFilterBar";
import { FilterNotice } from "@/components/find/FilterNotice";
import FilterBar from "@/components/find/FilterBar";
import { EXPRESSION_ICONS } from "@/components/find/filterIcons";
import { LoadError } from "@/components/find/LoadError";
import { YearPicker, YearRail } from "@/components/find/YearIndex";
import { setFavorite } from "@/components/find/favorites";
import { usePhotoParam } from "@/components/find/usePhotoParam";
import { useUrlFilter } from "@/components/find/useUrlFilter";
import { asArray, isRecord, readJsonObject } from "@/hooks/apiJson";
import { formatCount } from "@/lib/albums";
import { cn } from "@/lib/cn";
import { ageOn } from "@/lib/faces";
import { applyPhotoPatch, type PhotoPatch } from "@/lib/photoPatch";
import {
  EXPRESSION_LABELS,
  filterKey,
  filterSearch,
  hasUrlFilter,
  isExpression,
  NO_URL_FILTER,
  type Expression,
} from "@/lib/photoFilter";

type Tab = "photos" | "a-trier";

/** A year counts as the one being read once its heading passes this line. */
const SPY_LINE = 160;
/** How far below the viewport the next page starts loading. */
const PREFETCH_MARGIN = "0px 0px 1600px 0px";

interface YearGroup {
  key: string;
  year: number | null;
  photos: PersonPhoto[];
}

function byYear(photos: PersonPhoto[]): YearGroup[] {
  const groups = new Map<string, YearGroup>();
  for (const photo of photos) {
    const year = photo.taken ? new Date(photo.taken).getUTCFullYear() : null;
    const key = year === null ? "undated" : String(year);
    const group = groups.get(key) ?? { key, year, photos: [] };
    group.photos.push(photo);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** "6 ans", "6–7 ans" over a year; nothing while the birth date is unknown. */
function ageLabel(birthDate: string | null, group: YearGroup): string | null {
  // The group runs newest first: its last photo is the earliest
  const first = group.photos[group.photos.length - 1]?.taken;
  const last = group.photos[0]?.taken;
  if (!birthDate || !first || !last) return null;
  const from = ageOn(birthDate, first);
  const to = ageOn(birthDate, last);
  if (from === null || to === null) return null;
  const unit = (n: number) => (n <= 1 ? "an" : "ans");
  return from === to
    ? `${String(from)} ${unit(from)}`
    : `${String(from)}–${String(to)} ${unit(to)}`;
}

function YearSection({
  group,
  birthDate,
  count,
  onOpen,
  onToggleFavorite,
  onReplace,
}: {
  group: YearGroup;
  birthDate: string | null;
  /** Photos of the year, loaded or not */
  count: number;
  onOpen: (photo: Photo) => void;
  onToggleFavorite: (photo: Photo) => void;
  /** A tile's photo went to the Corbeille: what its slot shows now */
  onReplace: (id: Photo["id"], next: Photo | null) => void;
}) {
  const age = ageLabel(birthDate, group);
  const headingId = `year-${group.key}`;
  return (
    <section
      aria-labelledby={headingId}
      data-year={group.year ?? undefined}
      className="scroll-mt-[calc(var(--topbar-height)+1rem)] pt-10 first:pt-2"
    >
      <header className="mb-4 flex items-baseline gap-3 border-b border-line pb-3">
        <h2
          id={headingId}
          className="font-display text-display-sm font-semibold text-ink"
        >
          {group.year ?? "Sans date"}
        </h2>
        {age && <span className="text-sm text-ink-muted">{age}</span>}
        <span className="tabular ml-auto text-sm text-ink-muted">
          {formatCount(count, "photo")}
        </span>
      </header>
      <JustifiedGrid
        photos={group.photos}
        renderTile={(photo, size) => (
          <PhotoTile
            photo={photo}
            width={size.width}
            height={size.height}
            onOpen={onOpen}
            onToggleFavorite={onToggleFavorite}
            onReplace={onReplace}
          />
        )}
      />
    </section>
  );
}

function PersonContent() {
  const params = useParams();
  const search = useSearchParams();
  const toast = useToast();
  const rawId = typeof params.id === "string" ? params.id : "";
  const personId = /^\d+$/.test(rawId) ? Number(rawId) : null;
  const tab: Tab = search.get("tab") === "a-trier" ? "a-trier" : "photos";
  const yearParam = search.get("year");
  const startYear =
    yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : null;
  const [selectedPhotoId, setPhotoParam] = usePhotoParam();
  const [filter, setFilter] = useUrlFilter();
  const key = filterKey(filter);

  const [status, setStatus] = useState<
    "loading" | "ready" | "error" | "missing"
  >("loading");
  const [person, setPerson] = useState<PersonRow | null>(null);
  const [looks, setLooks] = useState<Expression[]>([]);
  const [pending, setPending] = useState(0);
  const [cover, setCover] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const stale = useRef(false);

  const load = useCallback(async () => {
    if (personId === null) {
      setStatus("missing");
      return;
    }
    try {
      const [detail, list] = await Promise.all([
        fetch(`/api/people/${String(personId)}`),
        fetch("/api/people"),
      ]);
      if (detail.status === 404) {
        setStatus("missing");
        return;
      }
      const data = await readJsonObject(detail);
      if (!detail.ok || data.success !== true || !isRecord(data.person))
        throw new Error(`HTTP ${detail.status}`);
      setPerson(data.person as unknown as PersonRow);
      setLooks(asArray(data.expressions).filter(isExpression));
      const people = asArray((await readJsonObject(list)).people);
      const me = people.find((p) => isRecord(p) && p.id === personId);
      setPending(
        isRecord(me) && typeof me.pending_count === "number"
          ? me.pending_count
          : 0,
      );
      setCover(
        isRecord(me) && typeof me.cover_face_id === "number"
          ? me.cover_face_id
          : null,
      );
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [personId]);

  useEffect(() => {
    void load();
  }, [load]);

  const { feed, setFeed, loadMore } = usePersonPhotos(
    personId,
    filter,
    key,
    startYear,
    attempt,
    selectedPhotoId,
  );
  const refresh = useCallback(() => {
    stale.current = false;
    setAttempt((n) => n + 1);
  }, []);

  const switchTab = (next: Tab) => {
    const url = new URL(window.location.href);
    if (next === "photos") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url.pathname + url.search);
    // Faces taken in the queue show up in the photos
    if (next === "photos" && stale.current) refresh();
  };

  // -- viewer ---------------------------------------------------------------
  const [viewerList, setViewerList] = useState<Photo[] | null>(null);
  // A photo sent to the Corbeille leaves its slot, or gives it to the next of its stack
  const slots = usePhotoSlots(feed.items);
  const items = slots.items;
  const list = viewerList ?? items;
  const selected = selectedPhotoId
    ? (list.find((p) => String(p.id) === selectedPhotoId) ?? null)
    : null;

  const { patch: patchSlot } = slots;
  const patch = useCallback(
    (id: Photo["id"], changes: PhotoPatch) => {
      setFeed((f) => ({
        ...f,
        items: f.items.map((p) =>
          String(p.id) === String(id) ? applyPhotoPatch(p, changes) : p,
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

  const { replace: replaceSlot } = slots;
  const replace = useCallback(
    (id: Photo["id"], next: Photo | null) => {
      replaceSlot(id, next);
      stale.current = true;
    },
    [replaceSlot],
  );

  const openFromGrid = useCallback(
    (photo: Photo) => {
      setViewerList(null);
      setPhotoParam(String(photo.id));
    },
    [setPhotoParam],
  );
  const openFromQueue = useCallback(
    (photo: Photo, queue: Photo[]) => {
      setViewerList(queue);
      setPhotoParam(String(photo.id));
    },
    [setPhotoParam],
  );
  const closeViewer = () => {
    setPhotoParam(null);
    if (stale.current && tab === "photos") refresh();
  };

  const onQueueChange = useCallback((remaining: number) => {
    setPending(Math.max(0, remaining));
    stale.current = true;
  }, []);

  // Scrolling near the end brings the next page, so does the viewer
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || feed.phase !== "ready" || !feed.next || tab !== "photos") return;
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
  }, [feed.phase, feed.next, loadMore, tab]);
  const selectedIndex =
    selected && viewerList === null
      ? items.indexOf(selected as PersonPhoto)
      : -1;
  useEffect(() => {
    if (selectedIndex !== -1 && selectedIndex >= items.length - 6) loadMore();
  }, [selectedIndex, items.length, feed.phase, loadMore]);

  const groups = useMemo(() => byYear(items), [items]);

  // The year index of Chronologie over every photo of the list, loaded or not
  const years = useMemo(
    () => feed.years.flatMap((y) => (y.year === null ? [] : [y.year])),
    [feed.years],
  );
  const yearCounts = useMemo(
    () =>
      new Map(
        feed.years.flatMap((y) =>
          y.year === null ? [] : [[String(y.year), y.count] as const],
        ),
      ),
    [feed.years],
  );
  const [activeYear, setActiveYear] = useState<number | null>(null);
  useEffect(() => {
    if (tab !== "photos") return;
    let frame = 0;
    const update = () => {
      frame = 0;
      let current: number | null = null;
      for (const section of Array.from(
        document.querySelectorAll<HTMLElement>("[data-year]"),
      )) {
        if (section.getBoundingClientRect().top > SPY_LINE) break;
        current = Number(section.dataset.year);
      }
      setActiveYear(current ?? groups[0]?.year ?? null);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
    };
  }, [groups, tab]);
  const jumpToYear = useCallback(
    (year: number) => {
      const section = document.querySelector(`[data-year="${String(year)}"]`);
      if (section) {
        section.scrollIntoView({ block: "start" });
        return;
      }
      // Not loaded yet: the list starts at that year
      window.scrollTo({ top: 0 });
      const url = new URL(window.location.href);
      if (years[0] === year) url.searchParams.delete("year");
      else url.searchParams.set("year", String(year));
      window.history.pushState(null, "", url.pathname + url.search);
    },
    [years],
  );
  const noMonths = useCallback(() => undefined, []);

  if (status === "missing") {
    return (
      <EmptyState
        icon={UsersRound}
        title="Cette personne n’existe pas"
        action={
          <ButtonLink href="/personnes" variant="secondary" icon={ArrowLeft}>
            Toutes les personnes
          </ButtonLink>
        }
        className="py-20"
      />
    );
  }
  if (status === "error") {
    return (
      <LoadError
        title="Cette personne n’a pas pu être chargée"
        onRetry={() => void load()}
        className="pt-10"
      />
    );
  }
  if (status === "loading" || !person) return <PageSkeleton />;

  const name = person.name ?? "Sans nom";
  const dated = feed.years.flatMap((y) => (y.year === null ? [] : [y.year]));
  const firstYear = dated[dated.length - 1] ?? null;
  const lastYear = dated[0] ?? null;
  const filtered = hasUrlFilter(filter);
  const own = { id: person.id, name };
  const toggleLook = (expression: Expression) => {
    const on = filter.faces.some(
      (f) => f.person === person.id && f.expression === expression,
    );
    setFilter({
      ...filter,
      faces: on
        ? filter.faces.filter(
            (f) => !(f.person === person.id && f.expression === expression),
          )
        : [...filter.faces, { person: person.id, expression }],
    });
  };
  const inTimeline = filterSearch({
    ...filter,
    people: filter.faces.some((f) => f.person === person.id)
      ? filter.people
      : [...filter.people.filter((id) => id !== person.id), person.id],
  });

  return (
    <>
      <PageHeader
        kicker={
          <Link
            href={`/personnes${filterSearch(filter)}`}
            className="transition-colors hover:text-ink"
          >
            Personnes
          </Link>
        }
        title={
          <span className="flex items-center gap-4">
            <FaceThumb
              faceId={cover}
              eager
              className="h-14 w-14 rounded-full ring-1 ring-line sm:h-16 sm:w-16"
            />
            <span className="min-w-0 truncate">{name}</span>
          </span>
        }
        meta={
          <>
            {feed.phase !== "loading" && (
              <span className="tabular">
                {formatCount(feed.total, "photo")}
              </span>
            )}
            {firstYear !== null && lastYear !== null && (
              <>
                <MetaDot />
                <span className="tabular">
                  {firstYear === lastYear
                    ? String(firstYear)
                    : `${String(firstYear)} – ${String(lastYear)}`}
                </span>
              </>
            )}
            <MetaDot />
            <Link
              href={`/timeline${inTimeline}`}
              className="text-ink-soft underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink hover:decoration-ink"
            >
              Dans la chronologie
            </Link>
          </>
        }
      />

      <Tabs<Tab>
        label={`Photos de ${name}`}
        value={tab}
        onChange={switchTab}
        tabs={[
          { id: "photos", label: "Photos", count: feed.total },
          { id: "a-trier", label: "À trier", count: pending },
        ]}
      />

      {tab === "photos" ? (
        <>
          <div className="mb-4 mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
            {looks.length > 0 && (
              <div
                role="group"
                aria-label={`Comment ${name} est sur les photos`}
                className="flex flex-wrap gap-1.5"
              >
                {looks.map((expression) => {
                  const Icon = EXPRESSION_ICONS[expression];
                  const pressed = filter.faces.some(
                    (f) =>
                      f.person === person.id && f.expression === expression,
                  );
                  return (
                    <button
                      key={expression}
                      type="button"
                      aria-pressed={pressed}
                      onClick={() => {
                        toggleLook(expression);
                      }}
                      className={cn(
                        "touch-target inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors duration-150",
                        pressed
                          ? "border-ink bg-ink text-paper"
                          : "border-line text-ink-soft hover:border-ink-muted hover:text-ink",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                      {EXPRESSION_LABELS[expression]}
                    </button>
                  );
                })}
              </div>
            )}
            <ColorFilterBar
              filter={filter.colors}
              onChange={(colors) => {
                setFilter({ ...filter, colors });
              }}
            />
          </div>
          <FilterBar
            filter={filter}
            onChange={setFilter}
            person={own}
            noChips={["color", "tone"]}
            noMenu={["color"]}
            className="mb-2"
          />
          <FilterNotice notes={feed.notes} />
          {feed.phase === "loading" ? (
            <div
              role="status"
              aria-label="Chargement des photos"
              className="pt-6"
            >
              <PhotoGridSkeleton count={12} />
            </div>
          ) : feed.phase === "error" ? (
            <LoadError
              title="Ses photos n’ont pas pu être chargées"
              onRetry={refresh}
              className="pt-10"
            />
          ) : feed.items.length === 0 ? (
            filtered || startYear ? (
              <EmptyState
                icon={SearchX}
                title={`Aucune photo de ${name} pour ce filtre`}
                action={
                  <Button
                    variant="secondary"
                    icon={RotateCcw}
                    onClick={() => {
                      setFilter(NO_URL_FILTER);
                    }}
                  >
                    Effacer le filtre
                  </Button>
                }
                className="py-16"
              />
            ) : (
              <EmptyState
                icon={ImageOff}
                title={`Aucune photo de ${name} pour l’instant`}
                body="Nommez son visage sur une photo (touche P dans la visionneuse) : les autres suivront."
                className="py-16"
              />
            )
          ) : (
            <>
              <div className="md:grid md:grid-cols-[minmax(0,1fr)_6rem] md:gap-8">
                <div className="min-w-0">
                  {groups.map((group) => (
                    <YearSection
                      key={group.key}
                      group={group}
                      birthDate={person.birth_date}
                      count={
                        feed.years.find((y) => y.year === group.year)?.count ??
                        group.photos.length
                      }
                      onOpen={openFromGrid}
                      onToggleFavorite={(photo) => void toggleFavorite(photo)}
                      onReplace={replace}
                    />
                  ))}
                  <div ref={sentinel} aria-hidden />
                  {feed.phase === "more" && (
                    <div className="mt-1">
                      <PhotoGridSkeleton count={8} />
                    </div>
                  )}
                  {feed.phase === "more-error" && (
                    <div className="flex flex-col items-center gap-3 py-12 text-center text-sm text-ink-muted">
                      <p>Les photos suivantes n’ont pas pu être chargées.</p>
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
                    counts={yearCounts}
                    active={activeYear}
                    activeYearMonths={[]}
                    activeMonth={null}
                    onJump={jumpToYear}
                    onJumpMonth={noMonths}
                  />
                )}
              </div>
              {years.length > 1 && (
                <YearPicker
                  years={years}
                  counts={yearCounts}
                  active={activeYear}
                  activeYearMonths={[]}
                  activeMonth={null}
                  onJump={jumpToYear}
                  onJumpMonth={noMonths}
                />
              )}
            </>
          )}
        </>
      ) : (
        <>
          {/* The queue is every face to review: the filter waits on Photos */}
          {filtered && (
            <p className="mt-6 flex flex-wrap items-center gap-x-1 text-sm text-ink-muted">
              Le filtre ne vaut que pour l’onglet Photos.
              <button
                type="button"
                onClick={() => {
                  setFilter(NO_URL_FILTER);
                }}
                className="touch-target inline-flex h-7 items-center rounded-full px-1 font-medium text-ink-soft underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink hover:decoration-ink"
              >
                Effacer le filtre
              </button>
            </p>
          )}
          <ReviewQueue
            personId={person.id}
            name={name}
            onChange={onQueueChange}
            onOpenPhoto={openFromQueue}
          />
        </>
      )}

      {selected && (
        <PhotoViewer
          photo={selected}
          photos={list}
          onClose={closeViewer}
          onPhotoChange={(photo) => {
            setPhotoParam(String(photo.id));
          }}
          onPhotoUpdate={patch}
          // The photos tab only: the review queue decides faces, not photos
          onPhotoReplace={viewerList === null ? replace : undefined}
          onFacesChange={() => {
            stale.current = true;
          }}
          showFaces={viewerList !== null}
        />
      )}
    </>
  );
}

export default function PersonPage() {
  return (
    <AppLayout>
      <ProtectedRoute>
        <Suspense fallback={<PageSkeleton />}>
          <PersonContent />
        </Suspense>
      </ProtectedRoute>
    </AppLayout>
  );
}
