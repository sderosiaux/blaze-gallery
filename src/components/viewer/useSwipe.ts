import { useRef, useState } from "react";

interface Options {
  disabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
}

/**
 * Horizontal swipe on touch: the photo follows the finger, and a long or quick
 * enough flick moves to the neighbour. Past the first or last photo the drag
 * resists instead.
 */
export function useSwipe({
  disabled,
  onPrevious,
  onNext,
  hasPrevious,
  hasNext,
}: Options) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{
    id: number;
    x: number;
    y: number;
    t: number;
    axis: "x" | "y" | null;
  } | null>(null);
  const pointers = useRef(new Set<number>());

  const reset = () => {
    start.current = null;
    setDragging(false);
    setOffset(0);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch") return;
    pointers.current.add(e.pointerId);
    if (disabled || pointers.current.size > 1) {
      if (start.current) reset();
      return;
    }
    start.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      t: performance.now(),
      axis: null,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.axis) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
        s.axis = "x";
        setDragging(true);
      } else if (Math.abs(dy) > 8) s.axis = "y";
    }
    if (s.axis !== "x") return;
    const blocked = (dx > 0 && !hasPrevious) || (dx < 0 && !hasNext);
    setOffset(blocked ? dx / 4 : dx);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    if (s.axis === "x") {
      const dx = e.clientX - s.x;
      const velocity = dx / Math.max(1, performance.now() - s.t);
      const width = (e.currentTarget as HTMLElement).clientWidth || 1;
      const far =
        Math.abs(dx) > Math.min(90, width * 0.2) || Math.abs(velocity) > 0.45;
      if (far && dx < 0 && hasNext) onNext();
      else if (far && dx > 0 && hasPrevious) onPrevious();
    }
    reset();
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (start.current?.id === e.pointerId) reset();
  };

  return {
    offset,
    dragging,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  };
}
