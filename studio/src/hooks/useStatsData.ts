// Stats data hook — aggregates from usage.db, cron.db, and skill/lesson counts.
// Returns gracefully empty data when DBs don't exist (cero not yet initialized).

import { invoke } from "@tauri-apps/api/core";
import { readDir, BaseDirectory } from "@tauri-apps/plugin-fs";
import { useCallback, useEffect, useState } from "react";

// ─── raw query shape (mirrors CronQueryResult in Rust) ──────────────────────

interface QueryResult {
  columns: string[];
  rows: Array<Array<unknown>>;
}

function rowToObj(cols: string[], row: Array<unknown>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  cols.forEach((c, i) => { o[c] = row[i]; });
  return o;
}

async function safeQuery(cmd: "usage_db_query" | "cron_db_query", sql: string): Promise<Array<Record<string, unknown>>> {
  try {
    const res = await invoke<QueryResult>(cmd, { sql });
    if (!res.columns.length) return [];
    return res.rows.map((r) => rowToObj(res.columns, r));
  } catch {
    return [];
  }
}

// ─── exported types ──────────────────────────────────────────────────────────

export interface DailyUsage {
  date: string;         // "YYYY-MM-DD"
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  turns: number;
}

export interface ModelUsage {
  model: string;
  total_tokens: number;
  cost_usd: number;
  turns: number;
}

export interface SkillStat {
  name: string;
  applied: number;
  success_rate: number | null;
}

export interface CronStats {
  total: number;
  enabled: number;
  ok_runs: number;
  error_runs: number;
}

export interface StatsData {
  daily: DailyUsage[];
  models: ModelUsage[];
  skills: SkillStat[];
  cron: CronStats;
  totalSessions: number;
  skillCount: number;
  lessonCount: number;
  totalCostUsd: number;
  totalTokens: number;
}

const EMPTY_STATS: StatsData = {
  daily: [],
  models: [],
  skills: [],
  cron: { total: 0, enabled: 0, ok_runs: 0, error_runs: 0 },
  totalSessions: 0,
  skillCount: 0,
  lessonCount: 0,
  totalCostUsd: 0,
  totalTokens: 0,
};

// ─── fetchers ────────────────────────────────────────────────────────────────

async function fetchDailyUsage(days = 30): Promise<DailyUsage[]> {
  const cutoff = Date.now() - days * 86400_000;
  const cutoffSec = Math.floor(cutoff / 1000);
  const rows = await safeQuery(
    "usage_db_query",
    `SELECT date(started_at, 'unixepoch') as date,
            SUM(input_tokens) as input_tokens,
            SUM(output_tokens) as output_tokens,
            SUM(COALESCE(cost_usd, 0)) as cost_usd,
            COUNT(*) as turns
     FROM turns
     WHERE started_at >= ${cutoffSec}
     GROUP BY date(started_at, 'unixepoch')
     ORDER BY date ASC`,
  );
  return rows.map((r) => ({
    date: String(r["date"] ?? ""),
    input_tokens: Number(r["input_tokens"] ?? 0),
    output_tokens: Number(r["output_tokens"] ?? 0),
    cost_usd: Number(r["cost_usd"] ?? 0),
    turns: Number(r["turns"] ?? 0),
  }));
}

async function fetchModelUsage(): Promise<ModelUsage[]> {
  const rows = await safeQuery(
    "usage_db_query",
    `SELECT model,
            SUM(input_tokens + output_tokens) as total_tokens,
            SUM(COALESCE(cost_usd, 0)) as cost_usd,
            COUNT(*) as turns
     FROM turns
     GROUP BY model
     ORDER BY total_tokens DESC
     LIMIT 10`,
  );
  return rows.map((r) => ({
    model: String(r["model"] ?? "unknown"),
    total_tokens: Number(r["total_tokens"] ?? 0),
    cost_usd: Number(r["cost_usd"] ?? 0),
    turns: Number(r["turns"] ?? 0),
  }));
}

async function fetchTotalSessions(): Promise<number> {
  const rows = await safeQuery(
    "usage_db_query",
    "SELECT COUNT(DISTINCT session_id) as cnt FROM turns",
  );
  return Number(rows[0]?.["cnt"] ?? 0);
}

async function fetchSkillStats(): Promise<SkillStat[]> {
  // Query skill_usages table; gracefully returns empty if table doesn't exist
  const rows = await safeQuery(
    "usage_db_query",
    `SELECT skill_name as name,
            COUNT(*) as applied,
            ROUND(AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END) * 100, 1) as success_rate
     FROM skill_usages
     GROUP BY skill_name
     ORDER BY applied DESC
     LIMIT 15`,
  );
  return rows.map((r) => ({
    name: String(r["name"] ?? ""),
    applied: Number(r["applied"] ?? 0),
    success_rate: r["success_rate"] != null ? Number(r["success_rate"]) : null,
  }));
}

async function fetchCronStats(): Promise<CronStats> {
  const [jobRows, runRows] = await Promise.all([
    safeQuery("cron_db_query", "SELECT COUNT(*) as total, SUM(enabled) as enabled FROM cron_jobs"),
    safeQuery("cron_db_query", "SELECT SUM(success) as ok, SUM(1 - success) as errors FROM cron_outputs"),
  ]);
  return {
    total: Number(jobRows[0]?.["total"] ?? 0),
    enabled: Number(jobRows[0]?.["enabled"] ?? 0),
    ok_runs: Number(runRows[0]?.["ok"] ?? 0),
    error_runs: Number(runRows[0]?.["errors"] ?? 0),
  };
}

async function countFiles(subdir: string): Promise<number> {
  try {
    const entries = await readDir(`.cero/${subdir}`, { baseDir: BaseDirectory.Home });
    return entries.filter((e) => !e.isDirectory).length;
  } catch {
    return 0;
  }
}

// ─── hook ────────────────────────────────────────────────────────────────────

export interface UseStatsDataResult {
  readonly data: StatsData;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
}

export function useStatsData(): UseStatsDataResult {
  const [data, setData] = useState<StatsData>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [daily, models, skills, cron, totalSessions, skillCount, lessonCount] =
        await Promise.all([
          fetchDailyUsage(30),
          fetchModelUsage(),
          fetchSkillStats(),
          fetchCronStats(),
          fetchTotalSessions(),
          countFiles("skills"),
          countFiles("lessons"),
        ]);

      const totalCostUsd = daily.reduce((s, d) => s + d.cost_usd, 0);
      const totalTokens = daily.reduce((s, d) => s + d.input_tokens + d.output_tokens, 0);

      setData({ daily, models, skills, cron, totalSessions, skillCount, lessonCount, totalCostUsd, totalTokens });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return { data, loading, error, refresh };
}
