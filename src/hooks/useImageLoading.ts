import { useCallback, useState, useSyncExternalStore } from "react";
import { loadImage, peekImage, subscribeImage, type CachedImage } from "@/components/viewer/imageCache";

interface Options {
  sessionToken?: string;
  priority?: "high" | "low";
}

/**
 * One image through the viewer's cache: starts the load, re-renders when it
 * settles. A URL that was preloaded comes back "ready" on the first render,
 * so a neighbour the viewer already fetched never flashes its placeholder.
 */
export function useImageLoading(
  src: string | null | undefined,
  { sessionToken, priority = "high" }: Options = {},
): CachedImage & { retry: () => void } {
  const [attempt, setAttempt] = useState(0);

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!src) return () => undefined;
      const unsubscribe = subscribeImage(src, onChange);
      loadImage(src, { sessionToken, priority, retry: attempt > 0 });
      onChange();
      return unsubscribe;
    },
    [src, sessionToken, priority, attempt],
  );

  const status = useSyncExternalStore(
    subscribe,
    () => (src ? (peekImage(src)?.status ?? "loading") : "error"),
    () => "loading" as const,
  );

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const entry = src ? peekImage(src) : undefined;

  return {
    status,
    src: status === "ready" ? entry?.src : undefined,
    width: entry?.width,
    height: entry?.height,
    element: status === "ready" ? entry?.element : undefined,
    retry,
  };
}
