/**
 * One queue for every grid image on the page.
 *
 * Native lazy loading starts screens ahead and in no particular order, and a
 * few slow thumbnail generations can hold every connection (six per host on
 * HTTP/1.1) while the tiles in view wait. Here the tiles in view always go
 * first, then the next screen, each in reading order; expensive generations
 * get their own small lane; work for tiles that scrolled away is dropped.
 */

export type Lane = "fast" | "slow";
/** 0: in the viewport, 1: within a screen of it. */
export type Priority = 0 | 1;

// Six matches what a browser opens per host on HTTP/1.1. Generations may take
// four of them, never all: previews keep moving while originals are read.
const TOTAL_LIMIT = 6;
const LANE_LIMITS: Record<Lane, number> = { fast: 6, slow: 4 };

interface Job {
  url: string;
  lane: Lane;
  priority: Priority;
  order: number;
  seq: number;
  controller: AbortController;
  started: boolean;
  settle: (result: LoadResult) => void;
}

export type LoadResult =
  | { ok: true; objectUrl: string }
  | { ok: false; status: number | "aborted" | "network" };

export interface ImageRequest {
  promise: Promise<LoadResult>;
  setPriority: (priority: Priority) => void;
  cancel: () => void;
}

const queue: Job[] = [];
const running: Record<Lane, number> = { fast: 0, slow: 0 };
let nextSeq = 0;

function better(a: Job, b: Job) {
  if (a.priority !== b.priority) return a.priority < b.priority;
  // Same visibility: the cheap request first, it shows something sooner.
  if (a.lane !== b.lane) return a.lane === "fast";
  if (a.order !== b.order) return a.order < b.order;
  return a.seq < b.seq;
}

function pump() {
  while (running.fast + running.slow < TOTAL_LIMIT) {
    let best: Job | undefined;
    for (const job of queue) {
      if (job.started || running[job.lane] >= LANE_LIMITS[job.lane]) continue;
      if (!best || better(job, best)) best = job;
    }
    if (!best) return;
    start(best);
  }
}

function remove(job: Job) {
  const i = queue.indexOf(job);
  if (i >= 0) queue.splice(i, 1);
}

async function start(job: Job) {
  job.started = true;
  running[job.lane]++;
  try {
    const response = await fetch(job.url, { signal: job.controller.signal });
    if (!response.ok) {
      job.settle({ ok: false, status: response.status });
      return;
    }
    const blob = await response.blob();
    job.settle({ ok: true, objectUrl: URL.createObjectURL(blob) });
  } catch (error) {
    job.settle({
      ok: false,
      status: job.controller.signal.aborted ? "aborted" : "network",
    });
  } finally {
    running[job.lane]--;
    remove(job);
    pump();
  }
}

export function requestImage(
  url: string,
  lane: Lane,
  priority: Priority,
  order: number,
): ImageRequest {
  let settle!: (result: LoadResult) => void;
  const promise = new Promise<LoadResult>((resolve) => {
    settle = resolve;
  });
  const job: Job = {
    url,
    lane,
    priority,
    order,
    seq: nextSeq++,
    controller: new AbortController(),
    started: false,
    settle,
  };
  queue.push(job);
  pump();

  return {
    promise,
    setPriority(priority) {
      if (job.priority === priority) return;
      job.priority = priority;
      pump();
    },
    cancel() {
      if (job.started) {
        job.controller.abort();
      } else {
        remove(job);
        job.settle({ ok: false, status: "aborted" });
      }
    },
  };
}

/**
 * Two shared observers instead of one per tile: "near" (a screen above and
 * below) decides whether a tile may load at all, "visible" raises it to the
 * front of the queue.
 */
type VisibilityListener = (state: { near: boolean; visible: boolean }) => void;

const listeners = new Map<
  Element,
  { near: boolean; visible: boolean; listener: VisibilityListener }
>();
let nearObserver: IntersectionObserver | null = null;
let visibleObserver: IntersectionObserver | null = null;

function observers() {
  if (nearObserver && visibleObserver) return { nearObserver, visibleObserver };
  const update =
    (key: "near" | "visible") => (entries: IntersectionObserverEntry[]) => {
      for (const entry of entries) {
        const state = listeners.get(entry.target);
        if (!state || state[key] === entry.isIntersecting) continue;
        state[key] = entry.isIntersecting;
        state.listener({ near: state.near, visible: state.visible });
      }
    };
  nearObserver = new IntersectionObserver(update("near"), {
    rootMargin: "100% 0px",
  });
  visibleObserver = new IntersectionObserver(update("visible"), {
    rootMargin: "0px",
  });
  return { nearObserver, visibleObserver };
}

export function observeVisibility(
  element: Element,
  listener: VisibilityListener,
): () => void {
  const { nearObserver: near, visibleObserver: visible } = observers();
  listeners.set(element, { near: false, visible: false, listener });
  near.observe(element);
  visible.observe(element);
  return () => {
    near.unobserve(element);
    visible.unobserve(element);
    listeners.delete(element);
  };
}
