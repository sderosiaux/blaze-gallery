"use client";

import { useEffect, useRef } from "react";

interface WarmupBatch {
  generated: string[];
  remaining: number;
  next: string | null;
}

function parseBatch(body: unknown): WarmupBatch | null {
  if (typeof body !== "object" || body === null) return null;
  const { generated, remaining, next } = body as Record<string, unknown>;
  if (!Array.isArray(generated) || typeof remaining !== "number") return null;
  return {
    generated: generated.filter((id): id is string => typeof id === "string"),
    remaining,
    next: typeof next === "string" ? next : null,
  };
}

/** Let the first screen of tiles load before competing with it. */
const START_DELAY_MS = 1500;

/**
 * While a folder is open, asks the server to build its missing thumbnails,
 * one batch after the other, so the folder is complete for every later visit.
 * Stops when the folder is done, when the page goes away (the batch under way
 * still finishes on the server), and pauses while the tab is hidden.
 */
export function useFolderWarmup(
  folderPath: string | null,
  enabled: boolean,
  onGenerated: (photoIds: string[]) => void,
) {
  const onGeneratedRef = useRef(onGenerated);
  onGeneratedRef.current = onGenerated;

  useEffect(() => {
    if (!folderPath || !enabled) return;
    const controller = new AbortController();
    const { signal } = controller;

    const pause = (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve();
        });
      });

    const run = async () => {
      await pause(START_DELAY_MS);
      let after: string | null = null;
      while (!signal.aborted) {
        if (document.visibilityState === "hidden") {
          await pause(2000);
          continue;
        }
        const params = new URLSearchParams({ folder: folderPath });
        if (after) params.set("after", after);
        const response = await fetch(
          `/api/thumbnails/warm?${params.toString()}`,
          {
            method: "POST",
            signal,
          },
        );
        if (!response.ok) return;
        const batch = parseBatch(await response.json());
        if (!batch) return;
        if (batch.generated.length > 0) onGeneratedRef.current(batch.generated);
        if (!batch.next || batch.remaining === 0) return;
        after = batch.next;
      }
    };

    // Network errors and aborts end the loop; the next visit picks it up.
    run().catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [folderPath, enabled]);
}
