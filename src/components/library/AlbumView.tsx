"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen, FolderX, ImagePlus, Library, Share2 } from "lucide-react";
import ShareDialog from "@/components/ShareDialog";
import PhotoGrid from "@/components/PhotoGrid";
import { AlbumGrid, albumHref } from "@/components/photos/AlbumCard";
import {
  Button,
  ButtonLink,
  EmptyState,
  MetaDot,
  PageHeader,
  Section,
} from "@/components/ui";
import {
  albumDateLabel,
  formatCount,
  isVideo,
  parseAlbumName,
} from "@/lib/albums";
import AlbumBreadcrumb from "./AlbumBreadcrumb";
import AlbumDropZone, { type AlbumDropZoneHandle } from "./AlbumDropZone";
import { LoadError } from "./LoadError";
import { AlbumSkeleton } from "./skeletons";
import { usePhotoParam } from "./usePhotoParam";
import {
  type AlbumData,
  type LoadResult,
  albumKey,
  albumSpan,
  albumTitle,
  cached,
  loadAlbum,
  spanLabel,
} from "./albumData";

type State = LoadResult<AlbumData> | { status: "loading" };

function initialState(path: string): State {
  const hit = cached<AlbumData>(albumKey(path));
  return hit ? { status: "ready", data: hit } : { status: "loading" };
}

function MetaLine({ parts }: { parts: string[] }) {
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={part}>
          {i > 0 && <MetaDot />}
          <span className="tabular">{part}</span>
        </Fragment>
      ))}
    </>
  );
}

/** One album as a chapter: where it sits, when it happened, its sub-albums, then its photos. */
export default function AlbumView({ path }: { path: string }) {
  const [state, setState] = useState<State>(() => initialState(path));
  const [shareOpen, setShareOpen] = useState(false);
  const [selectedPhotoId, setPhotoParam] = usePhotoParam();
  const dropZone = useRef<AlbumDropZoneHandle>(null);
  const request = useRef<AbortController | null>(null);

  const name =
    state.status === "ready"
      ? state.data.folder.name
      : (path.split("/").pop() ?? path);
  const title = parseAlbumName(name).title || name;
  const parentPath = path.split("/").slice(0, -1).join("/");

  const load = useCallback(
    async (quiet: boolean) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      if (!quiet) setState({ status: "loading" });
      try {
        const result = await loadAlbum(path, controller.signal);
        // A quiet refresh that fails keeps what is on screen.
        if (quiet && result.status === "error") return;
        setState(result);
      } catch {
        // Aborted: a newer request owns the state.
      }
    },
    [path],
  );

  useEffect(() => {
    load(state.status === "ready");
    return () => request.current?.abort();
    // Only on mount: the page keys this view by path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Also on `?photo=` changes: Next puts the layout's title back when Back pops the viewer entry.
  useEffect(() => {
    document.title = `${state.status === "missing" ? "Album not found" : title} · Blaze`;
  }, [state.status, title, selectedPhotoId]);

  const photos = state.status === "ready" ? state.data.photos : null;

  // A `?photo=` that isn't in this album would sit in the address bar with nothing open.
  useEffect(() => {
    if (!photos || !selectedPhotoId) return;
    if (!photos.some((p) => String(p.id) === selectedPhotoId))
      setPhotoParam(null);
  }, [photos, selectedPhotoId, setPhotoParam]);

  const openPicker = () => dropZone.current?.openPicker();

  return (
    <AlbumDropZone
      ref={dropZone}
      target={state.status === "ready" ? { path, title } : null}
      onUploaded={() => load(true)}
    >
      <AlbumBreadcrumb path={path} />

      {state.status === "loading" && (
        <AlbumSkeleton shape={path.includes("/") ? "photos" : "albums"} />
      )}

      {state.status === "missing" && (
        <EmptyState
          icon={FolderX}
          title="This album isn't here"
          body={`Nothing is stored under “${path}”. It may have been renamed or moved since the library was last synced.`}
          action={
            <>
              <ButtonLink href="/" variant="primary" icon={Library}>
                Back to the library
              </ButtonLink>
              {parentPath && (
                <ButtonLink href={albumHref(parentPath)} variant="secondary">
                  Open {albumTitle(parentPath)}
                </ButtonLink>
              )}
            </>
          }
          className="py-24"
        />
      )}

      {state.status === "error" && (
        <LoadError
          title="This album didn't open"
          onRetry={() => load(false)}
          className="py-24"
        >
          <ButtonLink href="/" variant="ghost">
            Back to the library
          </ButtonLink>
        </LoadError>
      )}

      {state.status === "ready" && (
        <AlbumContents
          data={state.data}
          title={title}
          selectedPhotoId={selectedPhotoId}
          onPhotoUrlChange={setPhotoParam}
          onShare={() => setShareOpen(true)}
          onAddPhotos={openPicker}
        />
      )}

      {/* The raw name: the dialog reads the date out of it. The count is the album's own
          media, which is what a guest sees (sub-albums aren't shared). */}
      <ShareDialog
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
        folderPath={path}
        folderName={name}
        photoCount={
          state.status === "ready" ? state.data.photos.length : undefined
        }
      />
    </AlbumDropZone>
  );
}

interface AlbumContentsProps {
  data: AlbumData;
  title: string;
  selectedPhotoId: string | null;
  onPhotoUrlChange: (id: string | null) => void;
  onShare: () => void;
  onAddPhotos: () => void;
}

function AlbumContents({
  data,
  title,
  selectedPhotoId,
  onPhotoUrlChange,
  onShare,
  onAddPhotos,
}: AlbumContentsProps) {
  const { folder, subfolders, photos } = data;
  const videos = photos.filter(isVideo).length;
  const span = albumSpan(photos, subfolders);
  const kicker = albumDateLabel({
    name: folder.name,
    date_from: span.from ?? null,
    date_to: span.to ?? null,
  });
  const range = spanLabel(span);

  const meta = [
    photos.length - videos > 0 && formatCount(photos.length - videos, "photo"),
    videos > 0 && formatCount(videos, "video"),
    subfolders.length > 0 && formatCount(subfolders.length, "album"),
    range && range !== kicker && range,
  ].filter((p): p is string => Boolean(p));

  const empty = photos.length === 0 && subfolders.length === 0;

  return (
    <>
      <PageHeader
        kicker={kicker ?? "Album"}
        title={title}
        meta={meta.length > 0 ? <MetaLine parts={meta} /> : "Empty for now"}
        actions={
          <>
            <Button variant="secondary" icon={Share2} onClick={onShare}>
              Share
            </Button>
            <Button variant="ghost" icon={ImagePlus} onClick={onAddPhotos}>
              Add photos
            </Button>
          </>
        }
      />

      {empty && (
        <div className="border-t border-line">
          <EmptyState
            icon={FolderOpen}
            title="Nothing in this album yet"
            body="Drag photos and videos anywhere onto this page, or pick them from your computer."
            action={
              <Button
                variant="secondary"
                icon={ImagePlus}
                onClick={onAddPhotos}
              >
                Add photos
              </Button>
            }
            className="py-20"
          />
        </div>
      )}

      {subfolders.length > 0 && (
        <Section title="Albums">
          <AlbumGrid folders={subfolders} />
        </Section>
      )}

      {photos.length > 0 &&
        (subfolders.length > 0 ? (
          <Section title="Photos">
            <PhotoGrid
              photos={photos}
              selectedPhotoId={selectedPhotoId}
              onPhotoUrlChange={onPhotoUrlChange}
            />
          </Section>
        ) : (
          <div className="border-t border-line pt-6">
            <PhotoGrid
              photos={photos}
              selectedPhotoId={selectedPhotoId}
              onPhotoUrlChange={onPhotoUrlChange}
            />
          </div>
        ))}
    </>
  );
}
