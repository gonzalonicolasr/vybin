// TabBar — browser-style tab strip for Vybin.
// Plus: hosts the window-controls (min/max/close) at top-right edge so they
// sit on the very top of the window like every browser/IDE titlebar.
//
// Renders a horizontal list of tabs with:
//   - Click to switch
//   - X button to close (disabled if only 1 tab)
//   - + button to open a new tab
//   - Visual indicator for ready/busy/offline state
//   - Keyboard: arrow-left/right to cycle tabs within the tablist
//   - Keyboard hint in tooltip (Ctrl+T / Ctrl+W / Ctrl+Tab)
//
// Styling follows the pixel-violet theme from styles.css.

import { useEffect, useRef, useState } from "react";
import { WindowControls } from "./components";
import { TAB_COLORS, TAB_COLOR_HEX, type Tab, type TabColor } from "./hooks/useTabs";

// ─────────────── types ───────────────

export interface TabBarProps {
  readonly onRename: (id: string, newTitle: string) => void;
  readonly onColorChange: (id: string, color: TabColor) => void;
  readonly tabs: readonly Tab[];
  readonly activeTabId: string;
  readonly onSwitch: (id: string) => void;
  readonly onClose: (id: string) => void;
  readonly onNew: () => void;
}

// ─────────────── sub-components ───────────────

interface TabItemProps {
  readonly tab: Tab;
  readonly active: boolean;
  readonly canClose: boolean;
  readonly onSwitch: () => void;
  readonly onClose: () => void;
  readonly onRename: (newTitle: string) => void;
  readonly onColorChange: (color: TabColor) => void;
}

function TabItem({ tab, active, canClose, onSwitch, onClose, onRename, onColorChange }: TabItemProps): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tab.title);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);

  // Focus + select-all on entering edit mode
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // Reset draft when tab title changes externally
  useEffect(() => {
    if (!editing) setDraft(tab.title);
  }, [tab.title, editing]);

  // Close palette / menu on outside click / Esc
  useEffect(() => {
    if (!showPalette && !menuOpen) return;
    const handler = (e: MouseEvent | KeyboardEvent): void => {
      if (e instanceof KeyboardEvent && e.key === "Escape") {
        setShowPalette(false);
        setMenuOpen(false);
      }
      if (e instanceof MouseEvent) {
        const target = e.target as HTMLElement;
        const inside =
          target.closest(".tab-color-palette") ||
          target.closest(".tab-context-menu") ||
          target.closest(`[data-tab-id="${tab.id}"]`);
        if (!inside) {
          setShowPalette(false);
          setMenuOpen(false);
        }
      }
    };
    window.addEventListener("mousedown", handler);
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("mousedown", handler);
      window.removeEventListener("keydown", handler);
    };
  }, [showPalette, menuOpen, tab.id]);

  const commit = (): void => {
    const next = draft.trim();
    if (next.length > 0 && next !== tab.title) onRename(next);
    setEditing(false);
  };

  const cancel = (): void => {
    setDraft(tab.title);
    setEditing(false);
  };

  const statusClass = tab.busy
    ? "tab-dot-busy"
    : tab.ready
      ? "tab-dot-ready"
      : "tab-dot-offline";

  return (
    <div
      data-tab-id={tab.id}
      className={`tab-item tab-color-${tab.color} ${active ? "tab-item-active" : ""}`}
      style={{ ["--tab-c" as string]: TAB_COLOR_HEX[tab.color] }}
      onClick={editing ? undefined : onSwitch}
      onContextMenu={(e): void => {
        e.preventDefault();
        e.stopPropagation();
        setMenuOpen(true);
        setShowPalette(false);
      }}
      title={editing ? "" : `${tab.title} — right-click for options`}
      role="tab"
      aria-selected={active}
    >
      <span
        className={`tab-dot ${statusClass}`}
        aria-hidden="true"
        onClick={(e): void => {
          e.stopPropagation();
          setShowPalette((s) => !s);
          setMenuOpen(false);
        }}
        title="Click to change color"
        style={{ cursor: "pointer" }}
      />
      {showPalette && (
        <div
          ref={paletteRef}
          className="tab-color-palette"
          onClick={(e) => e.stopPropagation()}
          role="menu"
          aria-label="Tab color"
        >
          {TAB_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`tab-color-swatch${tab.color === c ? " active" : ""}`}
              style={{ background: TAB_COLOR_HEX[c] }}
              onClick={(e): void => {
                e.stopPropagation();
                onColorChange(c);
                setShowPalette(false);
              }}
              aria-label={`Set color to ${c}`}
              title={c}
            />
          ))}
        </div>
      )}
      {editing ? (
        <input
          ref={inputRef}
          className="tab-title-edit"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          onBlur={commit}
          maxLength={64}
          spellCheck={false}
        />
      ) : (
        <span
          className="tab-title"
          onDoubleClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setEditing(true);
            setMenuOpen(false);
            setShowPalette(false);
          }}
        >
          {tab.title}
        </span>
      )}
      {!editing && (
        <>
          <button
            type="button"
            className="tab-color-btn"
            style={{ background: TAB_COLOR_HEX[tab.color] }}
            onClick={(e): void => {
              e.stopPropagation();
              setShowPalette((s) => !s);
              setMenuOpen(false);
            }}
            aria-label={`Change color (current: ${tab.color})`}
            title={`Color: ${tab.color} — click to change`}
            tabIndex={-1}
          />
          <button
            type="button"
            className="tab-edit-btn"
            onClick={(e): void => {
              e.stopPropagation();
              setEditing(true);
              setMenuOpen(false);
            }}
            aria-label="Rename tab"
            title="Rename"
            tabIndex={-1}
          >
            ✎
          </button>
        </>
      )}
      {canClose ? (
        <button
          className="tab-close"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          aria-label={`Close ${tab.title}`}
          title="Close tab (Ctrl+W)"
        >
          ✕
        </button>
      ) : (
        // Spacer so single-tab layout matches multi-tab layout width
        <span className="tab-close-spacer" aria-hidden="true" />
      )}
      {menuOpen && (
        <div
          className="tab-context-menu"
          role="menu"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="tab-context-item"
            onClick={(e): void => {
              e.stopPropagation();
              setMenuOpen(false);
              setEditing(true);
            }}
          >
            ✎ rename
          </button>
          <button
            type="button"
            className="tab-context-item"
            onClick={(e): void => {
              e.stopPropagation();
              setMenuOpen(false);
              setShowPalette(true);
            }}
          >
            ◉ change color
          </button>
          {canClose && (
            <button
              type="button"
              className="tab-context-item tab-context-item-danger"
              onClick={(e): void => {
                e.stopPropagation();
                setMenuOpen(false);
                onClose();
              }}
            >
              ✕ close
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────── main component ───────────────

export function TabBar({ tabs, activeTabId, onSwitch, onClose, onNew, onRename, onColorChange }: TabBarProps): React.JSX.Element {
  const canClose = tabs.length > 1;

  const handleTablistKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (tabs.length === 0) return;
    const idx = tabs.findIndex((t) => t.id === activeTabId);
    if (e.key === "ArrowRight") {
      e.preventDefault();
      const next = tabs[(idx + 1) % tabs.length];
      if (next) onSwitch(next.id);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
      if (prev) onSwitch(prev.id);
    }
  };

  return (
    <div className="tabbar" role="tablist" aria-label="Chat sessions" data-tauri-drag-region onKeyDown={handleTablistKeyDown}>
      <div className="tabbar-tabs" data-tauri-drag-region>
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            canClose={canClose}
            onSwitch={() => onSwitch(tab.id)}
            onClose={() => onClose(tab.id)}
            onRename={(newTitle) => onRename(tab.id, newTitle)}
            onColorChange={(color) => onColorChange(tab.id, color)}
          />
        ))}
      </div>
      <div className="tabbar-spacer" data-tauri-drag-region></div>
      <button
        className="tab-new"
        onClick={onNew}
        aria-label="New tab"
        title="New tab (Ctrl+T)"
      >
        +
      </button>
      <WindowControls />
    </div>
  );
}
