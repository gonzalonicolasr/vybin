// <Toasts /> — renders the global toast stack in the bottom-right corner.
// Mount once at App root level; pass toasts and dismiss from useToasts().

import type { Toast } from "./hooks/useToasts";

const KIND_COLOR: Record<string, string> = {
  success: "var(--cyan)",
  error:   "var(--red)",
  info:    "var(--accent)",
};

const KIND_ICON: Record<string, string> = {
  success: "✓",
  error:   "✗",
  info:    "·",
};

export function Toasts({
  toasts,
  dismiss,
}: {
  readonly toasts: ReadonlyArray<Toast>;
  readonly dismiss: (id: string) => void;
}): React.JSX.Element | null {
  if (toasts.length === 0) return null;
  return (
    <div
      style={{
        position: "fixed",
        bottom: 48,
        right: 16,
        zIndex: 9000,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxWidth: 360,
        pointerEvents: "none",
      }}
    >
      {toasts.map((t) => {
        const color = KIND_COLOR[t.kind] ?? "var(--fg)";
        const icon  = KIND_ICON[t.kind]  ?? "·";
        return (
          <div
            key={t.id}
            style={{
              background: "var(--bg-tint)",
              border: `1px solid ${color}`,
              color: "var(--fg)",
              padding: "8px 12px",
              fontFamily: "var(--code-font)",
              fontSize: 13,
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
              pointerEvents: "auto",
              animation: "toast-in 150ms ease-out",
            }}
          >
            <span style={{ color, flexShrink: 0, fontSize: 16 }}>{icon}</span>
            <span style={{ flex: 1, wordBreak: "break-word" }}>{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              style={{
                background: "none",
                border: "none",
                color: "var(--muted)",
                cursor: "pointer",
                flexShrink: 0,
                fontSize: 14,
                padding: 0,
                lineHeight: 1,
              }}
              aria-label="dismiss"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
