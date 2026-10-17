import { useLayoutEffect, useState, type RefObject } from "react";

export function useElementSize(ref: RefObject<HTMLElement>): {
  width: number;
  height: number;
} {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      setSize((prev) =>
        prev.width === width && prev.height === height
          ? prev
          : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

/** The largest box of this shape that fits, never wider than `maxWidth`. */
export function fitBox(
  area: { width: number; height: number },
  ratio: number,
  maxWidth = Infinity,
): { width: number; height: number } {
  if (area.width <= 0 || area.height <= 0) return { width: 0, height: 0 };
  const width = Math.min(area.width, area.height * ratio, maxWidth);
  return { width: Math.round(width), height: Math.round(width / ratio) };
}
