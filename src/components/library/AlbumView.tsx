"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  FolderOpen,
  FolderX,
  ImageOff,
  ImagePlus,
  Images,
  Library,
  Share2,
} from "lucide-react";
import ShareDialog from "@/components/ShareDialog";
import PhotoGrid from "@/components/PhotoGrid";
import { useFolderWarmup } from "@/components/photos/useFolderWarmup";
import { AlbumGrid, albumHref } from "@/components/photos/AlbumCard";
import {
  Button,
  ButtonLink,
  EmptyState,
  MetaDot,
  PageHeader,
  Section,
  useToast,
} from "@/components/ui";
import {
  albumDateLabel,
  formatCount,
  isVideo,
  parseAlbumName,
} from "@/lib/albums";
import { setFolderExcluded } from "@/lib/excludedFolders";
import AlbumBreadcrumb from "./AlbumBreadcrumb";
import AlbumDropZone, { type AlbumDropZoneHandle } from "./AlbumDropZone";
import FolderMenu, { type FolderMenuItem } from "./FolderMenu";
import { LoadError } from "./LoadError";
import { AlbumSkeleton } from "./skeletons";
import { usePhotoParam } from "./usePhotoParam";
import {
  type AlbumData,
  type LoadResult,
  albumKey,
  cached,
  folderName,
  forget,
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
  const toast = useToast();

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
    // The page keys this view by path: `load` only changes on a new mount.
    void load(initialState(path).status === "ready");
    return () => request.current?.abort();
  }, [load, path]);

  // Also on `?photo=` changes: Next puts the layout's title back when Back pops the viewer entry.
  useEffect(() => {
    document.title = `${state.status === "missing" ? "Dossier introuvable" : name} · Blaze`;
  }, [state.status, name, selectedPhotoId]);

  const photos = state.status === "ready" ? state.data.photos : null;

  // Opening a folder builds its missing thumbnails once and for all; tiles
  // sharpen as their thumbnail lands.
  const missingThumbnails =
    photos?.some(
      (p) =>
        p.mime_type.startsWith("image/") && p.thumbnail_status !== "generated",
    ) ?? false;
  const markGenerated = useCallback((ids: string[]) => {
    const built = new Set(ids);
    setState((current) =>
      current.status === "ready"
        ? {
            ...current,
            data: {
              ...current.data,
              photos: current.data.photos.map((p) =>
                built.has(String(p.id))
                  ? { ...p, thumbnail_status: "generated" as const }
                  : p,
              ),
            },
          }
        : current,
    );
  }, []);
  useFolderWarmup(path || null, missingThumbnails, markGenerated);

  // A `?photo=` that isn't in this folder would sit in the address bar with nothing open.
  useEffect(() => {
    if (!photos || !selectedPhotoId) return;
    if (!photos.some((p) => String(p.id) === selectedPhotoId))
      setPhotoParam(null);
  }, [photos, selectedPhotoId, setPhotoParam]);

  const openPicker = () => dropZone.current?.openPicker();

  const setExclusion = (exclusion: AlbumData["exclusion"]) => {
    setState((current) =>
      current.status === "ready"
        ? { ...current, data: { ...current.data, exclusion } }
        : current,
    );
  };

  // Shown at once, put back when the server refuses. Only offered on a
  // folder in the gallery or marked itself, so it was the other one before.
  const markExcluded = async (excluded: boolean) => {
    setExclusion(excluded ? { path } : null);
    // The cached body says otherwise: the next visit asks again
    forget(albumKey(path));
    try {
      await setFolderExcluded(path, excluded);
      toast.show(
        excluded ? "Retiré de la galerie" : "Réintégré à la galerie",
        "success",
        excluded
          ? {
              action: {
                label: "Annuler",
                onClick: () => void markExcluded(false),
              },
            }
          : undefined,
      );
    } catch {
      setExclusion(excluded ? null : { path });
      toast.show("Le changement n’a pas été enregistré", "error");
    }
  };

  return (
    <AlbumDropZone
      ref={dropZone}
      target={state.status === "ready" ? { path, title } : null}
      onUploaded={() => void load(true)}
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
          onRetry={() => void load(false)}
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
          onMarkExcluded={(excluded) => void markExcluded(excluded)}
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
  onMarkExcluded: (excluded: boolean) => void;
}

const OUT_OF_GALLERY_HINT =
  "Ses photos restent ici, hors de la Chronologie, de la Carte, des Couleurs, de Personnes et de la recherche par contenu";

/** Says the folder is out of the gallery, and which folder put it there when it is a parent. */
function OutOfGallery({
  path,
  exclusion,
}: {
  path: string;
  exclusion: { path: string };
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={OUT_OF_GALLERY_HINT}
    >
      <ImageOff className="h-3.5 w-3.5" aria-hidden />
      Hors galerie
      {exclusion.path !== path && (
        <>
          <MetaDot />
          <Link
            href={albumHref(exclusion.path)}
            className="transition-colors hover:text-ink"
          >
            {folderName(exclusion.path)}
          </Link>
        </>
      )}
    </span>
  );
}

function AlbumContents({
  data,
  title,
  selectedPhotoId,
  onPhotoUrlChange,
  onShare,
  onAddPhotos,
  onMarkExcluded,
}: AlbumContentsProps) {
  const { folder, subfolders, photos } = data;
  const exclusion = data.exclusion ?? null;
  // A folder put out by a parent comes back with it only: nothing to do here
  const menu: FolderMenuItem[] =
    exclusion === null
      ? [
          {
            label: "Ce dossier n’est pas une galerie photo",
            icon: ImageOff,
            onSelect: () => {
              onMarkExcluded(true);
            },
          },
        ]
      : exclusion.path === folder.path
        ? [
            {
              label: "Réintégrer à la galerie",
              icon: Images,
              onSelect: () => {
                onMarkExcluded(false);
              },
            },
          ]
        : [];
  const videos = photos.filter(isVideo).length;
  const span = photosSpan(photos);
  // The date in the name wins; without one, when its photos were taken.
  const kicker = albumDateLabel({
    name: folder.name,
    date_from: span.from ?? null,
    date_to: span.to ?? null,
  });
  // One date per folder: the kicker. A second range under it read as noise.
  const meta = [
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
        meta={
          (meta.length > 0 || exclusion) && (
            <>
              <MetaLine parts={meta} />
              {exclusion && (
                <>
                  {meta.length > 0 && <MetaDot />}
                  <OutOfGallery path={folder.path} exclusion={exclusion} />
                </>
              )}
            </>
          )
        }
        actions={
          <>
            <Button variant="secondary" icon={Share2} onClick={onShare}>
              Partager
            </Button>
            <Button variant="ghost" icon={ImagePlus} onClick={onAddPhotos}>
              Ajouter des photos
            </Button>
            <FolderMenu items={menu} />
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
          {/* Below a folder out of the gallery, every one is: no marker */}
          <AlbumGrid folders={subfolders} markExcluded={exclusion === null} />
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
