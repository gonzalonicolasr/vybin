// Mascot — pixel-art CRT-head that lives in the corner.
//
// Renders a 64×96 SVG with a head, neck, base, and an antenna. The face
// (eyes + mouth) is swapped per state; the rest stays static. Animations
// (blink, bounce, shake, glow, confetti) live in styles.css and are gated
// by `data-state` on the wrapper.

import React from "react";
import type { MascotState } from "./hooks/useMascot";

export interface MascotProps {
  readonly state: MascotState;
  readonly level: number;
  readonly xp: number;
  readonly xpToNext: number;
  readonly xpPercent: number;
}

export function Mascot({
  state,
  level,
  xp,
  xpToNext,
  xpPercent,
}: MascotProps): React.JSX.Element {
  const xpLabel = state === "level-up"
    ? "★ LEVEL UP ★"
    : `XP ${xp}/${xp + xpToNext}`;

  return (
    <div
      className="mascot"
      data-state={state}
      role="status"
      aria-label={`Vybin level ${level}, ${state}`}
    >
      <svg
        className="mascot-svg"
        viewBox="0 0 64 96"
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        {/* antenna — wobbles in idle/think */}
        <g className="m-antenna">
          <rect x="31" y="2" width="2" height="6" className="m-fg" />
          <rect x="29" y="0" width="6" height="2" className="m-accent" />
        </g>

        {/* CRT head shell — bevelled corners drawn with notches */}
        <rect x="6"  y="10" width="52" height="38" className="m-shell" />
        <rect x="4"  y="12" width="2"  height="34" className="m-shell" />
        <rect x="58" y="12" width="2"  height="34" className="m-shell" />
        <rect x="8"  y="8"  width="48" height="2"  className="m-shell" />
        <rect x="8"  y="48" width="48" height="2"  className="m-shell" />

        {/* screen inset — face lives here */}
        <rect x="10" y="14" width="44" height="30" className="m-screen" />

        {/* scanline overlay (subtle) */}
        <rect x="10" y="20" width="44" height="1" className="m-scanline" />
        <rect x="10" y="28" width="44" height="1" className="m-scanline" />
        <rect x="10" y="36" width="44" height="1" className="m-scanline" />

        {/* face — picked by state */}
        <Face state={state} />

        {/* neck */}
        <rect x="28" y="50" width="8" height="6" className="m-fg" />
        <rect x="26" y="56" width="12" height="2" className="m-fg" />

        {/* base/foot */}
        <rect x="16" y="58" width="32" height="6" className="m-shell" />
        <rect x="14" y="60" width="2"  height="4" className="m-shell" />
        <rect x="48" y="60" width="2"  height="4" className="m-shell" />

        {/* status LED on the base — green when idle/cheer, amber think, red x-eyes */}
        <rect x="42" y="60" width="3" height="3" className="m-led" />

        {/* state-specific overlays */}
        {state === "cheer" ? <CheerSparkles /> : null}
        {state === "level-up" ? <LevelUpRays /> : null}
      </svg>

      <div className="mascot-meta">
        <div className="mascot-lvl">
          <span className="mascot-lvl-label">Lv.</span>
          <span className="mascot-lvl-num">{level}</span>
        </div>
        <div className="mascot-xp-bar" title={xpLabel}>
          <div
            className="mascot-xp-fill"
            style={{ width: `${xpPercent}%` }}
          />
        </div>
        <div className="mascot-xp-text">{xpLabel}</div>
      </div>

      {state === "level-up" ? <Confetti /> : null}
    </div>
  );
}

// ─── faces ────────────────────────────────────────────────────────────────

function Face({ state }: { readonly state: MascotState }): React.JSX.Element {
  switch (state) {
    case "idle":
      return (
        <g className="m-face m-face-idle">
          {/* round-ish eyes */}
          <rect x="20" y="24" width="4" height="4" className="m-eye" />
          <rect x="40" y="24" width="4" height="4" className="m-eye" />
          {/* flat neutral mouth */}
          <rect x="26" y="38" width="12" height="2" className="m-mouth" />
        </g>
      );
    case "think":
      return (
        <g className="m-face m-face-think">
          {/* squinted eyes (short horizontal) */}
          <rect x="20" y="26" width="4" height="2" className="m-eye" />
          <rect x="40" y="26" width="4" height="2" className="m-eye" />
          {/* animated dots */}
          <rect x="26" y="38" width="2" height="2" className="m-mouth m-dot m-dot-1" />
          <rect x="31" y="38" width="2" height="2" className="m-mouth m-dot m-dot-2" />
          <rect x="36" y="38" width="2" height="2" className="m-mouth m-dot m-dot-3" />
        </g>
      );
    case "cheer":
      return (
        <g className="m-face m-face-cheer">
          {/* ^ ^ eyes — two rects per eye in chevron */}
          <rect x="19" y="26" width="2" height="2" className="m-eye" />
          <rect x="21" y="24" width="2" height="2" className="m-eye" />
          <rect x="23" y="26" width="2" height="2" className="m-eye" />
          <rect x="39" y="26" width="2" height="2" className="m-eye" />
          <rect x="41" y="24" width="2" height="2" className="m-eye" />
          <rect x="43" y="26" width="2" height="2" className="m-eye" />
          {/* smile — flat line + downward corners */}
          <rect x="26" y="38" width="12" height="2" className="m-mouth" />
          <rect x="24" y="36" width="2"  height="2" className="m-mouth" />
          <rect x="38" y="36" width="2"  height="2" className="m-mouth" />
        </g>
      );
    case "x-eyes":
      return (
        <g className="m-face m-face-xeyes">
          {/* × eyes left */}
          <rect x="19" y="23" width="2" height="2" className="m-eye" />
          <rect x="21" y="25" width="2" height="2" className="m-eye" />
          <rect x="23" y="27" width="2" height="2" className="m-eye" />
          <rect x="19" y="27" width="2" height="2" className="m-eye" />
          <rect x="23" y="23" width="2" height="2" className="m-eye" />
          {/* × eyes right */}
          <rect x="39" y="23" width="2" height="2" className="m-eye" />
          <rect x="41" y="25" width="2" height="2" className="m-eye" />
          <rect x="43" y="27" width="2" height="2" className="m-eye" />
          <rect x="39" y="27" width="2" height="2" className="m-eye" />
          <rect x="43" y="23" width="2" height="2" className="m-eye" />
          {/* sad mouth — inverted curve */}
          <rect x="26" y="38" width="12" height="2" className="m-mouth" />
          <rect x="24" y="40" width="2"  height="2" className="m-mouth" />
          <rect x="38" y="40" width="2"  height="2" className="m-mouth" />
        </g>
      );
    case "level-up":
      return (
        <g className="m-face m-face-up">
          {/* * eyes — 4-rect star each */}
          <rect x="20" y="24" width="4" height="2" className="m-eye" />
          <rect x="21" y="22" width="2" height="6" className="m-eye" />
          <rect x="40" y="24" width="4" height="2" className="m-eye" />
          <rect x="41" y="22" width="2" height="6" className="m-eye" />
          {/* O mouth — open ring */}
          <rect x="29" y="36" width="6" height="2" className="m-mouth" />
          <rect x="29" y="40" width="6" height="2" className="m-mouth" />
          <rect x="28" y="38" width="2" height="2" className="m-mouth" />
          <rect x="34" y="38" width="2" height="2" className="m-mouth" />
        </g>
      );
  }
}

// ─── cheer sparkles ────────────────────────────────────────────────────────

function CheerSparkles(): React.JSX.Element {
  // Four 2×2 sparks pop around the head, each with its own delay.
  const sparks = [
    { x: 4,  y: 14, delay: 0 },
    { x: 56, y: 16, delay: 0.12 },
    { x: 6,  y: 36, delay: 0.24 },
    { x: 56, y: 38, delay: 0.36 },
  ];
  return (
    <g className="m-sparkles">
      {sparks.map((s, i) => (
        <rect
          key={i}
          x={s.x}
          y={s.y}
          width="2"
          height="2"
          className="m-sparkle"
          style={{ animationDelay: `${s.delay}s` }}
        />
      ))}
    </g>
  );
}

// ─── level-up rays ─────────────────────────────────────────────────────────

function LevelUpRays(): React.JSX.Element {
  // Eight rays radiating from the screen centre (32, 28) — they grow
  // outward then fade. Each rotated to a different angle.
  const angles = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <g className="m-rays" transform="translate(32 28)">
      {angles.map((a, i) => (
        <rect
          key={a}
          x="-1"
          y="-30"
          width="2"
          height="14"
          className="m-ray"
          transform={`rotate(${a})`}
          style={{ animationDelay: `${i * 0.04}s` }}
        />
      ))}
    </g>
  );
}

// ─── confetti for level-up ─────────────────────────────────────────────────

function Confetti(): React.JSX.Element {
  // 8 squares spawned from mascot center, fly outward via CSS keyframes.
  // Each piece gets its own --tx/--ty CSS var so they go in different dirs.
  const pieces = [
    { tx:  46, ty: -34, color: "var(--accent)" },
    { tx: -42, ty: -28, color: "var(--magenta)" },
    { tx:  38, ty:  44, color: "var(--amber)" },
    { tx: -36, ty:  46, color: "var(--cyan)" },
    { tx:   8, ty: -52, color: "var(--accent)" },
    { tx:  -6, ty:  56, color: "var(--magenta)" },
    { tx:  56, ty:   4, color: "var(--amber)" },
    { tx: -54, ty:  -8, color: "var(--cyan)" },
  ];
  return (
    <div className="mascot-confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="mascot-confetti-piece"
          style={{
            ["--tx" as string]: `${p.tx}px`,
            ["--ty" as string]: `${p.ty}px`,
            background: p.color,
            animationDelay: `${i * 0.04}s`,
          }}
        />
      ))}
    </div>
  );
}
