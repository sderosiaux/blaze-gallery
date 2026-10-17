"use client";

import { X } from "lucide-react";
import { IconButton } from "@/components/ui";

interface Shortcut {
  keys: string[];
  label: string;
}

interface ShortcutsHelpProps {
  id: string;
  canFavorite: boolean;
  canDelete: boolean;
  onClose: () => void;
}

export default function ShortcutsHelp({
  id,
  canFavorite,
  canDelete,
  onClose,
}: ShortcutsHelpProps) {
  const shortcuts: Shortcut[] = [
    { keys: ["←", "→"], label: "Previous or next photo" },
    { keys: ["Space"], label: "Start or pause the slideshow" },
    ...(canFavorite
      ? [{ keys: ["F"], label: "Add to or remove from favorites" }]
      : []),
    { keys: ["I"], label: "Show or hide details" },
    { keys: ["Z"], label: "Zoom in or out. Double-click works too" },
    ...(canDelete
      ? [{ keys: ["Delete"], label: "Delete the photo, after you confirm" }]
      : []),
    { keys: ["Esc"], label: "Close the photo" },
    { keys: ["?"], label: "Show or hide these shortcuts" },
  ];

  return (
    <section
      id={id}
      aria-label="Keyboard shortcuts"
      className="absolute right-3 top-14 z-20 w-[min(22rem,calc(100%-1.5rem))] animate-rise-in rounded-xl border border-line bg-surface p-5 shadow-pop"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold text-ink">
          Keyboard shortcuts
        </h2>
        <IconButton
          icon={X}
          label="Close shortcuts"
          size="sm"
          onClick={onClose}
          className="-mr-2"
        />
      </div>
      <dl className="space-y-2.5">
        {shortcuts.map((s) => (
          <div
            key={s.label}
            className="flex items-baseline justify-between gap-4 text-sm"
          >
            <dt className="text-ink-soft">{s.label}</dt>
            <dd className="flex shrink-0 gap-1">
              {s.keys.map((k) => (
                <kbd
                  key={k}
                  className="min-w-[1.75rem] rounded border border-line-strong bg-paper px-1.5 py-0.5 text-center font-sans text-xs font-medium text-ink"
                >
                  {k}
                </kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
