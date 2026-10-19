"use client";

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { IconButton } from "@/components/ui";

export interface FolderMenuItem {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
}

/** The folder's rarer actions, behind « ⋯ » in its header. */
export default function FolderMenu({ items }: { items: FolderMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div className="relative" ref={menuRef}>
      <IconButton
        icon={MoreHorizontal}
        label="Plus d'actions"
        variant="ghost"
        className={open ? "bg-surface-sunken text-ink" : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
        }}
      />
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-dialog mt-2 w-max min-w-56 animate-rise-in overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-pop"
        >
          {items.map(({ label, icon: Icon, onSelect }) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSelect();
              }}
              className="flex w-full items-center gap-3 whitespace-nowrap px-4 py-2.5 text-left text-sm text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              <Icon className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
