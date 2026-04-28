// Modal — shared backdrop + dialog shell reused by ClarifyModal and ApprovalModal.
// Clicking the backdrop does NOT close (clarify/approval require explicit action).
// Supports slide+fade entrance animation via CSS keyframe toast-in (reused).
// Implements focus trap: Tab/Shift+Tab cycle within focusable elements inside the
// dialog. Focus is restored to the previously-focused element on unmount.

import { useEffect, useRef } from "react";

export interface ModalProps {
  readonly width?: string;
  readonly onEscape?: () => void;
  readonly children: React.ReactNode;
  /** Additional class on the inner dialog box */
  readonly className?: string;
}

const FOCUSABLE = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function Modal({ width = "min(560px, 94vw)", onEscape, children, className }: ModalProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  // Remember the element that was focused before the modal opened
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Save previous focus and restore on unmount
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    // Move focus into the dialog on mount
    const first = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return (): void => {
      previousFocusRef.current?.focus();
    };
  }, []);

  // Escape key handler
  useEffect(() => {
    if (!onEscape) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onEscape();
      }
    };
    window.addEventListener("keydown", handler, true);
    return (): void => window.removeEventListener("keydown", handler, true);
  }, [onEscape]);

  // Focus trap: intercept Tab and Shift+Tab to cycle within the dialog
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const handleTab = (e: KeyboardEvent): void => {
      if (e.key !== "Tab") return;
      const focusable = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    el.addEventListener("keydown", handleTab);
    return (): void => el.removeEventListener("keydown", handleTab);
  }, []);

  return (
    <div
      className="modal-backdrop"
      // Intentionally no onClick dismiss — request modals require explicit action
      aria-modal="true"
      role="dialog"
    >
      <div
        ref={dialogRef}
        className={`modal-box${className ? ` ${className}` : ""}`}
        style={{ width }}
        onClick={(e): void => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export function ModalHeader({
  children,
}: {
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return <div className="modal-header">{children}</div>;
}

export function ModalBody({
  children,
}: {
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return <div className="modal-body">{children}</div>;
}

export function ModalFooter({
  children,
}: {
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return <div className="modal-footer">{children}</div>;
}
