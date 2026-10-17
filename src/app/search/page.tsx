"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Library, SearchX } from "lucide-react";
import type { Folder, Photo } from "@/types";
import AppLayout from "@/components/AppLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import PhotoGrid, { PhotoGridSkeleton } from "@/components/PhotoGrid";
import { AlbumGrid } from "@/components/photos/AlbumCard";
import {
  ButtonLink,
  EmptyState,
  PageHeader,
  PageSkeleton,
  Section,
} from "@/components/ui";
import { AlbumGridSkeleton } from "@/components/find/AlbumGridSkeleton";
import { LoadError } from "@/components/find/LoadError";
import { StartingPoints } from "@/components/find/StartingPoints";
import { usePhotoParam } from "@/components/find/usePhotoParam";
import { formatCount, formatNumber } from "@/lib/albums";
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

/** Folders named after the query first, then those that only sit under a matching folder. */
function rankFolders(folders: Folder[], q: string): Folder[] {
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

function quoted(q: string) {
  return `«\u00a0${q}\u00a0»`;
}

function SearchContent() {
  const q = (useSearchParams().get("q") ?? "").trim();
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
            folders: rankFolders(data.folders ?? [], q),
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
    return () => {
      controller.abort();
    };
  }, [q, attempt]);

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
        q={state.q}
        results={state.results}
        selectedPhotoId={selectedPhotoId}
        onPhotoUrlChange={setPhotoParam}
      />
    </>
  );
}

function ResultsView({
  q,
  results,
  selectedPhotoId,
  onPhotoUrlChange,
}: {
  q: string;
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
      {folders.length > 0 && (
        <Section title="Dossiers">
          <AlbumGrid folders={folders} showPath eagerCount={8} />
        </Section>
      )}

      {photos.length > 0 && (
        <Section
          title="Photos"
          action={
            <span className="tabular text-sm text-ink-muted">
              {photos.length < photoTotal
                ? `${formatNumber(photos.length)} sur ${formatNumber(photoTotal)}`
                : formatCount(photos.length, "photo")}
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
