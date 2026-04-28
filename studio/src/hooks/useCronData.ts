// Cron data hook — reads ~/.cero/cron.db via Tauri command cron_db_query.
// The backend runs rusqlite in a blocking thread; we expose typed rows here.

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

// ─── raw query result shape (mirrors Rust CronQueryResult) ──────────────────

interface QueryResult {
  columns: string[];
  rows: Array<Array<unknown>>;
}

// ─── domain types (mirror cron.db schema) ───────────────────────────────────

export interface CronJob {
  id: string;
  name: string;
  prompt: string;
  schedule_kind: string;
  schedule_expr: string | null;
  schedule_minutes: number | null;
  schedule_run_at: string | null;
  schedule_display: string;
  skills: string[];
  script: string | null;
  workdir: string | null;
  model: string | null;
  provider: string | null;
  deliver: string | null;
  repeat_times: number | null;
  repeat_completed: number;
  enabled: boolean;
  state: "scheduled" | "running" | "paused" | "completed" | "error" | string;
  paused_at: number | null;
  paused_reason: string | null;
  next_run_at: number | null;
  last_run_at: number | null;
  last_status: "ok" | "error" | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

export interface CronOutput {
  job_id: string;
  run_at: number;
  output_markdown: string | null;
  final_response: string | null;
  success: boolean;
  error_message: string | null;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function rowToObject(columns: string[], row: Array<unknown>): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  columns.forEach((col, i) => { obj[col] = row[i]; });
  return obj;
}

function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string") return fallback;
  try { return JSON.parse(v) as T; } catch { return fallback; }
}

function toJob(raw: Record<string, unknown>): CronJob {
  return {
    id: String(raw["id"] ?? ""),
    name: String(raw["name"] ?? ""),
    prompt: String(raw["prompt"] ?? ""),
    schedule_kind: String(raw["schedule_kind"] ?? ""),
    schedule_expr: raw["schedule_expr"] != null ? String(raw["schedule_expr"]) : null,
    schedule_minutes: raw["schedule_minutes"] != null ? Number(raw["schedule_minutes"]) : null,
    schedule_run_at: raw["schedule_run_at"] != null ? String(raw["schedule_run_at"]) : null,
    schedule_display: String(raw["schedule_display"] ?? ""),
    skills: parseJson<string[]>(raw["skills"], []),
    script: raw["script"] != null ? String(raw["script"]) : null,
    workdir: raw["workdir"] != null ? String(raw["workdir"]) : null,
    model: raw["model"] != null ? String(raw["model"]) : null,
    provider: raw["provider"] != null ? String(raw["provider"]) : null,
    deliver: raw["deliver"] != null ? String(raw["deliver"]) : null,
    repeat_times: raw["repeat_times"] != null ? Number(raw["repeat_times"]) : null,
    repeat_completed: Number(raw["repeat_completed"] ?? 0),
    enabled: Number(raw["enabled"]) === 1,
    state: String(raw["state"] ?? "scheduled"),
    paused_at: raw["paused_at"] != null ? Number(raw["paused_at"]) : null,
    paused_reason: raw["paused_reason"] != null ? String(raw["paused_reason"]) : null,
    next_run_at: raw["next_run_at"] != null ? Number(raw["next_run_at"]) : null,
    last_run_at: raw["last_run_at"] != null ? Number(raw["last_run_at"]) : null,
    last_status: raw["last_status"] != null ? (raw["last_status"] as "ok" | "error") : null,
    last_error: raw["last_error"] != null ? String(raw["last_error"]) : null,
    created_at: Number(raw["created_at"] ?? 0),
    updated_at: Number(raw["updated_at"] ?? 0),
  };
}

async function queryJobs(): Promise<CronJob[]> {
  const result = await invoke<QueryResult>("cron_db_query", {
    sql: "SELECT id,name,prompt,schedule_kind,schedule_expr,schedule_minutes,schedule_run_at,schedule_display,skills,script,workdir,model,provider,deliver,repeat_times,repeat_completed,enabled,state,paused_at,paused_reason,next_run_at,last_run_at,last_status,last_error,created_at,updated_at FROM cron_jobs ORDER BY created_at DESC",
  });
  if (!result.columns.length) return [];
  return result.rows.map((r) => toJob(rowToObject(result.columns, r)));
}

async function queryOutputs(jobId: string, limit = 10): Promise<CronOutput[]> {
  const result = await invoke<QueryResult>("cron_db_query", {
    sql: `SELECT job_id,run_at,output_markdown,final_response,success,error_message FROM cron_outputs WHERE job_id='${jobId.replace(/'/g, "''")}' ORDER BY run_at DESC LIMIT ${limit}`,
  });
  if (!result.columns.length) return [];
  return result.rows.map((r) => {
    const raw = rowToObject(result.columns, r);
    return {
      job_id: String(raw["job_id"] ?? ""),
      run_at: Number(raw["run_at"] ?? 0),
      output_markdown: raw["output_markdown"] != null ? String(raw["output_markdown"]) : null,
      final_response: raw["final_response"] != null ? String(raw["final_response"]) : null,
      success: Number(raw["success"]) === 1,
      error_message: raw["error_message"] != null ? String(raw["error_message"]) : null,
    };
  });
}

export async function cronAction(
  action: string,
  jobId?: string,
  payload?: Record<string, unknown>,
): Promise<{ ok: boolean; stub?: boolean }> {
  return await invoke<{ ok: boolean; stub?: boolean }>("cron_action", {
    action,
    jobId: jobId ?? null,
    payload: payload ?? null,
  });
}

// ─── hook ────────────────────────────────────────────────────────────────────

export interface UseCronJobsResult {
  readonly jobs: CronJob[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
}

export function useCronJobs(pollMs = 5000): UseCronJobsResult {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const data = await queryJobs();
      setJobs(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => { void refresh(); }, [refresh]);

  // Polling
  useEffect(() => {
    if (pollMs <= 0) return;
    const id = window.setInterval(() => { void refresh(); }, pollMs);
    return (): void => window.clearInterval(id);
  }, [refresh, pollMs]);

  return { jobs, loading, error, refresh };
}

export { queryOutputs };
