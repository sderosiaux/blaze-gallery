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
  canRotate: boolean;
  canDelete: boolean;
  onClose: () => void;
}

export default function ShortcutsHelp({
  id,
  canFavorite,
  canRotate,
  canDelete,
  onClose,
}: ShortcutsHelpProps) {
  const shortcuts: Shortcut[] = [
    { keys: ["←", "→"], label: "Photo précédente ou suivante" },
    { keys: ["Espace"], label: "Lancer ou mettre en pause le diaporama" },
    ...(canFavorite
      ? [{ keys: ["F"], label: "Ajouter aux favoris ou en retirer" }]
      : []),
    { keys: ["I"], label: "Afficher ou masquer les infos" },
    { keys: ["Z"], label: "Zoomer ou dézoomer (double-clic aussi)" },
    ...(canRotate
      ? [
          { keys: ["R"], label: "Pivoter d’un quart de tour à droite" },
          { keys: ["Maj", "R"], label: "Pivoter d’un quart de tour à gauche" },
        ]
      : []),
    ...(canDelete
      ? [{ keys: ["Suppr"], label: "Supprimer la photo, après confirmation" }]
      : []),
    { keys: ["Échap"], label: "Fermer la photo" },
    { keys: ["?"], label: "Afficher ou masquer ces raccourcis" },
  ];

  return (
    <section
      id={id}
      aria-label="Raccourcis clavier"
      className="absolute right-3 top-14 z-20 w-[min(26rem,calc(100%-1.5rem))] animate-rise-in rounded-xl border border-line bg-surface p-5 shadow-pop"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-ink">Raccourcis clavier</h2>
        <IconButton
          icon={X}
          label="Fermer les raccourcis"
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
