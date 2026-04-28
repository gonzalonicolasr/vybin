// MCPView — configure MCP servers stored in ~/.cero/cero.config.json.
//
// Schema (mirrors cero/src/mcp/types.ts McpConfigSchema):
//   { mcpServers: Record<string, { command, args[], env?, cwd?, timeoutMs? }> }
//
// Reads/writes the file directly via Tauri fs plugin (same pattern as
// useCeroData.ts). After "Apply changes" the user is prompted to restart the
// sidecar so cero picks up the new server list.

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  exists,
  readTextFile,
  writeTextFile,
  BaseDirectory,
} from "@tauri-apps/plugin-fs";
import { useTabs } from "../hooks/useTabs";
import { useSettings } from "../hooks/useSettings";

// ─── types (mirror cero McpConfigSchema) ───────────────────────────────────

export interface McpServerSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerSpec>;
}

const CONFIG_REL = ".cero/cero.config.json"; // relative to $HOME

// ─── helpers ───────────────────────────────────────────────────────────────

async function readConfig(): Promise<McpConfig> {
  try {
    if (!(await exists(CONFIG_REL, { baseDir: BaseDirectory.Home }))) {
      return { mcpServers: {} };
    }
    const txt = await readTextFile(CONFIG_REL, { baseDir: BaseDirectory.Home });
    const parsed = JSON.parse(txt) as Partial<McpConfig>;
    return {
      mcpServers:
        parsed.mcpServers && typeof parsed.mcpServers === "object"
          ? parsed.mcpServers
          : {},
    };
  } catch {
    return { mcpServers: {} };
  }
}

async function writeConfig(config: McpConfig): Promise<void> {
  const txt = JSON.stringify(config, null, 2);
  await writeTextFile(CONFIG_REL, txt, { baseDir: BaseDirectory.Home });
}

// ─── env KV pair editing state ─────────────────────────────────────────────

type EnvPair = { key: string; value: string };

function envRecordToPairs(env?: Record<string, string>): EnvPair[] {
  if (!env) return [];
  return Object.entries(env).map(([key, value]) => ({ key, value }));
}

function pairsToEnvRecord(pairs: EnvPair[]): Record<string, string> | undefined {
  const filtered = pairs.filter((p) => p.key.trim().length > 0);
  if (filtered.length === 0) return undefined;
  const out: Record<string, string> = {};
  for (const { key, value } of filtered) {
    out[key.trim()] = value;
  }
  return out;
}

// ─── draft shape used by add/edit modal ────────────────────────────────────

interface ServerDraft {
  name: string;
  command: string;
  args: string[];   // one entry per element
  envPairs: EnvPair[];
  cwd: string;
  timeoutMs: string; // stored as string for input binding
}

function emptyDraft(): ServerDraft {
  return { name: "", command: "", args: [], envPairs: [], cwd: "", timeoutMs: "" };
}

function specToDraft(name: string, spec: McpServerSpec): ServerDraft {
  return {
    name,
    command: spec.command,
    args: [...spec.args],
    envPairs: envRecordToPairs(spec.env),
    cwd: spec.cwd ?? "",
    timeoutMs: spec.timeoutMs != null ? String(spec.timeoutMs) : "",
  };
}

function draftToSpec(draft: ServerDraft): McpServerSpec {
  const spec: McpServerSpec = {
    command: draft.command.trim(),
    args: draft.args.filter((a) => a.trim().length > 0),
  };
  const env = pairsToEnvRecord(draft.envPairs);
  if (env) spec.env = env;
  if (draft.cwd.trim()) spec.cwd = draft.cwd.trim();
  const ms = parseInt(draft.timeoutMs, 10);
  if (!isNaN(ms) && ms > 0) spec.timeoutMs = ms;
  return spec;
}

// ─── component ─────────────────────────────────────────────────────────────

export function MCPView(): React.JSX.Element {
  const { tabs } = useTabs();
  const { settings } = useSettings();

  const [config, setConfig] = useState<McpConfig>({ mcpServers: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Selected server for detail modal
  const [selectedName, setSelectedName] = useState<string | null>(null);
  // Add/edit modal
  const [editingDraft, setEditingDraft] = useState<ServerDraft | null>(null);
  const [editingOrigName, setEditingOrigName] = useState<string | null>(null); // null = new server
  const [formError, setFormError] = useState<string | null>(null);
  // Restart confirm
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const c = await readConfig();
      setConfig(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleApply = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await writeConfig(config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      setShowRestartConfirm(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleRestartSidecar = async (): Promise<void> => {
    setShowRestartConfirm(false);
    try {
      const tabIds = tabs.map((t) => t.id);
      const env: Record<string, string> = {};
      if (settings.anthropicApiKey) env.ANTHROPIC_API_KEY = settings.anthropicApiKey;
      if (settings.openaiApiKey) env.OPENAI_API_KEY = settings.openaiApiKey;
      if (settings.geminiApiKey) {
        env.GEMINI_API_KEY = settings.geminiApiKey;
        env.GOOGLE_API_KEY = settings.geminiApiKey;
      }
      if (settings.awsAccessKeyId) env.AWS_ACCESS_KEY_ID = settings.awsAccessKeyId;
      if (settings.awsSecretAccessKey) env.AWS_SECRET_ACCESS_KEY = settings.awsSecretAccessKey;
      if (settings.awsRegion) env.AWS_REGION = settings.awsRegion;
      await invoke("restart_session", {
        config: {
          provider: settings.provider,
          model: settings.model || null,
          base_url: settings.provider === "openai" && settings.baseUrl ? settings.baseUrl : null,
          sandbox: settings.sandbox,
          goal: settings.goal || null,
          no_learning: settings.learningMode === "off",
        },
        env,
        tabIds,
      });
    } catch (err) {
      setError(`Restart failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDeleteServer = (name: string): void => {
    setConfig((prev) => {
      const next = { ...prev, mcpServers: { ...prev.mcpServers } };
      delete next.mcpServers[name];
      return next;
    });
    setSelectedName(null);
  };

  const openAddModal = (): void => {
    setEditingDraft(emptyDraft());
    setEditingOrigName(null);
    setFormError(null);
  };

  const openEditModal = (name: string): void => {
    const spec = config.mcpServers[name];
    if (!spec) return;
    setEditingDraft(specToDraft(name, spec));
    setEditingOrigName(name);
    setFormError(null);
    setSelectedName(null);
  };

  const handleSaveDraft = (): void => {
    if (!editingDraft) return;
    const trimmedName = editingDraft.name.trim();
    if (!trimmedName) {
      setFormError("Server name is required");
      return;
    }
    if (!editingDraft.command.trim()) {
      setFormError("Command is required");
      return;
    }
    // Unique name check (ignore original name on edit)
    const existingNames = Object.keys(config.mcpServers);
    if (
      existingNames.includes(trimmedName) &&
      trimmedName !== editingOrigName
    ) {
      setFormError(`Server name "${trimmedName}" already exists`);
      return;
    }
    const spec = draftToSpec(editingDraft);
    setConfig((prev) => {
      const next = { ...prev, mcpServers: { ...prev.mcpServers } };
      // Remove old name if renaming
      if (editingOrigName && editingOrigName !== trimmedName) {
        delete next.mcpServers[editingOrigName];
      }
      next.mcpServers[trimmedName] = spec;
      return next;
    });
    setEditingDraft(null);
    setEditingOrigName(null);
    setFormError(null);
  };

  const servers = Object.entries(config.mcpServers);
  const selectedSpec = selectedName ? config.mcpServers[selectedName] : null;

  return (
    <div className="dataview">
      <div className="dataview-header">
        <h2>
          MCP SERVERS{" "}
          <span className="dataview-count">{servers.length}</span>
        </h2>
        <button className="dv-tag" onClick={openAddModal}>
          + add server
        </button>
        <button
          className="settings-btn-primary"
          style={{ fontSize: 17, padding: "3px 14px", marginLeft: "auto" }}
          onClick={handleApply}
          disabled={saving}
        >
          {saving ? "saving…" : saved ? "saved!" : "apply changes"}
        </button>
      </div>

      {error ? <div className="settings-error" style={{ marginBottom: 10 }}>{error}</div> : null}
      {loading ? <div className="dataview-empty">loading…</div> : null}

      {!loading && servers.length === 0 ? (
        <div className="dataview-empty">
          no MCP servers configured. click "+ add server" to define one.
          <br />
          <span style={{ fontSize: 18, color: "var(--muted)" }}>
            config reads from ~/.cero/cero.config.json
          </span>
        </div>
      ) : null}

      <div className="dataview-list">
        {servers.map(([name, spec]) => (
          <div
            key={name}
            className="dv-row"
            onClick={() => setSelectedName(name)}
          >
            <div className="dv-row-main">
              <div className="dv-row-title">{name}</div>
              <div className="dv-row-sub">
                <code>{spec.command}</code>
                {spec.args.length > 0
                  ? ` ${spec.args.join(" ")}`
                  : ""}
              </div>
            </div>
            <div className="dv-row-meta">
              {spec.env && Object.keys(spec.env).length > 0 ? (
                <span className="dv-pill">
                  {Object.keys(spec.env).length} env vars
                </span>
              ) : null}
              {spec.cwd ? (
                <span className="dv-pill">cwd</span>
              ) : null}
              {spec.timeoutMs ? (
                <span className="dv-pill">{spec.timeoutMs}ms</span>
              ) : null}
              <span className="dv-pill dv-pill-dim">
                tools shown after first connect
              </span>
            </div>
          </div>
        ))}
      </div>

      {selectedName && selectedSpec ? (
        <ServerDetailModal
          name={selectedName}
          spec={selectedSpec}
          onClose={() => setSelectedName(null)}
          onEdit={() => openEditModal(selectedName)}
          onDelete={() => {
            if (
              confirm(
                `Delete MCP server "${selectedName}"? This removes it from cero.config.json (apply changes to take effect).`,
              )
            ) {
              handleDeleteServer(selectedName);
            }
          }}
        />
      ) : null}

      {editingDraft ? (
        <ServerEditModal
          draft={editingDraft}
          isNew={editingOrigName === null}
          formError={formError}
          onChange={setEditingDraft}
          onSave={handleSaveDraft}
          onClose={() => { setEditingDraft(null); setFormError(null); }}
        />
      ) : null}

      {showRestartConfirm ? (
        <RestartConfirmModal
          onYes={handleRestartSidecar}
          onNo={() => setShowRestartConfirm(false)}
        />
      ) : null}
    </div>
  );
}

// ─── server detail modal ────────────────────────────────────────────────────

function ServerDetailModal({
  name,
  spec,
  onClose,
  onEdit,
  onDelete,
}: {
  readonly name: string;
  readonly spec: McpServerSpec;
  readonly onClose: () => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}): React.JSX.Element {
  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div
        className="settings-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <h2>{name}</h2>
          <button className="settings-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="settings-body">
          <h3 className="dv-section-h">COMMAND</h3>
          <div className="dv-detail-text">
            <code className="md-inline">{spec.command}</code>
          </div>

          {spec.args.length > 0 ? (
            <>
              <h3 className="dv-section-h">ARGS</h3>
              <ol className="dv-steps">
                {spec.args.map((a, i) => (
                  <li key={i}>
                    <code className="md-inline">{a}</code>
                  </li>
                ))}
              </ol>
            </>
          ) : null}

          {spec.env && Object.keys(spec.env).length > 0 ? (
            <>
              <h3 className="dv-section-h">ENV</h3>
              <ul className="dv-list">
                {Object.entries(spec.env).map(([k, v]) => (
                  <li key={k}>
                    <code className="md-inline">{k}</code> ={" "}
                    <code className="md-inline">{v}</code>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {spec.cwd ? (
            <>
              <h3 className="dv-section-h">CWD</h3>
              <div className="dv-detail-text">
                <code className="md-inline">{spec.cwd}</code>
              </div>
            </>
          ) : null}

          {spec.timeoutMs != null ? (
            <>
              <h3 className="dv-section-h">TIMEOUT</h3>
              <div className="dv-detail-text">{spec.timeoutMs}ms</div>
            </>
          ) : null}

          <h3 className="dv-section-h">TOOLS</h3>
          <div className="dv-detail-text" style={{ color: "var(--muted)", fontSize: 18 }}>
            {/* TODO: expose tool list via cero IPC once the binary supports
                      querying connected MCP server metadata */}
            Tools shown after first connect. Once cero MCP IPC exposes
            server-tools endpoint, this section will list exposed tool names.
          </div>
        </div>
        <div className="settings-footer">
          <button
            className="settings-btn-secondary"
            onClick={onDelete}
            style={{ borderColor: "var(--red)", color: "var(--red)", marginRight: "auto" }}
          >
            delete
          </button>
          <button
            className="settings-btn-secondary"
            onClick={onEdit}
          >
            edit
          </button>
          <button className="settings-btn-primary" onClick={onClose}>
            close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── add / edit modal ───────────────────────────────────────────────────────

function ServerEditModal({
  draft,
  isNew,
  formError,
  onChange,
  onSave,
  onClose,
}: {
  readonly draft: ServerDraft;
  readonly isNew: boolean;
  readonly formError: string | null;
  readonly onChange: (d: ServerDraft) => void;
  readonly onSave: () => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const update = <K extends keyof ServerDraft>(
    key: K,
    value: ServerDraft[K],
  ): void => onChange({ ...draft, [key]: value });

  const updateArg = (i: number, v: string): void => {
    const next = [...draft.args];
    next[i] = v;
    update("args", next);
  };
  const addArg = (): void => update("args", [...draft.args, ""]);
  const removeArg = (i: number): void =>
    update(
      "args",
      draft.args.filter((_, idx) => idx !== i),
    );

  const updateEnvKey = (i: number, k: string): void => {
    const next = [...draft.envPairs];
    next[i] = { ...next[i]!, key: k };
    update("envPairs", next);
  };
  const updateEnvVal = (i: number, v: string): void => {
    const next = [...draft.envPairs];
    next[i] = { ...next[i]!, value: v };
    update("envPairs", next);
  };
  const addEnvPair = (): void =>
    update("envPairs", [...draft.envPairs, { key: "", value: "" }]);
  const removeEnvPair = (i: number): void =>
    update(
      "envPairs",
      draft.envPairs.filter((_, idx) => idx !== i),
    );

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div
        className="settings-modal"
        style={{ width: "min(700px, 94vw)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <h2>{isNew ? "ADD MCP SERVER" : "EDIT MCP SERVER"}</h2>
          <button className="settings-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="settings-body">
          <div className="settings-section">
            <h3>IDENTITY</h3>
            <div className="settings-section-body">
              <label className="settings-field settings-field-required">
                <span className="settings-field-label">server name (unique key in cero.config.json)</span>
                <input
                  value={draft.name}
                  onChange={(e) => update("name", e.target.value)}
                  placeholder="e.g. filesystem"
                  autoFocus
                  disabled={!isNew}
                />
              </label>
              <label className="settings-field settings-field-required">
                <span className="settings-field-label">command (executable)</span>
                <input
                  value={draft.command}
                  onChange={(e) => update("command", e.target.value)}
                  placeholder="e.g. npx"
                />
              </label>
            </div>
          </div>

          <div className="settings-section">
            <h3>ARGS</h3>
            <div className="settings-section-body">
              {draft.args.map((a, i) => (
                <div
                  key={i}
                  style={{ display: "flex", gap: 6, alignItems: "center" }}
                >
                  <input
                    style={{ flex: 1, background: "var(--bg-tint)", border: "1px solid var(--border)", color: "var(--fg)", fontFamily: "var(--code-font)", fontSize: 13, padding: "6px 10px", outline: "none" }}
                    value={a}
                    onChange={(e) => updateArg(i, e.target.value)}
                    placeholder={`arg[${i}]`}
                  />
                  <button
                    className="settings-btn-secondary"
                    style={{ fontSize: 16, padding: "3px 10px", borderColor: "var(--red)", color: "var(--red)" }}
                    onClick={() => removeArg(i)}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button className="dv-tag" onClick={addArg}>
                + add arg
              </button>
            </div>
          </div>

          <div className="settings-section">
            <h3>ENV</h3>
            <div className="settings-section-body">
              {draft.envPairs.map((pair, i) => (
                <div
                  key={i}
                  style={{ display: "flex", gap: 6, alignItems: "center" }}
                >
                  <input
                    style={{ flex: 1, background: "var(--bg-tint)", border: "1px solid var(--border)", color: "var(--fg)", fontFamily: "var(--code-font)", fontSize: 13, padding: "6px 10px", outline: "none" }}
                    value={pair.key}
                    onChange={(e) => updateEnvKey(i, e.target.value)}
                    placeholder="KEY"
                  />
                  <input
                    style={{ flex: 2, background: "var(--bg-tint)", border: "1px solid var(--border)", color: "var(--fg)", fontFamily: "var(--code-font)", fontSize: 13, padding: "6px 10px", outline: "none" }}
                    value={pair.value}
                    onChange={(e) => updateEnvVal(i, e.target.value)}
                    placeholder="VALUE"
                  />
                  <button
                    className="settings-btn-secondary"
                    style={{ fontSize: 16, padding: "3px 10px", borderColor: "var(--red)", color: "var(--red)" }}
                    onClick={() => removeEnvPair(i)}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button className="dv-tag" onClick={addEnvPair}>
                + add env var
              </button>
            </div>
          </div>

          <div className="settings-section">
            <h3>OPTIONAL</h3>
            <div className="settings-section-body">
              <label className="settings-field">
                <span className="settings-field-label">working directory (cwd)</span>
                <input
                  value={draft.cwd}
                  onChange={(e) => update("cwd", e.target.value)}
                  placeholder="/path/to/dir (optional)"
                />
              </label>
              <label className="settings-field">
                <span className="settings-field-label">timeout (ms)</span>
                <input
                  type="number"
                  value={draft.timeoutMs}
                  onChange={(e) => update("timeoutMs", e.target.value)}
                  placeholder="30000 (optional)"
                  min="0"
                />
              </label>
            </div>
          </div>
        </div>

        {formError ? (
          <div className="settings-error settings-error-sticky">{formError}</div>
        ) : null}

        <div className="settings-footer">
          <button className="settings-btn-secondary" onClick={onClose}>
            cancel
          </button>
          <button className="settings-btn-primary" onClick={onSave}>
            {isNew ? "add server" : "save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── restart confirm ────────────────────────────────────────────────────────

function RestartConfirmModal({
  onYes,
  onNo,
}: {
  readonly onYes: () => void;
  readonly onNo: () => void;
}): React.JSX.Element {
  return (
    <div className="settings-backdrop" onClick={onNo}>
      <div
        className="settings-modal"
        style={{ width: "min(460px, 90vw)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <h2>APPLY CHANGES</h2>
        </div>
        <div className="settings-body" style={{ padding: "20px 24px" }}>
          <div className="dv-detail-text">
            cero.config.json saved. Restart the sidecar now so cero picks up
            the updated MCP server list?
          </div>
          <div
            style={{
              marginTop: 10,
              color: "var(--muted)",
              fontFamily: "var(--pixel-font)",
              fontSize: 17,
            }}
          >
            This will reset all chat sessions.
          </div>
        </div>
        <div className="settings-footer">
          <button className="settings-btn-secondary" onClick={onNo}>
            not now
          </button>
          <button className="settings-btn-primary" onClick={onYes}>
            restart sidecar
          </button>
        </div>
      </div>
    </div>
  );
}
