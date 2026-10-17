"use client";

import {
  Download,
  Heart,
  Info,
  Keyboard,
  Pause,
  Play,
  RotateCw,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";

interface PhotoViewerControlsProps {
  slideshow?: { playing: boolean; onToggle: () => void };
  zoom?: { active: boolean; available: boolean; onToggle: () => void };
  favorite?: { active: boolean; onToggle: () => void };
  info: { open: boolean; panelId: string; onToggle: () => void };
  /** Absent in shared views and for videos. */
  onRotate?: () => void;
  /** Absent when downloads aren't allowed. */
  onDownload?: () => void;
  /** Absent in shared views and when the parent can't delete. */
  onDelete?: () => void;
  help: { open: boolean; panelId: string; onToggle: () => void };
}

/** The viewer's actions, right side of the top bar. Every one has a key, named in its label. */
export default function PhotoViewerControls({
  slideshow,
  zoom,
  favorite,
  info,
  onRotate,
  onDownload,
  onDelete,
  help,
}: PhotoViewerControlsProps) {
  return (
    <div className="flex items-center gap-0.5 sm:gap-1">
      {slideshow && (
        <IconButton
          icon={slideshow.playing ? Pause : Play}
          label={
            slideshow.playing
              ? "Mettre le diaporama en pause (Espace)"
              : "Lancer le diaporama (Espace)"
          }
          aria-keyshortcuts="Space"
          active={slideshow.playing}
          onClick={slideshow.onToggle}
          iconClassName={cn(slideshow.playing && "text-accent-strong")}
        />
      )}
      {zoom && (
        <IconButton
          icon={zoom.active ? ZoomOut : ZoomIn}
          label={
            zoom.active
              ? "Dézoomer (Z)"
              : zoom.available
                ? "Zoomer (Z)"
                : "Zoomer (Z), une fois la photo chargée"
          }
          aria-keyshortcuts="Z"
          active={zoom.active}
          disabled={!zoom.available}
          onClick={zoom.onToggle}
          className="hidden sm:inline-flex"
        />
      )}
      {/* Colours go on the icon: the button's own text colour classes would compete with them. */}
      {favorite && (
        <IconButton
          icon={Heart}
          label={
            favorite.active
              ? "Retirer des favoris (F)"
              : "Ajouter aux favoris (F)"
          }
          aria-keyshortcuts="F"
          active={favorite.active}
          onClick={favorite.onToggle}
          iconClassName={cn(
            "transition-transform duration-200 ease-out-soft",
            favorite.active && "scale-110 fill-current text-favorite",
          )}
        />
      )}
      <IconButton
        icon={Info}
        label={info.open ? "Masquer les infos (I)" : "Afficher les infos (I)"}
        aria-keyshortcuts="I"
        aria-expanded={info.open}
        aria-controls={info.open ? info.panelId : undefined}
        active={info.open}
        onClick={info.onToggle}
      />
      {onRotate && (
        <IconButton
          icon={RotateCw}
          label="Pivoter à droite (R)"
          aria-keyshortcuts="R Shift+R"
          onClick={onRotate}
        />
      )}
      {onDownload && (
        <IconButton
          icon={Download}
          label="Télécharger l’original"
          onClick={onDownload}
        />
      )}
      {onDelete && (
        <IconButton
          icon={Trash2}
          label="Supprimer la photo (Suppr)"
          aria-keyshortcuts="Delete"
          onClick={onDelete}
          className="hover:bg-danger-soft hover:text-danger"
        />
      )}
      <IconButton
        icon={Keyboard}
        label="Raccourcis clavier (?)"
        aria-keyshortcuts="?"
        aria-expanded={help.open}
        aria-controls={help.open ? help.panelId : undefined}
        active={help.open}
        onClick={help.onToggle}
        className="hidden md:inline-flex"
      />
    </div>
  );
}
