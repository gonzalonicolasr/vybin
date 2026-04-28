// VoiceModeToggle — mic button for the StatusBar.
// State: off (muted, greyed) | active (accent glow + pulse).
// Click: toggles voice mode via Tauri command voice_mode_set (stub).
//
// TODO: wire "voice-mode-changed" sidecar event to keep state in sync
// when the backend changes mode externally (e.g. CLI /voice-mode stop).

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface VoiceModeToggleProps {
  readonly initialActive?: boolean;
}

export function VoiceModeToggle({ initialActive = false }: VoiceModeToggleProps): React.JSX.Element {
  const [active, setActive] = useState(initialActive);
  const [pending, setPending] = useState(false);

  const handleClick = useCallback(async (): Promise<void> => {
    if (pending) return;
    const next = !active;
    setPending(true);
    try {
      // TODO: voice_mode_set Tauri command — stub in lib.rs returns Ok(())
      // Real implementation should send "/voice-mode start|stop" to sidecar.
      await invoke("voice_mode_set", { active: next });
      setActive(next);
    } catch {
      // Silently ignore — backend stub may not exist yet
      setActive(next); // optimistic update for UX
    } finally {
      setPending(false);
    }
  }, [active, pending]);

  return (
    <button
      className={`voice-toggle ${active ? "voice-toggle-active" : "voice-toggle-off"}`}
      onClick={() => void handleClick()}
      title={`Voice mode: ${active ? "ON" : "OFF"}`}
      aria-label={`Voice mode ${active ? "on, click to disable" : "off, click to enable"}`}
      aria-pressed={active}
      disabled={pending}
    >
      <span className={`voice-icon ${active ? "voice-icon-active" : ""}`}>
        {/* Pixel-art mic glyph using Unicode block */}
        {active ? "●" : "○"}
      </span>
      <span className="voice-label">mic</span>
    </button>
  );
}
