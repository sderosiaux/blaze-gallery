"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Eye, EyeOff } from "lucide-react";
import {
  Button,
  Dialog,
  Field,
  IconButton,
  Input,
  Select,
  Switch,
  Textarea,
} from "@/components/ui";
import AlbumLinks from "@/components/sharing/AlbumLinks";
import { formatInstant } from "@/components/sharing/shareFormat";
import { useCopyLink } from "@/components/sharing/useCopyLink";
import { parseAlbumName } from "@/lib/albums";
import { createShare, listShares, type ShareLink } from "@/lib/shareClient";

interface ShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  folderPath: string;
  folderName: string;
}

type Expiry = "never" | "1" | "7" | "30" | "90" | "custom";

const EXPIRY_OPTIONS: Array<{ value: Expiry; label: string }> = [
  { value: "never", label: "Jamais" },
  { value: "1", label: "Dans 1 jour" },
  { value: "7", label: "Dans 7 jours" },
  { value: "30", label: "Dans 30 jours" },
  { value: "90", label: "Dans 3 mois" },
  { value: "custom", label: "Choisir une date" },
];

const NOTE_MAX = 500;
const DAY = 24 * 60 * 60 * 1000;

function localDateInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The instant the link stops working, or undefined for never. A chosen day lasts until its end. */
function expiryInstant(expiry: Expiry, customDate: string): string | undefined {
  if (expiry === "never") return undefined;
  if (expiry === "custom")
    return customDate
      ? new Date(`${customDate}T23:59:59`).toISOString()
      : undefined;
  return new Date(Date.now() + Number(expiry) * DAY).toISOString();
}

export default function ShareDialog({
  isOpen,
  onClose,
  folderPath,
  folderName,
}: ShareDialogProps) {
  const copy = useCopyLink();
  const path = useMemo(() => {
    try {
      return decodeURIComponent(folderPath);
    } catch {
      return folderPath;
    }
  }, [folderPath]);
  const { title } = parseAlbumName(folderName);

  // Callers pass inline closures; a stable one keeps Dialog from re-running its focus setup on every parent render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const close = useCallback(() => onCloseRef.current(), []);

  const [expiry, setExpiry] = useState<Expiry>("never");
  const [customDate, setCustomDate] = useState("");
  const [protect, setProtect] = useState(false);
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [allowDownload, setAllowDownload] = useState(true);
  const [note, setNote] = useState("");
  const [creating, setCreating] = useState(false);
  const [createFailed, setCreateFailed] = useState(false);
  const [created, setCreated] = useState<{
    share: ShareLink;
    url: string;
  } | null>(null);
  const copyButtonRef = useRef<HTMLButtonElement>(null);

  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [linksError, setLinksError] = useState(false);

  const loadLinks = useCallback(async () => {
    setLinksError(false);
    try {
      const all = await listShares();
      setLinks(all.filter((s) => s.folder_path === path));
    } catch {
      setLinksError(true);
    }
  }, [path]);

  useEffect(() => {
    if (isOpen) {
      loadLinks();
      return;
    }
    setExpiry("never");
    setCustomDate("");
    setProtect(false);
    setPassword("");
    setReveal(false);
    setAllowDownload(true);
    setNote("");
    setCreating(false);
    setCreateFailed(false);
    setCreated(null);
    setLinks(null);
  }, [isOpen, loadLinks]);

  useEffect(() => {
    if (created) copyButtonRef.current?.focus();
  }, [created]);

  const tomorrow = localDateInput(new Date(Date.now() + DAY));
  const expiresAt = expiryInstant(expiry, customDate);
  const missingPassword = protect && !password.trim();
  const missingDate = expiry === "custom" && !customDate;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creating || missingPassword || missingDate) return;
    setCreating(true);
    setCreateFailed(false);
    try {
      const result = await createShare({
        folder_path: path,
        allow_download: allowDownload,
        password: protect ? password.trim() : undefined,
        expires_at: expiresAt,
        description: note.trim() || undefined,
      });
      setCreated({ share: result.share, url: result.share_url });
      loadLinks();
    } catch {
      setCreateFailed(true);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onClose={close}
      title={created ? "Lien créé" : "Partager"}
      description={title}
      footer={
        created ? (
          <Button variant="secondary" onClick={close}>
            Fermer
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              Annuler
            </Button>
            <Button
              type="submit"
              form="share-form"
              variant="primary"
              loading={creating}
              disabled={missingPassword || missingDate}
            >
              Créer le lien
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="flex animate-fade-in flex-col gap-2 sm:flex-row">
          <Input
            readOnly
            value={created.url}
            aria-label="Lien"
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 bg-surface-sunken sm:flex-1"
          />
          <Button
            ref={copyButtonRef}
            variant="primary"
            icon={Copy}
            onClick={() => copy(created.url)}
          >
            Copier le lien
          </Button>
        </div>
      ) : (
        <form
          id="share-form"
          onSubmit={submit}
          className="space-y-5"
          noValidate
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Expiration"
              htmlFor="share-expiry"
              hint={
                expiry !== "never" && expiry !== "custom" && expiresAt
                  ? `Jusqu'au ${formatInstant(expiresAt)}`
                  : undefined
              }
              className={expiry === "custom" ? undefined : "sm:col-span-2"}
            >
              <Select
                id="share-expiry"
                data-autofocus
                value={expiry}
                onChange={(e) => setExpiry(e.target.value as Expiry)}
              >
                {EXPIRY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            {expiry === "custom" && (
              <Field label="Dernier jour" htmlFor="share-expiry-date">
                <Input
                  id="share-expiry-date"
                  type="date"
                  min={tomorrow}
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                />
              </Field>
            )}
          </div>

          <div className="space-y-3">
            <Switch
              id="share-protect"
              checked={protect}
              onChange={setProtect}
              label="Mot de passe"
            />
            {protect && (
              <div className="relative animate-fade-in">
                <Input
                  id="share-password"
                  aria-label="Mot de passe"
                  type={reveal ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  autoFocus
                  className="pr-12"
                />
                <IconButton
                  icon={reveal ? EyeOff : Eye}
                  label={
                    reveal
                      ? "Masquer le mot de passe"
                      : "Afficher le mot de passe"
                  }
                  size="sm"
                  onClick={() => setReveal((r) => !r)}
                  className="absolute right-1 top-1/2 -translate-y-1/2"
                />
              </div>
            )}
          </div>

          <Switch
            id="share-download"
            checked={allowDownload}
            onChange={setAllowDownload}
            label="Autoriser le téléchargement"
          />

          <Field label="Note" htmlFor="share-note">
            <Textarea
              id="share-note"
              value={note}
              maxLength={NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
            />
          </Field>

          {createFailed && (
            <p
              role="alert"
              className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger"
            >
              Le lien n&apos;a pas pu être créé.
            </p>
          )}
        </form>
      )}

      <AlbumLinks
        links={links}
        error={linksError}
        onRetry={loadLinks}
        highlightToken={created?.share.share_token}
      />
    </Dialog>
  );
}
