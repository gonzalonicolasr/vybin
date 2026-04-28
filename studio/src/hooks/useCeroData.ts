// Direct read access to ~/.cero/* artifacts produced by the cero binary.
// We use Tauri's fs plugin (gated by capabilities/default.json scope) instead
// of round-tripping through cero subcommands — faster, simpler, no subprocess.
//
// Schemas are mirrored in TS from cero's Zod schemas (they're stable JSON).

import {
  exists,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
  BaseDirectory,
} from "@tauri-apps/plugin-fs";
import { useCallback, useEffect, useState } from "react";

const CERO_HOME_REL = ".cero"; // joined with HOME via BaseDirectory.Home

// ─────────────── types (mirror cero schemas) ───────────────

export interface SolutionStep {
  description: string;
  tools_hint?: string[];
}
export interface Skill {
  id: string;
  name: string;
  category: string;
  problem: string;
  solution_steps: SolutionStep[];
  preconditions: string[];
  postconditions: string[];
  tags: string[];
  state: "draft" | "validated" | "archived";
  version: number;
  parent_id?: string;
  source: "auto" | "user";
  created_at: number;
  updated_at: number;
  applied_count: number;
  success_count: number;
  failure_count: number;
}

export interface Lesson {
  id: string;
  session_id: string;
  title: string;
  what_learned: string;
  applies_to: string[];
  ts: number;
}

export interface ExpertiseArea {
  area: string;
  level: "beginner" | "intermediate" | "advanced" | "expert";
  evidence_count: number;
  last_evidence_at?: number;
}
export interface Project {
  name: string;
  cwd?: string;
  description?: string;
  status: "active" | "paused" | "archived";
  last_active_at: number;
}
export interface Preference {
  key: string;
  value: string | number | boolean;
  confidence: number;
  source: "explicit" | "inferred";
  ts: number;
}
export interface UserModelHistoryEntry {
  ts: number;
  source: "agent" | "user" | "import";
  patch: Record<string, unknown>;
  reason?: string;
}
export interface UserModel {
  version: number;
  preferences: Preference[];
  expertise_areas: ExpertiseArea[];
  current_projects: Project[];
  working_style: Record<string, unknown>;
  communication_prefs: Record<string, unknown>;
  history: UserModelHistoryEntry[];
  last_updated_at: number;
}

// ─────────────── readers ───────────────

async function safeRead<T>(path: string): Promise<T | null> {
  try {
    if (!(await exists(path, { baseDir: BaseDirectory.Home }))) return null;
    const txt = await readTextFile(path, { baseDir: BaseDirectory.Home });
    return JSON.parse(txt) as T;
  } catch {
    return null;
  }
}

export async function listSkills(): Promise<Skill[]> {
  // Scan ~/.cero/skills/<category>/*.json
  const out: Skill[] = [];
  try {
    const cats = await readDir(`${CERO_HOME_REL}/skills`, {
      baseDir: BaseDirectory.Home,
    });
    for (const cat of cats) {
      if (!cat.isDirectory) continue;
      const files = await readDir(`${CERO_HOME_REL}/skills/${cat.name}`, {
        baseDir: BaseDirectory.Home,
      });
      for (const f of files) {
        if (!f.isFile || !f.name?.endsWith(".json")) continue;
        const skill = await safeRead<Skill>(
          `${CERO_HOME_REL}/skills/${cat.name}/${f.name}`,
        );
        if (skill) out.push(skill);
      }
    }
  } catch {
    /* dir may not exist */
  }
  return out.sort((a, b) => b.created_at - a.created_at);
}

export async function deleteSkill(skill: Skill): Promise<void> {
  const path = `${CERO_HOME_REL}/skills/${skill.category}/${skill.id}.json`;
  await remove(path, { baseDir: BaseDirectory.Home });
}

/**
 * Persist an updated skill back to disk. Used by the JSON-edit flow in
 * `SkillsView` so the user can edit metadata (steps, problem, tags…) directly.
 * The caller is responsible for shape validation — we only enforce that the
 * `id` in the parsed JSON matches the original (otherwise we'd silently move
 * the row).
 */
export async function saveSkill(original: Skill, updated: Skill): Promise<void> {
  if (updated.id !== original.id) {
    throw new Error(`id mismatch: original=${original.id} updated=${updated.id}`);
  }
  const path = `${CERO_HOME_REL}/skills/${original.category}/${original.id}.json`;
  await writeTextFile(path, JSON.stringify(updated, null, 2), {
    baseDir: BaseDirectory.Home,
  });
}

/**
 * Persist an updated lesson. Lessons live grouped by session_id in
 * `~/.cero/lessons/<session_id>.json`. We rewrite that file replacing the
 * matching lesson by id; if the session_id changed in the new payload we move
 * the lesson to the right file (delete from old, append to new).
 */
export async function saveLesson(original: Lesson, updated: Lesson): Promise<void> {
  if (updated.id !== original.id) {
    throw new Error(`id mismatch: original=${original.id} updated=${updated.id}`);
  }
  const oldPath = `${CERO_HOME_REL}/lessons/${original.session_id}.json`;
  const wrapper = await safeRead<{ lessons: Lesson[]; session_id?: string }>(oldPath);
  if (!wrapper || !Array.isArray(wrapper.lessons)) {
    throw new Error(`lesson file not found: ${oldPath}`);
  }
  if (updated.session_id === original.session_id) {
    const next = wrapper.lessons.map((l) => (l.id === original.id ? updated : l));
    await writeTextFile(
      oldPath,
      JSON.stringify({ ...wrapper, lessons: next }, null, 2),
      { baseDir: BaseDirectory.Home },
    );
    return;
  }
  // session_id moved → remove from old, append to new file
  const remaining = wrapper.lessons.filter((l) => l.id !== original.id);
  if (remaining.length === 0) {
    try { await remove(oldPath, { baseDir: BaseDirectory.Home }); } catch { /* ignore */ }
  } else {
    await writeTextFile(
      oldPath,
      JSON.stringify({ ...wrapper, lessons: remaining }, null, 2),
      { baseDir: BaseDirectory.Home },
    );
  }
  const newPath = `${CERO_HOME_REL}/lessons/${updated.session_id}.json`;
  const target = await safeRead<{ lessons: Lesson[]; session_id?: string }>(newPath);
  const merged = target && Array.isArray(target.lessons) ? [...target.lessons, updated] : [updated];
  await writeTextFile(
    newPath,
    JSON.stringify({ session_id: updated.session_id, lessons: merged }, null, 2),
    { baseDir: BaseDirectory.Home },
  );
}

/**
 * Delete a single lesson by id. Lessons are grouped per session_id in
 * `~/.cero/lessons/<session_id>.json`. We rewrite the file with the lesson
 * removed; if the file would be empty after, we delete it entirely.
 */
export async function deleteLesson(lesson: Lesson): Promise<void> {
  const path = `${CERO_HOME_REL}/lessons/${lesson.session_id}.json`;
  const wrapper = await safeRead<{ lessons: Lesson[]; session_id?: string }>(path);
  if (!wrapper || !Array.isArray(wrapper.lessons)) return;
  const remaining = wrapper.lessons.filter((l) => l.id !== lesson.id);
  if (remaining.length === 0) {
    try {
      await remove(path, { baseDir: BaseDirectory.Home });
    } catch {
      // fall through to overwriting
    }
    return;
  }
  await writeTextFile(
    path,
    JSON.stringify({ ...wrapper, lessons: remaining }, null, 2),
    { baseDir: BaseDirectory.Home },
  );
}

export async function listLessons(): Promise<Lesson[]> {
  const out: Lesson[] = [];
  try {
    const files = await readDir(`${CERO_HOME_REL}/lessons`, {
      baseDir: BaseDirectory.Home,
    });
    for (const f of files) {
      if (!f.isFile || !f.name?.endsWith(".json")) continue;
      const wrapper = await safeRead<{ lessons: Lesson[]; session_id?: string }>(
        `${CERO_HOME_REL}/lessons/${f.name}`,
      );
      if (wrapper && Array.isArray(wrapper.lessons)) {
        out.push(...wrapper.lessons);
      }
    }
  } catch {
    /* dir may not exist */
  }
  return out.sort((a, b) => b.ts - a.ts);
}

export async function readUserModel(): Promise<UserModel | null> {
  return await safeRead<UserModel>(`${CERO_HOME_REL}/user-model.json`);
}

/**
 * Persist a modified UserModel back to ~/.cero/user-model.json.
 * Performs a light shape guard before writing — rejects if required top-level
 * fields are missing or have the wrong type, so a corrupt draft cannot silently
 * overwrite a good model.
 */
export async function saveUserModel(model: UserModel): Promise<void> {
  // Shape guard (mirrors UserModelSchema required fields)
  if (typeof model.version !== "number") throw new Error("invalid model: version must be a number");
  if (!Array.isArray(model.expertise_areas)) throw new Error("invalid model: expertise_areas must be an array");
  if (!Array.isArray(model.current_projects)) throw new Error("invalid model: current_projects must be an array");
  if (!Array.isArray(model.preferences)) throw new Error("invalid model: preferences must be an array");
  if (!Array.isArray(model.history)) throw new Error("invalid model: history must be an array");
  if (typeof model.last_updated_at !== "number") throw new Error("invalid model: last_updated_at must be a number");

  const updated: UserModel = {
    ...model,
    last_updated_at: Date.now(),
    version: model.version + 1,
    history: [
      ...model.history,
      {
        ts: Date.now(),
        source: "user",
        patch: {},
        reason: "manual edit via Studio",
      },
    ],
  };

  await writeTextFile(
    `${CERO_HOME_REL}/user-model.json`,
    JSON.stringify(updated, null, 2),
    { baseDir: BaseDirectory.Home },
  );
}

// ─────────────── hooks ───────────────

export interface UseListResult<T> {
  readonly items: T[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
}

function useList<T>(
  fetcher: () => Promise<T[]>,
  deps: ReadonlyArray<unknown>,
): UseListResult<T> {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const data = await fetcher();
      setItems(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { items, loading, error, refresh };
}

export function useSkills(version: number): UseListResult<Skill> {
  return useList(listSkills, [version]);
}
export function useLessons(version: number): UseListResult<Lesson> {
  return useList(listLessons, [version]);
}

export function useUserModel(version: number): {
  readonly model: UserModel | null;
  readonly loading: boolean;
  readonly refresh: () => Promise<void>;
} {
  const [model, setModel] = useState<UserModel | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setModel(await readUserModel());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  return { model, loading, refresh };
}
