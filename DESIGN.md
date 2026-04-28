# Vybin — Design System

> Free desktop AI agent for vibe coding. Aesthetic: **synthwave / Miami sunset / pixel-art CRT**.

This DESIGN.md is the source of truth for both the desktop app (`studio/`) and the marketing landing (`landing/`). When in doubt, this file wins.

---

## 1. Aesthetic direction

**Synthwave + retro-futurist + tropical sunset.** Think Outrun, Miami Vice, vaporwave album covers, late-80s arcade, Hotline Miami sunset palette. Combined with a CRT terminal substrate (scanlines, pixel fonts, monospace meta).

Reference (provided by user — informally "the look"): a circular sunset scene with **two large palm-tree silhouettes framing the left and right edges**, fronds arching toward the center, a **large sun** sitting on a flat ocean horizon (with classic 80s horizontal band-cuts), distant mountain silhouettes, and **small foreground palms** in the lower corners. Sky gradient: deep purple → magenta → orange → amber. Water: dark purple with a vertical sun-shimmer reflection.

**Do:**
- Two BIG framing palms (left + right), trunks at the edges, fronds curving inward and partially overlapping the sky.
- Big sun (not a tiny dot — should read as a clear circle with carved horizontal bands).
- Water reflection (vertical shimmer of the sun on the ocean).
- Mountain / cloud silhouettes on the horizon line.
- Pixel density that reads as silhouette art, NOT as antenna sticks.
- `shape-rendering="crispEdges"` on every SVG.
- Use `<rect>` blocks for trunks and fronds (each visual "pixel" = 4–6 SVG units minimum, never 1px).
- Use `<circle>` for the sun (not stacked rects).
- Tiny stars (1–2 units) in the upper sky.

**Don't:**
- Sparse palms with 3 stick fronds (looks like a spider).
- Tiny sun that reads as a hamburger / toast / coin.
- Photoreal rendering — keep it pixel art.
- Anti-aliased gradients on small features.
- Color outside the palette below.

---

## 2. Color palette

### Sunset palette (banners, hero art)

| Token            | Hex       | Use                                    |
|------------------|-----------|----------------------------------------|
| `--sky-1`        | `#1a0a2a` | Deepest sky (top), water shadow        |
| `--sky-2`        | `#2a1838` | Upper sky                              |
| `--sky-3`        | `#5a1f5e` | Sky midtone (purple/magenta)           |
| `--sky-4`        | `#a83468` | Sky lower (rose)                       |
| `--sky-5`        | `#e8694a` | Sky near horizon (orange)              |
| `--sky-6`        | `#f5b048` | Horizon glow (amber)                   |
| `--sky-7`        | `#f9d670` | Brightest horizon (yellow)             |
| `--sun-core`     | `#fff5c0` | Sun center (cream-white)               |
| `--sun-mid`      | `#ffd070` | Sun midtone                            |
| `--sun-edge`     | `#ff8a50` | Sun outer edge                         |
| `--reflection`   | `#ffd089` | Sun reflection on water                |
| `--silhouette`   | `#0a0510` | Palm trees, mountains, foreground      |
| `--cloud`        | `#5a1f5e` | Cloud shelf at horizon                 |
| `--star`         | `#ffe8b0` | Tiny stars in upper sky                |

### App tokens (existing — `studio/src/styles.css`)

Default theme `violet` (do NOT change without coordination):

| Token              | Hex       | Use                       |
|--------------------|-----------|---------------------------|
| `--bg`             | `#0c0a10` | App background            |
| `--bg-tint`        | `#110e18` | Cards, surfaces           |
| `--fg`             | `#e0d8ec` | Primary text              |
| `--dim`            | `#7a7390` | Secondary text            |
| `--muted`          | `#4a4555` | Tertiary / disabled       |
| `--accent`         | `#b894f5` | Primary accent (violet)   |
| `--accent-d`       | `#8a6fd4` | Pressed / hover accent    |
| `--amber`          | `#e5a83a` | Warnings, highlights      |
| `--magenta`        | `#d177c8` | "You" tags                |
| `--cyan`           | `#6ad7d1` | Code / inline             |
| `--green`          | `#4ec94e` | OK / online status        |
| `--red`            | `#d96a6a` | Errors                    |
| `--border`         | `#1f1a2a` | Borders                   |
| `--border-soft`    | `#181420` | Soft dividers             |

Themes `lima` (green) and `amber` exist — see `studio/src/styles.css:60-100`.

---

## 3. Typography

| Use              | Font                             | Notes                        |
|------------------|----------------------------------|------------------------------|
| Headings, logo   | `VT323`, `Berkeley Mono`         | Pixel font, large sizes      |
| Body, code, meta | `JetBrains Mono`, `Berkeley Mono`| 400/500/600 weights          |
| ASCII art logo   | `JetBrains Mono` 700, 9px        | `pre` element, fixed-width   |

Load via Google Fonts:
```
https://fonts.googleapis.com/css2?family=VT323&family=JetBrains+Mono:wght@400;500;600;700&display=swap
```

---

## 4. CRT scanlines (signature effect)

Apply on `body::before` (or top-level container):

```css
background: repeating-linear-gradient(
  0deg,
  rgba(0, 0, 0, 0) 0px,
  rgba(0, 0, 0, 0) 2px,
  rgba(184, 148, 245, 0.025) 2px,
  rgba(184, 148, 245, 0.025) 3px
);
pointer-events: none;
position: fixed;
inset: 0;
z-index: 1;
```

Plus a soft vignette on `body::after` (radial gradient, transparent center → 40% black corners).

---

## 5. Logo — VYBIN ASCII (canonical)

5-line pixel block, JetBrains Mono 700 9px, color `var(--accent)`:

```
██    ██ ██    ██ ███████  ██ ███   ██
██    ██  ██  ██  ██    ██ ██ ████  ██
██    ██   ████   ███████  ██ ██ ██ ██
 ██  ██    ████   ██    ██ ██ ██  ████
  ████     ████   ███████  ██ ██   ███
```

Wordmark for marketing/CTA contexts: `VYBIN` in VT323, color `#ffd089` (cream-orange) when over sunset, `var(--accent)` when over `--bg`.

---

## 6. Components

### Hero banner (landing + app header)

**Landing** (`landing/index.html`):
- viewBox `0 0 1200 700`
- Full sunset scene with framing palms, big sun, foreground palms, mountain silhouettes, water reflection.
- `preserveAspectRatio="xMidYMax slice"` so horizon stays visible on wide screens.

**App header** (`studio/src/components.tsx` — `Header`):
- viewBox `0 0 1200 120` (banner-shaped, much shorter)
- Compressed sunset scene: 2 framing palms (smaller, denser fronds), centered sun, water band, no foreground palms.
- Opacity ~0.55–0.65 so ASCII logo + meta remain legible.
- Pointer-events none (preserves `data-tauri-drag-region`).
- Content sits on top with `text-shadow: 0 1px 0 rgba(0,0,0,0.55)`.

### Sun component (rule)

```svg
<defs>
  <linearGradient id="sun" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#fff5c0"/>
    <stop offset="55%" stop-color="#ffd070"/>
    <stop offset="100%" stop-color="#ff8a50"/>
  </linearGradient>
</defs>
<circle cx="..." cy="..." r="..." fill="url(#sun)"/>
<!-- 80s horizontal band cuts, opacity 0.4–0.6 each -->
```

Sun radius rule of thumb: **8–14% of viewport width** (NOT smaller — it should dominate the horizon).

### Palm tree (rule)

A correct palm silhouette has:
- **Tall trunk** (12–18% of viewport height) made of stacked `<rect>` blocks, each shifted 1–2 units horizontally to suggest curvature.
- **Crown center**: small block at the top of the trunk.
- **6–10 fronds per palm** radiating from the crown (not just 4):
  - 2 arching far over the sun area (longest, with drooping leaflets).
  - 2 reaching outward from the frame.
  - 2 drooping down on each side.
  - 1–2 standing straight up.
- **Leaflets**: tiny rects (4–6 units) along each frond to suggest segments.
- Color: `#0a0510` (silhouette) — NEVER mid-tone.

A palm that looks like 4 antenna sticks is wrong. A palm that looks like a tropical silhouette is right.

### Foreground palms (landing only)

Smaller palms in lower corners, simpler (single trunk + 3–4 stubby fronds), darker than main palms — they read as foreground depth.

---

## 7. File map

| Asset             | Path                                                  |
|-------------------|-------------------------------------------------------|
| Landing           | `landing/index.html` (single self-contained file)     |
| App header        | `studio/src/components.tsx` (`Header` function)       |
| App styles        | `studio/src/styles.css`                               |
| Tauri config      | `studio/src-tauri/tauri.conf.json`                    |
| OG image (todo)   | `landing/og.png` — 1200×630, sunset scene + wordmark  |
| Favicon (todo)    | `landing/favicon.svg` — sun + tiny palm                |

---

## 8. Accessibility

- Contrast: text on sunset must hit WCAG AA. Use text-shadow as a fallback when contrast would otherwise drop below 4.5:1.
- All decorative SVG = `aria-hidden="true"`.
- Reduce motion: respect `prefers-reduced-motion` if any animation is added (currently none).
- Focus rings: `outline: 2px solid var(--accent); outline-offset: 2px`.

---

## 9. Iteration log

- **2026-04-28** — DESIGN.md created. First pass at sunset SVG art (both landing + app header) judged "horrible" by user — palms too sparse, sun too small, looks like spider antennas. Second pass owned by `ui-designer` agent with full reference + density rules above.
