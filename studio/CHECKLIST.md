# cero studio — CHECKLIST de migración

> Versión actual shippada: **v7-fix3** (Desktop + MSI/NSIS installer)
> Última actualización: durante Fase 8 (cero studio)

## ✅ HECHO

### Backend (cero binary)
- [x] `--ipc-mode jsonl` flag — nuevo subcomando para hablar JSON Lines por stdin/stdout
- [x] `runIpcLoop` en `src/cli/chat-ipc.ts` con (a) parser de stdin línea-a-línea, (b) emit de eventos AgentEvent + system + error + snapshot, (c) snapshot push periódico cada 5s, (d) graceful shutdown con cancel handler
- [x] Schemas Zod compartidos para inbound (prompt/slash/swap-model/cancel/shutdown/snapshot-request) y outbound (ready/text-delta/tool-call/tool-result/turn-end/done/system/error/snapshot)
- [x] Versioning: header `cero-ipc/1` en el ready event

### Tauri shell (Rust)
- [x] `studio/src-tauri/` scaffold con Tauri 2.x
- [x] `sidecar.rs`: spawn cero binary, pipe stdin/stdout, emit Tauri events
- [x] Tauri commands: `start_session`, `send_prompt`, `send_slash`, `cancel_turn`, `request_snapshot`, `shutdown_session`, `restart_session`
- [x] `locate_cero`: prioridad CERO_BIN env > bundled sidecar > dev hardcode > PATH
- [x] Sidecar CWD: HOME en bundled, cero project root en dev
- [x] Plugins: `tauri-plugin-shell`, `tauri-plugin-store`, `tauri-plugin-fs`
- [x] Capabilities scope: fs locked a `~/.cero/**` solamente
- [x] Hide subprocess console window en Windows (CREATE_NO_WINDOW)
- [x] Shutdown timeout 30s para que LessonsExtractor complete antes de kill
- [x] Pasar env vars (API keys) al spawn de cero

### React frontend (UI)
- [x] App.tsx + components.tsx con layout v5: Header (logo ASCII + meta + dot online + ⚙) + Workspace (chat o vista) + Prompt + StatusBar
- [x] `useCero` lógica integrada en App.tsx (text-delta accumulation, tool-call/result tracking, snapshot dispatch)
- [x] Markdown rendering con react-markdown + shiki syntax highlighting (github-dark)
- [x] Code blocks con header amber del lenguaje + body con highlighting
- [x] Inline code, tablas con bordes violeta, headers/strong/em estilizados
- [x] Cursor latido violeta con glow al lado del prompt input
- [x] SideRail con NAV (chat/skills/lessons/user-model) + STATS live + TOP SKILLS bars + USER block
- [x] Settings page (modal Ctrl+,) con form completo: provider/model/baseURL + 6 API key fields + sandbox + learning mode + goal
- [x] Settings persiste en Tauri store, restart_session triggered en cambio
- [x] Highlight del campo API key activo según provider seleccionado + badge "ACTIVE"
- [x] Sticky error banner entre body y footer del Settings (siempre visible)
- [x] **SkillsView** — lista todas, filter, click → modal con problem/solution_steps/preconditions/postconditions/success rate, botón delete
- [x] **LessonsView** — cross-session, filter por tag chips, click → modal con what_learned full
- [x] **UserModelView** — current state con expertise/projects/preferences/working_style/communication, toggle history (cada change con su patch JSON)
- [x] Slash commands forwarded al sidecar (/clear /skills /lessons /user-model /model /quit)
- [x] Auto-scroll a bottom cuando llega text-delta nuevo
- [x] Snapshot polling + on-event refresh para que SkillsView/LessonsView/UserModelView se actualicen al toque

### Distribución
- [x] App icon real generado de `source.svg` (pixel violet "C")
- [x] Bundle one-exe: cero-x86_64-pc-windows-msvc.exe embedded como Tauri sidecar
- [x] MSI installer (46MB) + NSIS installer (31MB) producidos por `bun tauri build`
- [x] Workflow `.github/workflows/studio-release.yml` matrix multi-OS (ubuntu, ubuntu-22.04 ARM, macos-latest ARM, macos-13 x64, windows-latest)
- [x] Workflow usa `tauri-apps/tauri-action@v0` + sube a Releases automático con cada `git push --tags v*`

### Bugs resueltos
- [x] ASCII logo → `█` literal (encoding) → fallback a `#`
- [x] sidecar cwd Desktop sin .env → hardcode al cero root en dev
- [x] code block enorme spacing → CSS override (PARCIAL — sigue debt)
- [x] ⚙ no clickeable (drag region eats clicks) → app-region: no-drag
- [x] Save Settings no respondía → error sticky + highlight campo activo
- [x] Cero turn duplicado en streaming → ensurePendingInHistory + syncPendingToHistory por id

---

## ⏳ PENDIENTE

### Funcionalidad
- [ ] **Multi-tabs estilo navegador** — Ctrl+T nueva sesión, Ctrl+W cerrar, switch entre. Refactor: sidecar.rs HashMap<TabId, Handle>, Tauri commands con tabId param, frontend tabs UI · *2-3 hs*
- [ ] **Auto-import .env del cero project root** — primera vez que arranca sin config, detectar si hay `.env` en `C:/Users/gonza/cero/` y populate Settings · *0.5 hs*
- [ ] **MCP servers config UI** — form para `cero.config.json` mcpServers (name, command, args, env) · *1.5 hs*
- [ ] **Gateway Telegram start/stop UI** — botón en sidebar para arrancar `cero gateway --platform telegram --token X` como subprocess separado · *1.5 hs*
- [ ] **Stats view dedicado** — accesible desde nav, gráficos de skills/lessons over time, success rate por categoría · *1 hs*
- [ ] **Error toast/banner global** — para errores no-chat (sidecar crash, Settings save fail, fs read fail) · *0.5 hs*

### Visuales / Polish
- [ ] **Fix code-block spacing definitivo** — investigar por qué el CSS override actual no es suficiente, posiblemente el `white-space: pre` en `.md-codeblock *` causa newlines entre token spans · *0.5 hs*
- [ ] **Theme switcher** — variants (violet actual / lima / amber / classic) en Settings · *0.5 hs*
- [ ] **Loading skeleton** — placeholder pixel mientras se carga el primer snapshot · *0.5 hs*
- [ ] **Pulir status bar** — incluir tokens in/out + cost en vivo (recibirlo del cero binary via snapshot) · *1 hs*
- [ ] **Animations** — transiciones sutiles cuando cambia view, cuando llega skill/lesson nueva · *1 hs*

### Infraestructura
- [ ] **Test Playwright E2E** — automated UI tests sobre el .exe instalado · *2 hs*
- [ ] **Cross-platform test real** — runnear el binario macOS / Linux para confirmar que sidecar arranca · *1 hs*
- [ ] **Auto-update mechanism** — Tauri updater plugin para que app chequee nuevas versiones · *2 hs*
- [ ] **Crash reporter** — hook a Sentry o similar para production crashes · *1 hs*

---

## 📊 Resumen

```
HECHO:    36 items en backend + Tauri + frontend + distribución + bugs
PENDIENTE: 14 items (6 funcionalidad + 5 visuales + 4 infra)
PROGRESO: ~72% del scope original de Fase 8 + extras
```

## 🎯 Orden recomendado para seguir

1. **Multi-tabs** (más estructural, mejor hacerlo antes de otros features que cambien App state)
2. **Code-block spacing fix** (rápido, mejora visual visible)
3. **Auto-import .env** + **Error toast global** (UX wins chicos)
4. **MCP UI** + **Gateway UI** (features avanzadas)
5. **Theme switcher** + animations + loading skeleton (polish)
6. **Stats view** + auto-update + crash reporter (last mile)
