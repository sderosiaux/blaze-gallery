"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Dialog } from "@/components/ui";
import { formatCount } from "@/lib/albums";
import type {
  DuplicatePreview,
  DuplicateSelection,
} from "@/lib/exactDuplicateTypes";
import {
  previewDuplicates,
  trashDuplicates,
  TrashError,
} from "@/lib/trashClient";
import { formatSize } from "./format";

export default function DuplicateTrashDialog({
  selection,
  onClose,
  onDone,
  onChanged,
}: {
  selection: DuplicateSelection;
  onClose: () => void;
  onDone: (result: { count: number; lot: string }) => void;
  onChanged: (message: string) => void;
}) {
  const [preview, setPreview] = useState<DuplicatePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    let live = true;
    setPreview(null);
    setError(null);
    previewDuplicates(selection)
      .then((result) => {
        if (live) setPreview(result);
      })
      .catch((error: unknown) => {
        if (live)
          setError(
            error instanceof TrashError
              ? error.message
              : "Le calcul des copies a échoué.",
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
      onDone(await trashDuplicates(selection, preview.signature));
    } catch (error) {
      const message =
        error instanceof TrashError
          ? error.message
          : "La mise à la corbeille n’a pas abouti.";
      if (error instanceof TrashError && error.code === "DUPLICATES_CHANGED")
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
          ? `Mettre ${formatCount(preview.count, "fichier")} à la corbeille ?`
          : "Vérification des copies"
      }
      description={
        selection.group === "all"
          ? "Tous les groupes confirmés de cette section sont concernés, même ceux qui ne sont pas encore affichés."
          : "Seules les copies de ce groupe seront déplacées."
      }
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
                ? `Mettre ${formatCount(preview.count, "fichier")} à la corbeille`
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
              {formatSize(preview.bytes)} de copies dans{" "}
              {formatCount(preview.groups, "groupe")}.
            </p>
            <p>
              {selection.kind === "folders"
                ? "Le dossier choisi conserve ses fichiers."
                : "Un exemplaire de chaque fichier reste."}{" "}
              {selection.group === "all" &&
                "Vos choix sont respectés. Pour les autres groupes, un exemplaire de la galerie est privilégié, puis un favori."}
            </p>
            {selection.skip.length > 0 && (
              <p>
                {formatCount(
                  selection.skip.length,
                  "groupe laissé tel quel",
                  "groupes laissés tels quels",
                )}
                .
              </p>
            )}
            {selection.kind === "folders" && (
              <p>
                Les sous-dossiers et les fichiers ignorés par l’analyse restent
                en place. Les dossiers eux-mêmes ne sont pas supprimés.
              </p>
            )}
            <p>
              Les fichiers restent 30 jours dans la corbeille. Tout le lot peut
              être restauré. L’espace sera libéré lors du vidage de la
              corbeille.
            </p>
          </>
        ) : !error ? (
          <p role="status">Vérification de tous les fichiers concernés…</p>
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
