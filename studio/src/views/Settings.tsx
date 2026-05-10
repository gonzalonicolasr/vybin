// Settings modal — replaces the need to edit ~/.env or pass CLI flags.
// On save, the settings are persisted to Tauri store and the parent App
// triggers a sidecar restart with the new config.

import { useEffect, useState } from "react";
import type { CeroSettings, ProviderName, SandboxName, LearningMode, ThemeName } from "../hooks/useSettings";
import { isMuted, setMuted } from "../lib/mascot-sounds";

// ─── voice mode types ──────────────────────────────────────────────────────────

export type VoiceTtsProvider = "edge" | "openai" | "elevenlabs" | "gemini" | "mistral";

export interface VoiceModeSettings {
  enabled: boolean;
  ttsProvider: VoiceTtsProvider;
  voice: string;
}

export const DEFAULT_VOICE_MODE: VoiceModeSettings = {
  enabled: false,
  ttsProvider: "edge",
  voice: "en-US-AriaNeural",
};

const TTS_VOICES: Record<VoiceTtsProvider, string[]> = {
  edge:       ["en-US-AriaNeural", "en-US-JennyNeural", "en-US-GuyNeural", "en-GB-SoniaNeural", "es-ES-AlvaroNeural"],
  openai:     ["alloy", "echo", "fable", "onyx", "nova", "shimmer"],
  elevenlabs: ["Rachel", "Domi", "Bella", "Antoni", "Elli", "Josh", "Arnold", "Adam", "Sam"],
  gemini:     ["Aoede", "Charon", "Fenrir", "Kore", "Puck"],
  mistral:    ["default"],
};

export interface SettingsProps {
  readonly initial: CeroSettings;
  readonly initialVoice?: VoiceModeSettings;
  readonly onSave: (next: CeroSettings, voice: VoiceModeSettings) => Promise<void>;
  readonly onClose: () => void;
}

const PROVIDERS: ProviderName[] = [
  "anthropic",
  "openai",
  "bedrock",
  "gemini",
  "groq",
  "mistral",
  "deepseek",
  "openrouter",
  "together",
  "ollama",
  "llamacpp",
];
const SANDBOXES: SandboxName[] = ["local", "docker"];
const LEARNING_MODES: LearningMode[] = ["auto", "off"];
const THEMES: ThemeName[] = ["violet", "lima", "amber"];

const PROVIDER_MODELS: Record<ProviderName, ReadonlyArray<string>> = {
  anthropic:  ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5"],
  openai:     ["gpt-4o", "gpt-4o-mini", "glm-5.1", "kimi-k2.6", "qwen3.6-plus", "mimo-v2.5-pro"],
  bedrock:    ["anthropic.claude-sonnet-4-6-v1", "anthropic.claude-opus-4-1"],
  gemini:     ["gemini-2.0-flash", "gemini-2.5-pro"],
  groq:       ["llama-3.3-70b-versatile", "mixtral-8x7b-32768"],
  mistral:    ["mistral-large-latest", "mistral-small-latest"],
  deepseek:   ["deepseek-chat", "deepseek-coder"],
  openrouter: ["openrouter/auto", "anthropic/claude-3.5-sonnet", "openai/gpt-4o"],
  together:   ["meta-llama/Llama-3.3-70B-Instruct-Turbo"],
  ollama:     ["llama3.2", "llama3.1", "qwen2.5-coder"],
  llamacpp:   ["mate-v2", "mate-v1", "local-model"],
};

// Providers that talk an OpenAI-compatible HTTP API on a configurable
// baseUrl. They never require an API key and benefit from a sensible
// localhost default when the field is left empty.
const OPENAI_COMPAT_DEFAULTS: Partial<Record<ProviderName, string>> = {
  openai:   "https://opencode.ai/zen/go/v1 (or empty for api.openai.com)",
  ollama:   "http://127.0.0.1:11434/v1",
  llamacpp: "http://127.0.0.1:8080/v1",
};

export function Settings({ initial, initialVoice, onSave, onClose }: SettingsProps): React.JSX.Element {
  const [draft, setDraft] = useState<CeroSettings>(initial);
  const [voiceDraft, setVoiceDraft] = useState<VoiceModeSettings>(initialVoice ?? DEFAULT_VOICE_MODE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Esc closes modal
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return (): void => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const update = <K extends keyof CeroSettings>(key: K, value: CeroSettings[K]): void => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async (): Promise<void> => {
    setError(null);
    // Validate the active provider has a usable key
    if (draft.provider === "anthropic" && draft.anthropicApiKey.trim() === "") {
      setError("Anthropic provider requires an API key");
      return;
    }
    if (
      draft.provider === "openai" &&
      draft.openaiApiKey.trim() === ""
    ) {
      setError("OpenAI provider requires an API key");
      return;
    }
    if (draft.provider === "gemini" && draft.geminiApiKey.trim() === "") {
      setError("Gemini provider requires an API key");
      return;
    }
    if (
      draft.provider === "bedrock" &&
      (draft.awsAccessKeyId.trim() === "" || draft.awsSecretAccessKey.trim() === "")
    ) {
      setError("Bedrock provider requires AWS credentials");
      return;
    }
    setSaving(true);
    try {
      await onSave(draft, voiceDraft);
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
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="settings-header">
          <h2>SETTINGS</h2>
          <button className="settings-close" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>

        <div className="settings-body">
          <Section title="PROVIDER">
            <Field label="provider">
              <select
                value={draft.provider}
                onChange={(e) => {
                  const next = e.target.value as ProviderName;
                  setDraft((prev) => {
                    const models = PROVIDER_MODELS[next];
                    const nextModel = models.includes(prev.model) ? prev.model : (models[0] ?? prev.model);
                    // Seed a sensible localhost baseUrl when switching to a
                    // local OpenAI-compatible provider with an empty field —
                    // never overwrite a value the user already typed.
                    const localDefault = next === "llamacpp"
                      ? "http://127.0.0.1:8080/v1"
                      : next === "ollama"
                        ? "http://127.0.0.1:11434/v1"
                        : "";
                    const nextBaseUrl = prev.baseUrl.trim() === "" && localDefault !== ""
                      ? localDefault
                      : prev.baseUrl;
                    return { ...prev, provider: next, model: nextModel, baseUrl: nextBaseUrl };
                  });
                }}
              >
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="model">
              <input
                list="model-list"
                value={draft.model}
                onChange={(e) => update("model", e.target.value)}
              />
              <datalist id="model-list">
                {PROVIDER_MODELS[draft.provider].map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </Field>
            {OPENAI_COMPAT_DEFAULTS[draft.provider] !== undefined ? (
              <Field label="base URL (OpenAI-compatible endpoint)">
                <input
                  type="url"
                  value={draft.baseUrl}
                  onChange={(e) => update("baseUrl", e.target.value)}
                  placeholder={OPENAI_COMPAT_DEFAULTS[draft.provider]}
                />
              </Field>
            ) : null}
          </Section>

          <Section title={`API KEYS  ←  active: ${draft.provider}`}>
            <Field
              label="anthropic"
              required={draft.provider === "anthropic"}
            >
              <input
                type="password"
                value={draft.anthropicApiKey}
                onChange={(e) => update("anthropicApiKey", e.target.value)}
                placeholder="sk-ant-..."
                autoFocus={draft.provider === "anthropic"}
              />
            </Field>
            <Field
              label="openai / openai-compatible"
              required={draft.provider === "openai"}
            >
              <input
                type="password"
                value={draft.openaiApiKey}
                onChange={(e) => update("openaiApiKey", e.target.value)}
                placeholder="sk-..."
                autoFocus={draft.provider === "openai"}
              />
            </Field>
            <Field
              label="gemini"
              required={draft.provider === "gemini"}
            >
              <input
                type="password"
                value={draft.geminiApiKey}
                onChange={(e) => update("geminiApiKey", e.target.value)}
                placeholder="AIzaSy..."
                autoFocus={draft.provider === "gemini"}
              />
            </Field>
            <Field
              label="aws access key id"
              required={draft.provider === "bedrock"}
            >
              <input
                type="password"
                value={draft.awsAccessKeyId}
                onChange={(e) => update("awsAccessKeyId", e.target.value)}
                placeholder="AKIA..."
              />
            </Field>
            <Field
              label="aws secret access key"
              required={draft.provider === "bedrock"}
            >
              <input
                type="password"
                value={draft.awsSecretAccessKey}
                onChange={(e) => update("awsSecretAccessKey", e.target.value)}
              />
            </Field>
            <Field label="aws region">
              <input
                value={draft.awsRegion}
                onChange={(e) => update("awsRegion", e.target.value)}
                placeholder="us-east-1"
              />
            </Field>
          </Section>

          <Section title="RUNTIME">
            <Field label="sandbox (run_shell isolation)">
              <select
                value={draft.sandbox}
                onChange={(e) => update("sandbox", e.target.value as SandboxName)}
              >
                {SANDBOXES.map((s) => (
                  <option key={s} value={s}>
                    {s}{s === "docker" ? "  (recommended)" : "  (no isolation)"}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="learning mode (skills / lessons / user-model)">
              <select
                value={draft.learningMode}
                onChange={(e) => update("learningMode", e.target.value as LearningMode)}
              >
                {LEARNING_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="session goal (optional — seeds cross-session retrieval)">
              <input
                value={draft.goal}
                onChange={(e) => update("goal", e.target.value)}
                placeholder="e.g. refactor auth module"
              />
            </Field>
            <Field label="theme">
              <select
                value={draft.theme}
                onChange={(e) => update("theme", e.target.value as ThemeName)}
              >
                {THEMES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </Field>
          </Section>

          <Section title="MASCOT">
            <Field label="mascot sounds (8-bit chirps on cheer / error / level-up)">
              <select
                defaultValue={isMuted() ? "off" : "on"}
                onChange={(e) => setMuted(e.target.value === "off")}
              >
                <option value="off">off (default)</option>
                <option value="on">on</option>
              </select>
            </Field>
          </Section>

          <Section title="VOICE MODE">
            <Field label="auto-respond with voice in supported platforms">
              <select
                value={voiceDraft.enabled ? "on" : "off"}
                onChange={(e) => setVoiceDraft((v) => ({ ...v, enabled: e.target.value === "on" }))}
              >
                <option value="off">off</option>
                <option value="on">on</option>
              </select>
            </Field>
            <Field label="TTS provider">
              <select
                value={voiceDraft.ttsProvider}
                onChange={(e) => {
                  const next = e.target.value as VoiceTtsProvider;
                  const voices = TTS_VOICES[next];
                  setVoiceDraft((v) => ({
                    ...v,
                    ttsProvider: next,
                    voice: voices[0] ?? v.voice,
                  }));
                }}
              >
                {(["edge", "openai", "elevenlabs", "gemini", "mistral"] as VoiceTtsProvider[]).map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </Field>
            <Field label="voice">
              <select
                value={voiceDraft.voice}
                onChange={(e) => setVoiceDraft((v) => ({ ...v, voice: e.target.value }))}
              >
                {(TTS_VOICES[voiceDraft.ttsProvider] ?? []).map((voice) => (
                  <option key={voice} value={voice}>{voice}</option>
                ))}
              </select>
            </Field>
          </Section>

        </div>

        {error ? <div className="settings-error settings-error-sticky">{error}</div> : null}

        <div className="settings-footer">
          <button className="settings-btn-secondary" onClick={onClose} disabled={saving}>
            cancel
          </button>
          <button className="settings-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "saving…" : "save & restart session"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="settings-section">
      <h3>{title}</h3>
      <div className="settings-section-body">{children}</div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  readonly label: string;
  readonly required?: boolean;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className={`settings-field ${required ? "settings-field-required" : ""}`}>
      <span className="settings-field-label">
        {label}
        {required ? <span className="settings-required-badge"> · ACTIVE</span> : null}
      </span>
      {children}
    </label>
  );
}
