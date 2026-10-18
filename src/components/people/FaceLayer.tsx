"use client";

import type { PhotoFace } from "@/lib/people";
import { cn } from "@/lib/cn";

interface FaceLayerProps {
  faces: PhotoFace[];
  activeId: number | null;
  onPick: (face: PhotoFace, anchor: DOMRect) => void;
}

const percent = (v: number) => `${(v * 100).toFixed(3)}%`;

/**
 * The faces over the photo, in the box the photo fills: positions are
 * fractions of the photo as shown, so they hold at any size and in zoom.
 * A named face carries its name; a dashed one is waiting for one.
 */
export default function FaceLayer({ faces, activeId, onPick }: FaceLayerProps) {
  return (
    <div className="pointer-events-none absolute inset-0 animate-fade-in">
      {faces.map((face) => {
        const [x, y, w, h] = face.box;
        const name = face.person?.name ?? null;
        const active = face.face_id === activeId;
        const nearBottom = y + h > 0.9;
        return (
          <button
            key={face.face_id}
            type="button"
            data-face={face.face_id}
            aria-label={name ? `Visage de ${name}` : "Visage sans nom"}
            aria-haspopup="dialog"
            aria-expanded={active}
            onClick={(e) => {
              e.stopPropagation();
              onPick(face, e.currentTarget.getBoundingClientRect());
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
            }}
            className={cn(
              "pointer-events-auto absolute rounded-md border-on-photo outline-none",
              "shadow-[0_0_0_1px_rgb(var(--scrim)/0.35)] transition-[border-width,background-color] duration-150",
              "hover:bg-on-photo/10 focus-visible:ring-2 focus-visible:ring-on-photo",
              name ? "border-2" : "border-[1.5px] border-dashed",
              active && "border-[3px] bg-on-photo/10",
            )}
            style={{
              left: percent(x),
              top: percent(y),
              width: percent(w),
              height: percent(h),
            }}
          >
            {name && (
              <span
                className={cn(
                  "absolute left-1/2 max-w-[12rem] -translate-x-1/2 truncate whitespace-nowrap rounded bg-scrim/65 px-1.5 py-0.5 text-xs font-medium text-on-photo backdrop-blur-sm",
                  nearBottom ? "bottom-full mb-1" : "top-full mt-1",
                )}
              >
                {name}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
