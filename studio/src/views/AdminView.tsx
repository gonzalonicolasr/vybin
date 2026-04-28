// AdminView — admin panel with 6 tabs:
//   Credentials / Doctor / Update / Config / Tools / Personality
//
// Each tab replaces a cero CLI command so the user never needs the terminal.
// Tauri commands used:
//   credentials_db_query(sql) — read-only SQLite on credentials.db
//   cero_cli(args[])          — generic shell-out to cero binary (30s timeout)
//   relaunch_app()            — quit + relaunch after update
// File I/O uses @tauri-apps/plugin-fs (same scope as MCPView).

import { invoke } from "@tauri-apps/api/core";
import {
  exists,
  readTextFile,
  writeTextFile,
  readDir,
  mkdir,
  remove,
  BaseDirectory,
} from "@tauri-apps/plugin-fs";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTabs } from "../hooks/useTabs";
import { useSettings } from "../hooks/useSettings";

// ─── shared types ─────────────────────────────────────────────────────────────

interface QueryResult {
  columns: string[];
  rows: Array<Array<unknown>>;
}

interface CliOutput {
  stdout: string;
  stderr: string;
  exit_code: number;
}

function rowToObject(columns: string[], row: Array<unknown>): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  columns.forEach((col, i) => { obj[col] = row[i]; });
  return obj;
}

// ─── restart helper (shared by multiple tabs) ─────────────────────────────────

function useRestartSidecar(): () => Promise<void> {
  const { tabs } = useTabs();
  const { settings } = useSettings();
  return useCallback(async (): Promise<void> => {
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
      tabIds: tabs.map((t) => t.id),
    });
  }, [tabs, settings]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Credentials
// ─────────────────────────────────────────────────────────────────────────────

interface Credential {
  id: string;
  provider: string;
  label: string | null;
  enabled: boolean;
  rate_limited_until: number | null;
  last_used_at: number | null;
  created_at: number;
}

function fmtTs(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

function rateLimitStatus(c: Credential): { text: string; color: string } {
  if (!c.enabled) return { text: "disabled", color: "var(--muted)" };
  if (c.rate_limited_until !== null && c.rate_limited_until > Date.now()) {
    const relMin = Math.ceil((c.rate_limited_until - Date.now()) / 60000);
    return { text: `rate-limited ${relMin}m`, color: "var(--amber)" };
  }
  return { text: "ready", color: "var(--cyan)" };
}

interface AddCredDraft {
  provider: string;
  apiKey: string;
  label: string;
}

function AddCredModal({
  onClose,
  onAdded,
}: {
  readonly onClose: () => void;
  readonly onAdded: () => void;
}): React.JSX.Element {
  const PROVIDERS = ["openai", "openrouter", "groq", "mistral", "deepseek", "together", "anthropic", "gemini", "bedrock"];
  const [draft, setDraft] = useState<AddCredDraft>({ provider: "openai", apiKey: "", label: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const up = <K extends keyof AddCredDraft>(k: K, v: AddCredDraft[K]): void =>
    setDraft((prev) => ({ ...prev, [k]: v }));

  const handleSave = async (): Promise<void> => {
    if (!draft.apiKey.trim()) { setError("API key is required"); return; }
    setSaving(true);
    setError(null);
    try {
      const args = ["credentials", "add", draft.provider, draft.apiKey.trim()];
      if (draft.label.trim()) args.push("--label", draft.label.trim());
      const out = await invoke<CliOutput>("cero_cli", { args });
      if (out.exit_code !== 0) {
        setError(out.stderr || out.stdout || "unknown error");
        return;
      }
      onAdded();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div
        className="settings-modal"
        style={{ width: "min(520px, 92vw)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <h2>ADD CREDENTIAL</h2>
          <button className="settings-close" onClick={onClose}>✕</button>
        </div>
        <div className="settings-body">
          <div className="settings-section">
            <div className="settings-section-body">
              <label className="settings-field">
                <span className="settings-field-label">provider</span>
                <select value={draft.provider} onChange={(e) => up("provider", e.target.value)}>
                  {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label className="settings-field settings-field-required">
                <span className="settings-field-label">API key</span>
                <input
                  type="password"
                  value={draft.apiKey}
                  onChange={(e) => up("apiKey", e.target.value)}
                  placeholder="sk-..."
                  autoFocus
                />
              </label>
              <label className="settings-field">
                <span className="settings-field-label">label (optional)</span>
                <input
                  value={draft.label}
                  onChange={(e) => up("label", e.target.value)}
                  placeholder="personal / work / project-x"
                />
              </label>
            </div>
          </div>
        </div>
        {error ? <div className="settings-error settings-error-sticky">{error}</div> : null}
        <div className="settings-footer">
          <button className="settings-btn-secondary" onClick={onClose} disabled={saving}>cancel</button>
          <button className="settings-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "adding…" : "add credential"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CredentialsTab(): React.JSX.Element {
  const [creds, setCreds] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const result = await invoke<QueryResult>("credentials_db_query", {
        sql: "SELECT id,provider,label,enabled,rate_limited_until,last_used_at,created_at FROM credentials ORDER BY provider, created_at ASC",
      });
      if (!result.columns.length) { setCreds([]); return; }
      const parsed: Credential[] = result.rows.map((r) => {
        const raw = rowToObject(result.columns, r);
        return {
          id: String(raw["id"] ?? ""),
          provider: String(raw["provider"] ?? ""),
          label: raw["label"] != null ? String(raw["label"]) : null,
          enabled: Number(raw["enabled"]) === 1,
          rate_limited_until: raw["rate_limited_until"] != null ? Number(raw["rate_limited_until"]) : null,
          last_used_at: raw["last_used_at"] != null ? Number(raw["last_used_at"]) : null,
          created_at: Number(raw["created_at"] ?? 0),
        };
      });
      setCreds(parsed);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    intervalRef.current = setInterval(() => { void load(); }, 30_000);
    return (): void => {
      if (intervalRef.current !== null) clearInterval(intervalRef.current);
    };
  }, [load]);

  const doAction = async (action: "enable" | "disable" | "remove", id: string): Promise<void> => {
    if (action === "remove" && !confirm(`Remove credential ${id.slice(0, 12)}? This cannot be undone.`)) return;
    setActionError(null);
    try {
      const out = await invoke<CliOutput>("cero_cli", { args: ["credentials", action, id] });
      if (out.exit_code !== 0) {
        setActionError(out.stderr || out.stdout || "unknown error");
        return;
      }
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const doPeek = async (provider: string): Promise<void> => {
    try {
      const out = await invoke<CliOutput>("cero_cli", { args: ["credentials", "peek", provider] });
      alert(out.stdout.trim() || out.stderr.trim() || "no result");
    } catch (err) {
      alert(String(err));
    }
  };

  return (
    <div className="admin-tab-body">
      <div className="admin-tab-toolbar">
        <span style={{ color: "var(--dim)", fontSize: 17 }}>
          auto-refresh every 30s &nbsp;·&nbsp; {creds.length} credential{creds.length !== 1 ? "s" : ""}
        </span>
        <button className="dv-tag" style={{ marginLeft: "auto" }} onClick={() => setShowAdd(true)}>
          + add credential
        </button>
        <button className="dv-tag" onClick={() => void load()}>refresh</button>
      </div>

      {actionError ? <div className="settings-error" style={{ marginBottom: 8, fontSize: 17 }}>{actionError}</div> : null}
      {error ? (
        <div className="dataview-empty" style={{ color: "var(--muted)" }}>
          {error.includes("credentials.db") || error.includes("no such file")
            ? "No credentials database found. Use '+ add credential' to create your first entry."
            : error}
        </div>
      ) : null}
      {loading ? <div className="dataview-empty">loading…</div> : null}
      {!loading && !error && creds.length === 0 ? (
        <div className="dataview-empty">no credentials yet — click "+ add credential" to register an API key.</div>
      ) : null}

      {!loading && creds.length > 0 ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>id</th>
                <th>provider</th>
                <th>label</th>
                <th>status</th>
                <th>last used</th>
                <th>created</th>
                <th>actions</th>
              </tr>
            </thead>
            <tbody>
              {creds.map((c) => {
                const st = rateLimitStatus(c);
                return (
                  <tr key={c.id} style={{ opacity: c.enabled ? 1 : 0.55 }}>
                    <td style={{ fontFamily: "var(--code-font)", fontSize: 12 }}>
                      {c.id.slice(0, 14)}…
                    </td>
                    <td><span className="dv-pill dv-pill-accent">{c.provider}</span></td>
                    <td style={{ color: "var(--dim)", fontSize: 17 }}>{c.label ?? "—"}</td>
                    <td><span style={{ color: st.color, fontFamily: "var(--code-font)", fontSize: 12 }}>{st.text}</span></td>
                    <td style={{ color: "var(--muted)", fontSize: 16 }}>{fmtTs(c.last_used_at)}</td>
                    <td style={{ color: "var(--muted)", fontSize: 16 }}>{fmtTs(c.created_at)}</td>
                    <td>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          className="admin-row-btn"
                          onClick={() => void doAction(c.enabled ? "disable" : "enable", c.id)}
                          title={c.enabled ? "disable" : "enable"}
                        >
                          {c.enabled ? "off" : "on"}
                        </button>
                        <button
                          className="admin-row-btn"
                          onClick={() => void doPeek(c.provider)}
                          title="peek — show which key would be leased next"
                        >
                          peek
                        </button>
                        <button
                          className="admin-row-btn admin-row-btn-danger"
                          onClick={() => void doAction("remove", c.id)}
                          title="remove"
                        >
                          rm
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {showAdd ? (
        <AddCredModal
          onClose={() => setShowAdd(false)}
          onAdded={() => void load()}
        />
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Doctor
// ─────────────────────────────────────────────────────────────────────────────

interface CheckResult {
  name: string;
  level: "ok" | "warn" | "fail";
  message: string;
}

const REMEDIATION: Record<string, string> = {
  "provider:anthropic": "Set ANTHROPIC_API_KEY env var or run: cero credentials add anthropic <key>",
  "provider:openai":    "Set OPENAI_API_KEY env var or run: cero credentials add openai <key>",
  "provider:openrouter":"Set OPENROUTER_API_KEY env var or run: cero credentials add openrouter <key>",
  "provider:groq":      "Set GROQ_API_KEY env var or run: cero credentials add groq <key>",
  "provider:gemini":    "Set GEMINI_API_KEY env var or run: cero credentials add gemini <key>",
  "sandbox:docker":     "Install Docker Desktop from https://docker.com, then restart Docker daemon. Or switch sandbox to 'local' in Settings.",
  "disk space":         "Free up disk space at ~/.cero — consider clearing old sessions or models.",
  "providers":          "At least one provider must be configured. Open Settings (Ctrl+,) and add an API key.",
};

function levelIcon(level: "ok" | "warn" | "fail"): string {
  if (level === "ok")   return "✓";
  if (level === "warn") return "⚠";
  return "✗";
}

function levelColor(level: "ok" | "warn" | "fail"): string {
  if (level === "ok")   return "var(--cyan)";
  if (level === "warn") return "var(--amber)";
  return "var(--red)";
}

function parseChecks(stdout: string): CheckResult[] {
  const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
  const results: CheckResult[] = [];
  for (const line of lines) {
    const m = line.match(/^\[(ok|warn|fail)\]\s+(\S+(?:\s+\S+)*?)\s{2,}(.*)$/);
    if (!m) continue;
    const level = m[1] as "ok" | "warn" | "fail";
    const name  = m[2]!.trim();
    const msg   = m[3]!.trim();
    results.push({ name, level, message: msg });
  }
  return results;
}

function DoctorTab(): React.JSX.Element {
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const run = useCallback(async (): Promise<void> => {
    setRunning(true);
    setError(null);
    try {
      const out = await invoke<CliOutput>("cero_cli", { args: ["doctor"] });
      const parsed = parseChecks(out.stdout);
      if (parsed.length > 0) {
        setChecks(parsed);
      } else {
        // fallback: show raw stdout as a single "system" entry
        setChecks([{ name: "output", level: out.exit_code === 0 ? "ok" : "warn", message: (out.stdout || out.stderr).slice(0, 500) }]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => { void run(); }, 60_000);
    } else {
      if (intervalRef.current !== null) { clearInterval(intervalRef.current); intervalRef.current = null; }
    }
    return (): void => {
      if (intervalRef.current !== null) { clearInterval(intervalRef.current); intervalRef.current = null; }
    };
  }, [autoRefresh, run]);

  const toggle = (name: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });

  const failCount = checks.filter((c) => c.level === "fail").length;
  const warnCount = checks.filter((c) => c.level === "warn").length;

  return (
    <div className="admin-tab-body">
      <div className="admin-tab-toolbar">
        {checks.length > 0 ? (
          <span style={{ fontSize: 17, color: failCount > 0 ? "var(--red)" : warnCount > 0 ? "var(--amber)" : "var(--cyan)" }}>
            {failCount > 0 ? `${failCount} fail` : warnCount > 0 ? `${warnCount} warn` : "all ok"}
          </span>
        ) : null}
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 17, color: "var(--dim)", cursor: "pointer", marginLeft: "auto" }}>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          auto-refresh 60s
        </label>
        <button className="settings-btn-primary" style={{ fontSize: 17, padding: "4px 16px" }} onClick={() => void run()} disabled={running}>
          {running ? "running…" : checks.length > 0 ? "re-run" : "run health check"}
        </button>
      </div>

      {error ? <div className="settings-error" style={{ marginBottom: 8 }}>{error}</div> : null}

      {!running && checks.length === 0 && !error ? (
        <div className="dataview-empty">click "run health check" to diagnose your cero installation.</div>
      ) : null}

      {running ? <div className="dataview-empty">running health check…</div> : null}

      {!running && checks.length > 0 ? (
        <div className="admin-checks">
          {checks.map((c) => {
            const hasRemediation = c.level !== "ok" && REMEDIATION[c.name];
            const isOpen = expanded.has(c.name);
            return (
              <div key={c.name} className="admin-check-row" style={{ borderLeftColor: levelColor(c.level) }}>
                <div
                  className="admin-check-header"
                  onClick={hasRemediation ? () => toggle(c.name) : undefined}
                  style={{ cursor: hasRemediation ? "pointer" : "default" }}
                >
                  <span style={{ color: levelColor(c.level), fontSize: 20, width: 20, flexShrink: 0 }}>
                    {levelIcon(c.level)}
                  </span>
                  <span style={{ color: "var(--fg)", fontFamily: "var(--code-font)", fontSize: 13, flex: 1 }}>
                    {c.name}
                  </span>
                  <span style={{ color: "var(--dim)", fontFamily: "var(--code-font)", fontSize: 12, flex: 2 }}>
                    {c.message}
                  </span>
                  {hasRemediation ? (
                    <span style={{ color: "var(--muted)", fontSize: 16, marginLeft: 8 }}>
                      {isOpen ? "▲" : "▼"}
                    </span>
                  ) : null}
                </div>
                {isOpen && hasRemediation ? (
                  <div className="admin-check-hint">{REMEDIATION[c.name]}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Update
// ─────────────────────────────────────────────────────────────────────────────

interface UpdateState {
  current: string;
  latest: string;
  newer: boolean;
  assetUrl: string | null;
  notes: string;
}

function parseUpdateOutput(stdout: string): UpdateState | null {
  const current = stdout.match(/^current:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const latest  = stdout.match(/^latest\s*:\s*(.+)$/m)?.[1]?.trim() ?? "";
  if (!current || !latest) return null;
  const upToDate = /up to date/i.test(stdout);
  const assetMatch = stdout.match(/^asset\s*:\s*(\S+)/m);
  const notesMatch = stdout.match(/---\n([\s\S]*?)\n---/);
  return {
    current,
    latest,
    newer: !upToDate && current !== latest,
    assetUrl: assetMatch?.[1] ?? null,
    notes: notesMatch?.[1]?.trim() ?? "",
  };
}

function UpdateTab(): React.JSX.Element {
  const [state, setState] = useState<UpdateState | null>(null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customRepo, setCustomRepo] = useState("");
  const [progress, setProgress] = useState("");

  const doCheck = async (): Promise<void> => {
    setChecking(true);
    setError(null);
    setState(null);
    setApplied(false);
    try {
      const args = ["update"];
      if (customRepo.trim()) args.push("--repo", customRepo.trim());
      const out = await invoke<CliOutput>("cero_cli", { args });
      const parsed = parseUpdateOutput(out.stdout);
      if (!parsed) {
        setError(out.stderr || out.stdout || "unexpected output from update check");
        return;
      }
      setState(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  };

  const doApply = async (): Promise<void> => {
    if (!state?.newer) return;
    setApplying(true);
    setError(null);
    setProgress("Downloading update…");
    try {
      const args = ["update", "--apply"];
      if (customRepo.trim()) args.push("--repo", customRepo.trim());
      const out = await invoke<CliOutput>("cero_cli", { args });
      if (out.exit_code !== 0) {
        setError(out.stderr || "update apply failed");
        return;
      }
      setApplied(true);
      setProgress("Update installed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  };

  const doRelaunch = async (): Promise<void> => {
    try {
      await invoke("relaunch_app");
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <div className="admin-tab-body">
      <div className="admin-tab-toolbar">
        <label className="settings-field" style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1, maxWidth: 340 }}>
          <span className="settings-field-label" style={{ whiteSpace: "nowrap" }}>Custom repo:</span>
          <input
            value={customRepo}
            onChange={(e) => setCustomRepo(e.target.value)}
            placeholder="owner/name (optional)"
            style={{ background: "var(--bg-tint)", border: "1px solid var(--border)", color: "var(--fg)", fontFamily: "var(--code-font)", fontSize: 13, padding: "4px 8px", outline: "none", flex: 1 }}
          />
        </label>
        <button
          className="settings-btn-primary"
          style={{ fontSize: 17, padding: "4px 16px" }}
          onClick={() => void doCheck()}
          disabled={checking || applying}
        >
          {checking ? "checking…" : "check for updates"}
        </button>
      </div>

      {error ? <div className="settings-error" style={{ marginBottom: 8 }}>{error}</div> : null}

      {!state && !checking && !error ? (
        <div className="dataview-empty">click "check for updates" to query the latest release.</div>
      ) : null}

      {state ? (
        <div className="admin-update-panel">
          <div className="admin-update-row">
            <span style={{ color: "var(--dim)", fontSize: 18 }}>current version</span>
            <span style={{ color: "var(--fg)", fontFamily: "var(--code-font)", fontSize: 14 }}>{state.current}</span>
          </div>
          <div className="admin-update-row">
            <span style={{ color: "var(--dim)", fontSize: 18 }}>latest version</span>
            <span style={{ color: state.newer ? "var(--accent)" : "var(--cyan)", fontFamily: "var(--code-font)", fontSize: 14 }}>
              {state.latest}
            </span>
          </div>

          {!state.newer ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 0" }}>
              <span style={{ color: "var(--cyan)", fontSize: 24 }}>✓</span>
              <span style={{ color: "var(--fg)", fontSize: 20 }}>Up to date</span>
            </div>
          ) : (
            <>
              {state.notes ? (
                <div style={{ marginTop: 12 }}>
                  <div className="dv-section-h">RELEASE NOTES</div>
                  <div style={{ background: "var(--bg-tint)", border: "1px solid var(--border)", padding: "8px 12px", fontFamily: "var(--code-font)", fontSize: 12, whiteSpace: "pre-wrap", color: "var(--dim)", maxHeight: 160, overflowY: "auto", marginBottom: 10 }}>
                    {state.notes}
                  </div>
                </div>
              ) : null}

              {progress ? (
                <div style={{ color: "var(--accent)", fontFamily: "var(--pixel-font)", fontSize: 18, marginBottom: 8 }}>
                  {progress}
                </div>
              ) : null}

              {applied ? (
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
                  <span style={{ color: "var(--cyan)", fontSize: 20 }}>Update installed. Restart to use {state.latest}.</span>
                  <button className="settings-btn-primary" style={{ fontSize: 17 }} onClick={() => void doRelaunch()}>
                    restart now
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                  <button
                    className="settings-btn-primary"
                    style={{ fontSize: 18, padding: "6px 22px" }}
                    onClick={() => void doApply()}
                    disabled={applying}
                  >
                    {applying ? "downloading…" : `download & install ${state.latest}`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Config
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG_REL = ".cero/cero.config.json";

type LeafValue = string | number | boolean | string[];

interface TreeNode {
  path: string[];
  value: LeafValue;
  modified: boolean;
}

function flattenConfig(obj: unknown, prefix: string[] = []): TreeNode[] {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return [{ path: prefix, value: obj as LeafValue, modified: false }];
  }
  const out: TreeNode[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      out.push(...flattenConfig(v, [...prefix, k]));
    } else {
      out.push({ path: [...prefix, k], value: v as LeafValue, modified: false });
    }
  }
  return out;
}

function setNestedValue(obj: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> {
  if (path.length === 0) return obj;
  const [head, ...rest] = path as [string, ...string[]];
  if (rest.length === 0) {
    return { ...obj, [head]: value };
  }
  return {
    ...obj,
    [head]: setNestedValue((obj[head] as Record<string, unknown>) ?? {}, rest, value),
  };
}

function LeafEditor({
  node,
  onChange,
}: {
  readonly node: TreeNode;
  readonly onChange: (v: LeafValue) => void;
}): React.JSX.Element {
  const v = node.value;
  if (typeof v === "boolean") {
    return (
      <select
        value={String(v)}
        onChange={(e) => onChange(e.target.value === "true")}
        style={{ background: "var(--bg-tint)", border: "1px solid var(--border)", color: "var(--fg)", fontFamily: "var(--code-font)", fontSize: 12, padding: "2px 6px", outline: "none" }}
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (typeof v === "number") {
    return (
      <input
        type="number"
        value={v}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ background: "var(--bg-tint)", border: "1px solid var(--border)", color: "var(--fg)", fontFamily: "var(--code-font)", fontSize: 12, padding: "2px 6px", outline: "none", width: 120 }}
      />
    );
  }
  if (Array.isArray(v)) {
    return (
      <input
        value={v.join(",")}
        onChange={(e) => onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
        placeholder="comma-separated"
        style={{ background: "var(--bg-tint)", border: "1px solid var(--border)", color: "var(--fg)", fontFamily: "var(--code-font)", fontSize: 12, padding: "2px 6px", outline: "none", minWidth: 200 }}
      />
    );
  }
  return (
    <input
      value={String(v ?? "")}
      onChange={(e) => onChange(e.target.value)}
      style={{ background: "var(--bg-tint)", border: "1px solid var(--border)", color: "var(--fg)", fontFamily: "var(--code-font)", fontSize: 12, padding: "2px 6px", outline: "none", minWidth: 200 }}
    />
  );
}

function ConfigTab(): React.JSX.Element {
  const { tabs } = useTabs();
  const { settings } = useSettings();
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showRestartPrompt, setShowRestartPrompt] = useState(false);
  const [modifiedCount, setModifiedCount] = useState(0);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const found = await exists(CONFIG_REL, { baseDir: BaseDirectory.Home }).catch(() => false);
      if (!found) {
        setConfig({});
        setNodes([]);
        return;
      }
      const txt = await readTextFile(CONFIG_REL, { baseDir: BaseDirectory.Home });
      const parsed = JSON.parse(txt) as Record<string, unknown>;
      setConfig(parsed);
      setNodes(flattenConfig(parsed).map((n) => ({ ...n, modified: false })));
      setModifiedCount(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleChange = (idx: number, value: LeafValue): void => {
    setNodes((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx]!, value, modified: true };
      setModifiedCount(next.filter((n) => n.modified).length);
      return next;
    });
  };

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      let updated = { ...config };
      for (const node of nodes) {
        if (node.modified) {
          updated = setNestedValue(updated, node.path, node.value) as Record<string, unknown>;
        }
      }
      const txt = JSON.stringify(updated, null, 2);
      await writeTextFile(CONFIG_REL, txt, { baseDir: BaseDirectory.Home });
      setConfig(updated);
      setNodes((prev) => prev.map((n) => ({ ...n, modified: false })));
      setModifiedCount(0);
      setShowRestartPrompt(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async (): Promise<void> => {
    if (!confirm("Reset all changes? Modified values will revert to what is on disk.")) return;
    await load();
  };

  const handleRestartSidecar = async (): Promise<void> => {
    setShowRestartPrompt(false);
    try {
      const env: Record<string, string> = {};
      if (settings.anthropicApiKey) env.ANTHROPIC_API_KEY = settings.anthropicApiKey;
      if (settings.openaiApiKey) env.OPENAI_API_KEY = settings.openaiApiKey;
      if (settings.geminiApiKey) { env.GEMINI_API_KEY = settings.geminiApiKey; env.GOOGLE_API_KEY = settings.geminiApiKey; }
      if (settings.awsAccessKeyId) env.AWS_ACCESS_KEY_ID = settings.awsAccessKeyId;
      if (settings.awsSecretAccessKey) env.AWS_SECRET_ACCESS_KEY = settings.awsSecretAccessKey;
      if (settings.awsRegion) env.AWS_REGION = settings.awsRegion;
      await invoke("restart_session", {
        config: { provider: settings.provider, model: settings.model || null, sandbox: settings.sandbox, goal: settings.goal || null, no_learning: settings.learningMode === "off" },
        env,
        tabIds: tabs.map((t) => t.id),
      });
    } catch (err) {
      setError(`Restart failed: ${String(err)}`);
    }
  };

  return (
    <div className="admin-tab-body">
      <div className="admin-tab-toolbar">
        <span style={{ color: "var(--dim)", fontSize: 17 }}>~/.cero/cero.config.json</span>
        {modifiedCount > 0 ? (
          <span className="dv-pill dv-pill-accent" style={{ fontSize: 13 }}>{modifiedCount} modified</span>
        ) : null}
        <button className="settings-btn-secondary" style={{ fontSize: 16, padding: "3px 12px", marginLeft: "auto" }} onClick={() => void handleReset()}>
          reset
        </button>
        <button className="settings-btn-primary" style={{ fontSize: 17, padding: "4px 16px" }} onClick={() => void handleSave()} disabled={saving}>
          {saving ? "saving…" : "save changes"}
        </button>
      </div>

      {error ? <div className="settings-error" style={{ marginBottom: 8 }}>{error}</div> : null}
      {loading ? <div className="dataview-empty">loading…</div> : null}

      {!loading && nodes.length === 0 ? (
        <div className="dataview-empty">
          config file not found at ~/.cero/cero.config.json — it will be created on save.
        </div>
      ) : null}

      {!loading && nodes.length > 0 ? (
        <div className="admin-config-tree">
          {nodes.map((node, idx) => (
            <div key={node.path.join(".")} className={`admin-config-row ${node.modified ? "admin-config-row-modified" : ""}`}>
              <span className="admin-config-key">{node.path.join(".")}</span>
              <LeafEditor node={node} onChange={(v) => handleChange(idx, v)} />
            </div>
          ))}
        </div>
      ) : null}

      {showRestartPrompt ? (
        <div className="settings-backdrop" onClick={() => setShowRestartPrompt(false)}>
          <div className="settings-modal" style={{ width: "min(440px, 90vw)" }} onClick={(e) => e.stopPropagation()}>
            <div className="settings-header"><h2>APPLY CHANGES</h2></div>
            <div className="settings-body" style={{ padding: "20px 24px" }}>
              <div className="dv-detail-text">
                cero.config.json saved. Restart the sidecar now so cero picks up the new config?
              </div>
            </div>
            <div className="settings-footer">
              <button className="settings-btn-secondary" onClick={() => setShowRestartPrompt(false)}>not now</button>
              <button className="settings-btn-primary" onClick={() => void handleRestartSidecar()}>restart sidecar</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Tools
// ─────────────────────────────────────────────────────────────────────────────

interface ToolEntry {
  name: string;
  enabled: boolean;
}

const TOOL_TOGGLES_REL = ".cero/tool-toggles.json";

interface ToolToggles {
  enabled: string[];
  disabled: string[];
  preset?: string;
}

const PRESETS = ["minimal", "default", "code", "voice", "reset"] as const;

// These are the tool names registered in the cero default registry.
// Kept in sync with src/tools/core/index.ts — add new tools here as they land.
const KNOWN_TOOLS = [
  "read_file", "write_file", "edit_file", "list_dir", "grep", "search_files",
  "apply_patch", "run_shell", "session_search", "memory", "cronjob",
  "transcribe_audio", "text_to_speech", "voice_mode",
];

function isEnabled(name: string, toggles: ToolToggles): boolean {
  if (toggles.disabled.includes(name)) return false;
  if (toggles.enabled.length === 0) return true;
  return toggles.enabled.includes(name);
}

function ToolsTab(): React.JSX.Element {
  const restartSidecar = useRestartSidecar();
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [toggles, setToggles] = useState<ToolToggles>({ enabled: [], disabled: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      let t: ToolToggles = { enabled: [], disabled: [] };
      const found = await exists(TOOL_TOGGLES_REL, { baseDir: BaseDirectory.Home }).catch(() => false);
      if (found) {
        const txt = await readTextFile(TOOL_TOGGLES_REL, { baseDir: BaseDirectory.Home });
        t = JSON.parse(txt) as ToolToggles;
      }
      setToggles(t);
      setTools(KNOWN_TOOLS.map((name) => ({ name, enabled: isEnabled(name, t) })));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleToggle = async (name: string, next: boolean): Promise<void> => {
    setSaving(true);
    try {
      const out = await invoke<CliOutput>("cero_cli", { args: ["tools", next ? "enable" : "disable", name] });
      if (out.exit_code !== 0) { setError(out.stderr || "toggle failed"); return; }
      await load();
      setToast(`${name} ${next ? "enabled" : "disabled"}. Restart sidecar to apply.`);
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handlePreset = async (preset: string): Promise<void> => {
    setSaving(true);
    try {
      const args = preset === "reset"
        ? ["tools", "reset"]
        : ["tools", "toggle-set", preset];
      const out = await invoke<CliOutput>("cero_cli", { args });
      if (out.exit_code !== 0) { setError(out.stderr || "preset failed"); return; }
      await load();
      setToast(`Preset "${preset}" applied. Restart sidecar to apply.`);
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const filtered = tools.filter((t) =>
    !search.trim() || t.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="admin-tab-body">
      <div className="admin-tab-toolbar">
        <input
          className="dataview-search"
          placeholder="filter tools…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 200 }}
        />
        <span style={{ color: "var(--dim)", fontSize: 16 }}>preset:</span>
        {PRESETS.map((p) => (
          <button
            key={p}
            className={`dv-tag ${toggles.preset === p ? "active" : ""}`}
            onClick={() => void handlePreset(p)}
            disabled={saving}
          >
            {p}
          </button>
        ))}
        <button className="dv-tag" style={{ marginLeft: "auto" }} onClick={() => void restartSidecar()}>
          restart sidecar
        </button>
      </div>

      {toast ? (
        <div style={{ background: "rgba(184,148,245,0.12)", border: "1px solid var(--accent)", color: "var(--accent)", fontFamily: "var(--pixel-font)", fontSize: 17, padding: "6px 14px", marginBottom: 8 }}>
          {toast}
        </div>
      ) : null}
      {error ? <div className="settings-error" style={{ marginBottom: 8 }}>{error}</div> : null}
      {loading ? <div className="dataview-empty">loading…</div> : null}

      {!loading ? (
        <div className="dataview-list">
          {filtered.map((tool) => (
            <div key={tool.name} className="dv-row" style={{ alignItems: "center" }}>
              <div className="dv-row-main">
                <div className="dv-row-title" style={{ fontSize: 19 }}>{tool.name}</div>
              </div>
              <div className="dv-row-meta">
                <button
                  className={`admin-toggle-btn ${tool.enabled ? "admin-toggle-on" : "admin-toggle-off"}`}
                  onClick={() => void handleToggle(tool.name, !tool.enabled)}
                  disabled={saving}
                >
                  {tool.enabled ? "enabled" : "disabled"}
                </button>
              </div>
            </div>
          ))}
          {filtered.length === 0 ? (
            <div className="dataview-empty">no tools match "{search}"</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Personality
// ─────────────────────────────────────────────────────────────────────────────

interface PersonalityRecord {
  name: string;
  builtin: boolean;
  content: string;
  active: boolean;
}

const PERSONALITIES_DIR_REL = ".cero/personalities";
const ACTIVE_FILE_REL = ".cero/state/active-personality.txt";

const BUILTIN_SEEDS: Record<string, string> = {
  concise: `You communicate with maximum signal-to-noise. Skip pleasantries and meta-commentary. Default to short, direct answers; expand only when the user asks "why" or "how". Lists over prose when the answer is enumerable. Code without surrounding explanation unless explicitly requested.`,
  verbose: `You communicate thoroughly. For every recommendation, explain the rationale, alternatives considered, and trade-offs. Anticipate likely follow-up questions and address them inline. When showing code, walk through it block by block.`,
  academic: `You write with the rigour of a peer-reviewed paper. Cite sources or RFCs whenever a claim is non-trivial. Distinguish between established consensus, emerging best practice, and personal recommendation. Avoid colloquialisms; use precise technical vocabulary.`,
  casual: `You communicate like a senior engineer over coffee. Use plain language, contractions, and the occasional dry observation. Skip ceremony but never sloppy — the substance is still rigorous, the surface is just relaxed.`,
};

interface PersonalityEditModal {
  name: string;
  content: string;
  isNew: boolean;
}

function PersonalityModal({
  initial,
  onClose,
  onSave,
}: {
  readonly initial: PersonalityEditModal;
  readonly onClose: () => void;
  readonly onSave: (name: string, content: string) => Promise<void>;
}): React.JSX.Element {
  const [name, setName] = useState(initial.name);
  const [content, setContent] = useState(initial.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (): Promise<void> => {
    if (!name.trim()) { setError("name is required"); return; }
    if (name.trim() === "default") { setError('"default" is reserved'); return; }
    if (!content.trim()) { setError("content is required"); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave(name.trim(), content.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div
        className="settings-modal"
        style={{ width: "min(680px, 94vw)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <h2>{initial.isNew ? "NEW PERSONALITY" : "EDIT PERSONALITY"}</h2>
          <button className="settings-close" onClick={onClose}>✕</button>
        </div>
        <div className="settings-body">
          <div className="settings-section">
            <div className="settings-section-body">
              <label className="settings-field settings-field-required">
                <span className="settings-field-label">name (filename without .md)</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. pirate"
                  disabled={!initial.isNew}
                  autoFocus={initial.isNew}
                />
              </label>
              <label className="settings-field settings-field-required">
                <span className="settings-field-label">system prompt content (markdown)</span>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={10}
                  autoFocus={!initial.isNew}
                  style={{
                    background: "var(--bg-tint)", border: "1px solid var(--border)", color: "var(--fg)",
                    fontFamily: "var(--code-font)", fontSize: 13, padding: "8px 10px", outline: "none",
                    resize: "vertical", width: "100%",
                  }}
                />
              </label>
            </div>
          </div>
        </div>
        {error ? <div className="settings-error settings-error-sticky">{error}</div> : null}
        <div className="settings-footer">
          <button className="settings-btn-secondary" onClick={onClose} disabled={saving}>cancel</button>
          <button className="settings-btn-primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? "saving…" : initial.isNew ? "create" : "save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PersonalityTab(): React.JSX.Element {
  const restartSidecar = useRestartSidecar();
  const [personalities, setPersonalities] = useState<PersonalityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PersonalityEditModal | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string): void => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      // Ensure personalities dir + seed builtins on first load
      await mkdir(PERSONALITIES_DIR_REL, { baseDir: BaseDirectory.Home, recursive: true }).catch(() => undefined);
      for (const [name, content] of Object.entries(BUILTIN_SEEDS)) {
        const rel = `${PERSONALITIES_DIR_REL}/${name}.md`;
        const found = await exists(rel, { baseDir: BaseDirectory.Home }).catch(() => false);
        if (!found) {
          await writeTextFile(rel, `${content}\n`, { baseDir: BaseDirectory.Home }).catch(() => undefined);
        }
      }
      // Read active name
      let activeName = "default";
      try {
        activeName = (await readTextFile(ACTIVE_FILE_REL, { baseDir: BaseDirectory.Home })).trim() || "default";
      } catch { /* no active file — default */ }

      // List .md files
      const entries = await readDir(PERSONALITIES_DIR_REL, { baseDir: BaseDirectory.Home }).catch(() => [] as Awaited<ReturnType<typeof readDir>>);
      const records: PersonalityRecord[] = [];
      for (const entry of entries) {
        if (!entry.name?.endsWith(".md")) continue;
        const name = entry.name.slice(0, -3);
        const content = await readTextFile(`${PERSONALITIES_DIR_REL}/${entry.name}`, { baseDir: BaseDirectory.Home }).catch(() => "");
        records.push({
          name,
          builtin: Object.hasOwn(BUILTIN_SEEDS, name),
          content: content.trim(),
          active: name === activeName,
        });
      }
      records.sort((a, b) => a.name.localeCompare(b.name));
      setPersonalities(records);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleSetActive = async (name: string): Promise<void> => {
    try {
      await mkdir(".cero/state", { baseDir: BaseDirectory.Home, recursive: true }).catch(() => undefined);
      await writeTextFile(ACTIVE_FILE_REL, name, { baseDir: BaseDirectory.Home });
      await load();
      showToast(`Active personality set to "${name}". Restart sidecar to apply.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSave = async (name: string, content: string): Promise<void> => {
    await writeTextFile(`${PERSONALITIES_DIR_REL}/${name}.md`, `${content}\n`, { baseDir: BaseDirectory.Home });
    await load();
    showToast(`Saved "${name}".`);
  };

  const handleDelete = async (name: string): Promise<void> => {
    if (!confirm(`Delete personality "${name}"? This cannot be undone.`)) return;
    try {
      await remove(`${PERSONALITIES_DIR_REL}/${name}.md`, { baseDir: BaseDirectory.Home });
      await load();
      showToast(`Deleted "${name}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="admin-tab-body">
      <div className="admin-tab-toolbar">
        <span style={{ color: "var(--dim)", fontSize: 17 }}>
          ~/.cero/personalities/ &nbsp;·&nbsp; active: <b style={{ color: "var(--accent)" }}>
            {personalities.find((p) => p.active)?.name ?? "default"}
          </b>
        </span>
        <button className="dv-tag" style={{ marginLeft: "auto" }} onClick={() => setEditing({ name: "", content: "", isNew: true })}>
          + new
        </button>
        <button className="dv-tag" onClick={() => void restartSidecar()}>restart sidecar</button>
      </div>

      {toast ? (
        <div style={{ background: "rgba(184,148,245,0.12)", border: "1px solid var(--accent)", color: "var(--accent)", fontFamily: "var(--pixel-font)", fontSize: 17, padding: "6px 14px", marginBottom: 8 }}>
          {toast}
        </div>
      ) : null}
      {error ? <div className="settings-error" style={{ marginBottom: 8 }}>{error}</div> : null}
      {loading ? <div className="dataview-empty">loading…</div> : null}

      {!loading ? (
        <div className="dataview-list">
          {personalities.map((p) => (
            <div key={p.name} className="dv-row" style={{ alignItems: "center" }}>
              <div className="dv-row-main">
                <div className="dv-row-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {p.active ? <span style={{ color: "var(--accent)" }}>✓</span> : null}
                  {p.name}
                  {p.builtin ? <span className="dv-pill" style={{ fontSize: 10 }}>builtin</span> : null}
                </div>
                <div className="dv-row-sub" style={{ fontFamily: "var(--code-font)", fontSize: 12 }}>
                  {p.content.split("\n").slice(0, 2).join(" ").slice(0, 120)}
                  {p.content.length > 120 ? "…" : ""}
                </div>
              </div>
              <div className="dv-row-meta">
                {!p.active ? (
                  <button className="admin-row-btn admin-row-btn-accent" onClick={() => void handleSetActive(p.name)}>
                    set active
                  </button>
                ) : null}
                <button className="admin-row-btn" onClick={() => setEditing({ name: p.name, content: p.content, isNew: false })}>
                  edit
                </button>
                {!p.builtin ? (
                  <button className="admin-row-btn admin-row-btn-danger" onClick={() => void handleDelete(p.name)}>
                    delete
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          {personalities.length === 0 ? (
            <div className="dataview-empty">no personalities yet — click "+ new" to create one.</div>
          ) : null}
        </div>
      ) : null}

      {editing ? (
        <PersonalityModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab bar + main view
// ─────────────────────────────────────────────────────────────────────────────

type AdminTab = "credentials" | "doctor" | "update" | "config" | "tools" | "personality";

const TABS: { id: AdminTab; label: string }[] = [
  { id: "credentials", label: "credentials" },
  { id: "doctor",      label: "doctor"      },
  { id: "update",      label: "update"      },
  { id: "config",      label: "config"      },
  { id: "tools",       label: "tools"       },
  { id: "personality", label: "personality" },
];

export function AdminView(): React.JSX.Element {
  const [tab, setTab] = useState<AdminTab>("credentials");

  return (
    <div className="dataview" style={{ gap: 0 }}>
      <div className="dataview-header" style={{ marginBottom: 0, paddingBottom: 0, borderBottom: "none" }}>
        <h2>ADMIN</h2>
      </div>

      <div className="admin-tabbar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`admin-tab-btn ${tab === t.id ? "admin-tab-btn-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="admin-tab-panel">
        {tab === "credentials" ? <CredentialsTab /> : null}
        {tab === "doctor"      ? <DoctorTab />      : null}
        {tab === "update"      ? <UpdateTab />       : null}
        {tab === "config"      ? <ConfigTab />       : null}
        {tab === "tools"       ? <ToolsTab />        : null}
        {tab === "personality" ? <PersonalityTab />  : null}
      </div>
    </div>
  );
}
