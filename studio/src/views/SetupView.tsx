// SetupView — onboarding wizard that replaces `cero setup` CLI.
// Multi-step: Welcome → API Keys → Sandbox → Model → Gateway → Review.
// Persists setupCompleted flag in Tauri store so it only shows on first launch.

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import { useToastContext } from "../hooks/ToastContext";

// ─── provider catalogue ───────────────────────────────────────────────────────

interface ProviderInfo {
  id: string;
  label: string;
  keyUrl: string;
  envVar: string;
}

const PROVIDERS: ProviderInfo[] = [
  { id: "anthropic",  label: "Anthropic",    keyUrl: "https://console.anthropic.com/keys",     envVar: "ANTHROPIC_API_KEY"  },
  { id: "openai",     label: "OpenAI",       keyUrl: "https://platform.openai.com/api-keys",   envVar: "OPENAI_API_KEY"     },
  { id: "openrouter", label: "OpenRouter",   keyUrl: "https://openrouter.ai/keys",             envVar: "OPENROUTER_API_KEY" },
  { id: "ollama",     label: "Ollama",       keyUrl: "https://ollama.com",                     envVar: ""                   },
  { id: "groq",       label: "Groq",         keyUrl: "https://console.groq.com/keys",          envVar: "GROQ_API_KEY"       },
  { id: "mistral",    label: "Mistral",      keyUrl: "https://console.mistral.ai/api-keys",    envVar: "MISTRAL_API_KEY"    },
  { id: "deepseek",   label: "DeepSeek",     keyUrl: "https://platform.deepseek.com/api_keys", envVar: "DEEPSEEK_API_KEY"   },
  { id: "together",   label: "Together AI",  keyUrl: "https://api.together.xyz/settings/api-keys", envVar: "TOGETHER_API_KEY" },
  { id: "bedrock",    label: "AWS Bedrock",  keyUrl: "https://console.aws.amazon.com/iam",     envVar: "AWS_ACCESS_KEY_ID"  },
  { id: "gemini",     label: "Gemini",       keyUrl: "https://aistudio.google.com/app/apikey", envVar: "GEMINI_API_KEY"     },
];

const PROVIDER_MODELS: Record<string, string[]> = {
  anthropic:  ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5"],
  openai:     ["gpt-4o", "gpt-4o-mini", "gpt-4.1"],
  openrouter: ["openrouter/auto", "anthropic/claude-3.5-sonnet", "openai/gpt-4o"],
  ollama:     ["llama3.2", "llama3.1", "qwen2.5-coder"],
  groq:       ["llama-3.3-70b-versatile", "mixtral-8x7b-32768"],
  mistral:    ["mistral-large-latest", "mistral-small-latest"],
  deepseek:   ["deepseek-chat", "deepseek-coder"],
  together:   ["meta-llama/Llama-3.3-70B-Instruct-Turbo"],
  bedrock:    ["anthropic.claude-sonnet-4-6-v1", "anthropic.claude-opus-4-1"],
  gemini:     ["gemini-2.0-flash", "gemini-2.5-pro"],
};

// ─── sandbox types ────────────────────────────────────────────────────────────

type SandboxKind = "local" | "docker" | "ssh" | "modal" | "daytona" | "singularity";

interface DockerOpts {
  image: string;
  memoryMb: string;
  cpuShares: string;
}
interface SshOpts {
  host: string;
  user: string;
  port: string;
  identityFile: string;
  knownHostsFile: string;
}
interface ModalOpts {
  tokenId: string;
  tokenSecret: string;
  image: string;
  timeoutSeconds: string;
}
interface DaytonaOpts {
  apiKey: string;
  region: "us" | "eu";
  workspaceTemplate: string;
}
interface SingularityOpts {
  imagePath: string;
  bindMounts: string[];
}

interface SandboxConfig {
  kind: SandboxKind;
  docker: DockerOpts;
  ssh: SshOpts;
  modal: ModalOpts;
  daytona: DaytonaOpts;
  singularity: SingularityOpts;
}

function defaultSandbox(): SandboxConfig {
  return {
    kind: "local",
    docker: { image: "alpine:3", memoryMb: "512", cpuShares: "0.5" },
    ssh: { host: "", user: "", port: "22", identityFile: "", knownHostsFile: "" },
    modal: { tokenId: "", tokenSecret: "", image: "python:3.12-slim", timeoutSeconds: "300" },
    daytona: { apiKey: "", region: "us", workspaceTemplate: "" },
    singularity: { imagePath: "", bindMounts: [] },
  };
}

// ─── gateway config ───────────────────────────────────────────────────────────

interface GatewayConfig {
  enabled: boolean;
  telegramToken: string;
  discordToken: string;
  wsPort: string;
  wsSecret: string;
  httpPort: string;
  httpBearer: string;
}

function defaultGateway(): GatewayConfig {
  return {
    enabled: false,
    telegramToken: "",
    discordToken: "",
    wsPort: "8080",
    wsSecret: "",
    httpPort: "8888",
    httpBearer: "",
  };
}

// ─── full wizard state ────────────────────────────────────────────────────────

interface WizardState {
  selectedProviders: string[];
  apiKeys: Record<string, string>;
  keySaveStatus: Record<string, "idle" | "saving" | "ok" | "error">;
  keyErrors: Record<string, string>;
  sandbox: SandboxConfig;
  sandboxTestStatus: "idle" | "testing" | "ok" | "error";
  sandboxTestError: string;
  preferredProvider: string;
  model: string;
  temperature: number;
  maxTokens: number;
  gateway: GatewayConfig;
  reviewStatus: "idle" | "applying" | "ok" | "error";
  reviewError: string;
  reviewChecks: Array<{ label: string; ok: boolean; hint?: string }>;
}

function initWizard(): WizardState {
  return {
    selectedProviders: [],
    apiKeys: {},
    keySaveStatus: {},
    keyErrors: {},
    sandbox: defaultSandbox(),
    sandboxTestStatus: "idle",
    sandboxTestError: "",
    preferredProvider: "",
    model: "",
    temperature: 0.7,
    maxTokens: 4096,
    gateway: defaultGateway(),
    reviewStatus: "idle",
    reviewError: "",
    reviewChecks: [],
  };
}

// ─── step constants ───────────────────────────────────────────────────────────

const STEPS = [
  "welcome",
  "api-keys",
  "sandbox",
  "model",
  "gateway",
  "review",
] as const;

type Step = typeof STEPS[number];

const STEP_LABELS: Record<Step, string> = {
  welcome:   "1  PROVIDERS",
  "api-keys": "2  API KEYS",
  sandbox:   "3  SANDBOX",
  model:     "4  MODEL",
  gateway:   "5  GATEWAY",
  review:    "6  REVIEW",
};

// ─── props ────────────────────────────────────────────────────────────────────

export interface SetupViewProps {
  readonly onComplete: () => void;
}

// ─── main component ───────────────────────────────────────────────────────────

export function SetupView({ onComplete }: SetupViewProps): React.JSX.Element {
  const [step, setStep] = useState<Step>("welcome");
  const [state, setState] = useState<WizardState>(initWizard());
  const { toast } = useToastContext();

  const stepIndex = STEPS.indexOf(step);
  const progress = ((stepIndex + 1) / STEPS.length) * 100;

  const update = useCallback(<K extends keyof WizardState>(key: K, val: WizardState[K]): void => {
    setState((prev) => ({ ...prev, [key]: val }));
  }, []);

  const next = (): void => {
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]!);
  };
  const back = (): void => {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]!);
  };

  // ─── step handlers ────────────────────────────────────────────────────────

  const handleSaveKey = async (providerId: string): Promise<void> => {
    const key = state.apiKeys[providerId] ?? "";
    if (key.trim().length < 10) {
      update("keyErrors", { ...state.keyErrors, [providerId]: "Key too short (min 10 chars)" });
      return;
    }
    update("keySaveStatus", { ...state.keySaveStatus, [providerId]: "saving" });
    update("keyErrors", { ...state.keyErrors, [providerId]: "" });
    try {
      // TODO: wire credentials_add Tauri command when backend cero exposes
      // `cero credentials add <provider> <key>` via IPC (see lib.rs stubs below).
      await invoke("credentials_add", { provider: providerId, apiKey: key });
      update("keySaveStatus", { ...state.keySaveStatus, [providerId]: "ok" });
    } catch (err) {
      update("keySaveStatus", { ...state.keySaveStatus, [providerId]: "error" });
      update("keyErrors", { ...state.keyErrors, [providerId]: String(err) });
    }
  };

  const handleSandboxTest = async (): Promise<void> => {
    update("sandboxTestStatus", "testing");
    update("sandboxTestError", "");
    try {
      const opts = buildSandboxOpts(state.sandbox);
      // TODO: sandbox_test Tauri command stub — lib.rs returns ok:true for now.
      const result = await invoke<{ ok: boolean; error?: string }>("sandbox_test", {
        kind: state.sandbox.kind,
        opts,
      });
      if (result.ok) {
        update("sandboxTestStatus", "ok");
        toast.success(`Sandbox ${state.sandbox.kind}: health check passed`);
      } else {
        update("sandboxTestStatus", "error");
        update("sandboxTestError", result.error ?? "Unknown error");
      }
    } catch (err) {
      update("sandboxTestStatus", "error");
      update("sandboxTestError", String(err));
    }
  };

  const handleApply = async (): Promise<void> => {
    update("reviewStatus", "applying");
    update("reviewChecks", []);
    const checks: Array<{ label: string; ok: boolean; hint?: string }> = [];

    // 1. Write cero.config.json
    try {
      const config = buildCeroConfig(state);
      await writeTextFile(
        ".cero/cero.config.json",
        JSON.stringify(config, null, 2),
        { baseDir: BaseDirectory.Home },
      );
      checks.push({ label: "cero.config.json saved", ok: true });
    } catch (err) {
      checks.push({ label: "cero.config.json save failed", ok: false, hint: String(err) });
    }

    // 2. Restart session
    try {
      // TODO: restart_session takes full config+env — once cero binary is
      // updated to accept gateway + sandbox opts, pass the full payload.
      await invoke("restart_session", {
        config: {
          provider: state.preferredProvider || state.selectedProviders[0] || "openai",
          model: state.model || null,
          sandbox: state.sandbox.kind === "local" ? "local" : "docker",
          goal: null,
          no_learning: false,
        },
        env: buildEnvFromState(state),
        tabIds: [],
      });
      checks.push({ label: "Session restarted", ok: true });
    } catch (err) {
      checks.push({
        label: "Session restart failed",
        ok: false,
        hint: String(err),
      });
    }

    // 3. Doctor check (stub)
    try {
      // TODO: wire `cero doctor --json` once binary supports structured output.
      await invoke("sandbox_test", { kind: state.sandbox.kind, opts: buildSandboxOpts(state.sandbox) });
      checks.push({ label: "Doctor check: sandbox reachable", ok: true });
    } catch {
      checks.push({ label: "Doctor check: sandbox unreachable", ok: false, hint: "Verify sandbox config in step 3" });
    }

    const allOk = checks.every((c) => c.ok);
    update("reviewChecks", checks);
    update("reviewStatus", allOk ? "ok" : "error");

    if (allOk) {
      // Persist flag so App.tsx won't redirect here again
      try {
        await invoke("mark_setup_complete");
      } catch {
        // stub — if command doesn't exist yet, silently continue
      }
      setTimeout(() => { onComplete(); }, 800);
    }
  };

  // ─── render ────────────────────────────────────────────────────────────────

  return (
    <div className="setup-view">
      {/* Progress bar */}
      <div className="setup-progress-track">
        <div
          className="setup-progress-fill"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Step tabs */}
      <div className="setup-steps">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={`setup-step-tab ${step === s ? "setup-step-tab-active" : ""} ${i < stepIndex ? "setup-step-tab-done" : ""}`}
            onClick={() => {
              // Allow navigating back (not forward, to avoid skipping validation)
              if (i <= stepIndex) setStep(s);
            }}
          >
            {i < stepIndex ? "✓ " : ""}{STEP_LABELS[s]}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="setup-body">
        {step === "welcome"   && <StepWelcome state={state} update={update} />}
        {step === "api-keys"  && <StepApiKeys state={state} update={update} onSaveKey={handleSaveKey} />}
        {step === "sandbox"   && <StepSandbox state={state} update={update} onTest={handleSandboxTest} />}
        {step === "model"     && <StepModel state={state} update={update} />}
        {step === "gateway"   && <StepGateway state={state} update={update} />}
        {step === "review"    && <StepReview state={state} onApply={handleApply} />}
      </div>

      {/* Navigation */}
      <div className="setup-nav">
        {stepIndex > 0 ? (
          <button className="settings-btn-secondary" onClick={back}>
            back
          </button>
        ) : (
          <span />
        )}
        {step === "welcome" && (
          <button
            className="settings-btn-primary"
            disabled={state.selectedProviders.length === 0}
            onClick={next}
          >
            next
          </button>
        )}
        {step === "api-keys" && (
          <button className="settings-btn-primary" onClick={next}>
            next
          </button>
        )}
        {step === "sandbox" && (
          <button className="settings-btn-primary" onClick={next}>
            next
          </button>
        )}
        {step === "model" && (
          <button className="settings-btn-primary" onClick={next}>
            next
          </button>
        )}
        {step === "gateway" && (
          <button className="settings-btn-primary" onClick={next}>
            {state.gateway.enabled ? "next" : "skip"}
          </button>
        )}
        {step === "review" && (
          <button
            className="settings-btn-primary"
            disabled={state.reviewStatus === "applying" || state.reviewStatus === "ok"}
            onClick={handleApply}
          >
            {state.reviewStatus === "applying" ? "applying…"
              : state.reviewStatus === "ok" ? "done!"
              : "apply & start"}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Step 1: Welcome / Provider selection ─────────────────────────────────────

function StepWelcome({
  state,
  update,
}: {
  state: WizardState;
  update: <K extends keyof WizardState>(k: K, v: WizardState[K]) => void;
}): React.JSX.Element {
  const toggle = (id: string): void => {
    const selected = state.selectedProviders;
    const next = selected.includes(id)
      ? selected.filter((p) => p !== id)
      : [...selected, id];
    update("selectedProviders", next);
    if (!state.preferredProvider && next.length > 0) {
      update("preferredProvider", next[0]!);
    }
    if (state.preferredProvider && !next.includes(state.preferredProvider)) {
      update("preferredProvider", next[0] ?? "");
    }
  };

  return (
    <div className="setup-step">
      <h2 className="setup-step-title">WELCOME TO CERO STUDIO</h2>
      <p className="setup-step-desc">
        Select the AI providers you want to use. At least one is required.
      </p>
      <div className="setup-provider-grid">
        {PROVIDERS.map((p) => {
          const active = state.selectedProviders.includes(p.id);
          return (
            <div
              key={p.id}
              className={`setup-provider-card ${active ? "setup-provider-card-active" : ""}`}
              onClick={() => toggle(p.id)}
              role="checkbox"
              aria-checked={active}
            >
              <span className="setup-provider-name">{p.label}</span>
              {active && p.keyUrl ? (
                <a
                  className="setup-provider-link"
                  href={p.keyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  get key
                </a>
              ) : null}
              <span className="setup-provider-check">{active ? "✓" : ""}</span>
            </div>
          );
        })}
      </div>
      {state.selectedProviders.length === 0 && (
        <div className="setup-hint">Select at least one provider to continue.</div>
      )}
    </div>
  );
}

// ─── Step 2: API keys ─────────────────────────────────────────────────────────

function StepApiKeys({
  state,
  update,
  onSaveKey,
}: {
  state: WizardState;
  update: <K extends keyof WizardState>(k: K, v: WizardState[K]) => void;
  onSaveKey: (provider: string) => Promise<void>;
}): React.JSX.Element {
  const providers = PROVIDERS.filter((p) => state.selectedProviders.includes(p.id));

  return (
    <div className="setup-step">
      <h2 className="setup-step-title">API KEYS</h2>
      <p className="setup-step-desc">
        Enter your API keys. They are saved to <code className="md-inline">~/.cero/credentials.db</code>.
      </p>
      <div className="setup-keys-list">
        {providers.map((p) => {
          const key    = state.apiKeys[p.id] ?? "";
          const status = state.keySaveStatus[p.id] ?? "idle";
          const err    = state.keyErrors[p.id] ?? "";
          return (
            <div key={p.id} className="setup-key-row">
              <div className="setup-key-header">
                <span className="setup-key-label">{p.label}</span>
                {p.keyUrl ? (
                  <a
                    className="setup-provider-link"
                    href={p.keyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    get key
                  </a>
                ) : null}
                {status === "ok"    && <span className="setup-key-ok">saved</span>}
                {status === "error" && <span className="setup-key-err">error</span>}
              </div>
              {p.id === "ollama" ? (
                <span className="setup-hint">Ollama runs locally — no API key needed.</span>
              ) : (
                <div className="setup-key-input-row">
                  <input
                    type="password"
                    className="setup-key-input"
                    value={key}
                    onChange={(e) =>
                      update("apiKeys", { ...state.apiKeys, [p.id]: e.target.value })
                    }
                    placeholder={p.envVar ? `${p.envVar}...` : "enter key"}
                    autoComplete="off"
                  />
                  <button
                    className="settings-btn-secondary"
                    disabled={status === "saving" || key.trim().length < 10}
                    onClick={() => void onSaveKey(p.id)}
                    style={{ fontSize: 16, padding: "4px 14px", whiteSpace: "nowrap" }}
                  >
                    {status === "saving" ? "saving…" : "save key"}
                  </button>
                </div>
              )}
              {err ? <div className="setup-key-err-msg">{err}</div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Step 3: Sandbox ──────────────────────────────────────────────────────────

const SANDBOX_KINDS: SandboxKind[] = ["local", "docker", "ssh", "modal", "daytona", "singularity"];

function StepSandbox({
  state,
  update,
  onTest,
}: {
  state: WizardState;
  update: <K extends keyof WizardState>(k: K, v: WizardState[K]) => void;
  onTest: () => Promise<void>;
}): React.JSX.Element {
  const updateSandbox = <K extends keyof SandboxConfig>(k: K, v: SandboxConfig[K]): void => {
    update("sandbox", { ...state.sandbox, [k]: v });
  };
  const updateDocker  = <K extends keyof DockerOpts>(k: K, v: string): void =>
    updateSandbox("docker",  { ...state.sandbox.docker,  [k]: v } as DockerOpts);
  const updateSsh     = <K extends keyof SshOpts>(k: K, v: string): void =>
    updateSandbox("ssh",     { ...state.sandbox.ssh,     [k]: v } as SshOpts);
  const updateModal   = <K extends keyof ModalOpts>(k: K, v: string): void =>
    updateSandbox("modal",   { ...state.sandbox.modal,   [k]: v } as ModalOpts);
  const updateDaytona = <K extends keyof DaytonaOpts>(k: K, v: string | "us" | "eu"): void =>
    updateSandbox("daytona", { ...state.sandbox.daytona, [k]: v } as DaytonaOpts);

  const { kind } = state.sandbox;
  const testStatus = state.sandboxTestStatus;

  return (
    <div className="setup-step">
      <h2 className="setup-step-title">SANDBOX</h2>
      <p className="setup-step-desc">
        Choose how cero runs shell commands. Start with <b>local</b> for simplicity.
      </p>

      <div className="setup-radio-group">
        {SANDBOX_KINDS.map((k) => (
          <label key={k} className={`setup-radio-item ${kind === k ? "setup-radio-active" : ""}`}>
            <input
              type="radio"
              name="sandbox-kind"
              value={k}
              checked={kind === k}
              onChange={() => updateSandbox("kind", k)}
            />
            <span>{k}</span>
          </label>
        ))}
      </div>

      {kind === "docker" && (
        <div className="setup-sub-form">
          <SetupField label="image"><input value={state.sandbox.docker.image} onChange={(e) => updateDocker("image", e.target.value)} placeholder="alpine:3" /></SetupField>
          <SetupField label="memory (MB)"><input type="number" value={state.sandbox.docker.memoryMb} onChange={(e) => updateDocker("memoryMb", e.target.value)} placeholder="512" min="64" /></SetupField>
          <SetupField label="CPU shares"><input type="number" step="0.1" value={state.sandbox.docker.cpuShares} onChange={(e) => updateDocker("cpuShares", e.target.value)} placeholder="0.5" /></SetupField>
        </div>
      )}

      {kind === "ssh" && (
        <div className="setup-sub-form">
          <SetupField label="host (required)"><input value={state.sandbox.ssh.host} onChange={(e) => updateSsh("host", e.target.value)} placeholder="192.168.1.100" /></SetupField>
          <SetupField label="user (required)"><input value={state.sandbox.ssh.user} onChange={(e) => updateSsh("user", e.target.value)} placeholder="ubuntu" /></SetupField>
          <SetupField label="port"><input type="number" value={state.sandbox.ssh.port} onChange={(e) => updateSsh("port", e.target.value)} placeholder="22" /></SetupField>
          <SetupField label="identity file (optional)"><input value={state.sandbox.ssh.identityFile} onChange={(e) => updateSsh("identityFile", e.target.value)} placeholder="~/.ssh/id_rsa" /></SetupField>
          <SetupField label="known_hosts file (optional)"><input value={state.sandbox.ssh.knownHostsFile} onChange={(e) => updateSsh("knownHostsFile", e.target.value)} placeholder="~/.ssh/known_hosts" /></SetupField>
        </div>
      )}

      {kind === "modal" && (
        <div className="setup-sub-form">
          <SetupField label="token ID"><input type="password" value={state.sandbox.modal.tokenId} onChange={(e) => updateModal("tokenId", e.target.value)} placeholder="token-..." /></SetupField>
          <SetupField label="token secret"><input type="password" value={state.sandbox.modal.tokenSecret} onChange={(e) => updateModal("tokenSecret", e.target.value)} /></SetupField>
          <SetupField label="image"><input value={state.sandbox.modal.image} onChange={(e) => updateModal("image", e.target.value)} placeholder="python:3.12-slim" /></SetupField>
          <SetupField label="timeout (seconds)"><input type="number" value={state.sandbox.modal.timeoutSeconds} onChange={(e) => updateModal("timeoutSeconds", e.target.value)} placeholder="300" /></SetupField>
        </div>
      )}

      {kind === "daytona" && (
        <div className="setup-sub-form">
          <SetupField label="API key"><input type="password" value={state.sandbox.daytona.apiKey} onChange={(e) => updateDaytona("apiKey", e.target.value)} /></SetupField>
          <SetupField label="region">
            <div className="setup-radio-group" style={{ flexDirection: "row", gap: 14 }}>
              {(["us", "eu"] as const).map((r) => (
                <label key={r} className={`setup-radio-item ${state.sandbox.daytona.region === r ? "setup-radio-active" : ""}`}>
                  <input type="radio" name="daytona-region" value={r} checked={state.sandbox.daytona.region === r} onChange={() => updateDaytona("region", r)} />
                  <span>{r}</span>
                </label>
              ))}
            </div>
          </SetupField>
          <SetupField label="workspace template (optional)"><input value={state.sandbox.daytona.workspaceTemplate} onChange={(e) => updateDaytona("workspaceTemplate", e.target.value)} placeholder="my-template" /></SetupField>
        </div>
      )}

      {kind === "singularity" && (
        <div className="setup-sub-form">
          <SetupField label="image path (required)">
            <input
              value={state.sandbox.singularity.imagePath}
              onChange={(e) =>
                updateSandbox("singularity", { ...state.sandbox.singularity, imagePath: e.target.value })
              }
              placeholder="/path/to/image.sif"
            />
          </SetupField>
          <SetupField label="bind mounts (one per line)">
            <textarea
              className="setup-textarea"
              value={state.sandbox.singularity.bindMounts.join("\n")}
              onChange={(e) =>
                updateSandbox("singularity", {
                  ...state.sandbox.singularity,
                  bindMounts: e.target.value.split("\n").filter(Boolean),
                })
              }
              placeholder="/host/path:/container/path"
              rows={3}
            />
          </SetupField>
        </div>
      )}

      <div className="setup-test-row">
        <button
          className="settings-btn-secondary"
          onClick={() => void onTest()}
          disabled={testStatus === "testing"}
        >
          {testStatus === "testing" ? "testing…" : "health check"}
        </button>
        {testStatus === "ok" && <span className="setup-key-ok">sandbox reachable</span>}
        {testStatus === "error" && (
          <span className="setup-key-err">{state.sandboxTestError || "unreachable"}</span>
        )}
      </div>
    </div>
  );
}

// ─── Step 4: Model ────────────────────────────────────────────────────────────

function StepModel({
  state,
  update,
}: {
  state: WizardState;
  update: <K extends keyof WizardState>(k: K, v: WizardState[K]) => void;
}): React.JSX.Element {
  const preferredProvider = state.preferredProvider || state.selectedProviders[0] || "";
  const modelList = PROVIDER_MODELS[preferredProvider] ?? [];

  return (
    <div className="setup-step">
      <h2 className="setup-step-title">DEFAULT MODEL</h2>
      <p className="setup-step-desc">Pick your default provider and model for new sessions.</p>

      <div className="settings-section-body" style={{ gap: 14 }}>
        <SetupField label="preferred provider">
          <select
            value={preferredProvider}
            onChange={(e) => {
              update("preferredProvider", e.target.value);
              const models = PROVIDER_MODELS[e.target.value] ?? [];
              update("model", models[0] ?? "");
            }}
          >
            {state.selectedProviders.map((pid) => {
              const info = PROVIDERS.find((p) => p.id === pid);
              return <option key={pid} value={pid}>{info?.label ?? pid}</option>;
            })}
          </select>
        </SetupField>

        <SetupField label="model">
          <input
            list="setup-model-list"
            value={state.model || modelList[0] || ""}
            onChange={(e) => update("model", e.target.value)}
            placeholder={modelList[0] ?? "model name"}
          />
          <datalist id="setup-model-list">
            {modelList.map((m) => <option key={m} value={m} />)}
          </datalist>
        </SetupField>

        <SetupField label={`temperature: ${state.temperature.toFixed(2)}`}>
          <input
            type="range"
            min="0" max="1" step="0.05"
            value={state.temperature}
            onChange={(e) => update("temperature", parseFloat(e.target.value))}
            className="setup-slider"
          />
        </SetupField>

        <SetupField label="max tokens">
          <input
            type="number"
            value={state.maxTokens}
            onChange={(e) => update("maxTokens", parseInt(e.target.value, 10) || 4096)}
            min="256" max="200000" step="256"
          />
        </SetupField>
      </div>
    </div>
  );
}

// ─── Step 5: Gateway (optional) ───────────────────────────────────────────────

function StepGateway({
  state,
  update,
}: {
  state: WizardState;
  update: <K extends keyof WizardState>(k: K, v: WizardState[K]) => void;
}): React.JSX.Element {
  const gw = state.gateway;
  const updateGw = <K extends keyof GatewayConfig>(k: K, v: GatewayConfig[K]): void =>
    update("gateway", { ...gw, [k]: v });

  return (
    <div className="setup-step">
      <h2 className="setup-step-title">GATEWAY (OPTIONAL)</h2>
      <p className="setup-step-desc">
        Connect cero to messaging platforms. You can skip this and configure later via the Gateway view.
      </p>

      <div className="setup-toggle-row">
        <label className="setup-toggle-label">
          <input
            type="checkbox"
            checked={gw.enabled}
            onChange={(e) => updateGw("enabled", e.target.checked)}
          />
          <span>Enable gateway</span>
        </label>
      </div>

      {gw.enabled && (
        <div className="setup-sub-form">
          <h3 className="dv-section-h">TELEGRAM</h3>
          <SetupField label="bot token">
            <input type="password" value={gw.telegramToken} onChange={(e) => updateGw("telegramToken", e.target.value)} placeholder="123456:ABC-..." />
          </SetupField>

          <h3 className="dv-section-h">DISCORD</h3>
          <SetupField label="bot token">
            <input type="password" value={gw.discordToken} onChange={(e) => updateGw("discordToken", e.target.value)} placeholder="MTc..." />
          </SetupField>

          <h3 className="dv-section-h">WEBSOCKET</h3>
          <SetupField label="port">
            <input type="number" value={gw.wsPort} onChange={(e) => updateGw("wsPort", e.target.value)} placeholder="8080" />
          </SetupField>
          <SetupField label="auth secret">
            <input type="password" value={gw.wsSecret} onChange={(e) => updateGw("wsSecret", e.target.value)} />
          </SetupField>

          <h3 className="dv-section-h">HTTP</h3>
          <SetupField label="port">
            <input type="number" value={gw.httpPort} onChange={(e) => updateGw("httpPort", e.target.value)} placeholder="8888" />
          </SetupField>
          <SetupField label="bearer token">
            <input type="password" value={gw.httpBearer} onChange={(e) => updateGw("httpBearer", e.target.value)} />
          </SetupField>
        </div>
      )}
    </div>
  );
}

// ─── Step 6: Review ───────────────────────────────────────────────────────────

function StepReview({
  state,
  onApply: _onApply,
}: {
  state: WizardState;
  onApply: () => Promise<void>;
}): React.JSX.Element {
  const provider = state.preferredProvider || state.selectedProviders[0] || "—";
  const providerLabel = PROVIDERS.find((p) => p.id === provider)?.label ?? provider;

  return (
    <div className="setup-step">
      <h2 className="setup-step-title">REVIEW & APPLY</h2>
      <p className="setup-step-desc">Confirm your configuration before applying.</p>

      <div className="setup-review-grid">
        <ReviewRow label="providers" value={state.selectedProviders.map((id) => PROVIDERS.find((p) => p.id === id)?.label ?? id).join(", ")} />
        <ReviewRow label="active provider" value={providerLabel} />
        <ReviewRow label="model" value={state.model || `${provider} default`} />
        <ReviewRow label="sandbox" value={state.sandbox.kind} />
        <ReviewRow label="temperature" value={String(state.temperature)} />
        <ReviewRow label="max tokens" value={String(state.maxTokens)} />
        <ReviewRow label="gateway" value={state.gateway.enabled ? "enabled" : "disabled"} />
      </div>

      {state.reviewChecks.length > 0 && (
        <div className="setup-checks">
          {state.reviewChecks.map((check, i) => (
            <div key={i} className={`setup-check-row ${check.ok ? "setup-check-ok" : "setup-check-err"}`}>
              <span>{check.ok ? "✓" : "✗"}</span>
              <span>{check.label}</span>
              {check.hint ? <span className="setup-check-hint">{check.hint}</span> : null}
            </div>
          ))}
        </div>
      )}

      {state.reviewStatus === "error" && (
        <div className="settings-error" style={{ marginTop: 12 }}>
          Some checks failed. Review hints above and retry, or continue to Settings to adjust.
        </div>
      )}
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="setup-review-row">
      <span className="setup-review-label">{label}</span>
      <span className="setup-review-value">{value}</span>
    </div>
  );
}

// ─── utility sub-components ───────────────────────────────────────────────────

function SetupField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className="settings-field">
      <span className="settings-field-label">{label}</span>
      {children}
    </label>
  );
}

// ─── config builders ──────────────────────────────────────────────────────────

function buildSandboxOpts(sb: SandboxConfig): Record<string, unknown> {
  switch (sb.kind) {
    case "docker":      return { image: sb.docker.image, memoryMb: parseInt(sb.docker.memoryMb, 10), cpuShares: parseFloat(sb.docker.cpuShares) };
    case "ssh":         return { host: sb.ssh.host, user: sb.ssh.user, port: parseInt(sb.ssh.port, 10), identityFile: sb.ssh.identityFile || null };
    case "modal":       return { tokenId: sb.modal.tokenId, tokenSecret: sb.modal.tokenSecret, image: sb.modal.image, timeoutSeconds: parseInt(sb.modal.timeoutSeconds, 10) };
    case "daytona":     return { apiKey: sb.daytona.apiKey, region: sb.daytona.region, workspaceTemplate: sb.daytona.workspaceTemplate || null };
    case "singularity": return { imagePath: sb.singularity.imagePath, bindMounts: sb.singularity.bindMounts };
    default:            return {};
  }
}

function buildEnvFromState(state: WizardState): Record<string, string> {
  const env: Record<string, string> = {};
  for (const pid of state.selectedProviders) {
    const key = state.apiKeys[pid] ?? "";
    if (!key) continue;
    const info = PROVIDERS.find((p) => p.id === pid);
    if (info?.envVar) env[info.envVar] = key;
    if (pid === "gemini" && key) env["GOOGLE_API_KEY"] = key;
  }
  return env;
}

function buildCeroConfig(state: WizardState): Record<string, unknown> {
  const provider = state.preferredProvider || state.selectedProviders[0] || "openai";
  const config: Record<string, unknown> = {
    provider,
    model: state.model || null,
    sandbox: state.sandbox.kind,
    temperature: state.temperature,
    maxTokens: state.maxTokens,
  };
  if (state.sandbox.kind !== "local") {
    config.sandboxOpts = buildSandboxOpts(state.sandbox);
  }
  if (state.gateway.enabled) {
    config.gateway = {
      telegram: state.gateway.telegramToken ? { botToken: state.gateway.telegramToken } : null,
      discord:  state.gateway.discordToken  ? { botToken: state.gateway.discordToken  } : null,
      websocket: { port: parseInt(state.gateway.wsPort, 10), authSecret: state.gateway.wsSecret || null },
      http:     { port: parseInt(state.gateway.httpPort, 10), bearerToken: state.gateway.httpBearer || null },
    };
  }
  return config;
}
