// Images the viewer has asked for, kept decoded so moving to a neighbour paints
// at once. Originals can take many seconds to arrive from storage, so loads the
// viewer no longer needs are cancelled to give the bandwidth back.

export type LoadStatus = "loading" | "ready" | "error";

export interface CachedImage {
  status: LoadStatus;
  /** What an <img> should use: the URL itself, or a blob URL for password-protected shares. */
  src?: string;
  width?: number;
  height?: number;
  /**
   * The decoded element itself, once ready. Originals redirect to signed
   * storage URLs that the browser won't reuse from memory, so a fresh <img>
   * with the same src downloads it all over again: show this one instead.
   */
  element?: HTMLImageElement;
}

interface Entry extends CachedImage {
  key: string;
  img?: HTMLImageElement;
  objectUrl?: string;
  abort?: AbortController;
  touched: number;
}

interface LoadOptions {
  /** Password-protected shares: sent as `x-share-session`, so the bytes go through fetch. */
  sessionToken?: string;
  priority?: "high" | "low";
}

// Finished images kept beyond the ones in use: enough to step back a few
// photos at once, small enough that a dozen-megabyte originals don't pile up.
const KEEP_READY = 6;
const entries = new Map<string, Entry>();
// Keyed by URL rather than by entry, so a retried load keeps its subscribers.
const listeners = new Map<string, Set<() => void>>();
let clock = 0;

function notify(entry: Entry) {
  listeners.get(entry.key)?.forEach((fn) => fn());
}

function settle(entry: Entry, img: HTMLImageElement) {
  // decode() can reject for very large images that still display fine.
  img
    .decode()
    .catch(() => undefined)
    .then(() => {
      if (entries.get(entry.key) !== entry) return;
      entry.status = "ready";
      entry.width = img.naturalWidth;
      entry.height = img.naturalHeight;
      entry.element = img;
      notify(entry);
    });
}

function fail(entry: Entry) {
  if (entries.get(entry.key) !== entry) return;
  entry.status = "error";
  notify(entry);
}

function startImage(entry: Entry, src: string, priority: "high" | "low") {
  const img = new Image();
  img.decoding = "async";
  img.fetchPriority = priority;
  img.onload = () => settle(entry, img);
  img.onerror = () => fail(entry);
  entry.img = img;
  entry.src = src;
  img.src = src;
}

function start(entry: Entry, options: LoadOptions) {
  const priority = options.priority ?? "low";
  if (!options.sessionToken) {
    startImage(entry, entry.key, priority);
    return;
  }
  const abort = new AbortController();
  entry.abort = abort;
  fetch(entry.key, { headers: { "x-share-session": options.sessionToken }, signal: abort.signal })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.blob();
    })
    .then((blob) => {
      if (entries.get(entry.key) !== entry) return;
      entry.objectUrl = URL.createObjectURL(blob);
      startImage(entry, entry.objectUrl, priority);
    })
    .catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      fail(entry);
    });
}

function drop(entry: Entry) {
  entries.delete(entry.key);
  entry.abort?.abort();
  if (entry.img && entry.status === "loading") {
    entry.img.onload = null;
    entry.img.onerror = null;
    entry.img.src = "";
  }
  if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
}

/** Starts (or reuses) a load. A failed one is only retried when `retry` is set. */
export function loadImage(key: string, options: LoadOptions & { retry?: boolean } = {}): CachedImage {
  let entry = entries.get(key);
  if (entry?.status === "error" && options.retry) {
    drop(entry);
    entry = undefined;
  }
  if (!entry) {
    entry = { key, status: "loading", touched: ++clock };
    entries.set(key, entry);
    start(entry, options);
    notify(entry);
  } else {
    entry.touched = ++clock;
    if (options.priority === "high" && entry.img) entry.img.fetchPriority = "high";
  }
  return entry;
}

export function peekImage(key: string): CachedImage | undefined {
  return entries.get(key);
}

export function subscribeImage(key: string, listener: () => void): () => void {
  const set = listeners.get(key) ?? new Set<() => void>();
  set.add(listener);
  listeners.set(key, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(key);
  };
}

/**
 * Cancels every load outside `keep` that hasn't finished, and forgets the
 * least recently used finished ones beyond a small budget.
 */
export function retainImages(keep: Iterable<string>) {
  const kept = new Set(keep);
  const ready: Entry[] = [];
  entries.forEach((entry) => {
    if (kept.has(entry.key) || listeners.has(entry.key)) return;
    if (entry.status !== "ready") drop(entry);
    else ready.push(entry);
  });
  ready
    .sort((a, b) => b.touched - a.touched)
    .slice(KEEP_READY)
    .forEach(drop);
}
