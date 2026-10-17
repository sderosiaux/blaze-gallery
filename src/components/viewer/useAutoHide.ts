import { useEffect, useRef, useState, type RefObject } from "react";

const IDLE_MS = 2500;

/**
 * Controls fade out after a moment without the mouse moving, on desktop-sized
 * screens with a mouse. They stay while `hold` is set, while the pointer rests
 * on them or while one of them has keyboard focus. Touch never hides them.
 */
export function useAutoHide(
  root: RefObject<HTMLElement>,
  hold: boolean,
  mounted: boolean,
): boolean {
  const [visible, setVisible] = useState(true);
  const holdRef = useRef(hold);
  holdRef.current = hold;

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const fine = window.matchMedia(
      "(hover: hover) and (pointer: fine) and (min-width: 768px)",
    );
    let touched = !fine.matches;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const keep = () => {
      if (holdRef.current || touched || !fine.matches) return true;
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        active.closest("[data-chrome]") &&
        active.matches(":focus-visible")
      )
        return true;
      return Boolean(el.querySelector("[data-chrome]:hover"));
    };

    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(function check() {
        if (keep()) timer = setTimeout(check, IDLE_MS);
        else setVisible(false);
      }, IDLE_MS);
    };

    const wake = (e: Event) => {
      if (e instanceof PointerEvent)
        touched = e.pointerType === "touch" || !fine.matches;
      setVisible(true);
      arm();
    };

    fine.addEventListener("change", wake);
    el.addEventListener("pointermove", wake);
    el.addEventListener("pointerdown", wake);
    el.addEventListener("wheel", wake, { passive: true });
    document.addEventListener("keydown", wake);
    arm();
    return () => {
      clearTimeout(timer);
      fine.removeEventListener("change", wake);
      el.removeEventListener("pointermove", wake);
      el.removeEventListener("pointerdown", wake);
      el.removeEventListener("wheel", wake);
      document.removeEventListener("keydown", wake);
    };
  }, [root, mounted]);

  useEffect(() => {
    if (hold) setVisible(true);
  }, [hold]);

  return visible;
}
