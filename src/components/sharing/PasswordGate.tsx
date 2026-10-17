"use client";

import { useRef, useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";
import { Button, IconButton, Input } from "@/components/ui";
import { parseAlbumName } from "@/lib/albums";
import { unlockShare, type GuestResult } from "@/lib/shareClient";
import { cn } from "@/lib/cn";

interface PasswordGateProps {
  token: string;
  /** Only known when the API tells it before the password; the gate reads fine without it. */
  albumName?: string;
  onResult: (result: GuestResult) => void;
}

const HINT = "Not sure what it is? Ask the person who sent you the link.";
const WRONG =
  "That password doesn't match. Check it with the person who sent you the link.";

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
      <div className="kicker mb-3">A private album</div>
      <h1 className="text-balance break-words font-display text-display-md font-semibold text-ink">
        {title ?? "Someone shared photos with you"}
      </h1>
      <p className="mx-auto mt-4 max-w-xs text-pretty text-sm leading-relaxed text-ink-muted">
        They added a password to this album. Enter it to see the photos.
      </p>

      <form onSubmit={submit} className="mt-8 text-left" noValidate>
        <label
          htmlFor="share-password"
          className="block text-sm font-medium text-ink"
        >
          Password
        </label>
        <div className="relative mt-1.5">
          <Input
            ref={inputRef}
            id="share-password"
            type={reveal ? "text" : "password"}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (wrong) setWrong(false);
            }}
            autoComplete="current-password"
            autoFocus
            aria-invalid={wrong || undefined}
            aria-describedby="share-password-message"
            className={cn(
              "h-12 pr-12 text-base",
              wrong && "border-danger focus:border-danger focus:ring-danger/20",
            )}
          />
          <IconButton
            icon={reveal ? EyeOff : Eye}
            label={reveal ? "Hide password" : "Show password"}
            size="sm"
            onClick={() => setReveal((r) => !r)}
            className="absolute right-2 top-1/2 -translate-y-1/2"
          />
        </div>
        {/* Two lines reserved, so the error replaces the hint without moving the button. */}
        <p
          id="share-password-message"
          role={wrong ? "alert" : undefined}
          className={cn(
            "mt-2 min-h-[2.5rem] text-xs leading-5",
            wrong ? "text-danger" : "text-ink-muted",
          )}
        >
          {wrong ? WRONG : HINT}
        </p>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="mt-3 w-full"
          loading={busy}
          disabled={!password.trim()}
        >
          Open album
        </Button>
      </form>
    </div>
  );
}
