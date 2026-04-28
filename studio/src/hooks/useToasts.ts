// useToasts — lightweight global toast notification system.
//
// Usage:
//   import { useToasts } from "./hooks/useToasts";
//   const { toasts, toast } = useToasts();
//   toast.success("File saved");
//   toast.error("Connection failed");
//   toast.info("Scanning...");
//
// Toasts auto-dismiss after 5 seconds. <Toasts toasts={toasts} dismiss={dismiss} />
// renders the visual stack — mount it once at App root level.

import { useCallback, useState } from "react";

export type ToastKind = "success" | "error" | "info";

export interface Toast {
  readonly id: string;
  readonly kind: ToastKind;
  readonly message: string;
  readonly createdAt: number;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

export interface UseToastsResult {
  readonly toasts: ReadonlyArray<Toast>;
  readonly toast: ToastApi;
  readonly dismiss: (id: string) => void;
}

let toastSeq = 0;
const nextToastId = (): string => `toast-${++toastSeq}`;

const AUTO_DISMISS_MS = 5000;

export function useToasts(): UseToastsResult {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string): void => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string): void => {
      const id = nextToastId();
      const entry: Toast = { id, kind, message, createdAt: Date.now() };
      setToasts((prev) => [...prev, entry]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, AUTO_DISMISS_MS);
    },
    [],
  );

  const toast: ToastApi = {
    success: (msg) => push("success", msg),
    error:   (msg) => push("error",   msg),
    info:    (msg) => push("info",    msg),
  };

  return { toasts, toast, dismiss };
}
