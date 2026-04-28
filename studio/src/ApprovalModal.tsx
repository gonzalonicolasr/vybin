// ApprovalModal — asks the user to approve or deny a command cero wants to run.
//
// The sidecar emits { type:"approval-request", id, command, description?, dangerLevel, category }.
// Keybindings:
//   y       allow once
//   a       allow always for session (rememberForSession:true)
//   n / Esc deny

import { useCallback, useEffect, useState } from "react";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "./Modal";
import type { ApprovalRequest, ApprovalResponse, DangerLevel } from "./ipc-types";

export interface ApprovalModalProps {
  readonly request: ApprovalRequest;
  readonly onResolve: (response: ApprovalResponse) => void;
  readonly onCancel: () => void;
}

// ─── danger level styling ────────────────────────────────────────────────────

interface DangerStyle {
  icon: string;
  color: string;
  label: string;
}

const DANGER_STYLES: Record<DangerLevel, DangerStyle> = {
  low:      { icon: "i",  color: "var(--accent)",            label: "LOW" },
  medium:   { icon: "!",  color: "var(--amber)",             label: "MEDIUM" },
  high:     { icon: "!!", color: "var(--amber)",             label: "HIGH" },
  critical: { icon: "!!", color: "var(--red)",               label: "CRITICAL" },
};

const MAX_COMMAND_PREVIEW = 300;

// ─── component ────────────────────────────────────────────────────────────────

export function ApprovalModal({ request, onResolve, onCancel: _onCancel }: ApprovalModalProps): React.JSX.Element {
  const { id, command, description, dangerLevel, category } = request;
  const [showFull, setShowFull] = useState(false);
  const [reason, setReason] = useState("");

  const style = DANGER_STYLES[dangerLevel] ?? DANGER_STYLES.medium;
  const commandTruncated = command.length > MAX_COMMAND_PREVIEW && !showFull;
  const displayCommand = commandTruncated ? `${command.slice(0, MAX_COMMAND_PREVIEW)}…` : command;

  // onResolve(...) is wired in App.tsx to dequeue internally; calling onCancel
  // afterwards would dequeue twice and could pop the next pending request,
  // leaving a stale modal mounted with a request that was already answered.
  const handleAllow = useCallback((rememberForSession: boolean): void => {
    onResolve({
      type: "approval-response",
      id,
      approved: true,
      rememberForSession,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    });
  }, [id, reason, onResolve]);

  const handleDeny = useCallback((): void => {
    onResolve({
      type: "approval-response",
      id,
      approved: false,
      rememberForSession: false,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    });
  }, [id, reason, onResolve]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // Skip if user is typing in an input
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "y" || e.key === "Y") { e.preventDefault(); handleAllow(false); }
      if (e.key === "a" || e.key === "A") { e.preventDefault(); handleAllow(true);  }
      if (e.key === "n" || e.key === "N") { e.preventDefault(); handleDeny();        }
    };
    window.addEventListener("keydown", handler, true);
    return (): void => window.removeEventListener("keydown", handler, true);
  }, [handleAllow, handleDeny]);

  return (
    <Modal onEscape={handleDeny} width="min(640px, 96vw)" className={`approval-modal approval-modal-${dangerLevel}`}>
      <ModalHeader>
        <span
          className="modal-icon"
          style={{ color: style.color, borderColor: style.color }}
          aria-hidden="true"
        >
          {style.icon}
        </span>
        <h2 className="modal-title" style={{ color: style.color }}>
          APPROVAL REQUIRED
        </h2>
        <span className="modal-subtitle">cero wants to run a command</span>
      </ModalHeader>

      <ModalBody>
        {/* Badges */}
        <div className="approval-badges">
          <span className="dv-pill" style={{ borderColor: style.color, color: style.color }}>
            {style.label}
          </span>
          <span className="dv-pill">{category}</span>
        </div>

        {/* Command block */}
        <div className="approval-section-label">COMMAND</div>
        <pre className="approval-command" aria-label="command to execute">
          {displayCommand}
        </pre>
        {command.length > MAX_COMMAND_PREVIEW && (
          <button
            className="approval-show-more"
            onClick={(): void => setShowFull((v) => !v)}
          >
            {showFull ? "show less" : `show full (${command.length} chars)`}
          </button>
        )}

        {/* Description */}
        {description ? (
          <>
            <div className="approval-section-label">DESCRIPTION</div>
            <div className="approval-description">{description}</div>
          </>
        ) : null}

        {/* Optional reason */}
        <div className="approval-section-label">REASON (optional)</div>
        {/* Enter in the reason input does NOT submit — user must click Allow/Deny explicitly.
            This prevents accidental approval when typing a denial reason. */}
        <input
          className="approval-reason-input"
          value={reason}
          onChange={(e): void => setReason(e.target.value)}
          placeholder="why are you allowing/denying?"
        />
      </ModalBody>

      <ModalFooter>
        <button
          className="settings-btn-secondary approval-deny-btn"
          onClick={handleDeny}
          title="Deny (n / Esc)"
          data-testid="deny-btn"
        >
          deny (n)
        </button>
        <button
          className="settings-btn-secondary"
          onClick={(): void => handleAllow(true)}
          title={`Allow always for ${category} this session (a)`}
          data-testid="allow-always-btn"
        >
          always for {category} (a)
        </button>
        <button
          className="settings-btn-primary"
          onClick={(): void => handleAllow(false)}
          title="Allow once (y)"
          data-testid="allow-once-btn"
        >
          allow once (y)
        </button>
      </ModalFooter>
    </Modal>
  );
}
