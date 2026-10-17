"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { AlertCircle, CheckCircle2, ImagePlus, Loader2, X } from "lucide-react";
import { IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";

// Client-side media file validation (can't import from s3.ts - it uses Node modules)
const MEDIA_EXTENSIONS = new Set([
  // Images
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".webp",
  ".tiff",
  ".tif",
  ".svg",
  ".nef",
  ".cr2",
  ".cr3",
  ".arw",
  ".dng",
  ".raf",
  ".orf",
  ".rw2",
  ".pef",
  ".srw",
  ".x3f",
  ".heic",
  ".heif",
  ".avif",
  // Videos
  ".mp4",
  ".m4v",
  ".mov",
  ".avi",
  ".wmv",
  ".mkv",
  ".webm",
  ".flv",
  ".ogv",
  ".3gp",
  ".3g2",
  ".mts",
  ".m2ts",
  ".ts",
]);

function isMediaFile(filename: string): boolean {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf("."));
  return MEDIA_EXTENSIONS.has(ext);
}

const hasFiles = (e: DragEvent) =>
  Array.from(e.dataTransfer?.types ?? []).includes("Files");

interface UploadItem {
  id: string;
  file: File;
  status: "uploading" | "success" | "error";
  error?: string;
}

export interface AlbumDropZoneHandle {
  openPicker: () => void;
}

interface AlbumDropZoneProps {
  /** Where files go. Null on pages that are not an album: dropping is refused with a hint. */
  target: { path: string; title: string } | null;
  /** Called once a batch has settled with at least one file stored. */
  onUploaded?: () => void;
  children: React.ReactNode;
}

/**
 * Files dragged anywhere over the page light up a full-window overlay naming
 * the album they will land in. Listening on the window, not on a wrapper,
 * means the sidebar and the top bar count too, and a stray drop never makes
 * the browser navigate away to the file.
 */
const AlbumDropZone = forwardRef<AlbumDropZoneHandle, AlbumDropZoneProps>(
  function AlbumDropZone({ target, onUploaded, children }, ref) {
    const [dragging, setDragging] = useState(false);
    const [uploads, setUploads] = useState<UploadItem[]>([]);
    const [panelOpen, setPanelOpen] = useState(false);
    const [skipped, setSkipped] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const depth = useRef(0);
    const settled = useRef({ pending: 0, stored: 0 });
    const targetRef = useRef(target);
    const onUploadedRef = useRef(onUploaded);
    targetRef.current = target;
    onUploadedRef.current = onUploaded;

    useImperativeHandle(
      ref,
      () => ({ openPicker: () => inputRef.current?.click() }),
      [],
    );

    const upload = useCallback(async (item: UploadItem, folderPath: string) => {
      try {
        const formData = new FormData();
        formData.append("file", item.file);
        formData.append("folder", folderPath);
        const response = await fetch("/api/photos/upload", {
          method: "POST",
          body: formData,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Upload failed");
        settled.current.stored++;
        setUploads((all) =>
          all.map((u) => (u.id === item.id ? { ...u, status: "success" } : u)),
        );
      } catch (error) {
        setUploads((all) =>
          all.map((u) =>
            u.id === item.id
              ? {
                  ...u,
                  status: "error",
                  error:
                    error instanceof Error ? error.message : "Upload failed",
                }
              : u,
          ),
        );
      } finally {
        settled.current.pending--;
        if (settled.current.pending === 0 && settled.current.stored > 0) {
          settled.current.stored = 0;
          onUploadedRef.current?.();
        }
      }
    }, []);

    const addFiles = useCallback(
      (files: FileList | File[]) => {
        const destination = targetRef.current;
        if (!destination) return;
        const all = Array.from(files);
        const media = all.filter((file) => isMediaFile(file.name));
        setSkipped(all.length - media.length);
        setPanelOpen(true);
        if (media.length === 0) return;
        const items: UploadItem[] = media.map((file) => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
          file,
          status: "uploading",
        }));
        settled.current.pending += items.length;
        setUploads((prev) => [...prev, ...items]);
        items.forEach((item) => upload(item, destination.path));
      },
      [upload],
    );

    useEffect(() => {
      const onEnter = (e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current++;
        setDragging(true);
      };
      const onOver = (e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        if (e.dataTransfer)
          e.dataTransfer.dropEffect = targetRef.current ? "copy" : "none";
      };
      const onLeave = (e: DragEvent) => {
        if (!hasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      };
      const onDrop = (e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files);
      };
      const reset = () => {
        depth.current = 0;
        setDragging(false);
      };
      window.addEventListener("dragenter", onEnter);
      window.addEventListener("dragover", onOver);
      window.addEventListener("dragleave", onLeave);
      window.addEventListener("drop", onDrop);
      window.addEventListener("dragend", reset);
      return () => {
        window.removeEventListener("dragenter", onEnter);
        window.removeEventListener("dragover", onOver);
        window.removeEventListener("dragleave", onLeave);
        window.removeEventListener("drop", onDrop);
        window.removeEventListener("dragend", reset);
      };
    }, [addFiles]);

    const uploading = uploads.filter((u) => u.status === "uploading").length;
    const stored = uploads.filter((u) => u.status === "success").length;
    const failed = uploads.filter((u) => u.status === "error").length;

    const summary =
      uploading > 0
        ? `Adding ${uploading} of ${uploads.length} to ${target?.title ?? "the album"}`
        : failed > 0
          ? `${stored} added, ${failed} didn't go through`
          : `${stored} added to ${target?.title ?? "the album"}`;

    return (
      <>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,video/*"
          className="hidden"
          data-testid="add-photos-input"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            // Lets the same file be picked again after a failure.
            e.target.value = "";
          }}
        />

        {children}

        {dragging && (
          <div
            role="status"
            aria-live="polite"
            data-testid="drop-overlay"
            className="pointer-events-none fixed inset-0 z-overlay animate-fade-in bg-paper/80 p-3 backdrop-blur-sm sm:p-6"
          >
            <div
              className={cn(
                "flex h-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 text-center",
                target
                  ? "border-accent bg-accent-soft/40"
                  : "border-line-strong",
              )}
            >
              <span
                className={cn(
                  "mb-5 flex h-14 w-14 items-center justify-center rounded-full border bg-surface",
                  target
                    ? "border-accent/30 text-accent"
                    : "border-line text-ink-muted",
                )}
              >
                <ImagePlus className="h-6 w-6" aria-hidden />
              </span>
              {target ? (
                <>
                  <p className="kicker">Drop to add to</p>
                  <p className="mt-2 max-w-2xl text-balance break-words font-display text-display-md font-semibold text-ink">
                    {target.title}
                  </p>
                  <p className="mt-3 text-sm text-ink-muted">
                    Photos and videos only. Other files are left out.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-display text-display-sm font-semibold text-ink">
                    Open an album first
                  </p>
                  <p className="mt-2 max-w-sm text-sm text-ink-muted">
                    Photos are added to the album you are looking at. Pick one
                    below, then drop them there.
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        {panelOpen && (uploads.length > 0 || skipped > 0) && (
          <div
            role="region"
            aria-label="Uploads"
            className="fixed inset-x-3 bottom-3 z-overlay flex max-h-[50dvh] animate-rise-in flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-pop sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-96"
          >
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              {uploading > 0 ? (
                <Loader2
                  className="h-4 w-4 shrink-0 animate-spin text-ink-muted"
                  aria-hidden
                />
              ) : failed > 0 ? (
                <AlertCircle
                  className="h-4 w-4 shrink-0 text-danger"
                  aria-hidden
                />
              ) : (
                <CheckCircle2
                  className="h-4 w-4 shrink-0 text-success"
                  aria-hidden
                />
              )}
              <p
                className="min-w-0 flex-1 truncate text-sm font-medium text-ink"
                aria-live="polite"
              >
                {uploads.length > 0 ? summary : "Nothing to add"}
              </p>
              {uploading === 0 && stored > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setUploads((all) =>
                      all.filter((u) => u.status !== "success"),
                    )
                  }
                  className="shrink-0 rounded-sm text-xs text-ink-muted transition-colors hover:text-ink"
                >
                  Clear
                </button>
              )}
              <IconButton
                icon={X}
                label="Hide uploads"
                size="sm"
                className="-mr-2"
                onClick={() => setPanelOpen(false)}
              />
            </div>
            {skipped > 0 && (
              <p className="border-b border-line bg-warning-soft px-4 py-2 text-xs text-warning">
                {skipped === 1
                  ? "1 file was left out"
                  : `${skipped} files were left out`}
                : only photos and videos can be added.
              </p>
            )}
            <ul className="flex-1 divide-y divide-line overflow-y-auto">
              {uploads.map((u) => (
                <li key={u.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">{u.file.name}</p>
                    {u.status === "uploading" && (
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-sunken">
                        <div className="skeleton h-full w-full rounded-full" />
                      </div>
                    )}
                    {u.status === "error" && (
                      <p className="mt-0.5 truncate text-xs text-danger">
                        {u.error}
                      </p>
                    )}
                  </div>
                  {u.status === "uploading" && (
                    <span className="shrink-0 text-xs text-ink-muted">
                      Sending
                    </span>
                  )}
                  {u.status === "success" && (
                    <CheckCircle2
                      className="h-4 w-4 shrink-0 text-success"
                      aria-label="Added"
                    />
                  )}
                  {u.status === "error" && (
                    <IconButton
                      icon={X}
                      label={`Dismiss ${u.file.name}`}
                      size="sm"
                      onClick={() =>
                        setUploads((all) => all.filter((x) => x.id !== u.id))
                      }
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </>
    );
  },
);

export default AlbumDropZone;
