"use client";

import { useEffect, useState } from "react";
import { Button, Dialog, Field, Input } from "@/components/ui";
import { formatSize } from "@/components/stats/format";
import { formatCount, formatNumber } from "@/lib/albums";
import { cn } from "@/lib/cn";

/** What « Vider » may erase, as the server counted it (lib/trash.ts listTrash). */
export interface EmptyCounts {
  total: number;
  bytes: number;
  /** Waited the Corbeille's days or more, up to dueCutoff */
  due: number;
  dueBytes: number;
  dueCutoff: string;
  /** When the server counted: the cutoff of everything */
  asOf: string;
}

type Scope = "due" | "all";

/** The typed word that confirms as well as the count. */
const WORD = "VIDER";

/** The count as typed, spaces of any kind ignored ("33 961", "33961"). */
const typedCount = (value: string) => value.replace(/[\s\u00a0\u202f]/g, "");

/**
 * « Vider la corbeille »: the photos that have waited TRASH_DAYS by
 * default, everything on request, erased for good once the owner types
 * the count shown (or VIDER).
 */
export default function EmptyDialog({
  open,
  counts,
  days,
  progress,
  onClose,
  onEmpty,
}: {
  open: boolean;
  counts: EmptyCounts;
  days: number;
  /** Photos erased so far; null before it starts */
  progress: number | null;
  onClose: () => void;
  onEmpty: (confirmed: { expected: number; cutoff: string }) => void;
}) {
  const [scope, setScope] = useState<Scope>("due");
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (open) {
      setScope("due");
      setTyped("");
    }
  }, [open]);

  const n = scope === "due" ? counts.due : counts.total;
  const confirmed =
    n > 0 &&
    (typedCount(typed) === String(n) || typed.trim().toUpperCase() === WORD);
  const running = progress !== null;

  const options: { scope: Scope; label: string; n: number; bytes: number }[] = [
    {
      scope: "due",
      label: `Vider seulement ce qui a plus de ${days} jours`,
      n: counts.due,
      bytes: counts.dueBytes,
    },
    { scope: "all", label: "Tout vider", n: counts.total, bytes: counts.bytes },
  ];

  return (
    <Dialog
      open={open}
      onClose={() => {
        // Once started it goes on: each batch is erased for good
        if (!running) onClose();
      }}
      size="sm"
      title="Vider la corbeille ?"
      description={
        running
          ? `Effacement : ${formatNumber(progress)} sur ${formatNumber(n)}`
          : "Les fichiers sont effacés du stockage, toutes versions comprises. On ne peut pas les récupérer."
      }
      footer={
        <>
          <Button data-autofocus disabled={running} onClick={onClose}>
            Garder
          </Button>
          <Button
            variant="danger"
            loading={running}
            disabled={!confirmed}
            onClick={() => {
              onEmpty({
                expected: n,
                cutoff: scope === "due" ? counts.dueCutoff : counts.asOf,
              });
            }}
          >
            {n > 0 ? `Effacer ${formatCount(n, "photo")}` : "Effacer"}
          </Button>
        </>
      }
    >
      <div role="radiogroup" aria-label="Que vider" className="space-y-2">
        {options.map((option) => {
          const on = option.scope === scope;
          return (
            <button
              key={option.scope}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={running}
              onClick={() => {
                setScope(option.scope);
                setTyped("");
              }}
              className={cn(
                "flex w-full items-baseline justify-between gap-3 rounded-md border px-3 py-2.5 text-left transition-colors duration-200",
                on
                  ? "border-ink bg-surface-sunken"
                  : "border-line hover:border-ink-muted",
              )}
            >
              <span className="text-sm font-medium text-ink">
                {option.label}
              </span>
              <span className="tabular whitespace-nowrap text-sm text-ink-muted">
                {option.n > 0
                  ? `${formatCount(option.n, "photo")} · ${formatSize(option.bytes)}`
                  : "aucune photo"}
              </span>
            </button>
          );
        })}
      </div>
      {n > 0 ? (
        <Field
          className="mt-4"
          label={`Pour confirmer, tapez ${formatNumber(n)} ou ${WORD}`}
          htmlFor="empty-confirm"
        >
          <Input
            id="empty-confirm"
            autoComplete="off"
            spellCheck={false}
            disabled={running}
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
            }}
          />
        </Field>
      ) : (
        <p className="mt-4 text-sm text-ink-muted">
          {`Aucune photo n’est dans la corbeille depuis ${days} jours.`}
        </p>
      )}
    </Dialog>
  );
}
