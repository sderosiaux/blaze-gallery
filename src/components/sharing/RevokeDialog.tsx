"use client";

import { useCallback, useRef, useState } from "react";
import { Button, Dialog } from "@/components/ui";
import { formatCount, parseAlbumName } from "@/lib/albums";
import { folderNameOf, revokeShare, type ShareLink } from "@/lib/shareClient";
import { formatInstant } from "./shareFormat";

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
  const [error, setError] = useState<string | null>(null);
  const title = share
    ? parseAlbumName(share.folder_name || folderNameOf(share.folder_path)).title
    : "";

  // Stable, so Dialog keeps focus where it is while the request runs.
  const busyRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const close = useCallback(() => {
    if (busyRef.current) return;
    setError(null);
    onCloseRef.current();
  }, []);

  const confirm = async () => {
    if (!share) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await revokeShare(share.share_token);
      busyRef.current = false;
      onRevoked(share);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
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
      title="Revoke this link?"
      description={
        share
          ? `${title} · link created ${formatInstant(share.created_at)}`
          : undefined
      }
      footer={
        <>
          <Button
            variant="ghost"
            onClick={close}
            data-autofocus
            disabled={busy}
          >
            Keep link
          </Button>
          <Button variant="danger" onClick={confirm} loading={busy}>
            Revoke link
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-soft">
        Anyone who opens it will see that the album is no longer shared.
        {share && share.view_count > 0 && (
          <> It has been opened {formatCount(share.view_count, "time")}.</>
        )}{" "}
        This can&apos;t be undone, but you can always create a new link from the
        album.
      </p>
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          The link is still active. {error}
        </p>
      )}
    </Dialog>
  );
}
