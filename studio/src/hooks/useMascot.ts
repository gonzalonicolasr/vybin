// useMascot — drives the CRT-head mascot's state machine.
//
// The mascot has five visual states:
//   - idle      : default, blinks occasionally
//   - think     : sticky — set when agent starts working, cleared when it
//                 finishes (cheer or x-eyes)
//   - cheer     : transient (~1.8s) — set when a turn ends successfully
//   - x-eyes    : transient (~1.5s) — set when an error arrives
//   - level-up  : transient (~2.8s) — set when level rises by 1+,
//                 takes precedence over every other state
//
// Level is computed from snapshot.stats.skills + lessons, with one level per
// XP_PER_LEVEL (default 5) — the README's "every 5 skills/lessons" rule.
//
// Sounds are played through lib/mascot-sounds on every state transition into
// cheer / x-eyes / level-up. Respects prefers-reduced-motion via the sounds
// module's own gate.

import { useCallback, useEffect, useRef, useState } from "react";
import type { SnapshotData } from "../components";
import { playChirp } from "../lib/mascot-sounds";

export type MascotState = "idle" | "think" | "cheer" | "x-eyes" | "level-up";
export type MascotTrigger = "think" | "cheer" | "error";

export interface MascotInfo {
  readonly state: MascotState;
  readonly level: number;
  readonly xp: number;
  readonly xpToNext: number;
  readonly xpPercent: number;
  readonly trigger: (event: MascotTrigger) => void;
}

const XP_PER_LEVEL = 5;

const TRANSIENT_DURATIONS_MS = {
  cheer: 1800,
  "x-eyes": 1500,
  "level-up": 2800,
} as const;

export function useMascot(snapshot: SnapshotData): MascotInfo {
  const totalXp = snapshot.stats.skills + snapshot.stats.lessons;
  const level = Math.floor(totalXp / XP_PER_LEVEL) + 1;
  const xp = totalXp % XP_PER_LEVEL;
  const xpToNext = XP_PER_LEVEL - xp;
  const xpPercent = (xp / XP_PER_LEVEL) * 100;

  const [state, setState] = useState<MascotState>("idle");
  const lastLevelRef = useRef(level);
  const timeoutRef = useRef<number | null>(null);

  // Level-up detector. Initial mount doesn't fire (lastLevelRef seeded above).
  useEffect(() => {
    if (level > lastLevelRef.current) {
      lastLevelRef.current = level;
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
      setState("level-up");
      playChirp("level-up");
      timeoutRef.current = window.setTimeout(() => {
        setState("idle");
        timeoutRef.current = null;
      }, TRANSIENT_DURATIONS_MS["level-up"]);
    } else {
      lastLevelRef.current = level;
    }
  }, [level]);

  // Cleanup pending timer on unmount so React doesn't warn.
  useEffect(() => {
    return (): void => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    };
  }, []);

  const trigger = useCallback((event: MascotTrigger): void => {
    setState((prev) => {
      // level-up is sticky for its full duration
      if (prev === "level-up") return prev;

      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      if (event === "think") {
        // sticky — caller must follow with cheer or error. No sound.
        return "think";
      }
      if (event === "cheer") {
        playChirp("cheer");
        timeoutRef.current = window.setTimeout(() => {
          setState("idle");
          timeoutRef.current = null;
        }, TRANSIENT_DURATIONS_MS.cheer);
        return "cheer";
      }
      // error
      playChirp("error");
      timeoutRef.current = window.setTimeout(() => {
        setState("idle");
        timeoutRef.current = null;
      }, TRANSIENT_DURATIONS_MS["x-eyes"]);
      return "x-eyes";
    });
  }, []);

  return { state, level, xp, xpToNext, xpPercent, trigger };
}
