# Vybin

> Free desktop AI agent for vibe coding. Self-improving, multi-model, local-first.

**Site:** https://vybin.ceroclawd.com

Vybin is a free, open desktop AI agent. No subscription. Bring your own API keys
(or run fully local with Ollama). Self-improves from every session, remembers
how *you* code, and runs on your machine.

## Repo layout

| Path | What |
|---|---|
| `landing/` | Marketing site (single self-contained `index.html`), deployed to `vybin.ceroclawd.com` |
| `studio/` | Tauri 2 desktop app — React + TypeScript + Vite UI, Rust shell, JSON-lines IPC to the underlying agent |
| `DESIGN.md` | Source of truth for the visual identity (synthwave / Miami sunset / pixel-art CRT) used by both surfaces |
| `.github/workflows/` | Release pipeline |

## Build the desktop app

Requirements: [Bun](https://bun.sh), [Rust](https://rustup.rs).

```bash
cd studio
bun install
bun run tauri:dev          # dev (hot reload)
bun run tauri:build        # release artifact (.msi / .dmg / .AppImage)
```

The desktop app talks to the underlying `cero` agent binary as a
[Tauri sidecar](https://v2.tauri.app/develop/sidecar/). Drop the platform-
appropriate `cero-*` binary into `studio/src-tauri/binaries/` before running
a release build (the release workflow handles this automatically).

## Run the landing locally

```bash
cd landing
python -m http.server 8080
# open http://localhost:8080
```

## Design

See [DESIGN.md](./DESIGN.md). TL;DR: synthwave palette (deep purple → magenta →
amber sunset), VT323 + JetBrains Mono, pixel-art CRT scanlines.

## License

TBD — placeholder MIT planned for v0.1 public release.
