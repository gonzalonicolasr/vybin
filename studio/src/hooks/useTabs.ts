// useTabs — manages the multi-tab state for cero studio.
//
// Responsibilities:
//   - Maintain Tab[] + activeTabId in React state.
//   - Persist tab list (id + title only, NOT history) to Tauri store so tabs
//     survive app restarts. History is NOT persisted (new cero sessions on
//     re-launch per architecture decision in STATUS.md §4).
//   - Expose openTab / closeTab / switchTab / renameTab for UI and keybindings.
//   - Generate UUID v4 tab IDs without pulling in a library (crypto.randomUUID
//     is available in all modern Chromium / WebView2 contexts).
//
// The hook does NOT invoke Tauri commands — that's App.tsx's job so it can
// manage the sidecar payload (env, config) alongside tab lifecycle.

import { useCallback, useEffect, useRef, useState } from "react";
import { load } from "@tauri-apps/plugin-store";
import type { Turn, ToolEvent } from "../components";

// ─────────────── types ───────────────

/**
 * Predefined tab colors. Each name maps to a hex via TAB_COLOR_HEX so the
 * tab gets a single `--tab-c` CSS variable applied inline (border, bg,
 * dot, swatch all read from it). Extending the palette = add an entry
 * here and to TAB_COLOR_HEX; no CSS rule changes needed.
 */
export type TabColor =
  // grays / neutrals
  | "neutral" | "slate"
  // violets / purples
  | "violet" | "purple" | "indigo" | "magenta" | "pink"
  // reds / warms
  | "red" | "coral" | "orange" | "amber" | "peach"
  // greens
  | "lima" | "green" | "emerald" | "olive"
  // cyans / blues
  | "teal" | "cyan" | "sky" | "blue";

export const TAB_COLORS: ReadonlyArray<TabColor> = [
  "violet", "purple", "indigo", "magenta", "pink",
  "red", "coral", "orange", "amber", "peach",
  "lima", "green", "emerald", "olive",
  "teal", "cyan", "sky", "blue",
  "slate", "neutral",
];

export const TAB_COLOR_HEX: Record<TabColor, string> = {
  violet:  "#b894f5",
  purple:  "#a37aff",
  indigo:  "#7a6fd4",
  magenta: "#d177c8",
  pink:    "#e87aa0",
  red:     "#d96a6a",
  coral:   "#ff7e5f",
  orange:  "#e88c2a",
  amber:   "#e5a83a",
  peach:   "#ffb088",
  lima:    "#6ee87a",
  green:   "#4ec94e",
  emerald: "#2dd4a0",
  olive:   "#a0a040",
  teal:    "#5addc0",
  cyan:    "#6ad7d1",
  sky:     "#8acff0",
  blue:    "#6a96e8",
  slate:   "#8090a0",
  neutral: "#7a7390",
};

export interface Tab {
  readonly id: string;
  readonly title: string;
  readonly color: TabColor;
  readonly history: Turn[];
  readonly busy: boolean;
  readonly ready: boolean;
  readonly meta: TabMeta | null;
  // Mutable refs used internally — stored outside React state for performance
}

export interface TabMeta {
  readonly sessionId: string;
  readonly model: string;
  readonly provider: string;
  readonly sandbox: string;
}

// Persisted shape — includes history so a closed-and-reopened studio resumes
// at the same chat state. Runtime-only fields (busy, ready, meta) are NOT
// persisted because they reset on sidecar restart anyway.
interface PersistedTab {
  id: string;
  title: string;
  color?: TabColor; // optional for backwards compat with v1 entries
  history?: Turn[]; // optional for backwards compat with v1 store entries
}

// ─────────────── helpers ───────────────

export function makeTabId(): string {
  // crypto.randomUUID() is available in WebView2 (Chromium-based)
  // and all modern browsers. No lib needed.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback: manual v4-like UUID
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const TABS_STORE_KEY = "tabs_v1";
const ACTIVE_TAB_STORE_KEY = "active_tab_v1";
const STORE_PATH = "tabs.json";

let storePromise: ReturnType<typeof load> | null = null;
function getTabStore() {
  if (!storePromise) storePromise = load(STORE_PATH);
  return storePromise;
}

// Cap history persisted per tab to avoid bloating the store. Older turns are
// dropped from disk (still visible in-memory until tab restart).
const PERSIST_HISTORY_CAP = 200;

async function persistTabs(tabs: Tab[], activeTabId: string): Promise<void> {
  try {
    const store = await getTabStore();
    const persisted: PersistedTab[] = tabs.map((t) => ({
      id: t.id,
      title: t.title,
      color: t.color,
      history: t.history.length > PERSIST_HISTORY_CAP
        ? t.history.slice(-PERSIST_HISTORY_CAP)
        : t.history,
    }));
    await store.set(TABS_STORE_KEY, persisted);
    await store.set(ACTIVE_TAB_STORE_KEY, activeTabId);
    await store.save();
  } catch {
    // Best-effort — don't crash if store write fails
  }
}

async function loadPersistedTabs(): Promise<{ tabs: PersistedTab[]; activeTabId: string | null }> {
  try {
    const store = await getTabStore();
    const tabs = await store.get<PersistedTab[]>(TABS_STORE_KEY);
    const activeTabId = await store.get<string>(ACTIVE_TAB_STORE_KEY);
    return {
      tabs: Array.isArray(tabs) && tabs.length > 0 ? tabs : [],
      activeTabId: typeof activeTabId === "string" ? activeTabId : null,
    };
  } catch {
    return { tabs: [], activeTabId: null };
  }
}

function makeDefaultTab(id: string, index: number, title?: string): Tab {
  // Cycle through the predefined palette so new tabs get a stable, distinct
  // color out of the box. The user can change it later via the rename UI.
  const color = TAB_COLORS[index % TAB_COLORS.length] ?? "violet";
  return {
    id,
    title: title ?? `tab ${index + 1}`,
    color,
    history: [],
    busy: false,
    ready: false,
    meta: null,
  };
}

/**
 * Compute the next "tab N" name that doesn't collide with existing titles.
 * Strategy: parse the highest N from existing `tab N` titles and return N+1.
 * Custom-renamed tabs (titles that don't match the pattern) are ignored.
 * Prevents the duplicate "tab 2 / tab 2" bug after closing tab 1.
 */
function nextDefaultTitle(existing: ReadonlyArray<Tab>): string {
  let maxN = 0;
  for (const t of existing) {
    const m = t.title.match(/^tab (\d+)$/);
    if (m && m[1]) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n)) maxN = Math.max(maxN, n);
    }
  }
  return `tab ${maxN + 1}`;
}

// ─────────────── hook ───────────────

export interface UseTabsResult {
  readonly tabs: Tab[];
  readonly activeTabId: string;
  readonly activeTab: Tab | null;
  /** Open a new tab. Returns the new tab's id. */
  readonly openTab: () => string;
  /** Close a tab. If it was the active one, switches to adjacent tab.
   *  Returns the id of the tab that became active (or "" if none). */
  readonly closeTab: (id: string) => string;
  /** Switch focus to a tab by id. */
  readonly switchTab: (id: string) => void;
  /** Cycle forward (+1) or backward (-1) through tabs. */
  readonly cycleTab: (dir: 1 | -1) => void;
  /** Update mutable fields of a tab (history, busy, ready, meta, title). */
  readonly updateTab: (id: string, patch: Partial<Omit<Tab, "id">>) => void;
  /** Append a turn to a specific tab's history. */
  readonly appendTurn: (id: string, turn: Turn) => void;
  /** Update an existing turn in a tab's history by turn.id. */
  readonly updateTurn: (id: string, turnId: string, patch: Partial<Turn>) => void;
  /** Whether tabs have been loaded from store (false during initial async load). */
  readonly loaded: boolean;
}

export function useTabs(): UseTabsResult {
  // We start with a placeholder tab. The useEffect below replaces it after
  // loading persisted tabs from the store.
  const initialId = useRef(makeTabId());
  const [tabs, setTabs] = useState<Tab[]>([makeDefaultTab(initialId.current, 0)]);
  const [activeTabId, setActiveTabId] = useState<string>(initialId.current);
  const [loaded, setLoaded] = useState(false);

  // Ref that tracks the current activeTabId without recreating closeTab on every switch.
  // This prevents the stale-closure bug where closeTab closes over an outdated activeTabId.
  const activeTabIdRef = useRef(activeTabId);
  useEffect(() => { activeTabIdRef.current = activeTabId; }, [activeTabId]);

  // Load persisted tabs on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { tabs: persisted, activeTabId: storedActiveId } = await loadPersistedTabs();
      if (cancelled) return;
      if (persisted.length === 0) {
        // No persisted tabs — keep the placeholder, just mark as loaded
        setLoaded(true);
        return;
      }
      // Restore tabs with title + color + history from persisted data
      const restored: Tab[] = persisted.map((p, i) => ({
        ...makeDefaultTab(p.id, i),
        title: p.title,
        color: p.color ?? (TAB_COLORS[i % TAB_COLORS.length] ?? "violet"),
        history: Array.isArray(p.history) ? p.history : [],
      }));
      setTabs(restored);
      const activeExists = restored.some((t) => t.id === storedActiveId);
      setActiveTabId(activeExists ? (storedActiveId ?? restored[0]!.id) : restored[0]!.id);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist whenever tabs or activeTabId change (after initial load).
  // Debounced 800ms so streaming text-deltas don't trigger a disk write per
  // character — only the final state after a quiet period gets persisted.
  // Note: user-action mutations (color/title) bypass this via updateTab's
  // immediate persist branch; this debounce is the safety net for everything
  // else (history accumulation, ready/busy state).
  useEffect(() => {
    if (!loaded) return;
    const handle = setTimeout(() => {
      void persistTabs(tabs, activeTabId);
    }, 800);
    return () => clearTimeout(handle);
  }, [tabs, activeTabId, loaded]);

  // Flush on window close — guarantees no in-flight changes are lost.
  useEffect(() => {
    if (!loaded) return;
    const flush = (): void => { void persistTabs(tabs, activeTabId); };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [tabs, activeTabId, loaded]);

  // ─── mutations ───

  const openTab = useCallback((): string => {
    const id = makeTabId();
    setTabs((prev) => {
      // Name uses max-existing-N + 1 instead of length+1 — avoids the
      // duplicate-name bug after closing earlier tabs.
      const newTab = makeDefaultTab(id, prev.length, nextDefaultTitle(prev));
      return [...prev, newTab];
    });
    setActiveTabId(id);
    return id;
  }, []);

  const closeTab = useCallback((id: string): string => {
    let nextActive = "";
    setTabs((prev) => {
      if (prev.length <= 1) {
        // Never close the last tab — the App layer should open a new one
        // before or after this call. Return unchanged, caller handles this.
        return prev;
      }
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      // Use the ref to read the current activeTabId without stale closure.
      if (id === activeTabIdRef.current || nextActive === "") {
        const newIdx = Math.max(0, idx - 1);
        nextActive = next[newIdx]?.id ?? next[0]?.id ?? "";
      }
      return next;
    });
    if (nextActive) {
      setActiveTabId(nextActive);
    }
    return nextActive;
  // activeTabId deliberately omitted: we use activeTabIdRef.current instead.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchTab = useCallback((id: string): void => {
    setActiveTabId(id);
  }, []);

  const cycleTab = useCallback((dir: 1 | -1): void => {
    setTabs((prev) => {
      setActiveTabId((cur) => {
        const idx = prev.findIndex((t) => t.id === cur);
        if (idx === -1) return cur;
        const next = (idx + dir + prev.length) % prev.length;
        return prev[next]?.id ?? cur;
      });
      return prev;
    });
  }, []);

  const updateTab = useCallback((id: string, patch: Partial<Omit<Tab, "id">>): void => {
    // For user-set persistent fields (color, title) bypass the 800ms debounce
    // and persist immediately — otherwise a quick "change color → close window"
    // race loses the change. Streaming-heavy fields (history, busy, ready,
    // meta) keep the debounced path.
    const isUserAction = "color" in patch || "title" in patch;
    setTabs((prev) => {
      const next = prev.map((t) => (t.id === id ? { ...t, ...patch } : t));
      if (isUserAction) {
        // Fire-and-forget; the debounced effect will also run but writing
        // twice is cheap and idempotent.
        void persistTabs(next, activeTabIdRef.current);
      }
      return next;
    });
  }, []);

  const appendTurn = useCallback((id: string, turn: Turn): void => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, history: [...t.history, turn] } : t,
      ),
    );
  }, []);

  const updateTurn = useCallback(
    (id: string, turnId: string, patch: Partial<Turn>): void => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                history: t.history.map((turn) =>
                  turn.id === turnId ? { ...turn, ...patch } : turn,
                ),
              }
            : t,
        ),
      );
    },
    [],
  );

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  return {
    tabs,
    activeTabId,
    activeTab,
    openTab,
    closeTab,
    switchTab,
    cycleTab,
    updateTab,
    appendTurn,
    updateTurn,
    loaded,
  };
}

// ─────────────── pending turn helpers (exported for App.tsx) ───────────────
// These mirror the ceroTurnRef pattern from App.tsx but scoped per-tab.
// App.tsx holds a Map<tabId, PendingTurn> ref to track in-flight cero turns.

export interface PendingTurn {
  id: string;
  text: string;
  tools: ToolEvent[];
  skills: string[];
}

export function emptyPending(id: string): PendingTurn {
  return { id, text: "", tools: [], skills: [] };
}
