// React hook that talks to the cero sidecar via Tauri.
// On mount: starts a session, subscribes to the "cero-event" channel.
// Translates cero JSON-line messages into the Turn[] / SnapshotData
// shapes used by the v5 UI components.
//
// Single-session for now (one sidecar per app instance). Multi-tabs
// will own multiple useCero instances later.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Turn, ToolEvent, SnapshotData } from "../components";

const EVENT_CHANNEL = "cero-event";

// Cero IPC outbound message shapes (mirror src/cli/chat-ipc.ts).
type CeroMsg =
  | { type: "ready"; protocol: string; sessionId: string; model: string; provider: string; sandbox: string }
  | { type: "text-delta"; delta: string }
  | { type: "tool-call"; toolCallId: string; name: string; args: Record<string, unknown> }
  | { type: "tool-result"; toolCallId: string; content: string; isError: boolean }
  | { type: "turn-end"; reason: string }
  | { type: "done"; reason: string; turns: number }
  | { type: "system"; text: string }
  | { type: "error"; message: string }
  | { type: "snapshot"; snapshot: SnapshotData }
  | { type: "sidecar-exit" }
  | { type: "sidecar-stderr"; line: string };

export interface UseCeroResult {
  readonly ready: boolean;
  readonly busy: boolean;
  readonly turns: ReadonlyArray<Turn>;
  readonly snapshot: SnapshotData | null;
  readonly meta: { sessionId: string; model: string; provider: string; sandbox: string } | null;
  readonly stderr: ReadonlyArray<string>;
  readonly send: (text: string) => Promise<void>;
  readonly slash: (raw: string) => Promise<void>;
  readonly cancel: () => Promise<void>;
}

export interface UseCeroOptions {
  readonly provider?: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly sandbox?: string;
  readonly goal?: string;
  readonly noLearning?: boolean;
}

const EMPTY_SNAPSHOT: SnapshotData = {
  stats: { skills: 0, lessons: 0, sessions: 0, userModelVersion: 0, avgSuccessRate: null },
  topSkills: [],
  user: { expertiseAreas: [], currentProjects: [] },
};

let turnSeq = 0;
const nextTurnId = (): string => `t${++turnSeq}`;

export function useCero(opts: UseCeroOptions = {}): UseCeroResult {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const [meta, setMeta] = useState<UseCeroResult["meta"]>(null);
  const [stderr, setStderr] = useState<string[]>([]);

  // Refs we mutate from the event handler without re-render churn.
  const currentCeroTurn = useRef<{
    id: string;
    text: string;
    tools: ToolEvent[];
    skills: string[];
  } | null>(null);
  const toolCallStartTs = useRef<Map<string, number>>(new Map());

  const flushPending = useCallback((): void => {
    const pending = currentCeroTurn.current;
    if (!pending) return;
    setTurns((prev) => [
      ...prev,
      {
        id: pending.id,
        kind: "cero",
        text: pending.text,
        tools: pending.tools,
        ...(pending.skills.length > 0 ? { skills: pending.skills } : {}),
      },
    ]);
    currentCeroTurn.current = null;
  }, []);

  // Subscribe to events
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    const dispatch = (msg: CeroMsg): void => {
      switch (msg.type) {
        case "ready":
          setReady(true);
          setMeta({
            sessionId: msg.sessionId,
            model: msg.model,
            provider: msg.provider,
            sandbox: msg.sandbox,
          });
          break;
        case "text-delta": {
          const cur = currentCeroTurn.current;
          if (cur) {
            cur.text += msg.delta;
            // Force a re-render so the streaming text shows up.
            setTurns((prev) => [...prev]);
          } else {
            const fresh = { id: nextTurnId(), text: msg.delta, tools: [], skills: [] };
            currentCeroTurn.current = fresh;
            setTurns((prev) => [...prev, { id: fresh.id, kind: "cero", text: fresh.text, tools: [] }]);
          }
          break;
        }
        case "tool-call": {
          // Make sure there's a cero turn to attach to
          if (!currentCeroTurn.current) {
            currentCeroTurn.current = { id: nextTurnId(), text: "", tools: [], skills: [] };
            setTurns((prev) => [
              ...prev,
              { id: currentCeroTurn.current?.id ?? nextTurnId(), kind: "cero", text: "", tools: [] },
            ]);
          }
          const tool: ToolEvent = {
            id: msg.toolCallId,
            name: msg.name,
            args: JSON.stringify(msg.args, null, 2),
          };
          currentCeroTurn.current.tools.push(tool);
          toolCallStartTs.current.set(msg.toolCallId, Date.now());
          setTurns((prev) => [...prev]);
          break;
        }
        case "tool-result": {
          const start = toolCallStartTs.current.get(msg.toolCallId);
          const ms = start !== undefined ? Date.now() - start : undefined;
          const cur = currentCeroTurn.current;
          if (cur) {
            const tool = cur.tools.find((t) => t.id === msg.toolCallId);
            if (tool) {
              const updated: ToolEvent = {
                ...tool,
                result: msg.content,
                ...(ms !== undefined ? { ms } : {}),
              };
              cur.tools = cur.tools.map((t) => (t.id === msg.toolCallId ? updated : t));
              setTurns((prev) => [...prev]);
            }
          }
          break;
        }
        case "turn-end":
          // a turn ended (model finished one assistant message). Tools may follow
          // in the next turn — keep the pending cero turn open until done.
          break;
        case "done":
          flushPending();
          setBusy(false);
          break;
        case "system":
          flushPending();
          setTurns((prev) => [
            ...prev,
            { id: nextTurnId(), kind: "cero", text: msg.text },
          ]);
          break;
        case "error":
          flushPending();
          setTurns((prev) => [
            ...prev,
            { id: nextTurnId(), kind: "error", text: msg.message },
          ]);
          setBusy(false);
          break;
        case "snapshot":
          setSnapshot(msg.snapshot);
          break;
        case "sidecar-exit":
          setReady(false);
          setBusy(false);
          break;
        case "sidecar-stderr":
          setStderr((prev) => [...prev.slice(-49), msg.line]);
          break;
      }
    };

    (async (): Promise<void> => {
      try {
        unlisten = await listen<string>(EVENT_CHANNEL, (e) => {
          if (cancelled) return;
          try {
            const msg = JSON.parse(e.payload) as CeroMsg;
            dispatch(msg);
          } catch {
            // malformed line — ignore
          }
        });
        // Start the session
        await invoke("start_session", {
          config: {
            provider: opts.provider ?? null,
            model: opts.model ?? null,
            base_url: opts.baseUrl ?? null,
            sandbox: opts.sandbox ?? null,
            goal: opts.goal ?? null,
            no_learning: opts.noLearning ?? null,
          },
        });
      } catch (err) {
        if (!cancelled) {
          setStderr((prev) => [...prev, `start_session failed: ${String(err)}`]);
        }
      }
    })();

    return (): void => {
      cancelled = true;
      if (unlisten) unlisten();
      // Best-effort shutdown — fire-and-forget
      void invoke("shutdown_session").catch(() => {});
    };
    // We deliberately re-create the session if config changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    opts.provider,
    opts.model,
    opts.baseUrl,
    opts.sandbox,
    opts.goal,
    opts.noLearning,
    flushPending,
  ]);

  const send = useCallback(async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (trimmed.startsWith("/")) {
      await invoke("send_slash", { raw: trimmed });
      return;
    }
    setTurns((prev) => [...prev, { id: nextTurnId(), kind: "user", text: trimmed }]);
    setBusy(true);
    await invoke("send_prompt", { text: trimmed });
  }, []);

  const slash = useCallback(async (raw: string): Promise<void> => {
    await invoke("send_slash", { raw });
  }, []);

  const cancel = useCallback(async (): Promise<void> => {
    await invoke("cancel_turn");
    setBusy(false);
  }, []);

  return {
    ready,
    busy,
    turns,
    snapshot: snapshot ?? EMPTY_SNAPSHOT,
    meta,
    stderr,
    send,
    slash,
    cancel,
  };
}
