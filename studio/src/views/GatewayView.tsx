// GatewayView — manage gateway platforms (telegram/discord/websocket/http).
//
// Backend wiring: lib.rs spawns `cero gateway --platform=<x>` as a child
// process per platform, captures stdout/stderr in a 200-line ring buffer,
// and reports liveness via `try_wait()` on the Child handle. Tokens are
// passed via env vars (TELEGRAM_BOT_TOKEN, DISCORD_BOT_TOKEN, etc.) so they
// don't show up in process listings.
//
// Config is persisted via useGatewayConfig (tauri-plugin-store, gateway.json).
// The Rust side reads the same store key (`gatewayConfigs`).

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  useGatewayConfig,
  type GatewayConfigs,
  type TelegramConfig,
  type DiscordConfig,
  type WebSocketConfig,
  type HttpConfig,
} from "../hooks/useGatewayConfig";

// ─── types ──────────────────────────────────────────────────────────────────

export type Platform = "telegram" | "discord" | "websocket" | "http";
export type GatewayState = "connected" | "disconnected" | "error";

export interface GatewayStatus {
  state: GatewayState;
  error: string | null;
  message_count: number;
}

export interface LogEntry {
  ts: number;      // unix ms
  level: string;
  message: string;
}

// ─── Tauri command wrappers ─────────────────────────────────────────────────
// Backed by real implementations in lib.rs (spawn-and-track child process).

async function cmdGatewayStart(platform: Platform): Promise<void> {
  await invoke("gateway_start", { platform });
}

async function cmdGatewayStop(platform: Platform): Promise<void> {
  await invoke("gateway_stop", { platform });
}

async function cmdGatewayStatus(platform: Platform): Promise<GatewayStatus> {
  return await invoke<GatewayStatus>("gateway_status", { platform });
}

async function cmdGatewayLogs(platform: Platform, limit = 50): Promise<LogEntry[]> {
  return await invoke<LogEntry[]>("gateway_logs", { platform, limit });
}

// ─── card label map ─────────────────────────────────────────────────────────

const PLATFORM_LABELS: Record<Platform, string> = {
  telegram:  "TELEGRAM",
  discord:   "DISCORD",
  websocket: "WEBSOCKET",
  http:      "HTTP",
};

// ─── main view ──────────────────────────────────────────────────────────────

export function GatewayView(): React.JSX.Element {
  const { configs, loading: configLoading, save: saveConfigs } = useGatewayConfig();

  // Per-platform status (polled on mount + manual refresh)
  const [statuses, setStatuses] = useState<Record<Platform, GatewayStatus>>({
    telegram:  { state: "disconnected", error: null, message_count: 0 },
    discord:   { state: "disconnected", error: null, message_count: 0 },
    websocket: { state: "disconnected", error: null, message_count: 0 },
    http:      { state: "disconnected", error: null, message_count: 0 },
  });

  // Logs modal
  const [logsModal, setLogsModal] = useState<{
    platform: Platform;
    logs: LogEntry[];
    loading: boolean;
  } | null>(null);

  const refreshStatuses = useCallback(async (): Promise<void> => {
    const platforms: Platform[] = ["telegram", "discord", "websocket", "http"];
    const results = await Promise.allSettled(
      platforms.map((p) => cmdGatewayStatus(p)),
    );
    const next = { ...statuses };
    for (let i = 0; i < platforms.length; i++) {
      const r = results[i];
      if (r?.status === "fulfilled") {
        next[platforms[i]!] = r.value;
      }
    }
    setStatuses(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refreshStatuses();
    // Poll while the view is mounted so the dot/state updates if the child
    // exits on its own (e.g. invalid token, port already bound). 3s is a
    // good balance between responsiveness and IPC chatter.
    const id = window.setInterval(() => {
      void refreshStatuses();
    }, 3000);
    return (): void => {
      window.clearInterval(id);
    };
  }, [refreshStatuses]);

  const handleToggle = async (platform: Platform): Promise<void> => {
    const current = statuses[platform].state;
    try {
      if (current === "connected") {
        await cmdGatewayStop(platform);
      } else {
        await cmdGatewayStart(platform);
      }
      await refreshStatuses();
    } catch (err) {
      setStatuses((prev) => ({
        ...prev,
        [platform]: {
          state: "error",
          error: err instanceof Error ? err.message : String(err),
          message_count: prev[platform].message_count,
        },
      }));
    }
  };

  const handleRestart = async (platform: Platform): Promise<void> => {
    try {
      await cmdGatewayStop(platform);
      await cmdGatewayStart(platform);
      await refreshStatuses();
    } catch (err) {
      setStatuses((prev) => ({
        ...prev,
        [platform]: {
          state: "error",
          error: err instanceof Error ? err.message : String(err),
          message_count: prev[platform].message_count,
        },
      }));
    }
  };

  const handleViewLogs = async (platform: Platform): Promise<void> => {
    setLogsModal({ platform, logs: [], loading: true });
    try {
      const logs = await cmdGatewayLogs(platform, 50);
      setLogsModal({ platform, logs, loading: false });
    } catch {
      setLogsModal({ platform, logs: [], loading: false });
    }
  };

  const handleSaveConfig = async (next: GatewayConfigs): Promise<void> => {
    await saveConfigs(next);
  };

  if (configLoading) {
    return (
      <div className="dataview">
        <div className="dataview-empty">loading…</div>
      </div>
    );
  }

  const platforms: Platform[] = ["telegram", "discord", "websocket", "http"];

  return (
    <div className="dataview">
      <div className="dataview-header">
        <h2>GATEWAY</h2>
        <button
          className="dv-tag"
          style={{ marginLeft: "auto" }}
          onClick={refreshStatuses}
        >
          refresh status
        </button>
      </div>

      <div className="gateway-grid">
        {platforms.map((p) => (
          <GatewayCard
            key={p}
            platform={p}
            label={PLATFORM_LABELS[p]}
            status={statuses[p]}
            configs={configs}
            onToggle={handleToggle}
            onRestart={handleRestart}
            onViewLogs={handleViewLogs}
            onSaveConfig={handleSaveConfig}
          />
        ))}
      </div>

      {logsModal ? (
        <LogsModal
          platform={logsModal.platform}
          logs={logsModal.logs}
          loading={logsModal.loading}
          onClose={() => setLogsModal(null)}
        />
      ) : null}
    </div>
  );
}

// ─── gateway card ────────────────────────────────────────────────────────────

function GatewayCard({
  platform,
  label,
  status,
  configs,
  onToggle,
  onRestart,
  onViewLogs,
  onSaveConfig,
}: {
  readonly platform: Platform;
  readonly label: string;
  readonly status: GatewayStatus;
  readonly configs: GatewayConfigs;
  readonly onToggle: (p: Platform) => Promise<void>;
  readonly onRestart: (p: Platform) => Promise<void>;
  readonly onViewLogs: (p: Platform) => Promise<void>;
  readonly onSaveConfig: (next: GatewayConfigs) => Promise<void>;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

  const wrap = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  return (
    <div className="gw-card">
      <div className="gw-card-header">
        <StatusDot state={status.state} />
        <span className="gw-card-title">{label}</span>
        <span className="gw-msg-count">{status.message_count} msgs</span>
        <div className="gw-card-actions">
          <button
            className={`gw-toggle ${status.state === "connected" ? "gw-toggle-on" : "gw-toggle-off"}`}
            onClick={() => wrap(() => onToggle(platform))}
            disabled={busy}
            title={status.state === "connected" ? "stop" : "start"}
          >
            {status.state === "connected" ? "stop" : "start"}
          </button>
          <button
            className="settings-btn-secondary gw-action-btn"
            onClick={() => wrap(() => onRestart(platform))}
            disabled={busy || status.state !== "connected"}
            title="restart"
          >
            restart
          </button>
          <button
            className="settings-btn-secondary gw-action-btn"
            onClick={() => onViewLogs(platform)}
            disabled={busy}
            title="view logs"
          >
            logs
          </button>
        </div>
      </div>

      {status.error ? (
        <div className="gw-error">{status.error}</div>
      ) : null}

      <button
        className="gw-config-toggle"
        onClick={() => setExpanded((s) => !s)}
      >
        {expanded ? "hide config" : "config"}
      </button>

      {expanded ? (
        <PlatformConfigForm
          platform={platform}
          configs={configs}
          onSave={onSaveConfig}
        />
      ) : null}
    </div>
  );
}

// ─── status dot ─────────────────────────────────────────────────────────────

function StatusDot({ state }: { readonly state: GatewayState }): React.JSX.Element {
  const cls =
    state === "connected"
      ? "gw-dot gw-dot-connected"
      : state === "error"
        ? "gw-dot gw-dot-error"
        : "gw-dot gw-dot-disconnected";
  return <span className={cls} aria-label={state} />;
}

// ─── platform config forms ───────────────────────────────────────────────────

function PlatformConfigForm({
  platform,
  configs,
  onSave,
}: {
  readonly platform: Platform;
  readonly configs: GatewayConfigs;
  readonly onSave: (next: GatewayConfigs) => Promise<void>;
}): React.JSX.Element {
  const [draft, setDraft] = useState(configs);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Sync draft when parent configs change (e.g. after reload)
  useEffect(() => { setDraft(configs); }, [configs]);

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await onSave(draft);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="gw-config-body">
      {platform === "telegram" ? (
        <TelegramForm
          cfg={draft.telegram}
          onChange={(t) => setDraft((prev) => ({ ...prev, telegram: t }))}
        />
      ) : platform === "discord" ? (
        <DiscordForm
          cfg={draft.discord}
          onChange={(d) => setDraft((prev) => ({ ...prev, discord: d }))}
        />
      ) : platform === "websocket" ? (
        <WebSocketForm
          cfg={draft.websocket}
          onChange={(w) => setDraft((prev) => ({ ...prev, websocket: w }))}
        />
      ) : (
        <HttpForm
          cfg={draft.http}
          onChange={(h) => setDraft((prev) => ({ ...prev, http: h }))}
        />
      )}
      <button
        className="settings-btn-primary"
        style={{ fontSize: 16, padding: "4px 14px", marginTop: 10 }}
        onClick={save}
        disabled={saving}
      >
        {saving ? "saving…" : saved ? "saved!" : "save config"}
      </button>
    </div>
  );
}

function TelegramForm({
  cfg,
  onChange,
}: {
  readonly cfg: TelegramConfig;
  readonly onChange: (c: TelegramConfig) => void;
}): React.JSX.Element {
  return (
    <div className="gw-form">
      <GwField label="bot token">
        <input
          type="password"
          value={cfg.botToken}
          onChange={(e) => onChange({ ...cfg, botToken: e.target.value })}
          placeholder="123456:ABCdef..."
        />
      </GwField>
      <GwField label="admin username (optional)">
        <input
          value={cfg.adminUsername}
          onChange={(e) => onChange({ ...cfg, adminUsername: e.target.value })}
          placeholder="@myuser"
        />
      </GwField>
    </div>
  );
}

function DiscordForm({
  cfg,
  onChange,
}: {
  readonly cfg: DiscordConfig;
  readonly onChange: (c: DiscordConfig) => void;
}): React.JSX.Element {
  return (
    <div className="gw-form">
      <GwField label="bot token">
        <input
          type="password"
          value={cfg.botToken}
          onChange={(e) => onChange({ ...cfg, botToken: e.target.value })}
          placeholder="Bot token..."
        />
      </GwField>
      <GwField label="allowed user ids (comma-separated, optional)">
        <input
          value={cfg.allowedUserIds}
          onChange={(e) => onChange({ ...cfg, allowedUserIds: e.target.value })}
          placeholder="123456789,987654321"
        />
      </GwField>
    </div>
  );
}

function WebSocketForm({
  cfg,
  onChange,
}: {
  readonly cfg: WebSocketConfig;
  readonly onChange: (c: WebSocketConfig) => void;
}): React.JSX.Element {
  return (
    <div className="gw-form">
      <GwField label="port">
        <input
          type="number"
          value={cfg.port}
          onChange={(e) => onChange({ ...cfg, port: e.target.value })}
          placeholder="8080"
          min="1"
          max="65535"
        />
      </GwField>
      <GwField label="auth secret (optional)">
        <input
          type="password"
          value={cfg.authSecret}
          onChange={(e) => onChange({ ...cfg, authSecret: e.target.value })}
          placeholder="secret key"
        />
      </GwField>
    </div>
  );
}

function HttpForm({
  cfg,
  onChange,
}: {
  readonly cfg: HttpConfig;
  readonly onChange: (c: HttpConfig) => void;
}): React.JSX.Element {
  return (
    <div className="gw-form">
      <GwField label="port">
        <input
          type="number"
          value={cfg.port}
          onChange={(e) => onChange({ ...cfg, port: e.target.value })}
          placeholder="8888"
          min="1"
          max="65535"
        />
      </GwField>
      <GwField label="host">
        <input
          value={cfg.host}
          onChange={(e) => onChange({ ...cfg, host: e.target.value })}
          placeholder="127.0.0.1"
        />
      </GwField>
      <GwField label="bearer token (optional)">
        <input
          type="password"
          value={cfg.bearerToken}
          onChange={(e) => onChange({ ...cfg, bearerToken: e.target.value })}
          placeholder="token"
        />
      </GwField>
    </div>
  );
}

function GwField({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className="settings-field">
      <span className="settings-field-label" style={{ fontSize: 15 }}>
        {label}
      </span>
      {children}
    </label>
  );
}

// ─── logs modal ──────────────────────────────────────────────────────────────

function LogsModal({
  platform,
  logs,
  loading,
  onClose,
}: {
  readonly platform: Platform;
  readonly logs: LogEntry[];
  readonly loading: boolean;
  readonly onClose: () => void;
}): React.JSX.Element {
  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div
        className="settings-modal"
        style={{ width: "min(700px, 95vw)", maxHeight: "80vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <h2>{PLATFORM_LABELS[platform]} LOGS</h2>
          <button className="settings-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div
          className="settings-body"
          style={{ fontFamily: "var(--code-font)", fontSize: 12.5, lineHeight: 1.5 }}
        >
          {loading ? (
            <div className="dataview-empty">loading…</div>
          ) : logs.length === 0 ? (
            <div className="dataview-empty" style={{ fontFamily: "var(--pixel-font)", fontSize: 18 }}>
              no logs yet
            </div>
          ) : (
            logs.map((entry, i) => (
              <div key={i} className="gw-log-line">
                <span className="gw-log-ts">
                  {new Date(entry.ts).toISOString().slice(11, 23)}
                </span>
                <span
                  className="gw-log-level"
                  style={{ color: entry.level === "error" ? "var(--red)" : entry.level === "warn" ? "var(--amber)" : "var(--dim)" }}
                >
                  {entry.level}
                </span>
                <span className="gw-log-msg">{entry.message}</span>
              </div>
            ))
          )}
        </div>
        <div className="settings-footer">
          <button className="settings-btn-primary" onClick={onClose}>
            close
          </button>
        </div>
      </div>
    </div>
  );
}
