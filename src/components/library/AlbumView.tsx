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
  formatDateRange,
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
  cached,
  folderName,
  loadAlbum,
  photosSpan,
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

/** One folder of the bucket: where it sits, when it happened, its sub-folders, then its photos. */
export default function AlbumView({ path }: { path: string }) {
  const [state, setState] = useState<State>(() => initialState(path));
  const [shareOpen, setShareOpen] = useState(false);
  const [selectedPhotoId, setPhotoParam] = usePhotoParam();
  const dropZone = useRef<AlbumDropZoneHandle>(null);
  const request = useRef<AbortController | null>(null);

  const name =
    state.status === "ready" ? state.data.folder.name : folderName(path);
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
    document.title = `${state.status === "missing" ? "Dossier introuvable" : name} · Blaze`;
  }, [state.status, name, selectedPhotoId]);

  const photos = state.status === "ready" ? state.data.photos : null;

  // A `?photo=` that isn't in this folder would sit in the address bar with nothing open.
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
          title="Ce dossier est introuvable"
          action={
            parentPath ? (
              <ButtonLink
                href={albumHref(parentPath)}
                variant="primary"
                icon={FolderOpen}
              >
                Ouvrir {folderName(parentPath)}
              </ButtonLink>
            ) : (
              <ButtonLink href="/" variant="primary" icon={Library}>
                Ouvrir la Bibliothèque
              </ButtonLink>
            )
          }
          className="py-24"
        />
      )}

      {state.status === "error" && (
        <LoadError
          title="Ce dossier n'a pas pu être chargé"
          onRetry={() => load(false)}
          className="py-24"
        />
      )}

      {state.status === "ready" && (
        <AlbumContents
          data={state.data}
          title={title}
          selectedPhotoId={selectedPhotoId}
          onPhotoUrlChange={setPhotoParam}
          onShare={() => {
            setShareOpen(true);
          }}
          onAddPhotos={openPicker}
        />
      )}

      {/* The raw name: the dialog reads the date out of it. */}
      <ShareDialog
        isOpen={shareOpen}
        onClose={() => {
          setShareOpen(false);
        }}
        folderPath={path}
        folderName={name}
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
  const span = photosSpan(photos);
  // The date in the name wins; without one, when its photos were taken.
  const kicker = albumDateLabel({
    name: folder.name,
    date_from: span.from ?? null,
    date_to: span.to ?? null,
  });
  // Only when the photos say more than the name, e.g. a trip that began two days earlier.
  const range = formatDateRange(span.from, span.to);

  const meta = [
    range && range !== kicker && range,
    subfolders.length > 0 && formatCount(subfolders.length, "dossier"),
    photos.length - videos > 0 && formatCount(photos.length - videos, "photo"),
    videos > 0 && formatCount(videos, "vidéo"),
  ].filter((p): p is string => Boolean(p));

  const empty = photos.length === 0 && subfolders.length === 0;

  return (
    <>
      <PageHeader
        kicker={kicker}
        title={title}
        meta={meta.length > 0 && <MetaLine parts={meta} />}
        actions={
          <>
            <Button variant="secondary" icon={Share2} onClick={onShare}>
              Partager
            </Button>
            <Button variant="ghost" icon={ImagePlus} onClick={onAddPhotos}>
              Ajouter des photos
            </Button>
          </>
        }
      />

      {empty && (
        <div className="border-t border-line">
          <EmptyState
            icon={FolderOpen}
            title="Ce dossier est vide"
            action={
              <Button
                variant="secondary"
                icon={ImagePlus}
                onClick={onAddPhotos}
              >
                Ajouter des photos
              </Button>
            }
            className="py-20"
          />
        </div>
      )}

      {subfolders.length > 0 && (
        <Section title="Dossiers">
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
