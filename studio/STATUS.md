# Vybin — STATUS (Fase 8 / pre-v0.1)

> Estado al cierre del día. Todo el trabajo se hizo directo (dashboard de
> CeroSpace estuvo offline durante esta fase, no se pudo delegar al equipo).
> Cuando el bus de tasks vuelva, el equipo retoma lo que falta del checklist
> en `tasks.md` líneas Fase 8 → 8c (multi-tabs, MCP UI, Gateway UI, polish).

## Lo que existe HOY

```
C:/Users/gonza/cero/
├── src/                         ← cero CLI/agent (sin tocar excepto +ipc-mode)
│   └── cli/
│       ├── chat.ts              ← +flag --ipc-mode jsonl
│       └── chat-ipc.ts          ← runIpcLoop: stdin/stdout JSON-lines bridge
└── studio/                      ← NUEVO. Tauri 2.x + React 18 + Vite
    ├── src/
    │   ├── App.tsx              ← root: nav state machine, sidecar IPC, ⚙
    │   ├── components.tsx       ← Header / Workspace / SideRail / Prompt / StatusBar
    │   ├── Markdown.tsx         ← react-markdown + shiki syntax highlighting
    │   ├── styles.css           ← tema pixel-violet (paleta + tokens del v5 mockup)
    │   ├── hooks/
    │   │   ├── useCero.ts       ← (deprecated; lógica movida a App.tsx)
    │   │   ├── useSettings.ts   ← Tauri store backing config
    │   │   └── useCeroData.ts   ← reads ~/.cero/{skills,lessons,user-model}
    │   └── views/
    │       ├── Settings.tsx     ← API keys + provider/model + sandbox + learning
    │       ├── SkillsView.tsx   ← lista, filter, click → modal con detalle
    │       ├── LessonsView.tsx  ← cross-session, filter por tag
    │       └── UserModelView.tsx← current state + history viewer + diff
    └── src-tauri/
        ├── src/
        │   ├── main.rs          ← entry
        │   ├── lib.rs           ← Builder + plugins + commands
        │   └── sidecar.rs       ← spawn cero, IPC, restart_session
        ├── binaries/            ← cero-x86_64-pc-windows-msvc.exe (sidecar)
        ├── icons/               ← logo pixel violet generado de source.svg
        ├── capabilities/
        │   └── default.json     ← fs scope = ~/.cero/**, store, shell
        └── tauri.conf.json      ← v0.2.0, bundle.active, externalBin
```

## Funcionalidad ya migrada a Tauri studio

| Feature de cero | Status studio |
|---|---|
| Chat con LLM (4 providers) | ✅ via sidecar JSON-lines IPC |
| 10 core tools (read/write/grep/etc) | ✅ se renderizan como cards amber con args + result + ms |
| Markdown rendering (code blocks, tablas, headers, etc) | ✅ react-markdown + shiki (github-dark) |
| Slash commands (/clear /skills /lessons /model /quit) | ✅ se forwardean al sidecar |
| Skills auto-create + retrieve + improve | ✅ corre en cero, visible en SkillsView (lista) y modal (detalle, delete) |
| User-model auto-update (per-turn + session-end) | ✅ corre en cero, visible en UserModelView (current + history + diff) |
| Lessons extract + cross-session retrieve | ✅ corre en cero, visible en LessonsView (lista + tag filter + detalle) |
| Sandbox local/docker | ✅ configurable desde Settings → restart sidecar |
| Settings (API keys, provider, model, sandbox, learning, goal) | ✅ Tauri store, modal Ctrl+, |
| Cancel current turn | ✅ tauri command cancel_turn |
| Live snapshot de stats (skills/lessons/user-model/sessions/avgSuccess) | ✅ cada 5s + on-demand |
| Restart sidecar con nueva config | ✅ restart_session command, env vars frescos |
| App icon real | ✅ pixel violet "C" generado de source.svg |
| Bundle one-exe (cero embedded) | ✅ MSI 46MB + NSIS 31MB con cero adentro |
| GH Actions release multi-OS | ✅ studio-release.yml (matrix 5 platforms, tauri-action) |

## Bugs resueltos durante la fase

| Versión | Bug | Causa raíz | Fix |
|---|---|---|---|
| v1 | ASCII logo se renderizaba como `██` literal | encoding pipeline rompía el char U+2588 al pasar por stdout | Fallback a ASCII `#` simple |
| v2 | `cero studio.exe` abierto con doble-click no respondía | sidecar cwd era Desktop, sin `.env` con API key | locate_cero hardcodea cwd al cero project root en dev |
| v3 | Code blocks de markdown con spacing enorme | shiki output heredaba font-size de `.body` (22px VT323) | CSS override agresivo con `.md-codeblock *` |
| v4 | ⚙ no clickeable en header | `data-tauri-drag-region` se comía clicks de hijos | CSS `[data-tauri-drag-region] button { app-region: no-drag }` |
| v5 | Save Settings no respondía visiblemente | validation fallaba pero error scrolled out of view | Error sticky entre body y footer + highlight del campo activo |
| v6 | Cero turn duplicado en streaming (la "i" suelta + el mensaje completo) | text-delta hacía push a history, flushPending hacía push otra vez | ensurePendingInHistory + syncPendingToHistory: update in-place por id |

## Lo que falta (todavía pendiente)

| # | Pieza | Esfuerzo |
|---|---|---|
| 1 | **Multi-tabs estilo navegador** (Ctrl+T nueva sesión, switch entre, Ctrl+W) | 2-3 hs (refactor sidecar a HashMap<TabId, Handle>) |
| 2 | **MCP servers config UI** (form para cero.config.json mcpServers) | 1.5 hs |
| 3 | **Gateway Telegram start/stop UI** (manage bot desde studio) | 1.5 hs |
| 4 | **Stats view dedicado** (resumen agregado, gráficos opcional) | 0.5 hs |
| 5 | **Fix code-block spacing definitivo** (override no es suficiente) | 0.5 hs |
| 6 | **Theme switcher** (variants violet / lima / amber) | 0.5 hs |
| 7 | **Auto-import .env del cero project root** la primera vez | 0.5 hs |
| 8 | **Error toast/banner global** para errores no-chat | 0.5 hs |

## Distribución

- `cero-studio_0.2.0_x64-setup.exe` (NSIS, 31 MB) — recomendado para Windows
- `cero studio_0.2.0_x64_en-US.msi` (MSI, 46 MB) — alternativa para deploy AD/managed
- `cero-studio.exe` standalone (6.7 MB, requiere `cero.exe` al lado)
- GH Actions matrix produce equivalentes para Linux x64+arm64 + macOS arm64+x64 en cada `git push --tags v*`

## Cómo corre por dentro

```
┌─ Tauri Window (Rust + WebView2) ────────────────────────┐
│  React + Vite UI (Markdown + shiki + side rail nav)     │
│              ↕ Tauri IPC commands + cero-event channel  │
│  sidecar.rs spawns cero binary (sidecar mechanism)      │
│              ↕ stdin / stdout JSON Lines                │
│  cero --ipc-mode jsonl                                   │
│   ├─ Agent loop (4 providers, 10 tools, MCP, sandbox)   │
│   ├─ Learning hooks (skills + user-model + lessons)     │
│   └─ Reads/writes ~/.cero/{skills,lessons,user-model}    │
└──────────────────────────────────────────────────────────┘
```

## Decisiones de arquitectura clave

1. **cero binary = source of truth** — TODA la lógica de agente/tools/learning vive en cero. Studio es solo UI + process lifecycle. Esto significa que el TUI Ink y el desktop app comparten el mismo backend.

2. **Sidecar via JSON-lines** — opté por NO usar xterm.js (renderizar terminal output crudo). En vez de eso, cero emite AgentEvents tipados y studio renderiza cada uno con un componente React específico (text-delta como markdown, tool-call como card amber, etc). Más limpio y permite UI rica.

3. **Settings persiste en Tauri store** — no escribimos `.env` files. Las API keys se pasan al sidecar como env vars al spawn (que sobrescriben cualquier cosa que haya en el `.env` del cwd).

4. **Detail views leen ~/.cero/* directo** — no hay nuevos comandos cero, las vistas SkillsView/LessonsView/UserModelView leen los archivos JSON directo via Tauri fs plugin (con scope locked). Más rápido, no requiere subprocess.

5. **Single sidecar por studio process** (por ahora) — multi-tabs requiere refactor a HashMap<TabId, Sidecar>, pendiente para v8.
