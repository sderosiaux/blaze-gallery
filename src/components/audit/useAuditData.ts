"use client";

import { useCallback, useEffect, useState } from "react";

interface State<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

interface Options {
  /** Changing it refetches the same URL. */
  reloadKey?: number;
  /** Gives up and reports an error after this long. */
  timeoutMs?: number;
}

/**
 * Fetches one `{ success, data }` audit endpoint. While a new request runs the
 * previous data stays, so a section can keep its frame instead of flashing a
 * skeleton; an error clears it, since it would describe another time range.
 */
export function useAuditData<T>(
  url: string | null,
  { reloadKey = 0, timeoutMs }: Options = {},
) {
  const [state, setState] = useState<State<T>>({
    data: null,
    error: null,
    loading: url !== null,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    let timedOut = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : undefined;

    setState((s) => ({ ...s, loading: true, error: null }));
    fetch(url, { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.success) {
          throw new Error(
            body?.details ||
              body?.error ||
              `The server answered ${res.status}.`,
          );
        }
        setState({ data: body.data as T, error: null, loading: false });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted && !timedOut) return;
        const message = timedOut
          ? `No answer after ${Math.round((timeoutMs ?? 0) / 1000)} seconds.`
          : err instanceof Error && err.message !== "Failed to fetch"
            ? err.message
            : "The server could not be reached.";
        setState({ data: null, error: message, loading: false });
      })
      .finally(() => clearTimeout(timer));

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [url, reloadKey, attempt, timeoutMs]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
