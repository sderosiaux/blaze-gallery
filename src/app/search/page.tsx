"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarDays, Library, SearchX } from "lucide-react";
import type { Folder, Photo } from "@/types";
import AppLayout from "@/components/AppLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import PhotoGrid, { PhotoGridSkeleton } from "@/components/PhotoGrid";
import { AlbumGrid } from "@/components/photos/AlbumCard";
import {
  ButtonLink,
  EmptyState,
  MetaDot,
  PageHeader,
  PageSkeleton,
  Section,
  Skeleton,
} from "@/components/ui";
import { AlbumGridSkeleton } from "@/components/find/AlbumGridSkeleton";
import { LoadError } from "@/components/find/LoadError";
import { StartingPoints } from "@/components/find/StartingPoints";
import { usePhotoParam } from "@/components/find/usePhotoParam";
import { formatCount } from "@/lib/albums";
import { normalizeTextForSearch } from "@/lib/textUtils";

interface Results {
  photos: Photo[];
  folders: Folder[];
  /** Every matching photo; the API sends the first 50. */
  photoTotal: number;
}

type State =
  | { status: "idle" }
  | { status: "loading"; q: string }
  | { status: "error"; q: string }
  | { status: "ready"; q: string; results: Results };

const FOLDER_LIMIT = 20;

/** Albums named after the query first, then those that only sit under a matching folder. */
function rankAlbums(folders: Folder[], q: string): Folder[] {
  const needle = normalizeTextForSearch(q);
  return folders
    .filter((f) => Number(f.photo_count) > 0 || Number(f.subfolder_count) > 0)
    .map((folder, i) => ({
      folder,
      i,
      named: normalizeTextForSearch(folder.name).includes(needle),
    }))
    .sort((a, b) => Number(b.named) - Number(a.named) || a.i - b.i)
    .map(({ folder }) => folder);
}

function Quote({ children }: { children: React.ReactNode }) {
  return <>“{children}”</>;
}

function SearchContent() {
  const q = (useSearchParams()?.get("q") ?? "").trim();
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
    setState({ status: "loading", q });
    fetch(`/api/search?q=${encodeURIComponent(q)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error);
        const photos: Photo[] = data.photos ?? [];
        setState({
          status: "ready",
          q,
          results: {
            photos,
            folders: rankAlbums(data.folders ?? [], q),
            photoTotal:
              typeof data.photo_total === "number"
                ? data.photo_total
                : photos.length,
          },
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error", q });
      });
    return () => controller.abort();
  }, [q, attempt]);

  if (state.status === "idle") {
    return (
      <>
        <PageHeader kicker="Search" title="Find a memory">
          <p className="mt-4 max-w-2xl text-pretty text-base leading-relaxed text-ink-soft">
            Search reads album names, the folders they sit in and file names. A
            place, an event, a first name or a year usually finds it. Type in
            the field above
            <span className="hidden sm:inline">
              , or press{" "}
              <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 text-xs text-ink-muted">
                /
              </kbd>{" "}
              from any page
            </span>
            .
          </p>
        </PageHeader>
        <StartingPoints />
      </>
    );
  }

  const title = (
    <>
      Results for <Quote>{state.q}</Quote>
    </>
  );

  if (state.status === "error") {
    return (
      <>
        <PageHeader kicker="Search" title={title} />
        <LoadError
          title="Search didn't go through"
          onRetry={() => setAttempt((n) => n + 1)}
        />
      </>
    );
  }

  if (state.status === "loading") {
    return (
      <>
        <PageHeader
          kicker="Search"
          title={title}
          meta={<Skeleton className="h-4 w-44" />}
        />
        <div aria-live="polite" className="sr-only">
          Searching
        </div>
        <Section title="Albums">
          <AlbumGridSkeleton count={4} />
        </Section>
        <Section title="Photos">
          <PhotoGridSkeleton count={8} />
        </Section>
      </>
    );
  }

  return (
    <ResultsView
      q={state.q}
      title={title}
      results={state.results}
      selectedPhotoId={selectedPhotoId}
      onPhotoUrlChange={setPhotoParam}
    />
  );
}

function ResultsView({
  q,
  title,
  results,
  selectedPhotoId,
  onPhotoUrlChange,
}: {
  q: string;
  title: React.ReactNode;
  results: Results;
  selectedPhotoId: string | null;
  onPhotoUrlChange: (id: string | null) => void;
}) {
  const { photos, folders, photoTotal } = results;
  const words = useMemo(
    () => Array.from(new Set(q.split(/\s+/).filter((w) => w.length > 1))),
    [q],
  );

  if (folders.length === 0 && photos.length === 0) {
    return (
      <>
        <PageHeader
          kicker="Search"
          title={title}
          meta={<span>No albums or photos</span>}
        />
        <EmptyState
          icon={SearchX}
          title={
            <>
              Nothing matches <Quote>{q}</Quote>
            </>
          }
          body={
            <>
              Search reads album names, folder names and file names, not what is
              inside the photos. Try a shorter word, a place, a first name or a
              year.
              {words.length > 1 && (
                <span className="mt-3 block">
                  Or one word at a time:{" "}
                  {words.map((w, i) => (
                    <span key={w}>
                      {i > 0 && ", "}
                      <Link
                        href={`/search?q=${encodeURIComponent(w)}`}
                        className="font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-accent"
                      >
                        <Quote>{w}</Quote>
                      </Link>
                    </span>
                  ))}
                </span>
              )}
            </>
          }
          action={
            <>
              <ButtonLink href="/" variant="primary" icon={Library}>
                Browse the library
              </ButtonLink>
              <ButtonLink
                href="/timeline"
                variant="secondary"
                icon={CalendarDays}
              >
                Browse by date
              </ButtonLink>
            </>
          }
          className="pb-8 pt-10"
        />
        <StartingPoints albumLimit={4} />
      </>
    );
  }

  const partial = photos.length < photoTotal;

  return (
    <>
      <PageHeader
        kicker="Search"
        title={title}
        meta={
          <>
            <span className="tabular">
              {formatCount(folders.length, "album")}
            </span>
            <MetaDot />
            <span className="tabular">{formatCount(photoTotal, "photo")}</span>
          </>
        }
      />

      {folders.length > 0 && (
        <Section
          title="Albums"
          description={
            folders.length >= FOLDER_LIMIT
              ? `The first ${FOLDER_LIMIT} by name. A more precise word narrows them down.`
              : "Named after your search, or kept inside a folder that is."
          }
        >
          <AlbumGrid folders={folders} showPath eagerCount={8} />
        </Section>
      )}

      {photos.length > 0 && (
        <Section
          title="Photos"
          description={
            partial
              ? `The first ${photos.length.toLocaleString("en-GB")} of ${photoTotal.toLocaleString("en-GB")}, by file name. Open an album above to see them all.`
              : "Matched by file name or by the album they belong to."
          }
          action={
            <span className="tabular text-sm text-ink-muted">
              {partial
                ? `${photos.length} of ${photoTotal.toLocaleString("en-GB")}`
                : photos.length}
            </span>
          }
        >
          <PhotoGrid
            photos={photos}
            selectedPhotoId={selectedPhotoId}
            onPhotoUrlChange={onPhotoUrlChange}
            eagerCount={12}
          />
        </Section>
      )}
    </>
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
