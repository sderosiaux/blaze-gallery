"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FolderSearch, RotateCw } from "lucide-react";
import type { Folder } from "@/types";
import { AlbumGrid } from "@/components/photos/AlbumCard";
import { Button, EmptyState, Section, Skeleton } from "@/components/ui";
import AlbumDropZone from "./AlbumDropZone";
import { LoadError } from "./LoadError";
import RecentlyVisited from "./RecentlyVisited";
import RediscoverSection from "./RediscoverSection";
import { AlbumGridSkeleton } from "./skeletons";
import {
  ROOT_KEY,
  cached,
  cachedBucketName,
  loadBucketName,
  loadRootAlbums,
} from "./albumData";

type RootState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; folders: Folder[] };

function initialState(): RootState {
  const hit = cached<{ folders: Folder[] }>(ROOT_KEY);
  return hit
    ? { status: "ready", folders: hit.folders }
    : { status: "loading" };
}

/** The bucket's top-level folders first, then a few photos to fall back into. */
export default function LibraryHome() {
  const [root, setRoot] = useState<RootState>(initialState);
  const [bucket, setBucket] = useState(cachedBucketName);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async (quiet: boolean) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (!quiet) setRoot({ status: "loading" });
    try {
      const result = await loadRootAlbums(controller.signal);
      if (result.status === "ready")
        setRoot({ status: "ready", folders: result.data.folders });
      else if (!quiet) setRoot({ status: "error" });
    } catch {
      // Aborted by a newer request.
    }
  }, []);

  useEffect(() => {
    load(initialState().status === "ready");
    return () => request.current?.abort();
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    loadBucketName(controller.signal).then(
      // A failed read keeps the name remembered from earlier in the session.
      (name) => setBucket((shown) => name ?? shown ?? null),
      () => {},
    );
    return () => controller.abort();
  }, []);

  // Also on `?photo=` changes: Next puts the layout's title back when Back pops the viewer entry.
  const search = useSearchParams()?.toString();
  useEffect(() => {
    document.title = "Bibliothèque · Blaze";
  }, [search]);

  return (
    <AlbumDropZone target={null}>
      <h1 className="sr-only">Bibliothèque</h1>

      <Section
        title="Dossiers"
        kicker={
          bucket === undefined ? <Skeleton className="h-3 w-32" /> : bucket
        }
      >
        {root.status === "loading" && <AlbumGridSkeleton count={6} />}
        {root.status === "error" && (
          <LoadError
            title="Les dossiers n'ont pas pu être chargés"
            onRetry={() => load(false)}
            className="py-12"
          />
        )}
        {root.status === "ready" &&
          (root.folders.length > 0 ? (
            <AlbumGrid folders={root.folders} />
          ) : (
            <EmptyState
              icon={FolderSearch}
              title="Aucun dossier pour l'instant"
              action={
                <Button
                  variant="secondary"
                  icon={RotateCw}
                  onClick={() => load(false)}
                >
                  Réessayer
                </Button>
              }
              className="py-12"
            />
          ))}
      </Section>

      {/* Asked for at once: the root listing can take seconds on its own, and
          these are small JSON answers whose images load lazily below the fold. */}
      <RediscoverSection />
      <RecentlyVisited />
    </AlbumDropZone>
  );
}
