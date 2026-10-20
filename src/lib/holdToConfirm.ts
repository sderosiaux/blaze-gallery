export const HOLD_TO_CONFIRM_MS = 1000;

/** One confirmation per uninterrupted press; release is required to re-arm. */
export function createHoldToConfirm(onConfirm: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pressed = false;

  return {
    start() {
      if (pressed) return;
      pressed = true;
      timer = setTimeout(() => {
        timer = undefined;
        onConfirm();
      }, HOLD_TO_CONFIRM_MS);
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
      pressed = false;
    },
  };
}
