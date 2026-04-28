// Gateway config hook backed by tauri-plugin-store.
// Mirrors useSettings.ts pattern — each gateway platform gets its own config
// slice. Persisted to <appdata>/gateway.json.

import { Store, load } from "@tauri-apps/plugin-store";
import { useCallback, useEffect, useState } from "react";

const STORE_PATH = "gateway.json";

export interface TelegramConfig {
  botToken: string;
  adminUsername: string;
}

export interface DiscordConfig {
  botToken: string;
  allowedUserIds: string; // comma-separated
}

export interface WebSocketConfig {
  port: string; // stored as string for input binding
  authSecret: string;
}

export interface HttpConfig {
  port: string;
  host: string;
  bearerToken: string;
}

export interface GatewayConfigs {
  telegram: TelegramConfig;
  discord: DiscordConfig;
  websocket: WebSocketConfig;
  http: HttpConfig;
}

export const DEFAULT_GATEWAY_CONFIGS: GatewayConfigs = {
  telegram: { botToken: "", adminUsername: "" },
  discord: { botToken: "", allowedUserIds: "" },
  websocket: { port: "8080", authSecret: "" },
  http: { port: "8888", host: "127.0.0.1", bearerToken: "" },
};

let cachedStore: Store | null = null;
async function getStore(): Promise<Store> {
  if (cachedStore) return cachedStore;
  cachedStore = await load(STORE_PATH);
  return cachedStore;
}

async function readAll(): Promise<GatewayConfigs> {
  const store = await getStore();
  const out = structuredClone(DEFAULT_GATEWAY_CONFIGS);
  const stored = await store.get<GatewayConfigs>("gatewayConfigs");
  if (stored && typeof stored === "object") {
    // Merge stored values with defaults to handle schema additions
    if (stored.telegram) out.telegram = { ...out.telegram, ...stored.telegram };
    if (stored.discord)  out.discord  = { ...out.discord,  ...stored.discord  };
    if (stored.websocket) out.websocket = { ...out.websocket, ...stored.websocket };
    if (stored.http)     out.http     = { ...out.http,     ...stored.http     };
  }
  return out;
}

async function writeAll(configs: GatewayConfigs): Promise<void> {
  const store = await getStore();
  await store.set("gatewayConfigs", configs);
  await store.save();
}

export interface UseGatewayConfigResult {
  readonly configs: GatewayConfigs;
  readonly loading: boolean;
  readonly save: (next: GatewayConfigs) => Promise<void>;
}

export function useGatewayConfig(): UseGatewayConfigResult {
  const [configs, setConfigs] = useState<GatewayConfigs>(DEFAULT_GATEWAY_CONFIGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        const c = await readAll();
        if (!cancelled) setConfigs(c);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("gateway config load failed", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return (): void => { cancelled = true; };
  }, []);

  const save = useCallback(async (next: GatewayConfigs): Promise<void> => {
    await writeAll(next);
    setConfigs(next);
  }, []);

  return { configs, loading, save };
}
