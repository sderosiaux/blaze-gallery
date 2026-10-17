"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";
import { Button, IconButton, Input } from "@/components/ui";
import { albumDateLabel, parseAlbumName } from "@/lib/albums";
import { unlockShare, type GuestResult } from "@/lib/shareClient";
import { cn } from "@/lib/cn";

interface PasswordGateProps {
  token: string;
  /** Only known when the API tells it before the password; the gate reads fine without it. */
  albumName?: string;
  onResult: (result: GuestResult) => void;
}

export default function PasswordGate({
  token,
  albumName,
  onResult,
}: PasswordGateProps) {
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const title = albumName ? parseAlbumName(albumName).title : undefined;
  const dateLabel = albumName
    ? albumDateLabel({ name: albumName, date_from: null, date_to: null })
    : undefined;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = password.trim();
    if (!value || busy) return;
    setBusy(true);
    const result = await unlockShare(token, value);
    setBusy(false);
    if (result.kind === "wrong-password") {
      setWrong(true);
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }
    onResult(result);
  };

  return (
    <div className="w-full max-w-sm animate-rise-in py-16 text-center">
      <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full border border-line bg-surface text-ink-muted">
        <Lock className="h-6 w-6" aria-hidden />
      </div>
      {dateLabel && <div className="kicker mb-2">{dateLabel}</div>}
      <h1 className="text-balance break-words text-display-sm font-semibold text-ink">
        {title ?? "Dossier protégé"}
      </h1>
      <p
        id="share-password-message"
        role={wrong ? "alert" : undefined}
        className={cn("mt-2 text-sm", wrong ? "text-danger" : "text-ink-muted")}
      >
        {wrong
          ? "Ce mot de passe ne correspond pas."
          : "Ce dossier est protégé par un mot de passe."}
      </p>

      <form
        onSubmit={(e) => void submit(e)}
        className="mt-8 space-y-3"
        noValidate
      >
        <div className="relative">
          <Input
            ref={inputRef}
            id="share-password"
            type={reveal ? "text" : "password"}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (wrong) setWrong(false);
            }}
            placeholder="Mot de passe"
            aria-label="Mot de passe"
            autoComplete="current-password"
            aria-invalid={wrong || undefined}
            aria-describedby="share-password-message"
            className={cn(
              "h-12 pr-12 text-base",
              wrong && "border-danger focus:border-danger focus:ring-danger/20",
            )}
          />
          <IconButton
            icon={reveal ? EyeOff : Eye}
            label={
              reveal ? "Masquer le mot de passe" : "Afficher le mot de passe"
            }
            size="sm"
            onClick={() => {
              setReveal((r) => !r);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2"
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full"
          loading={busy}
          disabled={!password.trim()}
        >
          Ouvrir
        </Button>
      </form>
    </div>
  );
}
