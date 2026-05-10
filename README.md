```
██    ██ ██    ██ ███████  ██ ███   ██
██    ██  ██  ██  ██    ██ ██ ████  ██
██    ██   ████   ███████  ██ ██ ██ ██
 ██  ██    ████   ██    ██ ██ ██  ████
  ████     ████   ███████  ██ ██   ███
```

> **A desktop AI agent that has a face, levels up, and lives on your machine.**
> Free forever. Local-first. Open source. No subscription, ever.

[**vybin.ceroclawd.com**](https://vybin.ceroclawd.com) · [Releases](https://github.com/gonzalonicolasr/vybin/releases) · [Site (ES)](https://vybin.ceroclawd.com/es/)

---

## ▸ another ai coding tool? no.

Every "AI coding agent" today looks the same: text in, text out, $20/mo. Cursor wraps an editor. Claude Code wraps a CLI. Devin wraps a $500/mo subscription. They're useful, but they're **interchangeable**. The agent forgets you the moment you close the tab. There's no character, no continuity, no ownership.

**Vybin is the opposite.**

- It runs on **your machine**, not someone's cloud.
- It **learns who you are** — your stack, your patterns, your taste — and remembers across sessions.
- It has a **face**. A pixel-art mascot that lives in the corner, reacts to errors, sings on level up.
- It **levels up**. Every skill it learns, every lesson it remembers, makes it stronger. Pokémon for code agents.
- It's **$0**. No tier. No feature gate. No "pro plan."

```
                ╔════════════╗
                ║  ▒▒▒▒▒▒▒▒  ║
                ║  ▒ ◉  ◉ ▒  ║   "vibing."
                ║  ▒  ──  ▒  ║
                ║  ▒▒▒▒▒▒▒▒  ║
                ╚═════╤══════╝
                    ╔═╧═╗
                    ║▓▓▓║
                    ║▓▓▓║
                   ╔╝   ╚╗
                   ║▓   ▓║
                   ║▓   ▓║
                   ╚═════╝

      VYBIN — Lv.7  ▰▰▰▰▰▰▱▱▱▱  XP 240/350
```

---

## ▸ install (90 seconds to first vibe)

> **v0.1 is in active development — first public release coming soon.**
> Until then, build from source (instructions below) or watch [Releases](https://github.com/gonzalonicolasr/vybin/releases) for the first tag.

```bash
# windows (winget — post-v0.1)
winget install Vybin.Vybin

# macos (brew — post-v0.1)
brew install --cask vybin

# linux (.AppImage — available once v0.1 is tagged)
wget https://github.com/gonzalonicolasr/vybin/releases/latest/download/vybin.AppImage
chmod +x vybin.AppImage && ./vybin.AppImage
```

Or download the installer directly from [**Releases**](https://github.com/gonzalonicolasr/vybin/releases).

First boot:
1. Drop in any API key (Anthropic / OpenAI / Gemini / OpenRouter / …) **or** point it at your local Ollama.
2. Pick a model.
3. Type what you want.

That's it. No accounts. No telemetry. No "free trial expires in 14 days."

---

## ▸ what makes it different

|  | Vybin | Cursor | Claude Code | Devin |
|---|:---:|:---:|:---:|:---:|
| Free forever | ✅ | Limited | Pay-per-use | ❌ ($500+/mo) |
| Self-improving (skills + lessons) | ✅ | ❌ | Memory only | Internal |
| User-model (knows who you are) | ✅ | ❌ | ❌ | ❌ |
| Local models (Ollama) | ✅ | ❌ | ❌ | ❌ |
| 100% local data | ✅ | ❌ | CLI only | Cloud |
| Multi-platform gateway (Telegram/Discord) | ✅ | ❌ | ❌ | Slack only |
| Cron scheduler | ✅ | ❌ | ❌ | Internal |
| Has a face 😊 | ✅ | ❌ | ❌ | ❌ |
| Open source | ✅ | ❌ | ❌ | ❌ |

---

## ▸ what's actually inside

### · self-improving for real

Most "memory" features are glorified context dumps. Vybin builds three layers that compound over time:

```
~/.cero/
├── skills/      ← reusable recipes the agent wrote for itself ("vercel-style-landing", "stripe-checkout")
├── lessons/     ← things it screwed up and learned from ("don't quote env vars on Windows")
└── user-model/  ← who you are: stack, preferences, projects, expertise
```

Every session, Vybin scans these before it acts. By session #20 it stops asking you whether you prefer Tailwind. By session #50 it's faster than typing the prompt yourself.

### · 8 model providers, 6 sandboxes, 1 binary

```
PROVIDERS  anthropic · openai · bedrock · gemini
           openrouter · ollama (local) · groq
           mistral · deepseek · together

SANDBOXES  local · docker · ssh · modal
           daytona · singularity

GATEWAYS   telegram · discord · websocket · http (openai-compat)

TOOLS      ~30 built-in: browser (Playwright), voice (STT+TTS),
           vision + image gen, web search/extract/crawl,
           code execution, delegate, todo, checkpoints, MCP-native
```

Switch providers without restarting. Failover is automatic. Every credential lives on your disk.

### · the agent has a face

A pixel-art CRT-head mascot lives in the corner. It:
- **Idles** with subtle blinks and ambient lines (`*pixel hum*`, `vibing.`)
- **Thinks** with squinted eyes + animated dots when the agent is working
- **Cheers** with `^_^` eyes + 8-bit chirp when a turn finishes ✓
- **X-eyes** + descending beep when something breaks `[!]`
- **Levels up** with confetti + fanfare every 5 skills/lessons learned

Optional sound (off by default). Respects `prefers-reduced-motion`.

### · pokémon mode

Every skill the agent learns and every lesson it remembers contributes to its **level**. The mascot displays `Lv.X` + an XP bar. Crossing a milestone fires a `★ LEVEL UP ★` banner with sound and pixel confetti.

It's silly. It also makes you actually *want* to keep using it.

### · sleep mode `[coming in v0.2]`

**Not yet shipped.** The cron scheduler already lets you schedule any prompt on a timer. Sleep mode is the next step: Vybin will scan your repo for TODO comments overnight, attempt them in sandbox, and open local PRs for you to review in the morning. **Devin at $0, on your laptop, with no cloud round-trip.**

---

## ▸ the stack (for the curious)

```
┌─────────────────────────────────────────────┐
│  studio/  (Tauri 2 desktop app)             │
│  ┌─────────────────────────────────────┐    │
│  │  React 18 + TypeScript + Vite       │    │
│  │  - chat, skills, lessons, stats     │    │
│  │  - mascot, voice mode, multi-tab    │    │
│  └─────────────┬───────────────────────┘    │
│                │ JSON-lines IPC             │
│  ┌─────────────┴───────────────────────┐    │
│  │  Rust (Tauri shell + sidecar mgmt)  │    │
│  └─────────────┬───────────────────────┘    │
│                │ stdin/stdout               │
│  ┌─────────────┴───────────────────────┐    │
│  │  cero  (TypeScript agent runtime)   │    │
│  │  - turn loop · tool registry        │    │
│  │  - model providers · sandboxes      │    │
│  │  - skill manager · lesson learner   │    │
│  │  - user-model updater · scheduler   │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

The desktop UI lives in this repo. The agent runtime is in [`gonzalonicolasr/cero`](https://github.com/gonzalonicolasr/cero) and is shipped as a single sidecar binary inside the desktop app.

---

## ▸ build from source

You'll need: [Bun](https://bun.sh) (>= 1.0), [Rust](https://rustup.rs) (stable), and the platform's WebView runtime (WebView2 on Windows; pre-installed on macOS/Linux Ubuntu).

```bash
git clone https://github.com/gonzalonicolasr/vybin.git
cd vybin/studio
bun install

# dev (hot reload, opens window)
bun run tauri:dev

# release (.msi | .dmg | .AppImage)
bun run tauri:build
```

For release builds, drop the appropriate `cero-<target>` binary into `studio/src-tauri/binaries/`. The CI workflow under `.github/workflows/` handles this automatically.

### · run the landing site locally

```bash
cd landing
python -m http.server 8080
# → http://localhost:8080  (and /es/ for Spanish)
```

The landing is a single self-contained HTML file (no build step). The `es/` folder is the Spanish translation with a hreflang switcher.

---

## ▸ design

The whole product (app + landing) shares one visual identity: **synthwave + retro-futurist + tropical sunset**. Deep purple → magenta → amber palette, VT323 + JetBrains Mono, CRT scanlines, pixel-art everything.

The full system is documented in [`DESIGN.md`](./DESIGN.md) — palette tokens, typography, component rules, mascot states.

---

## ▸ contributing

Vybin is early. Issues, PRs, and ideas are very welcome — especially:

- **New tools** for the agent (~30 built-in, room for 100s more)
- **New sandboxes** (anyone want Firecracker?)
- **New gateways** (WhatsApp, Matrix, IRC, …)
- **Mascot skins** (yes, really — make a `vybin-tan` skin if you want)

Open an issue first if it's a big change. For small stuff, send a PR.

---

## ▸ license

MIT (planned for v0.1 public release).

The underlying agent runtime ([`cero`](https://github.com/gonzalonicolasr/cero)) is a fork inspired by [hermes-agent](https://github.com/NousResearch/hermes-agent) (also MIT, NousResearch).

---

```
made with synthwave & spite by ceroclawd
"every coder deserves an agent that knows them."
```
