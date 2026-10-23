"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Dialog } from "@/components/ui";
import { formatCount } from "@/lib/albums";
import type { CopiesPreview, CopiesSelection } from "@/lib/allCopies";
import {
  previewAllCopies,
  trashAllCopies,
  TrashError,
} from "@/lib/trashClient";

export default function AllCopiesDialog({
  selection,
  onClose,
  onDone,
  onChanged,
}: {
  selection: CopiesSelection;
  onClose: () => void;
  onDone: (result: { count: number; lot: string }) => void;
  onChanged: (message: string) => void;
}) {
  const [preview, setPreview] = useState<CopiesPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let live = true;
    setPreview(null);
    setError(null);
    previewAllCopies(selection)
      .then((result) => {
        if (live) setPreview(result);
      })
      .catch((error: unknown) => {
        if (live)
          setError(
            error instanceof TrashError
              ? error.message
              : "Le compte des copies n’a pas pu être chargé.",
          );
      });
    return () => {
      live = false;
    };
  }, [selection, attempt]);

  const close = useCallback(() => {
    if (!sending) onClose();
  }, [sending, onClose]);

  const send = async () => {
    if (!preview || sending) return;
    setSending(true);
    setError(null);
    try {
      onDone(await trashAllCopies(selection, preview.signature));
    } catch (error) {
      const message =
        error instanceof TrashError
          ? error.message
          : "Les copies n’ont pas pu être mises à la corbeille.";
      if (error instanceof TrashError && error.code === "STACKS_CHANGED")
        onChanged(message);
      else setError(message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog
      open
      onClose={close}
      title={
        preview
          ? `Mettre ${formatCount(preview.count, "copie")} à la corbeille ?`
          : "Toutes les copies identiques"
      }
      description="Toutes les piles de cet onglet sont prises en compte, même celles qui ne sont pas encore affichées."
      footer={
        <>
          <Button data-autofocus disabled={sending} onClick={close}>
            Annuler
          </Button>
          {error && !preview ? (
            <Button
              onClick={() => {
                setAttempt((n) => n + 1);
              }}
            >
              Réessayer
            </Button>
          ) : (
            <Button
              variant="danger"
              loading={sending}
              disabled={!preview || preview.count === 0}
              onClick={() => void send()}
            >
              {preview
                ? `Mettre ${formatCount(preview.count, "copie")} à la corbeille`
                : "Calcul en cours…"}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3 text-sm text-ink-muted">
        {preview ? (
          <>
            <p>
              Un exemplaire reste dans chacune des{" "}
              {formatCount(preview.stacks, "pile")} : votre choix pour les piles
              affichées, la photo proposée pour les autres.
            </p>
            {selection.skip.length > 0 && (
              <p>
                {formatCount(
                  selection.skip.length,
                  "pile décochée",
                  "piles décochées",
                )}{" "}
                : aucune photo ne sera déplacée.
              </p>
            )}
            <p>
              Les copies restent 30 jours dans la corbeille. Vous pouvez annuler
              toute l’opération.
            </p>
          </>
        ) : !error ? (
          <p role="status">Calcul de toutes les copies identiques…</p>
        ) : null}
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
