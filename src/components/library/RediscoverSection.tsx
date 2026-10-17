"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImageOff, Shuffle } from "lucide-react";
import type { Photo } from "@/types";
import PhotoGrid from "@/components/PhotoGrid";
import { Button, EmptyState, Section } from "@/components/ui";
import { LoadError } from "./LoadError";
import { JustifiedSkeleton } from "./skeletons";
import { usePhotoParam } from "./usePhotoParam";

const SHOWN = 24;
// Random rows include videos, RAW files and game sprites; asking for more and
// keeping the JPEGs leaves photographs, the things worth rediscovering.
const ASKED = 72;
const STORAGE_KEY = "blaze:rediscover";

const NONE: Photo[] = [];

const isPhotograph = (p: Photo) => p.mime_type === "image/jpeg";

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; photos: Photo[] };

function remembered(): Photo[] | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const photos = raw ? (JSON.parse(raw) as Photo[]) : null;
    return Array.isArray(photos) && photos.length > 0 ? photos : null;
  } catch {
    return null;
  }
}

/**
 * A random handful from the whole library. The pick is kept for the session,
 * so coming back from an album, or reloading with `?photo=`, finds the same
 * photos instead of a new draw; Shuffle is the only thing that redraws.
 */
export default function RediscoverSection() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [shuffling, setShuffling] = useState(false);
  const [selectedPhotoId, setPhotoParam] = usePhotoParam();
  const request = useRef<AbortController | null>(null);

  const draw = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setShuffling(true);
    try {
      const response = await fetch(`/api/photos/random?limit=${ASKED}`, {
        signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error);
      const photos = (body.photos as Photo[])
        .filter(isPhotograph)
        .slice(0, SHOWN);
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(photos));
      } catch {
        // Private mode or a full quota: the pick just won't survive a reload.
      }
      setState({ status: "ready", photos });
    } catch {
      if (controller.signal.aborted) return;
      setState((s) => (s.status === "ready" ? s : { status: "error" }));
    } finally {
      if (request.current === controller) setShuffling(false);
    }
  }, []);

  useEffect(() => {
    const kept = remembered();
    if (kept) setState({ status: "ready", photos: kept });
    else draw();
    return () => request.current?.abort();
  }, [draw]);

  const photos = state.status === "ready" ? state.photos : NONE;

  // A `?photo=` that isn't in this pick (an old link, another session) would
  // otherwise sit in the address bar with nothing open.
  useEffect(() => {
    if (state.status !== "ready" || !selectedPhotoId) return;
    if (!photos.some((p) => String(p.id) === selectedPhotoId))
      setPhotoParam(null);
  }, [state.status, photos, selectedPhotoId, setPhotoParam]);

  return (
    <Section
      title="Rediscover"
      description="Photographs drawn at random from every album."
      action={
        <Button
          variant="ghost"
          size="sm"
          icon={Shuffle}
          loading={shuffling && state.status === "ready"}
          onClick={draw}
          disabled={state.status === "loading"}
        >
          Shuffle
        </Button>
      }
    >
      {state.status === "loading" && <JustifiedSkeleton count={12} />}
      {state.status === "error" && (
        <LoadError
          title="The photos didn't come through"
          onRetry={draw}
          className="py-10"
        />
      )}
      {state.status === "ready" &&
        (photos.length === 0 ? (
          <EmptyState
            icon={ImageOff}
            title="No photographs to show yet"
            body="Once albums with photos have been synced from the bucket, a few of them will turn up here."
            className="py-10"
          />
        ) : (
          // Dimmed and inert while a new pick is on its way: a photo opened
          // now would vanish from under the viewer when the pick lands.
          <div
            aria-busy={shuffling || undefined}
            className="transition-opacity duration-300 ease-out-soft aria-busy:pointer-events-none aria-busy:opacity-50"
          >
            <PhotoGrid
              photos={photos}
              selectedPhotoId={selectedPhotoId}
              onPhotoUrlChange={setPhotoParam}
              eagerCount={12}
            />
          </div>
        ))}
    </Section>
  );
}
