// ClickParticles — rogue-like pixel click effect.
// Spawns 4-6 tiny pixel-art squares at each click position that scatter
// outward and fade in ~600ms. Mounted globally in App.tsx.
// Uses absolutely-positioned divs (not canvas) + CSS animations.
// pointer-events: none throughout — never interrupts click targets.

import { useEffect, useRef } from "react";

interface Particle {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  color: string;
  size: number;
}

// Pixel-violet palette: accent violet + amber accent
const COLORS = [
  "var(--accent)",   // violet
  "var(--accent)",   // violet (weighted heavier)
  "var(--amber)",    // amber
  "var(--accent-d)", // darker violet
];

const PARTICLE_COUNT_MIN = 4;
const PARTICLE_COUNT_MAX = 6;
const LIFETIME_MS = 600;

let particleSeq = 0;
const nextId = (): number => ++particleSeq;

function randomBetween(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

function spawnParticles(x: number, y: number): Particle[] {
  const count = Math.round(randomBetween(PARTICLE_COUNT_MIN, PARTICLE_COUNT_MAX));
  return Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = randomBetween(40, 120);
    return {
      id: nextId(),
      x,
      y,
      dx: Math.cos(angle) * speed,
      dy: Math.sin(angle) * speed,
      color: COLORS[Math.floor(Math.random() * COLORS.length)] ?? "var(--accent)",
      size: Math.round(randomBetween(3, 6)),
    };
  });
}

export function ClickParticles(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement;
      // Skip window-control buttons to avoid visual noise on close/min/max
      if (target.closest(".window-controls")) return;

      const container = containerRef.current;
      if (!container) return;

      const particles = spawnParticles(e.clientX, e.clientY);

      for (const p of particles) {
        const el = document.createElement("div");
        el.style.cssText = [
          "position:fixed",
          `left:${p.x}px`,
          `top:${p.y}px`,
          `width:${p.size}px`,
          `height:${p.size}px`,
          `background:${p.color}`,
          "pointer-events:none",
          "border-radius:0",
          "z-index:9998",
          "will-change:transform,opacity",
          `box-shadow:0 0 3px ${p.color}`,
        ].join(";");

        container.appendChild(el);

        // Animate with Web Animations API — no stylesheet needed
        el.animate(
          [
            { transform: "translate(0,0) scale(1)", opacity: 1 },
            {
              transform: `translate(${p.dx * LIFETIME_MS / 1000}px, ${p.dy * LIFETIME_MS / 1000}px) scale(0)`,
              opacity: 0,
            },
          ],
          { duration: LIFETIME_MS, easing: "ease-out", fill: "forwards" },
        ).onfinish = () => {
          container.removeChild(el);
        };
      }
    };

    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 9998,
        overflow: "visible",
      }}
    />
  );
}
