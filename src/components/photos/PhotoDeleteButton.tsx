"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Loader2, Trash2 } from "lucide-react";
import type { Photo } from "@/types";
import { useToast } from "@/components/ui";
import { asString, readJsonObject } from "@/hooks/apiJson";
import { cn } from "@/lib/cn";
import { createHoldToConfirm, HOLD_TO_CONFIRM_MS } from "@/lib/holdToConfirm";

interface PhotoDeleteButtonProps {
  photo: Photo;
  /** Called only after storage and the database confirm deletion. */
  onDeleted: (photo: Photo) => void;
}

export default function PhotoDeleteButton({
  photo,
  onDeleted,
}: PhotoDeleteButtonProps) {
  const toast = useToast();
  const [holding, setHolding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const busy = useRef(false);

  const remove = async () => {
    if (busy.current) return;
    busy.current = true;
    setHolding(false);
    setDeleting(true);
    try {
      const response = await fetch(`/api/photos/${photo.id}`, {
        method: "DELETE",
      });
      const data = await readJsonObject(response);
      if (!response.ok || data.success !== true) {
        toast.show(
          asString(data.error) ?? "La photo n’a pas été supprimée",
          "error",
        );
        busy.current = false;
        return;
      }
      onDeleted(photo);
      toast.show("Photo supprimée", "success");
      // Stay locked until the parent removes the tile: no second DELETE.
    } catch {
      busy.current = false;
      toast.show("La photo n’a pas été supprimée", "error");
    } finally {
      setDeleting(false);
    }
  };
  const removeRef = useRef(remove);
  removeRef.current = remove;
  const [hold] = useState(() =>
    createHoldToConfirm(() => void removeRef.current()),
  );
  const cancel = useCallback(() => {
    hold.cancel();
    setHolding(false);
  }, [hold]);

  useEffect(
    () => () => {
      hold.cancel();
    },
    [hold],
  );
  useEffect(() => {
    if (!holding) return;
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", cancel);
    return () => {
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", cancel);
    };
  }, [holding, cancel]);

  const start = () => {
    if (busy.current) return;
    setHolding(true);
    hold.start();
  };
  const label = deleting
    ? "Suppression en cours"
    : `Supprimer ${photo.filename} — maintenir 1 seconde`;

  return (
    <button
      type="button"
      aria-label={label}
      aria-busy={deleting}
      title={label}
      disabled={deleting}
      className={cn(
        "touch-target relative flex h-8 w-8 touch-pan-y select-none items-center justify-center rounded-full text-on-photo backdrop-blur-sm transition-[opacity,background-color] duration-200 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100",
        holding || deleting
          ? "bg-danger opacity-100"
          : "bg-scrim/35 opacity-0 hover:bg-danger",
      )}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        start();
      }}
      onPointerMove={(event) => {
        if (!holding) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < box.left ||
          event.clientX > box.right ||
          event.clientY < box.top ||
          event.clientY > box.bottom
        )
          cancel();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onLostPointerCapture={cancel}
      onBlur={cancel}
      onKeyDown={(event) => {
        if (event.key === "Escape") cancel();
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) start();
      }}
      onKeyUp={(event) => {
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
    >
      {deleting ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <Trash2 className="h-4 w-4" aria-hidden />
      )}
      {holding && (
        <svg
          aria-hidden
          viewBox="0 0 32 32"
          className="pointer-events-none absolute inset-0 h-full w-full -rotate-90"
        >
          <circle
            cx="16"
            cy="16"
            r="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            pathLength="100"
            strokeDasharray="100"
            strokeDashoffset="100"
            className="hold-delete-progress"
            style={
              {
                "--hold-delete-duration": `${HOLD_TO_CONFIRM_MS}ms`,
              } as CSSProperties
            }
          />
        </svg>
      )}
    </button>
  );
}
