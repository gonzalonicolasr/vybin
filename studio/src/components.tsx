import React, { useEffect, useState, type RefObject } from "react";
import { Markdown } from "./Markdown";
import { PROVIDER_LIST } from "./lib/providers";

export type ViewName = "chat" | "skills" | "lessons" | "user-model" | "mcp" | "gateway" | "scheduler" | "stats" | "admin" | "data" | "setup";

// ─────────────── shared types ───────────────

export interface ToolEvent {
  readonly id: string;
  readonly name: string;
  readonly ms?: number;
  readonly args?: string;
  readonly result?: string;
}

export interface Turn {
  readonly id: string;
  readonly kind: "user" | "cero" | "error";
  readonly text: string;
  readonly tools?: ReadonlyArray<ToolEvent>;
  readonly skills?: ReadonlyArray<string>;
  readonly extraText?: string;
}

export interface SnapshotData {
  readonly stats: {
    readonly skills: number;
    readonly lessons: number;
    readonly sessions: number;
    readonly userModelVersion: number;
    readonly avgSuccessRate: number | null;
  };
  readonly topSkills: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly successRate: number | null;
    readonly appliedCount: number;
  }>;
  readonly user: {
    readonly expertiseAreas: ReadonlyArray<string>;
    readonly currentProjects: ReadonlyArray<string>;
  };
}

// ─────────────── header ───────────────

const ASCII_LOGO = `██    ██ ██    ██ ███████  ██ ███   ██
██    ██  ██  ██  ██    ██ ██ ████  ██
██    ██   ████   ███████  ██ ██ ██ ██
 ██  ██    ████   ██    ██ ██ ██  ████
  ████     ████   ███████  ██ ██   ███`;

export interface HeaderProps {
  readonly version: string;
  readonly provider: string;
  readonly model: string;
  readonly sandbox: string;
  readonly online: boolean;
  readonly baseUrl: string | undefined;
  readonly apiKey: string | undefined;
  readonly onSettingsClick?: () => void;
  readonly onModelChange?: (modelId: string) => void;
  readonly onProviderChange?: (providerId: string) => void;
}

export function Header({
  version,
  provider,
  model,
  sandbox,
  online,
  baseUrl,
  apiKey,
  onSettingsClick,
  onModelChange,
  onProviderChange,
}: HeaderProps): React.JSX.Element {
  return (
    <div className="header" data-tauri-drag-region>
      {/* Pixel-art sunset banner — purely decorative, behind content */}
      <svg
        className="header-art"
        viewBox="0 0 1200 120"
        preserveAspectRatio="xMidYMid slice"
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        <defs>
          {/* Sky: deep purple top → amber horizon */}
          <linearGradient id="hdr-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#1a0a2a" />
            <stop offset="25%"  stopColor="#2a1838" />
            <stop offset="50%"  stopColor="#5a1f5e" />
            <stop offset="72%"  stopColor="#a83468" />
            <stop offset="88%"  stopColor="#e8694a" />
            <stop offset="100%" stopColor="#f5b048" />
          </linearGradient>
          {/* Sun: cream-white core → orange edge */}
          <linearGradient id="hdr-sun" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#fff5c0" />
            <stop offset="45%"  stopColor="#ffd070" />
            <stop offset="100%" stopColor="#ff8a50" />
          </linearGradient>
        </defs>

        {/* Sky fill */}
        <rect x="0" y="0" width="1200" height="120" fill="url(#hdr-sky)" />

        {/* Stars — upper 40px only */}
        <g fill="#ffe8b0">
          <rect x="90"  y="8"  width="2" height="2" opacity="0.9" />
          <rect x="198" y="16" width="2" height="2" opacity="0.7" />
          <rect x="320" y="6"  width="2" height="2" opacity="0.8" />
          <rect x="468" y="20" width="2" height="2" opacity="0.6" />
          <rect x="560" y="10" width="2" height="2" opacity="0.75" />
          <rect x="664" y="22" width="2" height="2" opacity="0.65" />
          <rect x="780" y="8"  width="2" height="2" opacity="0.85" />
          <rect x="900" y="18" width="2" height="2" opacity="0.7" />
          <rect x="1020" y="6" width="2" height="2" opacity="0.8" />
          <rect x="1120" y="24" width="2" height="2" opacity="0.6" />
          <rect x="152" y="30" width="2" height="2" opacity="0.5" />
          <rect x="840" y="34" width="2" height="2" opacity="0.55" />
        </g>

        {/* Sun: r=20, sitting on horizon at y=88, half-occluded */}
        <circle cx="600" cy="88" r="20" fill="url(#hdr-sun)" />
        {/* 80s band cuts across sun */}
        <rect x="581" y="70" width="38" height="3" fill="#1a0a2a" opacity="0.55" />
        <rect x="580" y="78" width="40" height="3" fill="#1a0a2a" opacity="0.48" />
        <rect x="579" y="86" width="42" height="3" fill="#1a0a2a" opacity="0.42" />

        {/* Mountain silhouettes on horizon */}
        <polygon
          points="0,88 40,76 72,82 110,70 148,80 190,74 230,82 280,78 340,82 400,88"
          fill="#0a0510"
        />
        <polygon
          points="800,88 860,76 910,82 960,72 1010,80 1060,76 1110,82 1160,78 1200,82 1200,88"
          fill="#0a0510"
        />

        {/* Horizon glow */}
        <rect x="0" y="87" width="1200" height="2" fill="#ffd089" opacity="0.7" />

        {/* Water band */}
        <rect x="0" y="88" width="1200" height="32" fill="#1a0a2a" opacity="0.88" />

        {/* Sun reflection shimmer */}
        <g fill="#ffd089">
          <rect x="594" y="91"  width="12" height="3" opacity="0.80" />
          <rect x="590" y="97"  width="20" height="2" opacity="0.65" />
          <rect x="592" y="103" width="16" height="2" opacity="0.50" />
          <rect x="588" y="110" width="24" height="2" opacity="0.35" />
          <rect x="590" y="117" width="20" height="2" opacity="0.20" />
        </g>

        {/* LEFT framing palm */}
        {/* Trunk: curves right (inward) as it rises */}
        <g fill="#0a0510">
          <rect x="52"  y="114" width="6" height="6" />
          <rect x="54"  y="100" width="6" height="14" />
          <rect x="56"  y="84"  width="6" height="16" />
          <rect x="58"  y="68"  width="6" height="16" />
          <rect x="60"  y="52"  width="6" height="16" />
          <rect x="62"  y="38"  width="6" height="14" />
          {/* Crown */}
          <rect x="60"  y="28"  width="10" height="12" />
          <rect x="58"  y="18"  width="14" height="12" />

          {/* Frond 1: long arch RIGHT toward sun (longest) */}
          <rect x="72"  y="26"  width="22" height="4" />
          <rect x="92"  y="22"  width="24" height="4" />
          <rect x="114" y="17"  width="24" height="4" />
          <rect x="136" y="12"  width="22" height="4" />
          <rect x="156" y="8"   width="18" height="4" />
          {/* Leaflets */}
          <rect x="100" y="26"  width="4" height="8" />
          <rect x="122" y="21"  width="4" height="8" />
          <rect x="144" y="16"  width="4" height="8" />

          {/* Frond 2: RIGHT drooping */}
          <rect x="72"  y="38"  width="22" height="4" />
          <rect x="92"  y="44"  width="22" height="4" />
          <rect x="112" y="50"  width="20" height="4" />
          <rect x="130" y="58"  width="16" height="4" />
          {/* Leaflets */}
          <rect x="100" y="48"  width="4" height="8" />
          <rect x="120" y="56"  width="4" height="8" />

          {/* Frond 3: straight UP */}
          <rect x="58"  y="4"   width="12" height="16" />
          <rect x="54"  y="0"   width="16" height="6" />
          {/* Leaflets */}
          <rect x="52"  y="8"   width="4" height="10" />
          <rect x="72"  y="6"   width="4" height="10" />

          {/* Frond 4: UP-LEFT (away from center) */}
          <rect x="38"  y="26"  width="24" height="4" />
          <rect x="18"  y="20"  width="24" height="4" />
          <rect x="0"   y="14"  width="22" height="4" />
          {/* Leaflets */}
          <rect x="44"  y="30"  width="4" height="8" />
          <rect x="24"  y="24"  width="4" height="8" />

          {/* Frond 5: LEFT drooping */}
          <rect x="38"  y="38"  width="24" height="4" />
          <rect x="16"  y="44"  width="26" height="4" />
          <rect x="0"   y="52"  width="20" height="4" />
          {/* Leaflets */}
          <rect x="42"  y="42"  width="4" height="8" />
          <rect x="22"  y="50"  width="4" height="8" />

          {/* Frond 6: sweeping LOW-RIGHT (long arch down toward water) */}
          <rect x="70"  y="50"  width="26" height="4" />
          <rect x="94"  y="56"  width="28" height="4" />
          <rect x="120" y="64"  width="28" height="4" />
          <rect x="146" y="72"  width="24" height="4" />
          <rect x="168" y="80"  width="18" height="4" />
          {/* Drooping leaflets */}
          <rect x="108" y="60"  width="4" height="8" />
          <rect x="134" y="70"  width="4" height="8" />
          <rect x="158" y="78"  width="4" height="8" />

          {/* Frond 7: UP-RIGHT diagonal */}
          <rect x="72"  y="16"  width="20" height="4" />
          <rect x="90"  y="10"  width="20" height="4" />
          <rect x="108" y="4"   width="16" height="4" />
          {/* Leaflets */}
          <rect x="98"  y="14"  width="4" height="7" />

          {/* Frond 8: DOWN-LEFT */}
          <rect x="38"  y="52"  width="24" height="4" />
          <rect x="16"  y="62"  width="26" height="4" />
          <rect x="0"   y="72"  width="20" height="4" />
        </g>

        {/* RIGHT framing palm — mirrored */}
        <g fill="#0a0510">
          <rect x="1142" y="114" width="6" height="6" />
          <rect x="1140" y="100" width="6" height="14" />
          <rect x="1138" y="84"  width="6" height="16" />
          <rect x="1136" y="68"  width="6" height="16" />
          <rect x="1134" y="52"  width="6" height="16" />
          <rect x="1132" y="38"  width="6" height="14" />
          {/* Crown */}
          <rect x="1130" y="28"  width="10" height="12" />
          <rect x="1128" y="18"  width="14" height="12" />

          {/* Frond 1: long arch LEFT toward sun */}
          <rect x="1106" y="26"  width="22" height="4" />
          <rect x="1084" y="22"  width="24" height="4" />
          <rect x="1062" y="17"  width="24" height="4" />
          <rect x="1042" y="12"  width="22" height="4" />
          <rect x="1026" y="8"   width="18" height="4" />
          {/* Leaflets */}
          <rect x="1096" y="26"  width="4" height="8" />
          <rect x="1074" y="21"  width="4" height="8" />
          <rect x="1052" y="16"  width="4" height="8" />

          {/* Frond 2: LEFT drooping */}
          <rect x="1106" y="38"  width="22" height="4" />
          <rect x="1086" y="44"  width="22" height="4" />
          <rect x="1068" y="50"  width="20" height="4" />
          <rect x="1054" y="58"  width="16" height="4" />
          {/* Leaflets */}
          <rect x="1096" y="48"  width="4" height="8" />
          <rect x="1076" y="56"  width="4" height="8" />

          {/* Frond 3: straight UP */}
          <rect x="1130" y="4"   width="12" height="16" />
          <rect x="1130" y="0"   width="16" height="6" />
          {/* Leaflets */}
          <rect x="1124" y="8"   width="4" height="10" />
          <rect x="1144" y="6"   width="4" height="10" />

          {/* Frond 4: UP-RIGHT (away from center) */}
          <rect x="1138" y="26"  width="24" height="4" />
          <rect x="1158" y="20"  width="24" height="4" />
          <rect x="1178" y="14"  width="22" height="4" />
          {/* Leaflets */}
          <rect x="1152" y="30"  width="4" height="8" />
          <rect x="1172" y="24"  width="4" height="8" />

          {/* Frond 5: RIGHT drooping */}
          <rect x="1138" y="38"  width="24" height="4" />
          <rect x="1158" y="44"  width="26" height="4" />
          <rect x="1180" y="52"  width="20" height="4" />
          {/* Leaflets */}
          <rect x="1154" y="42"  width="4" height="8" />
          <rect x="1174" y="50"  width="4" height="8" />

          {/* Frond 6: sweeping LOW-LEFT (long arch toward center) */}
          <rect x="1104" y="50"  width="26" height="4" />
          <rect x="1078" y="56"  width="28" height="4" />
          <rect x="1052" y="64"  width="28" height="4" />
          <rect x="1030" y="72"  width="24" height="4" />
          <rect x="1014" y="80"  width="18" height="4" />
          {/* Drooping leaflets */}
          <rect x="1088" y="60"  width="4" height="8" />
          <rect x="1062" y="70"  width="4" height="8" />
          <rect x="1040" y="78"  width="4" height="8" />

          {/* Frond 7: UP-LEFT diagonal */}
          <rect x="1108" y="16"  width="20" height="4" />
          <rect x="1090" y="10"  width="20" height="4" />
          <rect x="1076" y="4"   width="16" height="4" />
          {/* Leaflets */}
          <rect x="1098" y="14"  width="4" height="7" />

          {/* Frond 8: DOWN-RIGHT */}
          <rect x="1138" y="52"  width="24" height="4" />
          <rect x="1158" y="62"  width="26" height="4" />
          <rect x="1180" y="72"  width="20" height="4" />
        </g>
      </svg>

      <pre className="ascii-logo" data-tauri-drag-region>
        {ASCII_LOGO}
      </pre>
      <div className="meta" data-tauri-drag-region>
        v{version} &nbsp;·&nbsp; provider{" "}
        {onProviderChange ? (
          <ProviderPicker current={provider} onSelect={onProviderChange} />
        ) : (
          <b>{provider}</b>
        )} &nbsp;·&nbsp; model{" "}
        {onModelChange ? (
          <ModelPicker
            current={model}
            provider={provider}
            baseUrl={baseUrl}
            apiKey={apiKey}
            onSelect={onModelChange}
          />
        ) : (
          <b>{model}</b>
        )} &nbsp;·&nbsp; sandbox <b>{sandbox}</b>
      </div>
      <div className="header-spacer" data-tauri-drag-region></div>
      <div className="meta">
        {online ? <span className="dot"></span> : null}
        {online ? "online" : "offline"}
      </div>
      {onSettingsClick ? (
        <button
          className="header-settings-btn"
          onClick={onSettingsClick}
          aria-label="settings"
          title="settings (Ctrl+,)"
        >
          {/* Pixel-art gear — replaces ⚙ (U+2699) which anti-aliases heavily at 18px */}
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" style={{ display: "block" }}>
            <path
              d="M5,0 H7 V2 H5 Z M10,2 H12 V4 H10 Z M10,8 H12 V10 H10 Z M5,10 H7 V12 H5 Z M0,8 H2 V10 H0 Z M0,2 H2 V4 H0 Z M3,3 H9 V9 H3 Z M4,4 H8 V8 H4 Z"
              fill="currentColor"
              fillRule="evenodd"
            />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

// ─────────────── provider picker (click provider to change) ───────────────

function ProviderPicker({
  current,
  onSelect,
}: {
  readonly current: string;
  readonly onSelect: (providerId: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);

  // Close on outside click / Esc
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | KeyboardEvent): void => {
      if (e instanceof KeyboardEvent && e.key === "Escape") setOpen(false);
      if (e instanceof MouseEvent) {
        const target = e.target as HTMLElement;
        if (!target.closest(".provider-picker")) setOpen(false);
      }
    };
    window.addEventListener("mousedown", handler);
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("mousedown", handler);
      window.removeEventListener("keydown", handler);
    };
  }, [open]);

  return (
    <span className="provider-picker model-picker">
      <button
        type="button"
        className="model-picker-trigger"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        title="click to change provider"
      >
        <b>{current}</b>
        <span className="model-picker-caret">▾</span>
      </button>
      {open ? (
        <div className="model-picker-popover" onClick={(e) => e.stopPropagation()}>
          <div className="model-picker-list">
            {PROVIDER_LIST.map((p) => {
              const active = p.id === current;
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`model-picker-item${active ? " active" : ""}`}
                  onClick={() => {
                    setOpen(false);
                    if (!active) onSelect(p.id);
                  }}
                  title={p.id}
                >
                  {p.label} <span className="model-picker-item-id">({p.id})</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </span>
  );
}

// ─────────────── model picker (click model to change) ───────────────

function ModelPicker({
  current,
  provider,
  baseUrl,
  apiKey,
  onSelect,
}: {
  readonly current: string;
  readonly provider: string;
  readonly baseUrl: string | undefined;
  readonly apiKey: string | undefined;
  readonly onSelect: (modelId: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const close = (): void => {
    setOpen(false);
    setFilter("");
  };

  useEffect(() => {
    if (!open || models !== null || loading) return;
    const url = resolveModelsUrl(provider, baseUrl);
    if (!url) {
      setError(`No /v1/models endpoint for provider ${provider}`);
      return;
    }
    setLoading(true);
    setError(null);
    if (import.meta.env.DEV) console.debug("[model-picker] fetching", url);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey && apiKey.length > 0) headers["Authorization"] = `Bearer ${apiKey}`;
    const controller = new AbortController();
    // Use Tauri HTTP plugin (goes through Rust → no CORS), fall back to native
    // fetch in vite-only dev mode (when @tauri-apps/plugin-http isn't wired).
    (async () => {
      try {
        let mod: { fetch: typeof window.fetch } | null = null;
        try {
          mod = (await import("@tauri-apps/plugin-http")) as { fetch: typeof window.fetch };
        } catch {
          mod = null;
        }
        const fetcher = mod?.fetch ?? window.fetch.bind(window);
        const r = await fetcher(url, { headers, signal: controller.signal });
        if (!r.ok) {
          const body = await r.text().catch(() => "");
          throw new Error(`HTTP ${r.status} ${r.statusText} — ${body.slice(0, 200)}`);
        }
        const j = (await r.json()) as { data?: Array<{ id: string }> };
        const ids = (j.data ?? [])
          .map((m) => m.id)
          .filter((s): s is string => typeof s === "string");
        ids.sort();
        if (import.meta.env.DEV) console.debug("[model-picker] loaded", ids.length, "models");
        setModels(ids);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return; // unmount cleanup
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[model-picker] fetch failed", msg, "url=", url);
        setError(msg.length > 200 ? msg.slice(0, 200) + "…" : msg);
      } finally {
        setLoading(false);
      }
    })();
    return (): void => { controller.abort(); };
  }, [open, models, loading, provider, baseUrl, apiKey]);

  // Close on outside click / Esc
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | KeyboardEvent): void => {
      if (e instanceof KeyboardEvent && e.key === "Escape") close();
      if (e instanceof MouseEvent) {
        const target = e.target as HTMLElement;
        if (!target.closest(".model-picker")) close();
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onDown);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onDown);
    };
  }, [open]);

  const filtered = models?.filter((m) =>
    filter.trim().length === 0 ? true : m.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <span className="model-picker">
      <button
        type="button"
        className="model-picker-trigger"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        title="click to change model"
      >
        <b>{current}</b>
        <span className="model-picker-caret">▾</span>
      </button>
      {open ? (
        <div className="model-picker-popover" onClick={(e) => e.stopPropagation()}>
          <input
            className="model-picker-search"
            placeholder="filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoFocus
          />
          <div className="model-picker-list">
            {loading ? <div className="model-picker-empty">cargando…</div> : null}
            {error ? <div className="model-picker-empty">error: {error}</div> : null}
            {!loading && !error && filtered && filtered.length === 0 ? (
              <div className="model-picker-empty">no matches</div>
            ) : null}
            {filtered?.map((m) => (
              <button
                key={m}
                type="button"
                className={`model-picker-item ${m === current ? "active" : ""}`}
                onClick={() => {
                  onSelect(m);
                  close();
                }}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </span>
  );
}

function resolveModelsUrl(provider: string, baseUrl: string | undefined): string | null {
  // Provider-specific overrides come first; OpenAI-compatible fall through to baseUrl.
  if (provider === "anthropic") return "https://api.anthropic.com/v1/models";
  if (provider === "groq") return "https://api.groq.com/openai/v1/models";
  if (provider === "mistral") return "https://api.mistral.ai/v1/models";
  if (provider === "deepseek") return "https://api.deepseek.com/v1/models";
  if (provider === "openrouter") return "https://openrouter.ai/api/v1/models";
  if (provider === "together") return "https://api.together.xyz/v1/models";
  if (provider === "ollama") {
    const base = baseUrl && baseUrl.length > 0 ? baseUrl.replace(/\/$/, "") : "http://127.0.0.1:11434/v1";
    return `${base}/models`;
  }
  // openai (default) — uses baseUrl override (OpenCode, vLLM, etc.) or api.openai.com.
  // OpenCode: chat lives at /zen/go/v1 but models are exposed at /zen/v1/models
  // (no `/go`). Detect by host and special-case.
  if (baseUrl && baseUrl.length > 0) {
    if (/opencode\.ai/i.test(baseUrl)) return "https://opencode.ai/zen/v1/models";
    return `${baseUrl.replace(/\/$/, "")}/models`;
  }
  return "https://api.openai.com/v1/models";
}

// ─────────────── window controls (custom titlebar) ───────────────

export function WindowControls(): React.JSX.Element {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        setMaximized(await win.isMaximized());
        unlisten = await win.onResized(async () => {
          setMaximized(await win.isMaximized());
        });
      } catch {
        // running in vite dev (no Tauri) — controls just won't function
      }
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  const call = async (action: "minimize" | "toggleMaximize" | "close") => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      if (action === "minimize") await win.minimize();
      else if (action === "toggleMaximize") await win.toggleMaximize();
      else await win.close();
    } catch {
      // no-op outside Tauri
    }
  };

  return (
    <div className="window-controls" aria-label="window controls">
      <button
        type="button"
        className="window-btn window-btn-min"
        onClick={() => void call("minimize")}
        aria-label="minimize"
        title="minimize"
      >
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          <rect x="1" y="5" width="8" height="1" />
        </svg>
      </button>
      <button
        type="button"
        className="window-btn window-btn-max"
        onClick={() => void call("toggleMaximize")}
        aria-label={maximized ? "restore" : "maximize"}
        title={maximized ? "restore" : "maximize"}
      >
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          {maximized ? (
            <>
              <rect x="2" y="1" width="6" height="6" fill="none" strokeWidth="1" />
              <rect x="1" y="3" width="6" height="6" fill="none" strokeWidth="1" />
            </>
          ) : (
            <rect x="1" y="1" width="8" height="8" fill="none" strokeWidth="1" />
          )}
        </svg>
      </button>
      <button
        type="button"
        className="window-btn window-btn-close"
        onClick={() => void call("close")}
        aria-label="close"
        title="close"
      >
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          <path d="M1,1 L9,9 M9,1 L1,9" strokeWidth="1.4" />
        </svg>
      </button>
    </div>
  );
}

// ─────────────── workspace ───────────────

export interface WorkspaceProps {
  readonly turns: ReadonlyArray<Turn>;
  readonly snapshot: SnapshotData;
  readonly scrollRef: RefObject<HTMLDivElement>;
  readonly view: ViewName;
  readonly onViewChange: (v: ViewName) => void;
  readonly children?: React.ReactNode;
}

export function Workspace({
  turns,
  snapshot,
  scrollRef,
  view,
  onViewChange,
  children,
}: WorkspaceProps): React.JSX.Element {
  // Render chat OR view content — never both. Distinct keys force a real
  // unmount when switching so React can't accidentally retain nodes from
  // the previous branch (which was producing a stacked layout where users
  // saw the chat history above the new view).
  return (
    <div className="workspace">
      {view === "chat" ? (
        <div key="scroll-chat" className="scroll" ref={scrollRef}>
          {turns.map((t) => (
            <TurnRow key={t.id} turn={t} />
          ))}
        </div>
      ) : (
        <div key={`scroll-${view}`} className="scroll">{children}</div>
      )}
      <SideRail snapshot={snapshot} view={view} onViewChange={onViewChange} />
    </div>
  );
}

function TurnRow({ turn }: { readonly turn: Turn }): React.JSX.Element {
  const tagClass =
    turn.kind === "user" ? "tag you" : turn.kind === "cero" ? "tag cero" : "tag";
  const tagText = turn.kind === "user" ? "you" : turn.kind === "cero" ? "cero" : "err";
  // User messages are plain text, cero replies render as markdown so code
  // blocks, tables, headers, lists, links all render correctly.
  return (
    <div className="turn">
      <div className="line">
        <span className={tagClass}>{tagText}</span>
        <span className="body">
          {turn.kind === "cero" ? <Markdown text={turn.text} /> : turn.text}
        </span>
      </div>
      {turn.tools?.map((tool) => <ToolBlock key={tool.id} tool={tool} />)}
      {turn.skills?.map((s) => (
        <div key={s} className="skill-line">
          ✓ skill aprendida → <b>{s}</b>
        </div>
      ))}
      {turn.extraText ? (
        <div className="line">
          <span className={tagClass}>{tagText}</span>
          <span className="body">
            {turn.kind === "cero" ? <Markdown text={turn.extraText} /> : turn.extraText}
          </span>
        </div>
      ) : null}
    </div>
  );
}

// Tool args often contain a large multi-line "content" field (write_file,
// edit_file, apply_patch, etc). The LLM streams it as a JSON string with
// `\n` escape sequences — rendering that as-is shows everything on one line
// inside the JSON quotes. We split rich fields out so they render as proper
// multi-line blocks while the rest of the args stays compact.
const RICH_FIELDS = new Set(["content", "code", "body", "text", "source", "patch", "diff", "html"]);

function splitToolArgs(args: string): { compact: string; rich: Array<{ key: string; value: string }> } {
  try {
    const parsed = JSON.parse(args) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { compact: args, rich: [] };
    }
    const rich: Array<{ key: string; value: string }> = [];
    const restEntries: Array<[string, unknown]> = [];
    for (const [k, v] of Object.entries(parsed)) {
      if (
        typeof v === "string" &&
        (RICH_FIELDS.has(k) || (v.length > 120 && v.includes("\n")))
      ) {
        rich.push({ key: k, value: v });
      } else {
        restEntries.push([k, v]);
      }
    }
    const compact =
      restEntries.length === 0
        ? ""
        : JSON.stringify(Object.fromEntries(restEntries), null, 2);
    return { compact, rich };
  } catch {
    return { compact: args, rich: [] };
  }
}

function ToolBlock({ tool }: { readonly tool: ToolEvent }): React.JSX.Element {
  const { compact, rich } = tool.args ? splitToolArgs(tool.args) : { compact: "", rich: [] };
  return (
    <div className="tool">
      <span className="name">▣ {tool.name}</span>{" "}
      {tool.ms !== undefined ? <span className="ms">{tool.ms}ms</span> : null}
      {compact.length > 0 ? <pre className="tool-args">{compact}</pre> : null}
      {rich.map((r) => (
        <div key={r.key} className="tool-rich">
          <div className="tool-rich-label">{r.key}</div>
          <pre className="tool-rich-body">{r.value}</pre>
        </div>
      ))}
      {tool.result ? <pre className="tool-result">{tool.result}</pre> : null}
    </div>
  );
}

// ─────────────── side rail ───────────────

function SideRail({
  snapshot,
  view,
  onViewChange,
}: {
  readonly snapshot: SnapshotData;
  readonly view: ViewName;
  readonly onViewChange: (v: ViewName) => void;
}): React.JSX.Element {
  const { stats, topSkills, user } = snapshot;
  return (
    <div className="rail">
      <div>
        <h3>NAV</h3>
        <NavItem name="chat"       label="chat"       view={view} onChange={onViewChange} />
        <NavItem name="skills"     label="skills"     view={view} onChange={onViewChange} count={stats.skills} />
        <NavItem name="lessons"    label="lessons"    view={view} onChange={onViewChange} count={stats.lessons} />
        <NavItem name="user-model" label="user-model" view={view} onChange={onViewChange} suffix={`v${stats.userModelVersion}`} />
        <NavItem name="mcp"        label="mcp"        view={view} onChange={onViewChange} />
        <NavItem name="gateway"    label="gateway"    view={view} onChange={onViewChange} />
        <NavItem name="scheduler"  label="scheduler"  view={view} onChange={onViewChange} />
        <NavItem name="stats"      label="stats"      view={view} onChange={onViewChange} />
        <NavItem name="data"       label="data"       view={view} onChange={onViewChange} />
        <NavItem name="admin"      label="admin"      view={view} onChange={onViewChange} />
        <NavItem name="setup"      label="setup"      view={view} onChange={onViewChange} />
      </div>
      <div>
        <h3>STATS</h3>
        <StatRow label="skills" value={stats.skills} />
        <StatRow label="lessons" value={stats.lessons} />
        <StatRow label="user-model" value={`v${stats.userModelVersion}`} />
        <StatRow label="sessions" value={stats.sessions} />
        <StatRow
          label="success"
          value={
            stats.avgSuccessRate === null
              ? "·"
              : `${Math.round(stats.avgSuccessRate * 100)}%`
          }
        />
      </div>

      <div>
        <h3>TOP SKILLS</h3>
        {topSkills.length > 0 ? (
          topSkills.map((s) => (
            <div key={s.id} className="skill-card">
              <div className="name">{s.name}</div>
              <div
                className="bar"
                style={
                  {
                    "--p":
                      s.successRate === null
                        ? "0%"
                        : `${Math.round(s.successRate * 100)}%`,
                  } as React.CSSProperties
                }
              />
            </div>
          ))
        ) : (
          <div className="rail-empty">(no skills yet — they get auto-created as you chat)</div>
        )}
      </div>

      <div>
        <h3>USER</h3>
        <div className="user-block">
          {user.expertiseAreas.length > 0 ? (
            <div>{user.expertiseAreas.join(" · ")}</div>
          ) : null}
          {user.currentProjects.length > 0 ? (
            <div>proj {user.currentProjects.join(", ")}</div>
          ) : null}
          {user.expertiseAreas.length === 0 && user.currentProjects.length === 0 ? (
            <div className="rail-empty">(empty — chat a few turns to populate)</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StatRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | number;
}): React.JSX.Element {
  return (
    <div className="stat-line">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function NavItem({
  name,
  label,
  view,
  onChange,
  count,
  suffix,
}: {
  readonly name: ViewName;
  readonly label: string;
  readonly view: ViewName;
  readonly onChange: (v: ViewName) => void;
  readonly count?: number;
  readonly suffix?: string;
}): React.JSX.Element {
  const active = view === name;
  return (
    <button
      type="button"
      className={`nav-item ${active ? "nav-item-active" : ""}`}
      onClick={() => onChange(name)}
      aria-current={active ? "page" : undefined}
    >
      <span>{active ? "▶ " : ""}{label}</span>
      <b>{count !== undefined ? count : suffix ?? ""}</b>
    </button>
  );
}

// ─────────────── prompt ───────────────
// Input state lives inside Prompt to avoid per-keystroke App re-renders.
// App only receives the trimmed text on submit via onSubmit(text).

export interface PromptProps {
  readonly onSubmit: (v: string) => void;
  readonly onCancel?: () => void;
  readonly busy: boolean;
}

export function Prompt({
  onSubmit,
  onCancel,
  busy,
}: PromptProps): React.JSX.Element {
  const [value, setValue] = useState("");

  const handleSubmit = (): void => {
    onSubmit(value);
    setValue("");
  };

  return (
    <div className="prompt">
      <span className="arrow">{busy ? "…" : "▶"}</span>
      <input
        type="text"
        className="prompt-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !busy) {
            e.preventDefault();
            handleSubmit();
          } else if (e.key === "Escape" && busy && onCancel) {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder={
          busy
            ? "(streaming — Esc to cancel)"
            : "escribí, o /skills /lessons /model /clear /quit"
        }
        autoFocus
      />
    </div>
  );
}

// ─────────────── status ───────────────

export interface StatusBarProps {
  readonly provider: string;
  readonly model: string;
  readonly snapshot: SnapshotData;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  readonly cost?: number;
  readonly online?: boolean;
  readonly voiceModeToggle?: React.ReactNode;
}

export function StatusBar({
  provider,
  model,
  snapshot,
  tokensIn,
  tokensOut,
  cost,
  online = false,
  voiceModeToggle,
}: StatusBarProps): React.JSX.Element {
  const { stats } = snapshot;
  return (
    <div className="status">
      <span>
        {online ? <span className="dot"></span> : null}
        <b>{online ? "online" : "offline"}</b> · {provider}
      </span>
      <span>
        · model <b>{model}</b>
      </span>
      <span>
        · <b>{stats.skills}</b> skills · <b>{stats.lessons}</b> lessons · user{" "}
        <b>v{stats.userModelVersion}</b>
      </span>
      <span className="right">
        {tokensIn !== undefined && tokensOut !== undefined
          ? `${tokensIn}in/${tokensOut}out`
          : ""}
        {cost !== undefined ? ` · $${cost.toFixed(3)}` : ""}
      </span>
      {voiceModeToggle ? (
        <span className="status-voice">{voiceModeToggle}</span>
      ) : null}
    </div>
  );
}
