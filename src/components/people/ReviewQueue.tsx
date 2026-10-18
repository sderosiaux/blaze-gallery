"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCheck, RotateCcw, Sparkles, X } from "lucide-react";
import type { Candidate } from "@/lib/people";
import type { Photo } from "@/types";
import {
  Button,
  EmptyState,
  IconButton,
  Skeleton,
  useToast,
} from "@/components/ui";
import { LoadError } from "@/components/find/LoadError";
import { asArray, readJsonObject } from "@/hooks/apiJson";
import { formatNumber } from "@/lib/albums";
import { cn } from "@/lib/cn";
import { useElementSize } from "@/components/viewer/useElementSize";
import FaceThumb from "./FaceThumb";

type Verdict = "accepted" | "rejected";

interface Step {
  faceIds: number[];
  verdict: Verdict;
}

interface ReviewQueueProps {
  personId: number;
  name: string;
  /** Faces decided (or undone) here: counts and the photo list follow. */
  onChange: (delta: { accepted: number; decided: number }) => void;
  onOpenPhoto: (photo: Photo, list: Photo[]) => void;
}

const TILE = 112;
const MOBILE_TILE = 96;
const GAP = 8;
/** Room at the end of each row for its "accept the row" button. */
const ROW_ACTION = 44;

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

async function send(personId: number, decision: string, faceIds: number[]) {
  const response = await fetch(`/api/people/${String(personId)}/candidates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, face_ids: faceIds }),
  });
  const data = await readJsonObject(response);
  if (!response.ok || data.success !== true)
    throw new Error(`HTTP ${response.status}`);
}

/**
 * Faces the machine thinks may be her, closest first. One key per face:
 * G yes, X no, U undo; Maj+G takes the whole row. Decisions are written at
 * once; decided faces stay in place (dimmed or ticked) so the rows never
 * move under the keyboard.
 */
export default function ReviewQueue({
  personId,
  name,
  onChange,
  onOpenPhoto,
}: ReviewQueueProps) {
  const toast = useToast();
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [total, setTotal] = useState(0);
  const [verdicts, setVerdicts] = useState<Map<number, Verdict>>(new Map());
  const [history, setHistory] = useState<Step[]>([]);
  const [cursor, setCursor] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const area = useElementSize(wrapRef);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const response = await fetch(
        `/api/people/${String(personId)}/candidates?limit=300`,
      );
      const data = await readJsonObject(response);
      if (!response.ok || data.success !== true)
        throw new Error(`HTTP ${response.status}`);
      setCandidates(asArray(data.candidates) as Candidate[]);
      setTotal(typeof data.total === "number" ? data.total : 0);
      setVerdicts(new Map());
      setHistory([]);
      setCursor(0);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [personId]);

  useEffect(() => {
    void load();
  }, [load]);

  const tile = area.width < 520 ? MOBILE_TILE : TILE;
  const columns = Math.max(
    1,
    Math.floor((area.width - ROW_ACTION + GAP) / (tile + GAP)),
  );
  const rows = useMemo(() => {
    const out: { start: number; items: Candidate[] }[] = [];
    for (let start = 0; start < candidates.length; start += columns)
      out.push({ start, items: candidates.slice(start, start + columns) });
    return out;
  }, [candidates, columns]);

  const decidedCount = verdicts.size;
  const remaining = total - decidedCount;
  const current = candidates[cursor];

  const focusTile = useCallback((index: number) => {
    gridRef.current
      ?.querySelector<HTMLElement>(`[data-index="${String(index)}"]`)
      ?.focus({ preventScroll: false });
  }, []);

  const moveTo = useCallback(
    (index: number) => {
      const next = Math.min(Math.max(index, 0), candidates.length - 1);
      setCursor(next);
      focusTile(next);
    },
    [candidates.length, focusTile],
  );

  const nextUndecided = useCallback(
    (from: number, decided: Map<number, Verdict>) => {
      for (let i = from + 1; i < candidates.length; i++) {
        const c = candidates[i];
        if (c && !decided.has(c.face_id)) return i;
      }
      return from;
    },
    [candidates],
  );

  const decide = useCallback(
    async (faceIds: number[], verdict: Verdict) => {
      const fresh = faceIds.filter((id) => verdicts.get(id) !== verdict);
      if (fresh.length === 0) return;
      const before = new Map(verdicts);
      const after = new Map(verdicts);
      fresh.forEach((id) => after.set(id, verdict));
      setVerdicts(after);
      setHistory((h) => [...h, { faceIds: fresh, verdict }]);
      const last = candidates.findIndex(
        (c) => c.face_id === fresh[fresh.length - 1],
      );
      moveTo(nextUndecided(last, after));
      const accepted =
        verdict === "accepted"
          ? fresh.length
          : -fresh.filter((id) => before.get(id) === "accepted").length;
      const newlyDecided = fresh.filter((id) => !before.has(id)).length;
      try {
        await send(
          personId,
          verdict === "accepted" ? "accept" : "reject",
          fresh,
        );
        onChange({ accepted, decided: newlyDecided });
      } catch {
        setVerdicts(before);
        setHistory((h) => h.slice(0, -1));
        toast.show("La décision n’a pas été enregistrée", "error");
      }
    },
    [verdicts, candidates, moveTo, nextUndecided, personId, onChange, toast],
  );

  const undo = useCallback(async () => {
    const step = history[history.length - 1];
    if (!step) return;
    const before = new Map(verdicts);
    const after = new Map(verdicts);
    step.faceIds.forEach((id) => after.delete(id));
    setVerdicts(after);
    setHistory((h) => h.slice(0, -1));
    const first = candidates.findIndex((c) => c.face_id === step.faceIds[0]);
    if (first >= 0) moveTo(first);
    try {
      await send(personId, "undo", step.faceIds);
      onChange({
        accepted: step.verdict === "accepted" ? -step.faceIds.length : 0,
        decided: -step.faceIds.length,
      });
    } catch {
      setVerdicts(before);
      setHistory((h) => [...h, step]);
      toast.show("L’annulation n’a pas été enregistrée", "error");
    }
  }, [history, verdicts, candidates, moveTo, personId, onChange, toast]);

  const rowOf = (index: number) => Math.floor(index / columns);
  const acceptRow = useCallback(
    (row: number) => {
      const ids = candidates
        .slice(row * columns, row * columns + columns)
        .filter((c) => !verdicts.has(c.face_id))
        .map((c) => c.face_id);
      if (ids.length) void decide(ids, "accepted");
    },
    [candidates, columns, verdicts, decide],
  );

  const open = useCallback(
    (index: number) => {
      const c = candidates[index];
      if (c)
        onOpenPhoto(
          c.photo,
          candidates.map((x) => x.photo),
        );
    },
    [candidates, onOpenPhoto],
  );

  // Keys work anywhere on the page while no dialog (the viewer) is open
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyRef.current = (e: KeyboardEvent) => {
    if (status !== "ready" || candidates.length === 0) return;
    if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
    if (document.querySelector('[aria-modal="true"]')) return;
    const c = candidates[cursor];
    const handled = () => {
      e.preventDefault();
    };
    switch (e.key) {
      case "g":
      case "G":
        handled();
        if (e.shiftKey) acceptRow(rowOf(cursor));
        else if (c) void decide([c.face_id], "accepted");
        break;
      case "x":
      case "X":
        handled();
        if (c) void decide([c.face_id], "rejected");
        break;
      case "u":
      case "U":
        handled();
        void undo();
        break;
      case "ArrowRight":
        handled();
        moveTo(cursor + 1);
        break;
      case "ArrowLeft":
        handled();
        moveTo(cursor - 1);
        break;
      case "ArrowDown":
        handled();
        moveTo(cursor + columns);
        break;
      case "ArrowUp":
        handled();
        moveTo(cursor - columns);
        break;
      case "Enter":
        if (!(e.target instanceof HTMLElement && e.target.dataset.index))
          return;
        handled();
        open(cursor);
        break;
    }
  };
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      keyRef.current(e);
    };
    document.addEventListener("keydown", listener);
    return () => {
      document.removeEventListener("keydown", listener);
    };
  }, []);

  const verdictOf = (c: Candidate) => verdicts.get(c.face_id);

  // The wrapper is always there: its width decides how many faces per row
  return (
    <div ref={wrapRef} className="pt-6">
      {status === "error" ? (
        <LoadError
          title="Les visages à trier n’ont pas pu être chargés"
          onRetry={() => void load()}
        />
      ) : status === "loading" ? (
        <div
          role="status"
          aria-label="Chargement des visages à trier"
          className="flex flex-wrap gap-2"
        >
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-24 w-24 rounded-lg sm:h-28 sm:w-28"
            />
          ))}
        </div>
      ) : candidates.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Rien à trier"
          body={`Les visages qui ressemblent à ${name} sans certitude arriveront ici.`}
          className="py-16"
        />
      ) : (
        renderQueue()
      )}
    </div>
  );

  function renderQueue() {
    return (
      <>
        <div
          ref={gridRef}
          role="grid"
          aria-label={`Visages qui ressemblent peut-être à ${name}`}
          aria-rowcount={rows.length}
          className="space-y-2"
        >
          {rows.map((row, r) => {
            const undecided = row.items.some((c) => !verdictOf(c));
            return (
              <div
                key={row.start}
                role="row"
                className="flex items-center"
                style={{ gap: GAP }}
              >
                {row.items.map((c, i) => {
                  const index = row.start + i;
                  const verdict = verdictOf(c);
                  const selected = index === cursor;
                  return (
                    <div
                      key={c.face_id}
                      role="gridcell"
                      aria-selected={selected}
                    >
                      <button
                        type="button"
                        data-index={index}
                        tabIndex={selected ? 0 : -1}
                        aria-label={`Visage ${String(index + 1)}${
                          verdict === "accepted"
                            ? `, ${name}`
                            : verdict === "rejected"
                              ? `, pas ${name}`
                              : ""
                        }`}
                        onClick={() => {
                          setCursor(index);
                        }}
                        onDoubleClick={() => {
                          open(index);
                        }}
                        className={cn(
                          "relative block rounded-lg outline-none transition-[opacity,box-shadow] duration-150",
                          selected
                            ? "ring-2 ring-accent ring-offset-2 ring-offset-paper"
                            : "hover:ring-1 hover:ring-line-strong",
                          verdict === "rejected" && "opacity-35",
                        )}
                        style={{ width: tile, height: tile }}
                      >
                        <FaceThumb
                          faceId={c.face_id}
                          className="h-full w-full rounded-lg"
                        />
                        {verdict && (
                          <span
                            aria-hidden
                            className={cn(
                              "absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-on-photo shadow-lift",
                              verdict === "accepted" ? "bg-success" : "bg-ink",
                            )}
                          >
                            {verdict === "accepted" ? (
                              <Check className="h-3.5 w-3.5" />
                            ) : (
                              <X className="h-3.5 w-3.5" />
                            )}
                          </span>
                        )}
                      </button>
                    </div>
                  );
                })}
                <div role="gridcell" className="ml-auto pl-1">
                  {undecided && (
                    <IconButton
                      icon={CheckCheck}
                      size="sm"
                      label="Tout valider sur cette ligne (Maj+G)"
                      onClick={() => {
                        acceptRow(r);
                      }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {candidates.length < total && decidedCount === candidates.length && (
          <div className="mt-8 flex justify-center">
            <Button icon={RotateCcw} onClick={() => void load()}>
              Visages suivants
            </Button>
          </div>
        )}

        <div className="sticky bottom-4 z-10 mt-8 flex justify-center">
          <div className="flex max-w-full items-center gap-1 rounded-full border border-line bg-surface/95 p-1.5 shadow-pop backdrop-blur-md">
            <span className="tabular hidden px-3 text-sm text-ink-muted sm:inline">
              {formatNumber(Math.max(remaining, 0))} restants
            </span>
            <Button
              size="sm"
              variant="primary"
              icon={Check}
              disabled={!current}
              onClick={() => {
                if (current) void decide([current.face_id], "accepted");
              }}
            >
              <span className="truncate">C’est {name}</span>
              <kbd className="ml-1 hidden rounded bg-paper/20 px-1 text-[11px] font-medium sm:inline">
                G
              </kbd>
            </Button>
            <Button
              size="sm"
              icon={X}
              disabled={!current}
              onClick={() => {
                if (current) void decide([current.face_id], "rejected");
              }}
            >
              <span className="truncate">Pas {name}</span>
              <kbd className="ml-1 hidden rounded bg-surface-sunken px-1 text-[11px] font-medium text-ink-muted sm:inline">
                X
              </kbd>
            </Button>
            <IconButton
              icon={RotateCcw}
              size="sm"
              label="Annuler la dernière décision (U)"
              disabled={history.length === 0}
              onClick={() => void undo()}
            />
          </div>
        </div>
      </>
    );
  }
}
