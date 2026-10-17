import { useEffect, useState } from "react";

export const SLIDESHOW_INTERVAL_MS = 4000;
// An original that takes longer than this is skipped past rather than waited on.
const MAX_WAIT_MS = 15000;

interface Options {
  playing: boolean;
  /** Changes with every photo, restarting the clock. */
  photoKey: string;
  /** The photo is on screen at its best (or will not get better). */
  ready: boolean;
  /** Videos move on when they end, not on a clock. */
  waitForEnd: boolean;
  hasNext: boolean;
  onNext: () => void;
  onEnd: () => void;
}

/** Returns whether the clock is running for the current photo. */
export function useSlideshow({
  playing,
  photoKey,
  ready,
  waitForEnd,
  hasNext,
  onNext,
  onEnd,
}: Options): boolean {
  const [stalled, setStalled] = useState<string | null>(null);

  useEffect(() => {
    if (!playing || ready) return;
    const timer = setTimeout(() => setStalled(photoKey), MAX_WAIT_MS);
    return () => clearTimeout(timer);
  }, [playing, ready, photoKey]);

  const running = playing && !waitForEnd && (ready || stalled === photoKey);

  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(
      () => (hasNext ? onNext() : onEnd()),
      SLIDESHOW_INTERVAL_MS,
    );
    return () => clearTimeout(timer);
  }, [running, photoKey, hasNext, onNext, onEnd]);

  return running;
}
