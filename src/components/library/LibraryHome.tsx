"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FolderSearch } from "lucide-react";
import type { Folder } from "@/types";
import { AlbumGrid } from "@/components/photos/AlbumCard";
import { EmptyState, MetaDot, PageHeader, Section, Skeleton } from "@/components/ui";
import AlbumDropZone from "./AlbumDropZone";
import { LoadError } from "./LoadError";
import RecentlyVisited from "./RecentlyVisited";
import RediscoverSection from "./RediscoverSection";
import { AlbumGridSkeleton } from "./skeletons";
import { ROOT_KEY, cached, loadRootAlbums } from "./albumData";
import { useLibraryTotals, totalsLine } from "./useLibraryTotals";

type RootState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; folders: Folder[] };

function initialState(): RootState {
  const hit = cached<{ folders: Folder[] }>(ROOT_KEY);
  return hit ? { status: "ready", folders: hit.folders } : { status: "loading" };
}

/** The cover of the library: what it holds, its albums, and a few photos to fall back into. */
export default function LibraryHome() {
  const [root, setRoot] = useState<RootState>(initialState);
  const totals = useLibraryTotals();
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async (quiet: boolean) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (!quiet) setRoot({ status: "loading" });
    try {
      const result = await loadRootAlbums(controller.signal);
      if (result.status === "ready") setRoot({ status: "ready", folders: result.data.folders });
      else if (!quiet) setRoot({ status: "error" });
    } catch {
      // Aborted by a newer request.
    }
  }, []);

  useEffect(() => {
    load(initialState().status === "ready");
    return () => request.current?.abort();
  }, [load]);

  // Also on `?photo=` changes: Next puts the layout's title back when Back pops the viewer entry.
  const search = useSearchParams()?.toString();
  useEffect(() => {
    document.title = "Library · Blaze";
  }, [search]);

  const line = totalsLine(totals);

  return (
    <AlbumDropZone target={null}>
      <PageHeader
        size="xl"
        kicker="Family archive"
        title="The library"
        meta={
          line === undefined ? (
            <Skeleton className="h-4 w-72 max-w-full" />
          ) : (
            line.map((part, i) => (
              <Fragment key={part}>
                {i > 0 && <MetaDot />}
                <span className="tabular">{part}</span>
              </Fragment>
            ))
          )
        }
      />

      <Section title="Albums" className="pt-0 sm:pt-0">
        {root.status === "loading" && <AlbumGridSkeleton count={6} />}
        {root.status === "error" && <LoadError title="The albums didn't load" onRetry={() => load(false)} className="py-12" />}
        {root.status === "ready" &&
          (root.folders.length > 0 ? (
            <AlbumGrid folders={root.folders} />
          ) : (
            <EmptyState
              icon={FolderSearch}
              title="No albums yet"
              body="Albums appear here once the bucket has been read. That runs on its own in the background; come back in a few minutes."
              className="py-12"
            />
          ))}
      </Section>

      {/* Asked for at once: the root listing can take seconds on its own, and
          these are small JSON answers whose images load lazily below the fold. */}
      <RecentlyVisited />
      <RediscoverSection />
    </AlbumDropZone>
  );
}
