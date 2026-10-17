"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type Resource<T> =
  | { status: "idle" }
  | { status: "loading"; startedAt: number }
  | { status: "ready"; data: T; tookMs: number }
  | { status: "error"; error: string };

/**
 * Fetches one /api/stats/** endpoint the first time `enabled` is true, then
 * keeps the result: switching tabs back and forth never refetches. A failure
 * stays local to the caller, which shows its own retry.
 */
export function useStatsResource<T>(url: string, enabled: boolean) {
  const [state, setState] = useState<Resource<T>>({ status: "idle" });
  const controller = useRef<AbortController | null>(null);

  const fetchInto = useCallback(
    async (silent: boolean) => {
      controller.current?.abort();
      const ctrl = new AbortController();
      controller.current = ctrl;
      const startedAt = performance.now();
      if (!silent) setState({ status: "loading", startedAt });
      try {
        const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.success) {
          throw new Error(body?.error || `The server answered ${res.status}`);
        }
        setState({ status: "ready", data: body.data as T, tookMs: performance.now() - startedAt });
      } catch (error) {
        // A silent refresh that fails keeps the numbers already on screen.
        if (ctrl.signal.aborted || silent) return;
        setState({ status: "error", error: error instanceof Error ? error.message : "Unknown error" });
      }
    },
    [url],
  );

  const load = useCallback(() => fetchInto(false), [fetchInto]);
  /** Refetch while keeping the current render: no skeleton flash. */
  const refresh = useCallback(() => fetchInto(true), [fetchInto]);

  // A ref, not the state, guards the first load: Strict Mode runs the effect
  // twice before the "loading" state lands, and the server keeps running a
  // query even after its request is aborted, so a second request would double
  // the database work of the slow analyses.
  const requested = useRef(false);
  useEffect(() => {
    if (!enabled || requested.current) return;
    requested.current = true;
    load();
  }, [enabled, load]);

  return { state, retry: load, refresh };
}

/** Whole seconds since `startedAt` (ticking until it is undefined): progress for slow analyses. */
export function useElapsed(startedAt: number | undefined) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (startedAt === undefined) return;
    const id = window.setInterval(() => setNow(performance.now()), 500);
    return () => window.clearInterval(id);
  }, [startedAt]);
  return startedAt === undefined ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));
}
