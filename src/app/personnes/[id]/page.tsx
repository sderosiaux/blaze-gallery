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
import { ArrowLeft, ImageOff, UsersRound } from "lucide-react";
import type { Photo } from "@/types";
import type { PersonPhoto, PersonRow } from "@/lib/people";
import AppLayout from "@/components/AppLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import PhotoViewer from "@/components/PhotoViewer";
import JustifiedGrid from "@/components/photos/JustifiedGrid";
import PhotoTile from "@/components/photos/PhotoTile";
import FaceThumb from "@/components/people/FaceThumb";
import ReviewQueue from "@/components/people/ReviewQueue";
import {
  ButtonLink,
  EmptyState,
  MetaDot,
  PageHeader,
  PageSkeleton,
  Tabs,
  useToast,
} from "@/components/ui";
import { LoadError } from "@/components/find/LoadError";
import { YearPicker, YearRail } from "@/components/find/YearIndex";
import { setFavorite } from "@/components/find/favorites";
import { usePhotoParam } from "@/components/find/usePhotoParam";
import { asArray, isRecord, readJsonObject } from "@/hooks/apiJson";
import { formatCount, formatDateRange } from "@/lib/albums";
import { ageOn } from "@/lib/faces";
import { applyPhotoPatch, type PhotoPatch } from "@/lib/photoPatch";

type Tab = "photos" | "a-trier";

/** A year counts as the one being read once its heading passes this line. */
const SPY_LINE = 160;

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
  const first = group.photos[0]?.taken;
  const last = group.photos[group.photos.length - 1]?.taken;
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
  onOpen,
  onToggleFavorite,
}: {
  group: YearGroup;
  birthDate: string | null;
  onOpen: (photo: Photo) => void;
  onToggleFavorite: (photo: Photo) => void;
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
          {formatCount(group.photos.length, "photo")}
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
  const [selectedPhotoId, setPhotoParam] = usePhotoParam();

  const [status, setStatus] = useState<
    "loading" | "ready" | "error" | "missing"
  >("loading");
  const [person, setPerson] = useState<PersonRow | null>(null);
  const [photos, setPhotos] = useState<PersonPhoto[]>([]);
  const [pending, setPending] = useState(0);
  const [cover, setCover] = useState<number | null>(null);
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
      setPhotos(asArray(data.photos) as PersonPhoto[]);
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
      stale.current = false;
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [personId]);

  useEffect(() => {
    void load();
  }, [load]);

  const switchTab = (next: Tab) => {
    const url = new URL(window.location.href);
    if (next === "photos") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url.pathname + url.search);
    // Faces taken in the queue show up in the photos
    if (next === "photos" && stale.current) void load();
  };

  // -- viewer ---------------------------------------------------------------
  const [viewerList, setViewerList] = useState<Photo[] | null>(null);
  const list = viewerList ?? photos;
  const selected = selectedPhotoId
    ? (list.find((p) => String(p.id) === selectedPhotoId) ?? null)
    : null;

  const patch = useCallback((id: Photo["id"], changes: PhotoPatch) => {
    setPhotos((all) =>
      all.map((p) =>
        String(p.id) === String(id) ? applyPhotoPatch(p, changes) : p,
      ),
    );
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
        toast.show("Les favoris n'ont pas pu être mis à jour.", "error");
      }
    },
    [patch, toast],
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
    if (stale.current && tab === "photos") void load();
  };

  const onQueueChange = useCallback((remaining: number) => {
    setPending(Math.max(0, remaining));
    stale.current = true;
  }, []);

  const groups = useMemo(() => byYear(photos), [photos]);

  // The year index of Chronologie, oldest first like the photos
  const years = useMemo(
    () => groups.flatMap((g) => (g.year === null ? [] : [g.year])),
    [groups],
  );
  const yearCounts = useMemo(
    () =>
      new Map(
        groups.flatMap((g) =>
          g.year === null ? [] : [[String(g.year), g.photos.length] as const],
        ),
      ),
    [groups],
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
      setActiveYear(current ?? years[0] ?? null);
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
  }, [groups, years, tab]);
  const jumpToYear = useCallback((year: number) => {
    document
      .querySelector(`[data-year="${String(year)}"]`)
      ?.scrollIntoView({ block: "start" });
  }, []);
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
  const first = photos.find((p) => p.taken)?.taken;
  const last = [...photos].reverse().find((p) => p.taken)?.taken;

  return (
    <>
      <PageHeader
        kicker={
          <Link href="/personnes" className="transition-colors hover:text-ink">
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
            <span className="tabular">
              {formatCount(photos.length, "photo")}
            </span>
            {first && last && (
              <>
                <MetaDot />
                <span>{formatDateRange(first, last)}</span>
              </>
            )}
            <MetaDot />
            <Link
              href={`/timeline?person=${String(person.id)}`}
              className="text-ink-soft underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink hover:decoration-accent"
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
          { id: "photos", label: "Photos", count: photos.length },
          { id: "a-trier", label: "À trier", count: pending },
        ]}
      />

      {tab === "photos" ? (
        photos.length === 0 ? (
          <EmptyState
            icon={ImageOff}
            title={`Aucune photo de ${name} pour l’instant`}
            body="Nommez son visage sur une photo (touche P dans la visionneuse) : les autres suivront."
            className="py-16"
          />
        ) : (
          <>
            <div className="md:grid md:grid-cols-[minmax(0,1fr)_6rem] md:gap-8">
              <div className="min-w-0">
                {groups.map((group) => (
                  <YearSection
                    key={group.key}
                    group={group}
                    birthDate={person.birth_date}
                    onOpen={openFromGrid}
                    onToggleFavorite={(photo) => void toggleFavorite(photo)}
                  />
                ))}
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
        )
      ) : (
        <ReviewQueue
          personId={person.id}
          name={name}
          onChange={onQueueChange}
          onOpenPhoto={openFromQueue}
        />
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
