"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/cn";

type ToastTone = "success" | "error" | "info";

interface ToastOptions {
  /** Milliseconds on screen. Defaults: 3.5 s, 6 s for errors, 8 s with an action. */
  duration?: number;
  /** One inline action, e.g. Undo. Clicking it also dismisses the toast. */
  action?: { label: string; onClick: () => void };
}

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: React.ReactNode;
  action?: ToastOptions["action"];
}

interface ToastApi {
  show: (
    message: React.ReactNode,
    tone?: ToastTone,
    options?: ToastOptions,
  ) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const icons = { success: CheckCircle2, error: AlertCircle, info: Info };
const iconTones = {
  success: "text-success",
  error: "text-favorite",
  info: "text-ink-faint",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((all) => all.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (
      message: React.ReactNode,
      tone: ToastTone = "info",
      options: ToastOptions = {},
    ) => {
      const id = nextId.current++;
      setItems((all) => [
        ...all.slice(-2),
        { id, tone, message, action: options.action },
      ]);
      const fallback = options.action ? 8000 : tone === "error" ? 6000 : 3500;
      setTimeout(() => {
        dismiss(id);
      }, options.duration ?? fallback);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-toast flex flex-col items-center gap-2 px-4 sm:bottom-6"
      >
        {items.map((t) => {
          const Icon = icons[t.tone];
          return (
            <div
              key={t.id}
              role={t.tone === "error" ? "alert" : "status"}
              className="pointer-events-auto flex max-w-md animate-rise-in items-center gap-3 rounded-full bg-ink py-2.5 pl-4 pr-2 text-sm text-paper shadow-pop"
            >
              <Icon
                className={cn("h-4 w-4 shrink-0", iconTones[t.tone])}
                aria-hidden
              />
              <span className="min-w-0">{t.message}</span>
              {t.action && (
                <button
                  type="button"
                  onClick={() => {
                    t.action?.onClick();
                    dismiss(t.id);
                  }}
                  className="shrink-0 rounded-full px-2.5 py-1 text-sm font-semibold text-paper underline-offset-4 transition-colors hover:bg-paper/10 hover:underline"
                >
                  {t.action.label}
                </button>
              )}
              <button
                type="button"
                aria-label="Fermer"
                onClick={() => {
                  dismiss(t.id);
                }}
                className="rounded-full p-1 text-paper/60 transition-colors hover:text-paper"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
