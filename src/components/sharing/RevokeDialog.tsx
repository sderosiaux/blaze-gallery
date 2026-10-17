"use client";

import { useCallback, useRef, useState } from "react";
import { Button, Dialog } from "@/components/ui";
import { parseAlbumName } from "@/lib/albums";
import { folderNameOf, revokeShare, type ShareLink } from "@/lib/shareClient";
import { cn } from "@/lib/cn";

interface RevokeDialogProps {
  share: ShareLink | null;
  onClose: () => void;
  onRevoked: (share: ShareLink) => void;
}

export default function RevokeDialog({
  share,
  onClose,
  onRevoked,
}: RevokeDialogProps) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const title = share
    ? parseAlbumName(share.folder_name || folderNameOf(share.folder_path)).title
    : "";

  // Stable, so Dialog keeps focus where it is while the request runs.
  const busyRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const close = useCallback(() => {
    if (busyRef.current) return;
    setFailed(false);
    onCloseRef.current();
  }, []);

  const confirm = async () => {
    if (!share) return;
    busyRef.current = true;
    setBusy(true);
    setFailed(false);
    try {
      await revokeShare(share.share_token);
      busyRef.current = false;
      onRevoked(share);
    } catch {
      setFailed(true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={share !== null}
      onClose={close}
      size="sm"
      title={"Révoquer ce lien\u00a0?"}
      description={title}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={close}
            data-autofocus
            disabled={busy}
          >
            Annuler
          </Button>
          <Button variant="danger" onClick={confirm} loading={busy}>
            Révoquer
          </Button>
        </>
      }
    >
      <p
        role={failed ? "alert" : undefined}
        className={cn(
          "text-sm leading-relaxed",
          failed ? "text-danger" : "text-ink-soft",
        )}
      >
        {failed
          ? "Le lien n'a pas pu être révoqué."
          : "Le dossier ne s'ouvrira plus avec ce lien."}
      </p>
    </Dialog>
  );
}
