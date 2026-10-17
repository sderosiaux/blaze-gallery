"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Copy, Eye, EyeOff, ExternalLink } from "lucide-react";
import { Button, Dialog, Field, IconButton, Input, Select, Switch, Textarea, buttonClasses } from "@/components/ui";
import AlbumLinks from "@/components/sharing/AlbumLinks";
import { ShareBadges } from "@/components/sharing/ShareBadges";
import { expiryLabel, formatInstant } from "@/components/sharing/shareFormat";
import { useCopyLink } from "@/components/sharing/useCopyLink";
import { albumDateLabel, formatCount, parseAlbumName } from "@/lib/albums";
import { createShare, listShares, type ShareLink } from "@/lib/shareClient";

interface ShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  folderPath: string;
  folderName: string;
  /** Lets the dialog say how many photos the guest will see. */
  photoCount?: number;
}

type Expiry = "never" | "1" | "7" | "30" | "90" | "custom";

const EXPIRY_OPTIONS: Array<{ value: Expiry; label: string }> = [
  { value: "never", label: "Never" },
  { value: "1", label: "In 1 day" },
  { value: "7", label: "In 7 days" },
  { value: "30", label: "In 30 days" },
  { value: "90", label: "In 3 months" },
  { value: "custom", label: "On a date I choose" },
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
  if (expiry === "custom") return customDate ? new Date(`${customDate}T23:59:59`).toISOString() : undefined;
  return new Date(Date.now() + Number(expiry) * DAY).toISOString();
}

export default function ShareDialog({ isOpen, onClose, folderPath, folderName, photoCount }: ShareDialogProps) {
  const copy = useCopyLink();
  const path = useMemo(() => {
    try {
      return decodeURIComponent(folderPath);
    } catch {
      return folderPath;
    }
  }, [folderPath]);
  const { title } = parseAlbumName(folderName);
  const dateLabel = albumDateLabel({ name: folderName, date_from: null, date_to: null });

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
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ share: ShareLink; url: string } | null>(null);
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
    setCreateError(null);
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
    setCreateError(null);
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
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setCreating(false);
    }
  };

  const albumLine = (
    <>
      <span className="font-medium text-ink-soft">{title}</span>
      {dateLabel && <> · {dateLabel}</>}
      {photoCount !== undefined && <> · {formatCount(photoCount, "photo")}</>}
    </>
  );

  return (
    <Dialog
      open={isOpen}
      onClose={close}
      title={created ? "Your link is ready" : "Share this album"}
      description={created ? `Anyone with this link can open ${title}. Send it however you like.` : albumLine}
      footer={
        created ? (
          <>
            <a href={created.url} target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: "secondary" })}>
              <ExternalLink className="h-4 w-4" aria-hidden />
              Open as a guest
            </a>
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" form="share-form" variant="primary" loading={creating} disabled={missingPassword || missingDate}>
              Create link
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="animate-fade-in">
          <div className="flex items-center gap-2 text-sm font-medium text-success">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            Link created
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input
              readOnly
              value={created.url}
              aria-label="Share link"
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 bg-paper sm:flex-1"
            />
            <Button ref={copyButtonRef} variant="primary" icon={Copy} onClick={() => copy(created.url)}>
              Copy link
            </Button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-ink-muted">
            <ShareBadges share={created.share} />
            <span>{expiryLabel(created.share)}</span>
            {created.share.allow_download && <span>Downloads allowed</span>}
          </div>
        </div>
      ) : (
        <form id="share-form" onSubmit={submit} className="space-y-5" noValidate>
          <p className="text-sm leading-relaxed text-ink-muted">
            Guests see this album&apos;s photos on a simple page, without signing in and without the rest of your library.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Link expires"
              htmlFor="share-expiry"
              hint={expiry === "never" ? "Works until you revoke it" : expiry !== "custom" && expiresAt ? `Open until ${formatInstant(expiresAt)}` : undefined}
              className={expiry === "custom" ? undefined : "sm:col-span-2"}
            >
              <Select id="share-expiry" value={expiry} onChange={(e) => setExpiry(e.target.value as Expiry)}>
                {EXPIRY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            {expiry === "custom" && (
              <Field label="Last day" htmlFor="share-expiry-date" hint={customDate ? "Works until the end of that day" : "Pick a day"}>
                <Input id="share-expiry-date" type="date" min={tomorrow} value={customDate} onChange={(e) => setCustomDate(e.target.value)} />
              </Field>
            )}
          </div>

          <div className="space-y-3">
            <Switch
              id="share-protect"
              checked={protect}
              onChange={setProtect}
              label="Ask for a password"
              description="Guests type it once on each device."
            />
            {protect && (
              <div className="relative animate-fade-in">
                <Input
                  id="share-password"
                  aria-label="Password"
                  type={reveal ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Choose a password"
                  autoComplete="new-password"
                  autoFocus
                  className="pr-12"
                />
                <IconButton
                  icon={reveal ? EyeOff : Eye}
                  label={reveal ? "Hide password" : "Show password"}
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
            label="Allow downloads"
            description="Guests can save the original files. They can always view the photos."
          />

          <Field
            label="A note to your guests"
            htmlFor="share-note"
            hint={`Optional, shown at the top of the album. ${NOTE_MAX - note.length} characters left.`}
          >
            <Textarea
              id="share-note"
              value={note}
              maxLength={NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
              placeholder="The photos from Sunday, as promised."
              rows={3}
            />
          </Field>

          {createError && (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
              We couldn&apos;t create the link. {createError}
            </p>
          )}
        </form>
      )}

      <AlbumLinks links={links} error={linksError} onRetry={loadLinks} highlightToken={created?.share.share_token} />
    </Dialog>
  );
}
