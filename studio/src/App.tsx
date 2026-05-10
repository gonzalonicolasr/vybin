import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useRef, useState, useCallback } from "react";
import { ErrorBoundary } from "./ErrorBoundary";
import {
  Header,
  Workspace,
  Prompt,
  StatusBar,
  type ToolEvent,
  type SnapshotData,
  type ViewName,
} from "./components";
import { type CeroSettings, DEFAULT_SETTINGS, useSettings } from "./hooks/useSettings";
import { getProviderMeta } from "./lib/providers";
import { useTabs, emptyPending, type PendingTurn } from "./hooks/useTabs";
import { TabBar } from "./TabBar";
import { Toasts } from "./Toasts";
import { useToasts } from "./hooks/useToasts";
import { ToastContext } from "./hooks/ToastContext";
import { notify } from "./lib/notify";
import { Settings, DEFAULT_VOICE_MODE, type VoiceModeSettings } from "./views/Settings";
import { Mascot } from "./Mascot";
import { useMascot } from "./hooks/useMascot";
import { SkillsView } from "./views/SkillsView";
import { LessonsView } from "./views/LessonsView";
import { UserModelView } from "./views/UserModelView";
import { MCPView } from "./views/MCPView";
import { GatewayView } from "./views/GatewayView";
import { SchedulerView } from "./views/SchedulerView";
import { StatsView } from "./views/StatsView";
import { DataView } from "./views/DataView";
import { AdminView } from "./views/AdminView";
import { SetupView } from "./views/SetupView";
import { VoiceModeToggle } from "./VoiceModeToggle";
import { ClarifyModal } from "./ClarifyModal";
import { ApprovalModal } from "./ApprovalModal";
import { ClickParticles } from "./ClickParticles";
import type { ClarifyRequest, ApprovalRequest, ClarifyResponse, ApprovalResponse, PendingRequest } from "./ipc-types";

// Vybin v0.3.0 — multi-tab edition.
// Each tab owns an isolated cero sidecar process. tab_id (UUID v4) is assigned
// by the frontend; all Tauri commands and inbound events carry it for routing.

const EVENT_CHANNEL = "cero-event";
const MAX_TABS_WARNING = 10;

const EMPTY_SNAPSHOT: SnapshotData = {
  stats: { skills: 0, lessons: 0, sessions: 0, userModelVersion: 0, avgSuccessRate: null },
  topSkills: [],
  user: { expertiseAreas: [], currentProjects: [] },
};

let turnSeq = 0;
const nextTurnId = (): string => `t${++turnSeq}`;

// ─────────────── session learning summary ───────────────

export interface SessionLearningSummary {
  skillsCreated: number;
  skillsUpdated: number;
  lessonsStored: number;
  userModelChanged: boolean;
  changedFields: string[];
  versionBefore?: number;
  versionAfter?: number;
  totalTokens?: number;
  costUsd?: number;
}

// ─────────────── inbound event shape ───────────────

type CeroMsg =
  | { type: "ready"; tab_id: string; protocol: string; sessionId: string; model: string; provider: string; sandbox: string }
  | { type: "text-delta"; tab_id: string; delta: string }
  | { type: "tool-call"; tab_id: string; toolCallId: string; name: string; args: Record<string, unknown> }
  | { type: "tool-result"; tab_id: string; toolCallId: string; content: string; isError: boolean }
  | { type: "turn-end"; tab_id: string; reason: string }
  | { type: "done"; tab_id: string; reason: string; turns: number }
  | { type: "system"; tab_id: string; text: string }
  | { type: "error"; tab_id: string; message: string }
  | { type: "snapshot"; tab_id: string; snapshot: SnapshotData }
  | { type: "sidecar-exit"; tab_id: string }
  | { type: "sidecar-stderr"; tab_id: string; line: string }
  | { type: "session-end-summary"; tab_id: string; summary: SessionLearningSummary }
  | (ClarifyRequest & { tab_id: string })
  | (ApprovalRequest & { tab_id: string });

// ─────────────── component ───────────────

export function App(): React.JSX.Element {
  const { settings, loading: settingsLoading, save: saveSettings } = useSettings();
  const { toasts, toast, dismiss: dismissToast } = useToasts();
  const {
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
    loaded: tabsLoaded,
  } = useTabs();

  const [showSettings, setShowSettings] = useState(false);
  const [view, setView] = useState<ViewName>("chat");
  const [snapshotVersion, setSnapshotVersion] = useState(0);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotData>(EMPTY_SNAPSHOT);
  // Mascot state machine — drives the corner CRT-head. Level/XP derive from
  // snapshot.stats; transient states (cheer/x-eyes) are triggered from the
  // event dispatcher below.
  const mascot = useMascot(snapshot);
  const [learningSummary, setLearningSummary] = useState<SessionLearningSummary | null>(null);
  const importedEnvRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Auto-reconnect — per-tab backoff timers. Cleared on manual reconnect or
  // when the tab goes ready. Exponential: 2s → 4s → 8s → 16s → 30s (cap).
  const reconnectTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const reconnectAttempts = useRef<Map<string, number>>(new Map());

  // Voice mode state — parsed from settings.voiceMode JSON field
  const [voiceMode, setVoiceMode] = useState<VoiceModeSettings>(DEFAULT_VOICE_MODE);

  // Setup wizard — shown on first launch (before setup is complete)
  const [showSetup, setShowSetup] = useState(false);

  // Per-tab request queues. Map<tabId, PendingRequest[]>.
  // First entry in each array is the currently-displayed modal; the rest are queued.
  const [requestQueues, setRequestQueues] = useState<Map<string, PendingRequest[]>>(new Map());

  // Per-tab pending turn tracking. Map<tabId, PendingTurn | null>
  // Stored as a ref (not state) because it's only used during streaming;
  // visual updates go through appendTurn / updateTurn which do use state.
  const pendingRef = useRef<Map<string, PendingTurn | null>>(new Map());
  // Per-tab tool timing. Map<tabId, Map<toolCallId, startMs>>
  const toolStartRef = useRef<Map<string, Map<string, number>>>(new Map());
  // Debounce timers for syncPendingToTab — groups rapid text-deltas into one setTabs call.
  // pendingRef is mutated synchronously on every delta; only the React state flush is debounced.
  const syncDebounceRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // ─── pending turn helpers (scoped to a tab) ───

  const ensurePendingInTab = useCallback(
    (tabId: string): PendingTurn => {
      let pending = pendingRef.current.get(tabId) ?? null;
      if (pending) return pending;
      pending = emptyPending(nextTurnId());
      pendingRef.current.set(tabId, pending);
      appendTurn(tabId, { id: pending.id, kind: "cero", text: "", tools: [] });
      return pending;
    },
    [appendTurn],
  );

  const syncPendingToTab = useCallback(
    (tabId: string): void => {
      const pending = pendingRef.current.get(tabId);
      if (!pending) return;
      updateTurn(tabId, pending.id, {
        text: pending.text,
        tools: [...pending.tools],
        ...(pending.skills.length > 0 ? { skills: [...pending.skills] } : {}),
      });
    },
    [updateTurn],
  );

  const flushPending = useCallback(
    (tabId: string): void => {
      syncPendingToTab(tabId);
      pendingRef.current.set(tabId, null);
    },
    [syncPendingToTab],
  );

  // ─── request queue helpers ───

  const enqueueRequest = useCallback((tabId: string, req: PendingRequest): void => {
    setRequestQueues((prev) => {
      const next = new Map(prev);
      const q = next.get(tabId) ?? [];
      next.set(tabId, [...q, req]);
      return next;
    });
  }, []);

  const dequeueRequest = useCallback((tabId: string): void => {
    setRequestQueues((prev) => {
      const next = new Map(prev);
      const q = next.get(tabId) ?? [];
      if (q.length <= 1) {
        next.delete(tabId);
      } else {
        next.set(tabId, q.slice(1));
      }
      return next;
    });
  }, []);

  const resolveRequest = useCallback(
    async (tabId: string, payload: ClarifyResponse | ApprovalResponse): Promise<void> => {
      try {
        await invoke("respond_request", { tabId, payload });
      } catch (err) {
        toast.error(`Failed to send response: ${String(err)}`);
      }
      dequeueRequest(tabId);
    },
    [dequeueRequest, toast],
  );

  // ─── event dispatcher (routes by tab_id) ───

  const dispatch = useCallback(
    (msg: CeroMsg): void => {
      const tabId = msg.tab_id;
      if (!tabId) return; // Safety: drop messages without routing info

      if (import.meta.env.DEV) console.debug("[ipc-event]", msg.type, tabId);

      switch (msg.type) {
        case "ready":
          updateTab(tabId, {
            ready: true,
            meta: {
              sessionId: msg.sessionId,
              model: msg.model,
              provider: msg.provider,
              sandbox: msg.sandbox,
            },
          });
          // Reset backoff counter on successful reconnect
          reconnectAttempts.current.delete(tabId);
          {
            const t = reconnectTimers.current.get(tabId);
            if (t !== undefined) { clearTimeout(t); reconnectTimers.current.delete(tabId); }
          }
          break;

        case "text-delta": {
          const cur = ensurePendingInTab(tabId);
          cur.text += msg.delta;
          // Debounce: accumulate deltas in the mutable ref; flush React state at most every 80ms
          clearTimeout(syncDebounceRef.current.get(tabId));
          syncDebounceRef.current.set(
            tabId,
            setTimeout(() => { syncPendingToTab(tabId); }, 80),
          );
          mascot.trigger("think");
          break;
        }

        case "tool-call": {
          const cur = ensurePendingInTab(tabId);
          const tool: ToolEvent = {
            id: msg.toolCallId,
            name: msg.name,
            args: JSON.stringify(msg.args, null, 2),
          };
          cur.tools.push(tool);
          if (!toolStartRef.current.has(tabId)) {
            toolStartRef.current.set(tabId, new Map());
          }
          toolStartRef.current.get(tabId)!.set(msg.toolCallId, Date.now());
          syncPendingToTab(tabId);
          break;
        }

        case "tool-result": {
          const tabTools = toolStartRef.current.get(tabId);
          const start = tabTools?.get(msg.toolCallId);
          const ms = start !== undefined ? Date.now() - start : undefined;
          const pending = pendingRef.current.get(tabId) ?? null;
          if (pending) {
            const t = pending.tools.find((tt) => tt.id === msg.toolCallId);
            if (t) {
              const updated: ToolEvent = {
                ...t,
                result: msg.content,
                ...(ms !== undefined ? { ms } : {}),
              };
              pending.tools = pending.tools.map((tt) =>
                tt.id === msg.toolCallId ? updated : tt,
              );
              syncPendingToTab(tabId);
            }
          }
          break;
        }

        case "turn-end":
          break;

        case "done":
          flushPending(tabId);
          updateTab(tabId, { busy: false });
          mascot.trigger("cheer");
          break;

        case "system":
          flushPending(tabId);
          appendTurn(tabId, { id: nextTurnId(), kind: "cero", text: msg.text });
          break;

        case "error": {
          flushPending(tabId);
          const m = msg.message ?? "";
          const helpful = /API[_ ]?KEY|api key|unauthorized|401/i.test(m)
            ? `${m}\n\n→ Configurá tu API key en Settings (Ctrl+,)`
            : m;
          appendTurn(tabId, { id: nextTurnId(), kind: "error", text: helpful });
          updateTab(tabId, { busy: false });
          void notify({ title: "Vybin — error", body: m.slice(0, 140), kind: "error" });
          mascot.trigger("error");
          break;
        }

        case "snapshot":
          setSnapshot(msg.snapshot);
          setSnapshotVersion((v) => v + 1);
          break;

        case "sidecar-exit": {
          updateTab(tabId, { ready: false, busy: false });
          void notify({ title: "Vybin — sidecar exited", body: `Session ended (tab ${tabId.slice(0, 8)})`, kind: "warning" });
          // Schedule auto-reconnect with exponential backoff (2s → 4s → 8s → 16s → 30s cap)
          const prevAttempts = reconnectAttempts.current.get(tabId) ?? 0;
          const delayMs = Math.min(2000 * Math.pow(2, prevAttempts), 30_000);
          reconnectAttempts.current.set(tabId, prevAttempts + 1);
          const existingTimer = reconnectTimers.current.get(tabId);
          if (existingTimer !== undefined) clearTimeout(existingTimer);
          const timer = setTimeout(() => {
            reconnectTimers.current.delete(tabId);
            const payload = buildSidecarPayload(settings);
            void invoke("open_tab", {
              tabId,
              config: payload.config,
              env: payload.env,
            }).catch(() => {
              // If this attempt also fails, the next sidecar-exit event will
              // schedule another retry automatically.
            });
          }, delayMs);
          reconnectTimers.current.set(tabId, timer);
          break;
        }

        case "clarify-request":
          enqueueRequest(tabId, { kind: "clarify", req: msg as ClarifyRequest & { tab_id: string } });
          break;

        case "approval-request":
          enqueueRequest(tabId, { kind: "approval", req: msg as ApprovalRequest & { tab_id: string } });
          void notify({ title: "Vybin — approval needed", body: `${msg.dangerLevel.toUpperCase()}: ${msg.command.slice(0, 80)}`, kind: "warning" });
          break;

        case "session-end-summary":
          // Only show if something actually happened
          if (
            msg.summary.skillsCreated > 0 ||
            msg.summary.skillsUpdated > 0 ||
            msg.summary.lessonsStored > 0 ||
            msg.summary.userModelChanged
          ) {
            setLearningSummary(msg.summary);
            window.setTimeout(() => setLearningSummary(null), 5000);
          }
          break;

        case "sidecar-stderr": {
          // Forward stderr lines that look like errors as toasts so the user
          // sees why the sidecar isn't going online (bad API key, model 404,
          // baseUrl unreachable, etc.). Skip noise like "info" / "debug".
          const line = (msg as { line?: string }).line ?? "";
          if (/error|fatal|fail|invalid|unauthorized|401|403|404|ECONNREF|ENOTFOUND/i.test(line)) {
            toast.error(`sidecar: ${line.length > 200 ? `${line.slice(0, 200)}…` : line}`);
          }
          break;
        }
      }
    },
    [updateTab, ensurePendingInTab, syncPendingToTab, flushPending, appendTurn, enqueueRequest],
  );

  // ─── subscribe to events once ───

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    (async (): Promise<void> => {
      unlisten = await listen<string>(EVENT_CHANNEL, (e) => {
        if (cancelled) return;
        try {
          const msg = JSON.parse(e.payload) as CeroMsg;
          dispatch(msg);
        } catch {
          /* malformed line */
        }
      });
    })();
    return (): void => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [dispatch]);

  // ─── open initial tabs after store is loaded ───
  // We wait for both settings and tabs to be loaded so we have the env ready.

  const initializedRef = useRef(false);
  useEffect(() => {
    if (!tabsLoaded || settingsLoading || initializedRef.current) return;
    initializedRef.current = true;
    const payload = buildSidecarPayload(settings);
    // Spawn sidecar for each persisted tab (or the default single tab)
    for (const tab of tabs) {
      void (async () => {
        try {
          await invoke("open_tab", {
            tabId: tab.id,
            config: payload.config,
            env: payload.env,
          });
        } catch (err) {
          setGlobalError(`Failed to spawn session for tab ${tab.title}: ${String(err)}`);
        }
      })();
    }
  }, [tabsLoaded, settingsLoading, settings, tabs]);

  // ─── first-launch: import .env ───

  useEffect(() => {
    if (settingsLoading || importedEnvRef.current) return;
    const hasAnyKey =
      settings.anthropicApiKey ||
      settings.openaiApiKey ||
      settings.geminiApiKey ||
      settings.awsAccessKeyId;
    if (hasAnyKey) {
      importedEnvRef.current = true;
      return;
    }
    importedEnvRef.current = true;
    (async (): Promise<void> => {
      try {
        const env = (await invoke("try_import_env")) as Record<string, string>;
        if (Object.keys(env).length === 0) return;
        const next: CeroSettings = { ...settings };
        if (env.ANTHROPIC_API_KEY) next.anthropicApiKey = env.ANTHROPIC_API_KEY;
        if (env.OPENAI_API_KEY) next.openaiApiKey = env.OPENAI_API_KEY;
        if (env.OPENAI_BASE_URL) next.baseUrl = env.OPENAI_BASE_URL;
        if (env.GEMINI_API_KEY || env.GOOGLE_API_KEY) {
          next.geminiApiKey = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY ?? "";
        }
        if (env.AWS_ACCESS_KEY_ID) next.awsAccessKeyId = env.AWS_ACCESS_KEY_ID;
        if (env.AWS_SECRET_ACCESS_KEY) next.awsSecretAccessKey = env.AWS_SECRET_ACCESS_KEY;
        if (env.AWS_REGION) next.awsRegion = env.AWS_REGION;
        if (next.provider === DEFAULT_SETTINGS.provider) {
          if (next.openaiApiKey) next.provider = "openai";
          else if (next.anthropicApiKey) next.provider = "anthropic";
          else if (next.geminiApiKey) next.provider = "gemini";
        }
        await saveSettings(next);
        const keyCount = Object.keys(env).filter(
          (k) => k.endsWith("_API_KEY") || k.endsWith("_KEY_ID"),
        ).length;
        toast.success(`API keys imported from .env (${keyCount} keys)`);
      } catch {
        // Best-effort — silent if no .env or unreadable
      }
    })();
  }, [settings, settingsLoading, saveSettings]);

  // ─── first-launch: show setup wizard if no API keys and setup not completed ───

  useEffect(() => {
    if (settingsLoading) return;
    if (settings.setupCompleted === "true") return;
    const hasAnyKey =
      settings.anthropicApiKey ||
      settings.openaiApiKey ||
      settings.geminiApiKey ||
      settings.awsAccessKeyId;
    if (!hasAnyKey) {
      setShowSetup(true);
    }
  // Only run once after settings load
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoading]);

  // ─── parse voice mode from settings whenever settings change ───

  useEffect(() => {
    if (!settings.voiceMode) return;
    try {
      const parsed = JSON.parse(settings.voiceMode) as VoiceModeSettings;
      setVoiceMode(parsed);
    } catch {
      // Malformed — keep current state
    }
  }, [settings.voiceMode]);

  // ─── restart ALL sidecars when settings change (after initial load) ───

  // ─── apply theme class to <body> whenever settings.theme changes ───
  useEffect(() => {
    const body = document.body;
    body.classList.remove("theme-violet", "theme-lima", "theme-amber");
    body.classList.add(`theme-${settings.theme ?? "violet"}`);
  }, [settings.theme]);

  const settingsChangedRef = useRef(false);
  useEffect(() => {
    if (settingsLoading || !initializedRef.current) return;
    if (!settingsChangedRef.current) {
      // Skip the very first fire (that's handled by the initializedRef block above)
      settingsChangedRef.current = true;
      return;
    }
    const payload = buildSidecarPayload(settings);
    const tabIds = tabs.map((t) => t.id);
    void (async () => {
      try {
        await invoke("restart_session", {
          config: payload.config,
          env: payload.env,
          tabIds,
        });
        // Reset pending turns and ready state for all tabs
        for (const tab of tabs) {
          pendingRef.current.set(tab.id, null);
          updateTab(tab.id, { ready: false, busy: false });
        }
      } catch (err) {
        setGlobalError(`Sidecar restart failed: ${String(err)}`);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, settingsLoading]);

  // ─── auto-scroll when active tab history changes ───

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeTab?.history.length]);

  // ─── keyboard shortcuts ───

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      if (e.key === ",") {
        e.preventDefault();
        setShowSettings(true);
        return;
      }

      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        handleOpenTab();
        return;
      }

      if (e.key === "w" || e.key === "W") {
        e.preventDefault();
        handleCloseTab(activeTabId);
        return;
      }

      // Ctrl+Tab = next, Ctrl+Shift+Tab = previous
      if (e.key === "Tab") {
        e.preventDefault();
        cycleTab(e.shiftKey ? -1 : 1);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return (): void => window.removeEventListener("keydown", onKey);
  // handleOpenTab and handleCloseTab are stable (useCallback) — listed below
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, cycleTab]);

  // ─── tab management handlers ───

  const handleOpenTab = useCallback((): void => {
    if (tabs.length >= MAX_TABS_WARNING) {
      setGlobalError(
        `Warning: ${tabs.length} tabs open. Each tab runs a separate cero process (~100 MB RAM).`,
      );
      setTimeout(() => setGlobalError(null), 5000);
    }
    const id = openTab(); // openTab() from useTabs generates the id & sets active
    const payload = buildSidecarPayload(settings);
    void (async () => {
      try {
        await invoke("open_tab", {
          tabId: id,
          config: payload.config,
          env: payload.env,
        });
      } catch (err) {
        setGlobalError(`Failed to open tab: ${String(err)}`);
      }
    })();
  }, [tabs.length, openTab, settings]);

  const handleCloseTab = useCallback(
    (id: string): void => {
      if (tabs.length === 1) {
        // Last tab: open a new one before closing so the user always has a session
        handleOpenTab();
      }
      // Drain pending requests for this tab — send default-deny/null so cero recovers clean
      const queue = requestQueues.get(id) ?? [];
      for (const pending of queue) {
        const payload =
          pending.kind === "clarify"
            ? { type: "clarify-response" as const, id: pending.req.id, answer: null, reason: "tab closed" }
            : { type: "approval-response" as const, id: pending.req.id, approved: false, rememberForSession: false, reason: "tab closed" };
        void invoke("respond_request", { tabId: id, payload }).catch(() => {/* ignore — tab closing */});
      }
      if (queue.length > 0) {
        setRequestQueues((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
      }
      const nextActiveId = closeTab(id);
      void invoke("close_tab", { tabId: id }).catch((err) => {
        setGlobalError(`Close tab error: ${String(err)}`);
      });
      if (nextActiveId) {
        // Clean up dangling pending state for closed tab
        pendingRef.current.delete(id);
        toolStartRef.current.delete(id);
      }
    },
    [tabs.length, closeTab, handleOpenTab, requestQueues],
  );

  // ─── chat handlers ───

  const handleSubmit = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed) return;
      // input is cleared inside Prompt after submit; App only sees the final text
      if (trimmed.startsWith("/")) {
        await invoke("send_slash", { tabId: activeTabId, raw: trimmed });
        return;
      }
      appendTurn(activeTabId, { id: nextTurnId(), kind: "user", text: trimmed });
      updateTab(activeTabId, { busy: true });
      await invoke("send_prompt", { tabId: activeTabId, text: trimmed });
    },
    [activeTabId, appendTurn, updateTab],
  );

  const handleCancelStream = useCallback((): void => {
    void invoke("cancel_turn", { tabId: activeTabId }).catch(() => {/* no-op */});
  }, [activeTabId]);

  const handleSaveSettings = useCallback(
    async (next: CeroSettings, voice: VoiceModeSettings): Promise<void> => {
      const withVoice: CeroSettings = { ...next, voiceMode: JSON.stringify(voice) };
      await saveSettings(withVoice);
      setVoiceMode(voice);
      // useEffect on [settings] above will restart sidecars
    },
    [saveSettings],
  );

  const handleSetupComplete = useCallback(async (): Promise<void> => {
    await saveSettings({ ...settings, setupCompleted: "true" });
    setShowSetup(false);
    setView("chat");
  }, [settings, saveSettings]);

  // ─── derived display values ───

  const meta = activeTab?.meta ?? null;
  const busy = activeTab?.busy ?? false;
  const ready = activeTab?.ready ?? false;
  const turns = activeTab?.history ?? [];

  // The current request modal for the active tab (head of FIFO queue)
  const activeQueue = requestQueues.get(activeTabId) ?? [];
  const activeRequest = activeQueue[0] ?? null;
  const queueDepth = activeQueue.length;

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss: dismissToast }}>
    <div className="frame">
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSwitch={switchTab}
        onClose={handleCloseTab}
        onNew={handleOpenTab}
        onRename={(id, title) => updateTab(id, { title })}
        onColorChange={(id, color) => updateTab(id, { color })}
      />
      <Header
        version="0.3.0-alpha"
        provider={meta?.provider ?? settings.provider}
        model={meta?.model ?? settings.model}
        sandbox={meta?.sandbox ?? settings.sandbox}
        online={ready}
        baseUrl={settings.baseUrl}
        apiKey={settings.openaiApiKey}
        onSettingsClick={() => setShowSettings(true)}
        onReconnect={() => {
          // Force a fresh sidecar with whatever the user has saved.
          const payload = buildSidecarPayload(settings);
          for (const tab of tabs) {
            updateTab(tab.id, { ready: false, busy: false });
          }
          void invoke("restart_session", {
            config: payload.config,
            env: payload.env,
            tabIds: tabs.map((t) => t.id),
          })
            .then(() => toast.info("reconnecting sidecar with current settings…"))
            .catch((err) => {
              setGlobalError(`Reconnect failed: ${String(err)}`);
              toast.error(`reconnect failed: ${String(err)}`);
            });
        }}
        onModelChange={(modelId) => {
          // Persist + restart all tabs with the new model (env vars stay the same).
          void saveSettings({ ...settings, model: modelId }).then(async () => {
            const payload = buildSidecarPayload({ ...settings, model: modelId });
            try {
              await invoke("restart_session", {
                config: payload.config,
                env: payload.env,
                tabIds: tabs.map((t) => t.id),
              });
              for (const tab of tabs) {
                updateTab(tab.id, { ready: false, busy: false });
              }
            } catch (err) {
              setGlobalError(`Failed to switch model: ${String(err)}`);
            }
          });
        }}
        onProviderChange={(providerId) => {
          // Switch provider → reset model to that provider's default so the
          // restart succeeds even if the previous model was provider-specific.
          // The user can fine-tune via the model picker afterwards.
          const meta = getProviderMeta(providerId);
          const nextProvider = providerId as CeroSettings["provider"];
          const nextModel = meta?.defaultModel ?? settings.model;
          const nextSettings: CeroSettings = {
            ...settings,
            provider: nextProvider,
            model: nextModel,
          };
          void saveSettings(nextSettings).then(async () => {
            const payload = buildSidecarPayload(nextSettings);
            try {
              await invoke("restart_session", {
                config: payload.config,
                env: payload.env,
                tabIds: tabs.map((t) => t.id),
              });
              for (const tab of tabs) {
                updateTab(tab.id, { ready: false, busy: false });
              }
            } catch (err) {
              setGlobalError(`Failed to switch provider: ${String(err)}`);
            }
          });
        }}
      />
      <ErrorBoundary label="workspace">
      <Workspace
        turns={turns}
        snapshot={snapshot}
        scrollRef={scrollRef}
        view={view}
        onViewChange={setView}
      >
        {view === "skills" ? <SkillsView snapshotVersion={snapshotVersion} /> : null}
        {view === "lessons" ? <LessonsView snapshotVersion={snapshotVersion} /> : null}
        {view === "user-model" ? <UserModelView snapshotVersion={snapshotVersion} /> : null}
        {view === "mcp" ? <MCPView /> : null}
        {view === "gateway" ? <GatewayView /> : null}
        {view === "scheduler" ? <SchedulerView /> : null}
        {view === "stats" ? <ErrorBoundary label="stats"><StatsView /></ErrorBoundary> : null}
        {view === "data" ? <DataView /> : null}
        {view === "admin" ? <ErrorBoundary label="admin"><AdminView /></ErrorBoundary> : null}
        {view === "setup" ? <SetupView onComplete={() => void handleSetupComplete()} /> : null}
      </Workspace>
      </ErrorBoundary>
      {view === "chat" ? (
        <Prompt onSubmit={handleSubmit} onCancel={handleCancelStream} busy={busy} />
      ) : null}
      <StatusBar
        provider={
          (settings.baseUrl || settings.provider)
            .replace(/^https?:\/\//, "")
            .split("/")[0] ?? settings.provider
        }
        model={meta?.model ?? settings.model}
        snapshot={snapshot}
        online={ready}
        voiceModeToggle={<VoiceModeToggle initialActive={voiceMode.enabled} />}
      />
      {globalError ? (
        <div
          className={`global-toast ${globalError.startsWith("✓") ? "global-toast-ok" : "global-toast-err"}`}
        >
          {globalError}
          <button className="global-toast-close" onClick={() => setGlobalError(null)}>
            ✕
          </button>
        </div>
      ) : null}
      {showSetup ? (
        <div className="setup-overlay">
          <SetupView onComplete={() => void handleSetupComplete()} />
        </div>
      ) : null}
      {showSettings ? (
        <Settings
          initial={settings}
          initialVoice={voiceMode}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
        />
      ) : null}
      {/* Request modals — rendered for the active tab only */}
      {activeRequest !== null && (
        <>
          {queueDepth > 1 && (
            <div className="modal-queue-indicator">
              {queueDepth - 1} more request{queueDepth > 2 ? "s" : ""} queued
            </div>
          )}
          {activeRequest.kind === "clarify" && (
            <ClarifyModal
              request={activeRequest.req}
              onResolve={(response): void => { void resolveRequest(activeTabId, response); }}
              onCancel={(): void => dequeueRequest(activeTabId)}
            />
          )}
          {activeRequest.kind === "approval" && (
            <ApprovalModal
              request={activeRequest.req}
              onResolve={(response): void => { void resolveRequest(activeTabId, response); }}
              onCancel={(): void => dequeueRequest(activeTabId)}
            />
          )}
        </>
      )}
      <Toasts toasts={toasts} dismiss={dismissToast} />
      {learningSummary ? (
        <SessionSummaryToast
          summary={learningSummary}
          onDismiss={() => setLearningSummary(null)}
        />
      ) : null}
      <ClickParticles />
      <Mascot
        state={mascot.state}
        level={mascot.level}
        xp={mascot.xp}
        xpToNext={mascot.xpToNext}
        xpPercent={mascot.xpPercent}
      />
    </div>
    </ToastContext.Provider>
  );
}

// ─────────────── session summary toast ───────────────

function SessionSummaryToast({
  summary,
  onDismiss,
}: {
  readonly summary: SessionLearningSummary;
  readonly onDismiss: () => void;
}): React.JSX.Element {
  const modelVersionLine =
    summary.userModelChanged && summary.versionBefore !== undefined && summary.versionAfter !== undefined
      ? `user model: v${summary.versionBefore} → v${summary.versionAfter}`
      : summary.userModelChanged
      ? "user model: updated"
      : null;

  return (
    <div
      style={{
        position: "fixed",
        top: 18,
        right: 24,
        zIndex: 9500,
        width: 320,
        background: "var(--bg-tint)",
        border: "1px solid var(--accent)",
        boxShadow: "0 0 24px rgba(184, 148, 245, 0.25)",
        fontFamily: "var(--pixel-font)",
        animation: "toast-in 200ms ease-out",
      }}
    >
      {/* header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: "1px solid var(--border)",
          color: "var(--accent)",
          fontSize: 20,
        }}
      >
        <span>
          <span style={{ color: "var(--accent)", marginRight: 8 }}>✦</span>
          session learned
        </span>
        <button
          onClick={onDismiss}
          style={{
            background: "none",
            border: "none",
            color: "var(--muted)",
            cursor: "pointer",
            fontFamily: "var(--pixel-font)",
            fontSize: 18,
            padding: "0 4px",
          }}
          aria-label="dismiss"
        >
          ✕
        </button>
      </div>
      {/* bullets */}
      <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
        {summary.skillsCreated > 0 && (
          <div style={{ fontSize: 18, color: summary.skillsCreated > 0 ? "var(--accent)" : "var(--dim)" }}>
            + {summary.skillsCreated} skill{summary.skillsCreated !== 1 ? "s" : ""} created
          </div>
        )}
        {summary.skillsUpdated > 0 && (
          <div style={{ fontSize: 18, color: "var(--fg)" }}>
            + {summary.skillsUpdated} skill{summary.skillsUpdated !== 1 ? "s" : ""} updated
          </div>
        )}
        {summary.lessonsStored > 0 && (
          <div style={{ fontSize: 18, color: "var(--fg)" }}>
            + {summary.lessonsStored} lesson{summary.lessonsStored !== 1 ? "s" : ""} recorded
          </div>
        )}
        {modelVersionLine ? (
          <div style={{ fontSize: 18, color: "var(--cyan)" }}>{modelVersionLine}</div>
        ) : null}
        {summary.totalTokens !== undefined && (
          <div style={{ fontSize: 16, color: "var(--dim)", marginTop: 4 }}>
            {summary.totalTokens.toLocaleString()} tokens
            {summary.costUsd !== undefined
              ? ` · $${summary.costUsd.toFixed(4)}`
              : ""}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────── payload builder ───────────────

function buildSidecarPayload(s: CeroSettings): { config: Record<string, unknown>; env: Record<string, string> } {
  const env: Record<string, string> = {};
  if (s.anthropicApiKey) env.ANTHROPIC_API_KEY = s.anthropicApiKey;
  if (s.openaiApiKey) env.OPENAI_API_KEY = s.openaiApiKey;
  if (s.geminiApiKey) {
    env.GEMINI_API_KEY = s.geminiApiKey;
    env.GOOGLE_API_KEY = s.geminiApiKey;
  }
  if (s.awsAccessKeyId) env.AWS_ACCESS_KEY_ID = s.awsAccessKeyId;
  if (s.awsSecretAccessKey) env.AWS_SECRET_ACCESS_KEY = s.awsSecretAccessKey;
  if (s.awsRegion) env.AWS_REGION = s.awsRegion;

  // llama.cpp ships an OpenAI-compatible HTTP server (`llama-server`), so we
  // map the provider to "openai" + base_url for the sidecar — the cero binary
  // doesn't need a dedicated llamacpp adapter. Same trick lets us swap our
  // own Mate model in transparently. llama.cpp ignores the API key but the
  // OpenAI client SDK refuses to start without one, so we inject a stub.
  const isLlamaCpp = s.provider === "llamacpp";
  const sidecarProvider = isLlamaCpp ? "openai" : s.provider;
  const llamaCppBaseUrl = isLlamaCpp
    ? (s.baseUrl.trim() === "" ? "http://127.0.0.1:8080/v1" : s.baseUrl)
    : null;
  const sidecarBaseUrl = isLlamaCpp
    ? llamaCppBaseUrl
    : (s.provider === "openai" && s.baseUrl ? s.baseUrl : null);

  if (sidecarBaseUrl && (s.provider === "openai" || isLlamaCpp)) {
    env.OPENAI_BASE_URL = sidecarBaseUrl;
  }
  if (isLlamaCpp && !env.OPENAI_API_KEY) {
    env.OPENAI_API_KEY = "sk-local-no-key-required";
  }

  return {
    config: {
      provider: sidecarProvider,
      model: s.model || null,
      base_url: sidecarBaseUrl,
      sandbox: s.sandbox,
      goal: s.goal || null,
      no_learning: s.learningMode === "off",
    },
    env,
  };
}
