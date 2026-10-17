"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { Photo } from "@/types";
import PhotoViewerControls from "./PhotoViewerControls";
import { Button, Dialog, IconButton, useToast } from "@/components/ui";
import { useFavoriteToggle } from "@/hooks/useFavoriteToggle";
import { usePhotoNavigation } from "@/hooks/usePhotoNavigation";
import { isVideo } from "@/lib/albums";
import { cn } from "@/lib/cn";
import ViewerPhoto, {
  type FullStatus,
  type PlaceholderState,
} from "./viewer/ViewerPhoto";
import ViewerVideo from "./viewer/ViewerVideo";
import InfoPanel from "./viewer/InfoPanel";
import ShortcutsHelp from "./viewer/ShortcutsHelp";
import { loadImage, retainImages } from "./viewer/imageCache";
import {
  albumOf,
  isRawFile,
  placeholderSources,
  viewerSources,
} from "./viewer/sources";
import { formatTakenDay } from "./viewer/format";
import { useAutoHide } from "./viewer/useAutoHide";
import { useSlideshow, SLIDESHOW_INTERVAL_MS } from "./viewer/useSlideshow";
import { useSwipe } from "./viewer/useSwipe";

interface PhotoViewerProps {
  photo: Photo;
  /** The album, in order: arrows, swipe and the slideshow walk through it. */
  photos?: Photo[];
  onClose: () => void;
  /** Called with the photo as the server now has it after a favourite toggle. */
  onFavoriteToggle?: (photo: Photo) => void;
  onPhotoChange?: (photo: Photo) => void;
  /** Called once the photo is deleted from storage. Without it, delete is not offered. */
  onDelete?: (photo: Photo) => void;
  isSharedView?: boolean;
  shareToken?: string;
  allowDownload?: boolean;
  /** Password-protected shares: the session from the password gate. */
  sessionToken?: string;
}

interface Keyed<T> {
  id: string;
  value: T;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])';

function triggerDownload(href: string, filename: string, newTab = false) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  if (newTab) a.target = "_blank";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Looking at one photo. A white stage, the photo as large as the window
 * allows, under it only its day, its folder and its place in the folder;
 * controls fade away while you look and come back when the mouse moves.
 * Rendered in a portal so no page stacking context can clip it.
 */
export default function PhotoViewer({
  photo,
  photos,
  onClose,
  onFavoriteToggle,
  onPhotoChange,
  onDelete,
  isSharedView = false,
  shareToken,
  allowDownload = true,
  sessionToken,
}: PhotoViewerProps) {
  const toast = useToast();
  const rootRef = useRef<HTMLDivElement>(null);
  const infoId = useId();
  const helpId = useId();
  const [mounted, setMounted] = useState(false);

  const nav = usePhotoNavigation(photo, photos, onPhotoChange);
  const current = nav.current;
  const currentId = String(current.id);
  const shared = isSharedView && shareToken ? shareToken : undefined;
  const session = shared ? sessionToken : undefined;
  const sources = useMemo(
    () => viewerSources(current, shared),
    [current, shared],
  );
  const video = isVideo(current);
  const canFavorite = !isSharedView;
  const canDelete = !isSharedView && Boolean(onDelete);

  const [infoOpen, setInfoOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  // Per-photo state is keyed by id so a new photo starts clean without a reset pass.
  const [zoomedId, setZoomedId] = useState<string | null>(null);
  const [fullState, setFullState] = useState<Keyed<{
    status: FullStatus;
    placeholder: PlaceholderState;
  }> | null>(null);
  const [videoState, setVideoState] = useState<Keyed<
    "playing" | "ended" | "failed"
  > | null>(null);
  const [retry, setRetry] = useState<Keyed<number> | null>(null);

  const zoomed = zoomedId === currentId;
  const full =
    fullState?.id === currentId
      ? fullState.value
      : {
          status: "loading" as FullStatus,
          placeholder: "pending" as PlaceholderState,
        };
  const videoOutcome = videoState?.id === currentId ? videoState.value : null;
  const retryKey = retry?.id === currentId ? retry.value : 0;

  useEffect(() => {
    setMounted(true);
  }, []);

  // ---- favourites, download, delete -------------------------------------

  const favorite = useFavoriteToggle(current, {
    enabled: canFavorite,
    onChange: onFavoriteToggle,
    onError: () => {
      toast.show("Le favori n’a pas été enregistré", "error");
    },
  });

  const toggleFavorite = useCallback(() => {
    if (!canFavorite) return;
    setAnnouncement(
      favorite.isFavorite ? "Retirée des favoris" : "Ajoutée aux favoris",
    );
    favorite.toggle();
  }, [canFavorite, favorite]);

  const download = useCallback(async () => {
    if (!allowDownload) return;
    if (!shared) {
      // The library route redirects to storage, where `download` is ignored
      // (cross-origin): a new tab keeps the viewer open, and `download=1` asks
      // the route for an attachment so the browser saves instead of showing.
      triggerDownload(`${sources.download}?download=1`, current.filename, true);
      return;
    }
    if (!session) {
      triggerDownload(sources.download, current.filename);
      return;
    }
    try {
      const response = await fetch(sources.download, {
        headers: { "x-share-session": session },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const url = URL.createObjectURL(await response.blob());
      triggerDownload(url, current.filename);
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 10_000);
    } catch {
      toast.show("Le téléchargement n’a pas démarré", "error");
    }
  }, [
    allowDownload,
    shared,
    session,
    sources.download,
    current.filename,
    toast,
  ]);

  const confirmDelete = useCallback(async () => {
    setDeleting(true);
    try {
      const response = await fetch(`/api/photos/${currentId}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) throw new Error(data.error);
      onDelete?.(current);
      toast.show("Photo supprimée", "success");
      setConfirmOpen(false);
      onClose();
    } catch {
      toast.show("La photo n’a pas été supprimée", "error");
    } finally {
      setDeleting(false);
    }
  }, [currentId, current, onDelete, onClose, toast]);

  // ---- navigation, slideshow, zoom --------------------------------------

  const { goToPrevious: previous, goToNext: next, goTo } = nav;
  const stopSlideshow = useCallback(() => {
    setPlaying(false);
  }, []);
  const toggleSlideshow = useCallback(() => {
    if (nav.total < 2) return;
    setPlaying((p) => !p);
  }, [nav.total]);

  const toggleZoom = useCallback(() => {
    if (video || full.status !== "ready") return;
    setZoomedId((id) => (id === currentId ? null : currentId));
  }, [video, full.status, currentId]);

  const onZoomedChange = useCallback(
    (z: boolean) => {
      setZoomedId(z ? currentId : null);
    },
    [currentId],
  );
  const onStatus = useCallback(
    (status: FullStatus, placeholder: PlaceholderState) => {
      setFullState({ id: currentId, value: { status, placeholder } });
    },
    [currentId],
  );
  const onVideoSettled = useCallback(
    (outcome: "playing" | "ended" | "failed") => {
      setVideoState({ id: currentId, value: outcome });
    },
    [currentId],
  );

  const photoReady = video
    ? videoOutcome === "ended" || videoOutcome === "failed"
    : full.status !== "loading";
  const clockRunning = useSlideshow({
    playing,
    photoKey: currentId,
    ready: photoReady,
    waitForEnd: video && videoOutcome !== "ended" && videoOutcome !== "failed",
    hasNext: nav.hasNext,
    onNext: next,
    onEnd: stopSlideshow,
  });

  const swipe = useSwipe({
    disabled: zoomed,
    onPrevious: previous,
    onNext: next,
    hasPrevious: nav.hasPrevious,
    hasNext: nav.hasNext,
  });

  // Neighbours: their cheap layers right away, their originals once this
  // photo's original is in (they would only slow it down before).
  useEffect(() => {
    const keep: string[] = [];
    if (sources.full && !video) keep.push(sources.full);
    const settled = video || full.status !== "loading";
    nav.neighbours.forEach((p, i) => {
      if (isVideo(p)) return;
      const s = viewerSources(p, shared);
      const layers = placeholderSources(p, s);
      [layers.preview, layers.thumb].forEach((src) => {
        if (!src) return;
        loadImage(src);
        keep.push(src);
      });
      if (s.full && settled && i < 2) {
        loadImage(s.full, { sessionToken: session });
        keep.push(s.full);
      }
    });
    retainImages(keep);
  }, [nav.neighbours, sources.full, video, full.status, shared, session]);

  // Closing cancels the originals still on their way: the grid needs the
  // bandwidth. Deferred so the stage has unsubscribed from its own first.
  useEffect(
    () => () =>
      void setTimeout(() => {
        retainImages([]);
      }, 0),
    [],
  );

  // ---- caption ----------------------------------------------------------

  const day = current.metadata?.date_taken
    ? formatTakenDay(current.metadata.date_taken)
    : null;
  const album = isSharedView ? null : albumOf(current);
  const inList = nav.index >= 0 && nav.total > 1;
  const position = inList ? `${nav.index + 1} / ${nav.total}` : null;
  // An undated photo shows no title; assistive tech still gets its name.
  const name = day ?? current.filename;

  useEffect(() => {
    setAnnouncement(
      [inList && `Photo ${nav.index + 1} sur ${nav.total}`, name]
        .filter(Boolean)
        .join(", "),
    );
  }, [currentId, inList, nav.index, nav.total, name]);

  // ---- focus, keyboard, scroll lock -------------------------------------

  const confirmOpenRef = useRef(confirmOpen);
  confirmOpenRef.current = confirmOpen;
  const deletingRef = useRef(deleting);
  deletingRef.current = deleting;
  // Stable: the Dialog re-runs its focus effect whenever onClose changes.
  const closeConfirm = useCallback(() => {
    if (!deletingRef.current) setConfirmOpen(false);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const opener = document.activeElement as HTMLElement | null;
    rootRef.current?.focus({ preventScroll: true });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus that wanders out (a click on something behind) is brought back.
    const onFocusIn = (e: FocusEvent) => {
      const root = rootRef.current;
      if (!root || confirmOpenRef.current) return;
      if (e.target instanceof Node && !root.contains(e.target))
        root.focus({ preventScroll: true });
    };
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.body.style.overflow = overflow;
      if (opener?.isConnected && opener !== document.body)
        opener.focus({ preventScroll: true });
    };
  }, [mounted]);

  const onKey = (e: KeyboardEvent) => {
    // The delete confirmation owns the keyboard while it is open.
    if (confirmOpenRef.current) return;
    const root = rootRef.current;
    if (!root) return;
    const target = e.target instanceof HTMLElement ? e.target : null;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };

    if (e.key === "Tab") {
      const items = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null);
      if (items.length === 0) {
        handled();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const inside = target && root.contains(target) && target !== root;
      if (e.shiftKey && (!inside || target === first)) {
        handled();
        last.focus();
      } else if (!e.shiftKey && (!inside || target === last)) {
        handled();
        first.focus();
      }
      return;
    }

    if (e.key === "Escape") {
      handled();
      if (helpOpen) setHelpOpen(false);
      else if (zoomed) setZoomedId(null);
      else onClose();
      return;
    }

    // Shortcuts of the page behind (⌘K, /) must not reach it.
    if (e.metaKey || e.ctrlKey || e.altKey) {
      if (e.key.toLowerCase() === "k") handled();
      return;
    }
    if (target?.closest('input, textarea, select, [contenteditable="true"]'))
      return;
    // A focused video keeps its own keys.
    if (
      target?.tagName === "VIDEO" &&
      [
        " ",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "k",
        "m",
        "f",
      ].includes(e.key)
    )
      return;

    switch (e.key) {
      case "ArrowLeft":
        handled();
        previous();
        break;
      case "ArrowRight":
        handled();
        next();
        break;
      case "Home":
        handled();
        goTo(0);
        break;
      case "End":
        handled();
        goTo(nav.total - 1);
        break;
      case " ":
        // Space presses a focused button; elsewhere it runs the slideshow.
        if (target?.closest("button, a")) return;
        handled();
        toggleSlideshow();
        break;
      case "f":
      case "F":
        if (!canFavorite) return;
        handled();
        toggleFavorite();
        break;
      case "i":
      case "I":
        handled();
        setInfoOpen((v) => !v);
        break;
      case "z":
      case "Z":
        handled();
        toggleZoom();
        break;
      case "?":
        handled();
        setHelpOpen((v) => !v);
        break;
      case "/":
        handled();
        break;
      case "Delete":
      case "Backspace":
        if (!canDelete) return;
        handled();
        setConfirmOpen(true);
        break;
    }
  };
  const onKeyRef = useRef(onKey);
  onKeyRef.current = onKey;

  useEffect(() => {
    // Capture phase: runs before the page's own shortcuts, which it can then stop.
    const listener = (e: KeyboardEvent) => {
      onKeyRef.current(e);
    };
    document.addEventListener("keydown", listener, true);
    return () => {
      document.removeEventListener("keydown", listener, true);
    };
  }, []);

  const chromeVisible = useAutoHide(
    rootRef,
    infoOpen || helpOpen || confirmOpen,
    mounted,
  );
  const chromeClass = cn(
    "transition-opacity duration-300 ease-out-soft",
    !chromeVisible && "pointer-events-none opacity-0",
  );

  // A mouse click on the paper around the photo closes, as it always has.
  const pointerType = useRef("mouse");
  const onStageClick = (e: React.MouseEvent) => {
    if (pointerType.current !== "mouse") return;
    if (
      e.target instanceof HTMLElement &&
      e.target.hasAttribute("data-backdrop")
    )
      onClose();
  };

  if (!mounted) return null;

  // Only what changes what you can do: a preview standing in for a file the
  // browser can't show, or an original that didn't come.
  const note = (() => {
    if (video) return null;
    if (full.status === "unavailable" && full.placeholder === "shown") {
      return (
        <>
          {isRawFile(current)
            ? "Aperçu du fichier RAW."
            : "Aperçu, ce format ne s’affiche pas en grand."}
          {allowDownload && (
            <NoteAction onClick={download}>Télécharger l’original</NoteAction>
          )}
        </>
      );
    }
    if (full.status === "error" && full.placeholder === "shown") {
      return (
        <>
          L’original n’a pas chargé.
          <NoteAction
            onClick={() => {
              setRetry({ id: currentId, value: retryKey + 1 });
            }}
          >
            Réessayer
          </NoteAction>
        </>
      );
    }
    return null;
  })();

  const nothingToShow =
    !video &&
    (full.status === "unavailable" || full.status === "error") &&
    full.placeholder === "none";

  const stageChildren = video ? (
    <ViewerVideo
      key={currentId}
      photo={current}
      sources={sources}
      sessionToken={session}
      allowDownload={allowDownload}
      onDownload={download}
      onSettled={onVideoSettled}
    />
  ) : (
    <ViewerPhoto
      key={currentId}
      photo={current}
      sources={sources}
      sessionToken={session}
      zoomed={zoomed}
      onZoomedChange={onZoomedChange}
      onStatus={onStatus}
      retryKey={retryKey}
    />
  );

  return createPortal(
    <>
      <div
        ref={rootRef}
        role="dialog"
        aria-modal="true"
        aria-label={name}
        tabIndex={-1}
        className={cn(
          "fixed inset-0 z-viewer flex animate-fade-in flex-col bg-paper text-ink outline-none",
          "pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]",
          !chromeVisible && "cursor-none",
        )}
        onPointerDownCapture={(e) => (pointerType.current = e.pointerType)}
      >
        <header
          data-chrome
          className={cn(
            "flex h-14 shrink-0 items-center justify-between gap-2 px-2 sm:px-4",
            chromeClass,
          )}
        >
          <IconButton
            icon={X}
            label="Fermer (Échap)"
            aria-keyshortcuts="Escape"
            onClick={onClose}
          />
          <PhotoViewerControls
            slideshow={
              nav.total > 1 ? { playing, onToggle: toggleSlideshow } : undefined
            }
            zoom={
              video
                ? undefined
                : {
                    active: zoomed,
                    available: full.status === "ready",
                    onToggle: toggleZoom,
                  }
            }
            favorite={
              canFavorite
                ? { active: favorite.isFavorite, onToggle: toggleFavorite }
                : undefined
            }
            info={{
              open: infoOpen,
              panelId: infoId,
              onToggle: () => {
                setInfoOpen((v) => !v);
              },
            }}
            onDownload={allowDownload ? download : undefined}
            onDelete={
              canDelete
                ? () => {
                    setConfirmOpen(true);
                  }
                : undefined
            }
            help={{
              open: helpOpen,
              panelId: helpId,
              onToggle: () => {
                setHelpOpen((v) => !v);
              },
            }}
          />
        </header>

        <div className="relative flex min-h-0 flex-1">
          <div className="relative flex min-w-0 flex-1 flex-col">
            {playing && (
              <div
                aria-hidden
                className="absolute inset-x-0 top-0 z-10 h-0.5 bg-line"
              >
                <SlideshowProgress
                  key={`${currentId}-${clockRunning}`}
                  running={clockRunning}
                />
              </div>
            )}

            <div
              className="relative min-h-0 flex-1"
              style={{ touchAction: zoomed ? "auto" : "pan-y pinch-zoom" }}
              data-backdrop
              onClick={onStageClick}
              {...swipe.handlers}
            >
              <div
                data-backdrop
                className={cn(
                  "absolute inset-0 px-0 py-2 sm:px-6 sm:py-3 md:px-20 lg:px-24",
                  !swipe.dragging &&
                    "transition-transform duration-200 ease-out-soft",
                )}
                style={{
                  transform: swipe.offset
                    ? `translate3d(${swipe.offset}px, 0, 0)`
                    : undefined,
                }}
              >
                <div data-backdrop className="relative h-full w-full">
                  {stageChildren}
                  {nothingToShow && (
                    <Unviewable
                      photo={current}
                      allowDownload={allowDownload}
                      onDownload={download}
                      onRetry={
                        full.status === "error"
                          ? () => {
                              setRetry({ id: currentId, value: retryKey + 1 });
                            }
                          : undefined
                      }
                    />
                  )}
                </div>
              </div>

              {nav.total > 1 && (
                <>
                  <div
                    data-chrome
                    className={cn(
                      "absolute left-3 top-1/2 hidden -translate-y-1/2 md:block lg:left-5",
                      chromeClass,
                    )}
                  >
                    <IconButton
                      icon={ChevronLeft}
                      label="Photo précédente (←)"
                      aria-keyshortcuts="ArrowLeft"
                      variant="secondary"
                      size="lg"
                      disabled={!nav.hasPrevious}
                      onClick={previous}
                      className="shadow-lift"
                    />
                  </div>
                  <div
                    data-chrome
                    className={cn(
                      "absolute right-3 top-1/2 hidden -translate-y-1/2 md:block lg:right-5",
                      chromeClass,
                    )}
                  >
                    <IconButton
                      icon={ChevronRight}
                      label="Photo suivante (→)"
                      aria-keyshortcuts="ArrowRight"
                      variant="secondary"
                      size="lg"
                      disabled={!nav.hasNext}
                      onClick={next}
                      className="shadow-lift"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="flex h-20 shrink-0 items-center gap-1 px-1 sm:px-6">
              {nav.total > 1 && (
                <IconButton
                  icon={ChevronLeft}
                  label="Photo précédente"
                  disabled={!nav.hasPrevious}
                  onClick={previous}
                  className="md:hidden"
                />
              )}
              <figure className="min-w-0 flex-1 text-center">
                <figcaption>
                  {day && (
                    <p className="truncate text-lg font-semibold leading-tight text-ink sm:text-xl">
                      {day}
                    </p>
                  )}
                  {(album || position) && (
                    <p
                      className={cn(
                        "flex items-center justify-center gap-x-2 truncate text-sm text-ink-muted",
                        day && "mt-1",
                      )}
                    >
                      {album && (
                        <Link
                          href={album.href}
                          className="truncate text-ink-soft underline-offset-2 transition-colors hover:text-ink hover:underline"
                        >
                          {album.title}
                        </Link>
                      )}
                      {album && position && <Dot />}
                      {position && (
                        <span className="tabular shrink-0">{position}</span>
                      )}
                    </p>
                  )}
                  {note && (
                    <p className="mt-1 truncate text-xs text-ink-muted">
                      {note}
                    </p>
                  )}
                </figcaption>
              </figure>
              {nav.total > 1 && (
                <IconButton
                  icon={ChevronRight}
                  label="Photo suivante"
                  disabled={!nav.hasNext}
                  onClick={next}
                  className="md:hidden"
                />
              )}
            </div>
          </div>

          {infoOpen && (
            <InfoPanel
              id={infoId}
              photo={current}
              showAlbum={!isSharedView}
              onClose={() => {
                setInfoOpen(false);
              }}
            />
          )}
        </div>

        {helpOpen && (
          <ShortcutsHelp
            id={helpId}
            canFavorite={canFavorite}
            canDelete={canDelete}
            onClose={() => {
              setHelpOpen(false);
            }}
          />
        )}

        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </div>

      <Dialog
        open={confirmOpen}
        onClose={closeConfirm}
        size="sm"
        title={"Supprimer cette photo\u00a0?"}
        description={`«\u00a0${current.filename}\u00a0» sera effacée du stockage, définitivement.`}
        footer={
          <>
            <Button data-autofocus onClick={closeConfirm} disabled={deleting}>
              Garder
            </Button>
            <Button variant="danger" onClick={confirmDelete} loading={deleting}>
              Supprimer
            </Button>
          </>
        }
      />
    </>,
    document.body,
  );
}

function Dot() {
  return (
    <span
      aria-hidden
      className="h-[3px] w-[3px] shrink-0 rounded-full bg-ink-faint"
    />
  );
}

function NoteAction({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ml-1 font-medium text-ink underline underline-offset-2 hover:decoration-2"
    >
      {children}
    </button>
  );
}

/** Fills over one slideshow interval. Reduced motion gets a still bar. */
function SlideshowProgress({ running }: { running: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !running) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = el.animate(
      [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
      {
        duration: SLIDESHOW_INTERVAL_MS,
        easing: "linear",
        fill: "forwards",
      },
    );
    return () => {
      animation.cancel();
    };
  }, [running]);
  return (
    <div
      ref={ref}
      className={cn(
        "h-full origin-left bg-accent",
        running ? "scale-x-100 motion-safe:scale-x-0" : "scale-x-0",
      )}
    />
  );
}

function Unviewable({
  photo,
  allowDownload,
  onDownload,
  onRetry,
}: {
  photo: Photo;
  allowDownload: boolean;
  onDownload: () => void;
  onRetry?: () => void;
}) {
  const ext = photo.filename.includes(".")
    ? photo.filename.split(".").pop()!.toUpperCase()
    : null;
  const message = onRetry
    ? "La photo n’a pas chargé"
    : isRawFile(photo)
      ? `Les fichiers RAW${ext ? ` (${ext})` : ""} ne s’affichent pas dans un navigateur`
      : "Ce format ne s’affiche pas dans un navigateur";
  return (
    <div
      data-backdrop
      className="absolute inset-0 flex items-center justify-center p-4"
    >
      <div className="flex max-w-md animate-fade-in flex-col items-center rounded-lg border border-line bg-surface px-6 py-10 text-center">
        <h2 className="text-pretty text-display-sm font-semibold text-ink">
          {message}
        </h2>
        {onRetry ? (
          <Button variant="primary" className="mt-6" onClick={onRetry}>
            Réessayer
          </Button>
        ) : (
          allowDownload && (
            <Button className="mt-6" onClick={onDownload}>
              Télécharger l’original
            </Button>
          )
        )}
      </div>
    </div>
  );
}
