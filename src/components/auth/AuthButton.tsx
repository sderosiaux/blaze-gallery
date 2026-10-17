"use client";

import { useEffect, useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { Button, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";

function GoogleGlyph() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function Avatar({ name, picture, size = "sm" }: { name: string; picture?: string; size?: "sm" | "lg" }) {
  const box = size === "lg" ? "h-10 w-10 text-base" : "h-8 w-8 text-sm";
  return picture ? (
    // eslint-disable-next-line @next/next/no-img-element -- remote Google avatar, not worth an image-optimizer domain
    <img src={picture} alt="" className={cn(box, "rounded-full object-cover ring-1 ring-line")} />
  ) : (
    <span className={cn(box, "inline-flex items-center justify-center rounded-full bg-ink font-display italic text-paper")}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export default function AuthButton({ compact = false }: { compact?: boolean }) {
  const { isAuthenticated, user, loading, login, logout } = useAuth();
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      await login();
    } finally {
      setIsLoggingIn(false);
    }
  };

  if (!mounted || loading) {
    return <Skeleton className={compact ? "h-8 w-8 rounded-full" : "h-9 w-full rounded-full"} />;
  }

  if (isAuthenticated && user) {
    return (
      <div className="relative w-full" ref={menuRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          title={`Signed in as ${user.name}`}
          className={cn(
            "flex w-full items-center gap-3 rounded-md py-1.5 text-left transition-colors hover:bg-surface-sunken",
            compact ? "justify-center px-0" : "px-2",
            open && "bg-surface-sunken",
          )}
        >
          <Avatar name={user.name} picture={user.picture} />
          {!compact && (
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-ink">{user.name}</span>
              <span className="block truncate text-xs text-ink-muted">{user.email}</span>
            </span>
          )}
        </button>
        {open && (
          <div
            role="menu"
            className={cn(
              "absolute bottom-full z-dialog mb-2 w-64 animate-rise-in overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-pop",
              compact ? "left-0" : "left-0 right-0 w-auto",
            )}
          >
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              <Avatar name={user.name} picture={user.picture} size="lg" />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-ink">{user.name}</div>
                <div className="truncate text-xs text-ink-muted">{user.email}</div>
              </div>
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                logout();
              }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              <LogOut className="h-4 w-4 text-ink-muted" aria-hidden />
              Sign out
            </button>
          </div>
        )}
      </div>
    );
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleLogin}
        disabled={isLoggingIn}
        aria-label="Sign in with Google"
        title="Sign in with Google"
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-line-strong bg-surface text-ink-soft hover:text-ink"
      >
        <GoogleGlyph />
      </button>
    );
  }

  return (
    <Button onClick={handleLogin} loading={isLoggingIn} variant="secondary" className="w-full">
      {!isLoggingIn && <GoogleGlyph />}
      {isLoggingIn ? "Signing in…" : "Sign in with Google"}
    </Button>
  );
}
