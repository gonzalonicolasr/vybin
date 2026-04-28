// ToastContext — provides the toast() API to any component in the tree.
// Mount <ToastProvider> once in App (wrapping its children) and call
// useToastContext() anywhere deeper to fire toasts.

import { createContext, useContext } from "react";
import type { Toast } from "./useToasts";

interface ToastCtxValue {
  toasts: ReadonlyArray<Toast>;
  dismiss: (id: string) => void;
  toast: {
    success: (msg: string) => void;
    error:   (msg: string) => void;
    info:    (msg: string) => void;
  };
}

const NOOP = (): void => { /* noop */ };

const ToastContext = createContext<ToastCtxValue>({
  toasts: [],
  dismiss: NOOP,
  toast: { success: NOOP, error: NOOP, info: NOOP },
});

export { ToastContext };
export type { ToastCtxValue };

export function useToastContext(): ToastCtxValue {
  return useContext(ToastContext);
}
