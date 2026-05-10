# Vybin — Roadmap consolidado (auditoría 2026-05-10)

> Síntesis de 5 reviews paralelos: architect-reviewer · react-pro · security-auditor · ux-designer · product-manager. Total: ~35 hallazgos.

## Tabla maestra (35 hallazgos por severity)

| # | Sev | Categ | Source | Issue | File |
|---|---|---|---|---|---|
| 1 | 🔴 CRIT-SEC | sec | sec#2 | **SQL injection en `cron_db_query`** vía `jobId` (escape débil) + `limit` sin validar. Check "starts SELECT" trivial bypass | `useCronData.ts:108`, `lib.rs:524` |
| 2 | 🔴 CRIT-SEC | sec | sec#3 | **MCP server sin sandbox** — accept arbitrary command + spawned con env vars (incluye API keys). Vector activo (CVE Anthropic abr 2026) | `MCPView.tsx:107,560` |
| 3 | 🔴 CRIT-SEC | sec | sec#1 | API keys plaintext en `settings.json` (%APPDATA%) + child env vars readable por procesos del mismo user | `useSettings.ts:8`, `sidecar.rs:186` |
| 4 | 🔴 CRIT-UX | ux+pm | ux#1+pm#1 | Sin release público — `git tag` vacío. README wget URL roto. Nadie puede instalar | n/a |
| 5 | 🔴 CRIT-UX | ux | ux#1 | "offline ↻" cryptic, mismo color que meta. User stuck en loop de Settings | `components.tsx` Header |
| 6 | 🟠 HIGH-BUG | arch+react+ux | arch#2+react#1+ux#5 | **Settings restart fire-and-forget** — destruye state pendiente, no espera shutdown, todos los tabs flip a offline sin distinguir restart de error real | `sidecar.rs:435-466`, `App.tsx:488-514`, Header |
| 7 | 🟠 HIGH-BUG | react | react#2 | `dispatch` callback no incluye `mascot.trigger` en deps — state machine de mascota se vuelve stale | `App.tsx:356` |
| 8 | 🟠 HIGH-PERF | arch+react | arch#1+react#3 | IPC sin backpressure + `SideRail` re-renders ~12.5×/s durante streaming | `sidecar.rs:271-290`, `components.tsx:739,831` |
| 9 | 🟠 HIGH-UX | ux | ux#2 | SetupView 6 steps pide sandbox/gateway/temperature antes del primer mensaje. Abandono alto | `SetupView.tsx:165-183` |
| 10 | 🟠 HIGH-UX | ux | ux#3 | SideRail 11 items flat. `setup` aparece después del onboarding (confunde) | `components.tsx:831` |
| 11 | 🟠 HIGH-UX | ux | ux#4 | Mascot decorativa, sin click ni tooltip — corner desperdiciado | `Mascot.tsx`, `App.tsx` |
| 12 | 🟠 HIGH-PM | pm+arch+react | pm+arch#7+react#4 | **Rebrand cero→Vybin incompleto** — Cargo.toml, CI workflow, package-lock, comments, STATUS.md, fixtures de tests, "WELCOME TO CERO STUDIO" en SetupView | múltiples (ver checklist abajo) |
| 13 | 🟠 HIGH-PM | pm | pm#2 | Sound default invertido — README dice "off by default" pero código `muted = false` y Settings sin toggle | `mascot-sounds.ts:11`, `Settings.tsx` |
| 14 | 🟡 MED-SEC | sec | sec#4 | Stderr toasts pueden leak API keys (SDKs incluyen key en error: `sk-ant-api03-...`) | `App.tsx:344` |
| 15 | 🟡 MED-SEC | sec | sec#5 | `shell:default` capability permite arbitrary commands desde WebView (XSS → RCE) | `capabilities/default.json:8` |
| 16 | 🟡 MED-SEC | sec | sec#6 | `credentials_db_query` pass-through SQL contra DB con `api_key` plaintext | `AdminView.tsx:208`, `lib.rs:716-769` |
| 17 | 🟡 MED-ARCH | arch | arch#3 | Protocol versioning (`cero-ipc/1`) declarado pero nunca validado | `App.tsx:74,221` |
| 18 | 🟡 MED-ARCH | arch | arch#4 | 100MB/tab × 10 tabs sin warning antes del cap. Sin detección de zombie sidecars | `sidecar.rs:34,153` |
| 19 | 🟡 MED-ARCH | arch | arch#5 | Snapshots globales — tabs sobreescriben los stats del otro | `App.tsx:312`, `ipc-types.ts` |
| 20 | 🟡 MED-ARCH | arch | arch#6 | Dev path hardcoded `C:\Users\gonza\cero\dist\cero-windows.exe` rompe para otros devs | `sidecar.rs:107` |
| 21 | 🟡 MED-REACT | react | react#5 | `Modal` con `role="dialog"` en backdrop (no en box) + sin `aria-labelledby` — screen readers no anuncian título | `Modal.tsx:86-96` |
| 22 | 🟡 MED-REACT | react | react#6 | `handleCloseTab` con `requestQueues` en deps → TabBar re-renders con cada IPC modal | `App.tsx:585-618` |
| 23 | 🟡 MED-UX | ux | ux#6 | Multi-tab discoverability nula — shortcuts solo en tooltip, doble-click invisible | `TabBar.tsx`, `App.tsx` |
| 24 | 🟡 MED-PM | pm | pm test | 3 tests fallan en `UserModelView.test.tsx:49,212` — fixture hardcoded "cero studio" | tests |
| 25 | 🟡 MED-PM | pm | pm sleep | Sleep mode promocionado en comparison table pero NO existe en código (solo SchedulerView con cron manual) | n/a (feature ausente) |
| 26 | 🟢 LOW-SEC | sec | sec#7 | `cero update` reachable sin signature check (no hay updater Tauri configurado todavía) | `lib.rs:786` |
| 27 | 🟢 LOW-REACT | react | react#7 | `ModelPicker` no resetea `models` al cambiar provider — lista stale | `components.tsx:482-528` |
| 28 | 🟢 LOW-UX | ux | ux#7 | Stderr toasts crudos (Node stack traces). Falta translation layer regex→user msg | `App.tsx:344` |
| 29 | 🟢 LOW-PM | pm | pm gateways | GatewayView wired pero el lado Rust de `gateway_start` no testeado runtime | `GatewayView.tsx`, `lib.rs` |
| 30 | 🟢 LOW-PM | pm | pm sandboxes | README promete 6 sandboxes (ssh/modal/daytona/singularity), código solo `local` y `docker` | `Settings.tsx:51` |

---

## Convergencias críticas (3+ reviews lo encontraron)

1. **Settings restart roto** — arch#2 + react#1 + ux#5 → señal triple, máxima prioridad
2. **Rebrand cero→Vybin incompleto** — pm + arch#7 + react#4 → ruido constante para contribuidores y users
3. **Re-render perf** — arch#1 + react#3 → IPC + SideRail combo

---

## SPRINT 0 — esta semana (8h efectivas)

Lo que mueve la aguja YA. Cero refactors grandes, todo arreglos puntuales.

| # | Tarea | Estim | Cierra finding |
|---|---|---|---|
| 1 | **Fix SQL injection cron_db_query** — convertir a `rusqlite params![]` | 1h | #1 |
| 2 | **MCP confirm modal** — antes de spawn, mostrar comando resuelto + warning + checkbox "I trust this" | 1h | #2 |
| 3 | **Sound default → muted + toggle en Settings** | 30min | #13 |
| 4 | **Redact API keys en stderr toasts** — regex `sk-[A-Za-z0-9\-]{20,}` → `[REDACTED]` | 15min | #14 |
| 5 | **Restarting state separado de offline** — header muestra "syncing…" amber durante respawn, "offline" rojo solo después de 8s sin ready | 1h | #6 (parcial) |
| 6 | **Mascot trigger en deps de dispatch** — fix bug latente | 5min | #7 |
| 7 | **React.memo en SideRail + Workspace** | 20min | #8 (parcial) |
| 8 | **Fix tests rebrand** — UserModelView fixture + SetupView "WELCOME TO VYBIN" | 30min | #12 (parcial) + #24 |
| 9 | **CI workflow rename** — studio-release.yml → "Vybin release" | 15min | #12 (parcial) |
| 10 | **Cargo.toml + lib.rs comments** — `vybin` / `vybin_lib` | 20min | #12 (parcial) |
| 11 | **Quitar dev path hardcoded** — `CERO_DEV_BIN` env var | 15min | #20 |
| 12 | **Primer release v0.1.0** — git tag v0.1.0-alpha + push (CI ya está armado) | 15min | #4 (parcial) |

**Total**: ~5.5h. Cierra 12 findings (incluye todos los CRITICAL del security excepto #3 API keys at rest que requiere keyring crate).

---

## SPRINT 1 — próximas 2 semanas (16h)

Trabajo estructural mayor, requiere diseño antes de tipear.

1. **API keys via OS keychain** (#3) — `tauri-plugin-stronghold` o crate `keyring`. Migración de existing `settings.json` keys. ~4h
2. **Settings restart correcto** (#6) — await shutdown handles, restarting state propagado, queue de pending turns post-respawn. ~3h
3. **MCP sandbox real** (#2) — Job Object con restricted token en Windows, namespaces en Linux. ~4h
4. **Quitar `shell:default`** (#15) — auditar usages, migrar a Rust commands. ~1h
5. **Snapshots por tab** (#19) — `Map<tabId, Snapshot>`, rendering del active. ~2h
6. **SetupView fast path** (#9) — 2 steps (provider+key, live test). Mover sandbox/gateway/tuning a "Advanced". ~2h

---

## SPRINT 2 — mes (20h)

Polish para v0.1 público de verdad.

1. **Mascot funcional** (#11) — click → popover con state reason + last event + XP milestone + "View stats". ~3h
2. **SideRail 2-tier** (#10) — NAV core + EXTEND collapsible + admin/data hidden. ~3h
3. **TabBar coachmark + auto-name** (#23) — first-message como tab title. ~2h
4. **Stderr translation layer** (#28) — regex map → user msg. ~1h
5. **Backpressure IPC + protocol versioning** (#8 + #17) — drop strategy para text-delta queues + check de protocol mismatch. ~4h
6. **Auto-reconnect con backoff** (#5 estructural) — reemplazar botón manual. ~2h
7. **Tab memory monitoring** (#18) — soft warning a 6 tabs + diagnostic command. ~2h
8. **Zombie sidecar detection** (#18) — watchdog de health. ~2h
9. **Modal a11y** (#21) — `aria-labelledby` + role en box correcto. ~30min
10. **handleCloseTab ref pattern** (#22) — sacar requestQueues de deps. ~30min

---

## ROADMAP futuro (no incluir en v0.1)

- **Sleep mode** (#25) — el feature más vendido del README pero más complejo. Requiere TODO scanner en repo + agente autonomo + git operations + diff review UI. Sprint dedicado de 1-2 semanas.
- **6 sandboxes** (#30) — actualmente 2 (local, docker). ssh/modal/daytona/singularity requieren cada uno integración + auth + UX. ~1 semana cada uno.
- **Tauri updater + signature** (#26) — cuando estén listos para auto-update. Minisign keys.
- **Tab-level credentials** — para usar Mate en un tab y Claude en otro sin restart.

---

## Rebrand checklist completo (#12)

| File | Línea | Stale | Replace |
|---|---|---|---|
| `.github/workflows/studio-release.yml` | 1, 108, 110 | "cero studio release", "cero studio $tag", "cero studio —" | "Vybin release", "Vybin $tag", "Vybin —" |
| `studio/src-tauri/Cargo.toml` | 2, 12 | `name = "cero-studio"`, `cero_studio_lib` | `vybin`, `vybin_lib` |
| `studio/package-lock.json` | 2, 8 | `"name": "cero-studio"` | `"name": "vybin"` (regen con install) |
| `studio/src/App.tsx` | 41 | `// cero studio v0.3.0...` | `// Vybin v0.2.0...` |
| `studio/src/hooks/useTabs.ts` | 1 | comment "cero studio" | Vybin |
| `studio/src/TabBar.tsx` | 1 | comment "cero studio" | Vybin |
| `studio/src/views/StatsView.tsx` | 1 | comment "cero studio" | Vybin |
| `studio/src/views/SetupView.tsx` | 441 | `WELCOME TO CERO STUDIO` | `WELCOME TO VYBIN` |
| `studio/src/views/UserModelView.test.tsx` | 49, 212 | fixture "cero studio" | "vybin" |
| `studio/src/__tests__/setup-flow.test.tsx` | 71 | `WELCOME TO CERO STUDIO` (test asume string vieja) | `WELCOME TO VYBIN` |
| `studio/STATUS.md` | título + cuerpo | "cero studio" | "Vybin" o archivar |
| `studio/CHECKLIST.md` | título + cuerpo | "cero studio" | "Vybin" o archivar |

---
*Actualizado: 2026-05-10. Releer al cerrar sprint para ver qué tachás.*
