// Settings hook backed by tauri-plugin-store.
// Persists to <appdata>/settings.json on disk.
// Used by the Settings modal AND by useCero to seed StartSessionConfig.

import { Store, load } from "@tauri-apps/plugin-store";
import { useCallback, useEffect, useRef, useState } from "react";

const STORE_PATH = "settings.json";

export type ProviderName =
  | "anthropic"
  | "openai"
  | "bedrock"
  | "gemini"
  | "groq"
  | "mistral"
  | "deepseek"
  | "openrouter"
  | "together"
  | "ollama";
export type SandboxName = "local" | "docker";
export type LearningMode = "auto" | "off";
export type ThemeName = "violet" | "lima" | "amber";

export interface CeroSettings {
  // Provider config
  provider: ProviderName;
  model: string;
  baseUrl: string;

  // API keys (per-provider; only the active provider's key is required)
  anthropicApiKey: string;
  openaiApiKey: string;
  geminiApiKey: string;
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  awsRegion: string;

  // Runtime config
  sandbox: SandboxName;
  learningMode: LearningMode;
  goal: string;
  // UI
  theme: ThemeName;

  // Onboarding flag — "true" once the setup wizard is completed
  setupCompleted: string;

  // Voice mode — stored as JSON-serialised VoiceModeSettings string
  voiceMode: string;
}

export const DEFAULT_SETTINGS: CeroSettings = {
  provider: "openai",
  model: "glm-5.1",
  baseUrl: "https://opencode.ai/zen/go/v1",
  anthropicApiKey: "",
  openaiApiKey: "",
  geminiApiKey: "",
  awsAccessKeyId: "",
  awsSecretAccessKey: "",
  awsRegion: "us-east-1",
  sandbox: "local",
  learningMode: "auto",
  goal: "",
  theme: "violet",
  setupCompleted: "",
  voiceMode: "",
};

let cachedStore: Store | null = null;
async function getStore(): Promise<Store> {
  if (cachedStore) return cachedStore;
  cachedStore = await load(STORE_PATH);
  return cachedStore;
}

async function readAll(): Promise<CeroSettings> {
  const store = await getStore();
  const out = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof CeroSettings>) {
    const v = await store.get<unknown>(key);
    if (v !== undefined && v !== null) {
      // Strings only — all our settings are string|enum strings
      (out as Record<string, unknown>)[key] = String(v);
    }
  }
  return out;
}

async function writeAll(settings: CeroSettings): Promise<void> {
  const store = await getStore();
  for (const [k, v] of Object.entries(settings)) {
    await store.set(k, v);
  }
  await store.save();
}

export interface UseSettingsResult {
  readonly settings: CeroSettings;
  readonly loading: boolean;
  readonly save: (next: CeroSettings) => Promise<void>;
  readonly reload: () => Promise<void>;
}

export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<CeroSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        const s = await readAll();
        if (!cancelled) setSettings(s);
      } catch (err) {
        // store load failed — keep defaults
        // eslint-disable-next-line no-console
        console.warn("settings load failed", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, []);

  // Serialize concurrent saves: each call chains onto the previous promise so
  // overlapping writes (e.g. model change + settings modal save) never interleave.
  const savingRef = useRef<Promise<void>>(Promise.resolve());

  const save = useCallback(async (next: CeroSettings): Promise<void> => {
    savingRef.current = savingRef.current.then(() => writeAll(next));
    await savingRef.current;
    setSettings(next);
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const s = await readAll();
      setSettings(s);
    } finally {
      setLoading(false);
    }
  }, []);

  return { settings, loading, save, reload };
}
