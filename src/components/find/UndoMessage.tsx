"use client";

import { useState } from "react";

interface UndoMessageProps {
  text: React.ReactNode;
  doneText: React.ReactNode;
  /** Resolves true once the change is undone; false leaves the button for another try. */
  onUndo: () => Promise<boolean>;
}

/** Toast body with an Undo button that can only fire once. */
export function UndoMessage({ text, doneText, onUndo }: UndoMessageProps) {
  const [state, setState] = useState<"idle" | "working" | "done">("idle");

  const undo = async () => {
    setState("working");
    setState((await onUndo()) ? "done" : "idle");
  };

  return (
    <span className="flex items-center gap-2">
      <span>{state === "done" ? doneText : text}</span>
      {state !== "done" && (
        <button
          type="button"
          onClick={undo}
          disabled={state === "working"}
          className="touch-target -my-1 rounded-full px-2.5 py-1 font-semibold text-paper underline decoration-paper/40 underline-offset-4 transition-colors duration-150 hover:decoration-paper disabled:opacity-60"
        >
          Undo
        </button>
      )}
    </span>
  );
}
