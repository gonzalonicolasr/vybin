// DataView — F4-T43
// Three tabs: Memory (MEMORY.md / USER.md editor), Insights (cross-session report),
// Usage (token/cost detail table + charts).
//
// Architecture notes:
// - Memory files live at ~/.cero/MEMORY.md and ~/.cero/USER.md
// - Read / write via @tauri-apps/plugin-fs (BaseDirectory.Home + .cero/ prefix)
// - RACE CONDITION WARNING: the cero binary's memory_tool also writes these files
//   using atomic rename (tmp file → rename). Studio reads mtime before save and
//   aborts if the file was modified externally since the last load.  This prevents
//   silently overwriting the binary's writes. The user will see a
//   "file changed on disk — refresh before saving" error and can refresh to pull
//   the latest version.
// - Insights: invokes usage_db_query to build an inline report from usage.db,
//   mirroring the format of aggregateInsights() in src/agent/insights.ts.
//   Results are cached in component state with a generatedAt timestamp.
// - Usage: reads usage.db via usage_db_query (same pattern as useStatsData.ts).
//   CSV export writes to ~/Downloads/cero-usage-YYYY-MM-DD.csv.

import {
  readTextFile,
  writeTextFile,
  stat,
  exists,
  BaseDirectory,
} from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  type TooltipValueType,
} from "recharts";
import { Markdown } from "../Markdown";

// ─── palette (mirrors StatsView) ─────────────────────────────────────────────

const C_ACCENT = "#7c3aed";
const C_CYAN   = "#67e8f9";
const C_AMBER  = "#fbbf24";
const C_RED    = "#d96a6a";
const PIE_COLORS = [C_ACCENT, C_CYAN, C_AMBER, C_RED, "#a78bfa", "#34d399", "#f87171", "#60a5fa"];
const AXIS_STYLE = { fill: "#666", fontSize: 11, fontFamily: "JetBrains Mono, monospace" };

type VT = TooltipValueType | undefined;

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtUsd(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function shortDate(d: string): string {
  return d.slice(5).replace("-", "/");
}

// ─── shared query helper (same pattern as useStatsData.ts) ───────────────────

interface QueryResult {
  columns: string[];
  rows: Array<Array<unknown>>;
}

function rowToObj(cols: string[], row: Array<unknown>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  cols.forEach((c, i) => { o[c] = row[i]; });
  return o;
}

async function safeQuery(sql: string): Promise<Array<Record<string, unknown>>> {
  try {
    const res = await invoke<QueryResult>("usage_db_query", { sql });
    if (!res.columns.length) return [];
    return res.rows.map((r) => rowToObj(res.columns, r));
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 1 — MEMORY EDITOR
// ═══════════════════════════════════════════════════════════════════════════

type MemoryFile = "MEMORY.md" | "USER.md";

interface FileState {
  content: string;
  draft: string;
  // mtime as ms epoch, or null if file doesn't exist / mtime unavailable
  mtime: number | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  modified: boolean;
}

const MEMORY_PATHS: Record<MemoryFile, string> = {
  "MEMORY.md": ".cero/MEMORY.md",
  "USER.md":   ".cero/USER.md",
};

async function loadFile(name: MemoryFile): Promise<{ content: string; mtime: number | null }> {
  const path = MEMORY_PATHS[name];
  const fileExists = await exists(path, { baseDir: BaseDirectory.Home });
  if (!fileExists) return { content: "", mtime: null };
  const [content, info] = await Promise.all([
    readTextFile(path, { baseDir: BaseDirectory.Home }),
    stat(path, { baseDir: BaseDirectory.Home }).catch(() => null),
  ]);
  // stat returns mtime as Date | null
  const mtime = info?.mtime instanceof Date ? info.mtime.getTime() : null;
  return { content, mtime };
}

const EMPTY_FILE: FileState = {
  content: "",
  draft: "",
  mtime: null,
  loading: true,
  saving: false,
  error: null,
  modified: false,
};

function useMemoryFile(name: MemoryFile) {
  const [state, setState] = useState<FileState>(EMPTY_FILE);

  const load = useCallback(async (): Promise<void> => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { content, mtime } = await loadFile(name);
      setState({ content, draft: content, mtime, loading: false, saving: false, error: null, modified: false });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: String(err) }));
    }
  }, [name]);

  useEffect(() => { void load(); }, [load]);

  const setDraft = useCallback((draft: string) => {
    setState((s) => ({ ...s, draft, modified: draft !== s.content }));
  }, []);

  const save = useCallback(async (draft: string, currentMtime: number | null): Promise<void> => {
    setState((s) => ({ ...s, saving: true, error: null }));
    try {
      const path = MEMORY_PATHS[name];

      // Race condition guard: re-check mtime before writing.
      // The cero binary writes these files via atomic rename; if the file was
      // modified externally since we loaded it, we abort and ask the user to
      // refresh first.
      const latestInfo = await stat(path, { baseDir: BaseDirectory.Home }).catch(() => null);
      const latestMtime = latestInfo?.mtime instanceof Date ? latestInfo.mtime.getTime() : null;

      if (currentMtime !== null && latestMtime !== null && latestMtime > currentMtime) {
        setState((s) => ({
          ...s,
          saving: false,
          error: "file changed on disk — refresh before saving to avoid overwriting external changes",
        }));
        return;
      }

      await writeTextFile(path, draft, { baseDir: BaseDirectory.Home });
      const newInfo = await stat(path, { baseDir: BaseDirectory.Home }).catch(() => null);
      const newMtime = newInfo?.mtime instanceof Date ? newInfo.mtime.getTime() : null;
      setState({ content: draft, draft, mtime: newMtime, loading: false, saving: false, error: null, modified: false });
    } catch (err) {
      setState((s) => ({ ...s, saving: false, error: String(err) }));
    }
  }, [name]);

  const create = useCallback(async (): Promise<void> => {
    const path = MEMORY_PATHS[name];
    await writeTextFile(path, "", { baseDir: BaseDirectory.Home });
    setState({ content: "", draft: "", mtime: Date.now(), loading: false, saving: false, error: null, modified: false });
  }, [name]);

  const clear = useCallback(async (): Promise<void> => {
    const path = MEMORY_PATHS[name];
    await writeTextFile(path, "", { baseDir: BaseDirectory.Home });
    setState({ content: "", draft: "", mtime: Date.now(), loading: false, saving: false, error: null, modified: false });
  }, [name]);

  return { state, setDraft, save, load, create, clear };
}

function MemoryFilePanel({ name }: { readonly name: MemoryFile }): React.JSX.Element {
  const { state, setDraft, save, load, create, clear } = useMemoryFile(name);
  const [confirmClear, setConfirmClear] = useState(false);
  // Keep a ref to mtime so the save callback captures the value at click time,
  // not at hook definition time.
  const mtimeRef = useRef<number | null>(null);
  mtimeRef.current = state.mtime;

  const isNew = !state.loading && state.mtime === null && state.content === "";

  function handleSave(): void {
    void save(state.draft, mtimeRef.current);
  }

  function handleClearConfirm(): void {
    setConfirmClear(false);
    void clear();
  }

  return (
    <div className="mem-panel">
      <div className="mem-panel-toolbar">
        <span className="mem-panel-name">{name}</span>
        {state.mtime !== null ? (
          <span className="mem-panel-mtime">
            modified {new Date(state.mtime).toLocaleString()}
          </span>
        ) : null}
        <div className="mem-panel-actions">
          <button
            className="dv-tag"
            onClick={() => void load()}
            disabled={state.loading || state.saving}
            title="Re-read from disk (pulls in external changes)"
          >
            refresh
          </button>
          {!isNew ? (
            <button
              className="dv-tag"
              onClick={() => setConfirmClear(true)}
              disabled={state.loading || state.saving}
              style={{ borderColor: "var(--red)", color: "var(--red)" }}
              title="Clear file contents"
            >
              clear
            </button>
          ) : null}
          <button
            className={`settings-btn-primary${state.modified ? " mem-save-dirty" : ""}`}
            style={{ fontSize: 16, padding: "3px 14px" }}
            onClick={handleSave}
            disabled={!state.modified || state.saving || state.loading}
            title="Save to disk"
          >
            {state.saving ? "saving…" : "save"}
          </button>
        </div>
      </div>

      {state.error ? (
        <div className="mem-error">{state.error}</div>
      ) : null}

      {state.loading ? (
        <div className="dataview-empty">loading…</div>
      ) : isNew ? (
        <div className="mem-empty-state">
          <div className="dataview-empty">
            Empty — start adding curated memories
          </div>
          <button
            className="settings-btn-primary"
            style={{ alignSelf: "center", marginTop: 8 }}
            onClick={() => void create()}
          >
            Create {name}
          </button>
        </div>
      ) : (
        <div className="mem-split">
          <div className="mem-editor-wrap">
            <textarea
              className="mem-textarea"
              value={state.draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              placeholder={`# ${name}\n\nWrite curated memories here…`}
            />
          </div>
          <div className="mem-preview-wrap">
            <div className="mem-preview-label">PREVIEW</div>
            <div className="mem-preview-body">
              {state.draft.trim().length === 0 ? (
                <span className="dv-empty-line">(empty)</span>
              ) : (
                <Markdown text={state.draft} />
              )}
            </div>
          </div>
        </div>
      )}

      {confirmClear ? (
        <div className="settings-backdrop" onClick={() => setConfirmClear(false)}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="settings-header">
              <h2>CLEAR {name}?</h2>
              <button className="settings-close" onClick={() => setConfirmClear(false)}>✕</button>
            </div>
            <div className="settings-body">
              <p style={{ fontFamily: "var(--pixel-font)", fontSize: 20, color: "var(--fg)", lineHeight: 1.4 }}>
                This will erase all contents of <b>{name}</b>. The file will remain but
                be empty. This cannot be undone.
              </p>
            </div>
            <div className="settings-footer">
              <button className="settings-btn-secondary" onClick={() => setConfirmClear(false)}>
                cancel
              </button>
              <button
                className="settings-btn-primary"
                style={{ borderColor: "var(--red)", color: "var(--red)" }}
                onClick={handleClearConfirm}
              >
                clear
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MemoryTab(): React.JSX.Element {
  const [activeFile, setActiveFile] = useState<MemoryFile>("MEMORY.md");

  return (
    <div className="mem-root">
      <div className="mem-file-tabs">
        <button
          className={`dv-tag ${activeFile === "MEMORY.md" ? "active" : ""}`}
          onClick={() => setActiveFile("MEMORY.md")}
        >
          MEMORY.md
        </button>
        <button
          className={`dv-tag ${activeFile === "USER.md" ? "active" : ""}`}
          onClick={() => setActiveFile("USER.md")}
        >
          USER.md
        </button>
        <span className="mem-file-hint">
          curated memory · injected into every cero session
        </span>
      </div>
      {/* key=activeFile forces remount so useEffect re-runs for each file */}
      <MemoryFilePanel key={activeFile} name={activeFile} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 2 — INSIGHTS
// ═══════════════════════════════════════════════════════════════════════════

type InsightsDays = 7 | 30 | 90 | 365;

interface InsightsCache {
  markdown: string;
  generatedAt: number;
  days: InsightsDays;
}

async function buildInsightsReport(days: InsightsDays): Promise<string> {
  const cutoffSec = Math.floor((Date.now() - days * 86400_000) / 1000);

  const [providerRows, dayRows, skillRows] = await Promise.all([
    safeQuery(
      `SELECT provider, COUNT(*) as turns,
              SUM(input_tokens) as input, SUM(output_tokens) as output,
              SUM(COALESCE(cached_tokens, 0)) as cached,
              SUM(COALESCE(cost_usd, 0)) as cost
       FROM turns WHERE started_at >= ${cutoffSec}
       GROUP BY provider ORDER BY turns DESC`,
    ),
    safeQuery(
      `SELECT date(started_at, 'unixepoch') as date,
              COUNT(*) as turns,
              SUM(COALESCE(cost_usd, 0)) as cost
       FROM turns WHERE started_at >= ${cutoffSec}
       GROUP BY date(started_at, 'unixepoch') ORDER BY date ASC`,
    ),
    safeQuery(
      `SELECT skill_name as name, COUNT(*) as applied,
              ROUND(AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END) * 100, 1) as rate
       FROM skill_usages
       GROUP BY skill_name ORDER BY applied DESC LIMIT 15`,
    ).catch(() => [] as Array<Record<string, unknown>>),
  ]);

  const totalTurns = providerRows.reduce((s, r) => s + Number(r["turns"] ?? 0), 0);
  const totalCost  = providerRows.reduce((s, r) => s + Number(r["cost"]  ?? 0), 0);

  const lines: string[] = [];
  lines.push(`# Insights (last ${days === 365 ? "all time" : `${days} days`})`);
  lines.push("");
  lines.push(`- Total turns: **${totalTurns}**`);
  lines.push(`- Total cost: **${fmtUsd(totalCost)}**`);

  if (providerRows.length > 0) {
    lines.push("");
    lines.push("## Usage by provider");
    lines.push("| provider | turns | input | output | cached | cost |");
    lines.push("|---|---:|---:|---:|---:|---:|");
    for (const r of providerRows) {
      lines.push(
        `| ${String(r["provider"] ?? "?")} | ${Number(r["turns"])} | ${fmtTokens(Number(r["input"] ?? 0))} | ${fmtTokens(Number(r["output"] ?? 0))} | ${fmtTokens(Number(r["cached"] ?? 0))} | ${fmtUsd(Number(r["cost"] ?? 0))} |`,
      );
    }
  }

  if (dayRows.length > 0) {
    lines.push("");
    lines.push("## Daily trend");
    lines.push("| day | turns | cost |");
    lines.push("|---|---:|---:|");
    for (const r of dayRows) {
      lines.push(`| ${String(r["date"] ?? "")} | ${Number(r["turns"])} | ${fmtUsd(Number(r["cost"] ?? 0))} |`);
    }
  }

  if (skillRows.length > 0) {
    lines.push("");
    lines.push("## Top skills");
    lines.push("| skill | applied | success rate |");
    lines.push("|---|---:|---:|");
    for (const r of skillRows) {
      const rate = r["rate"] != null ? `${Number(r["rate"])}%` : "—";
      lines.push(`| ${String(r["name"] ?? "")} | ${Number(r["applied"])} | ${rate} |`);
    }
  } else {
    lines.push("");
    lines.push("_No skill usage data yet — run some sessions with learning enabled._");
  }

  return lines.join("\n");
}

function InsightsTab(): React.JSX.Element {
  const [days, setDays] = useState<InsightsDays>(7);
  const [cache, setCache] = useState<InsightsCache | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const generate = useCallback(async (d: InsightsDays, force: boolean): Promise<void> => {
    if (!force && cache !== null && cache.days === d) return; // cache hit
    setLoading(true);
    setError(null);
    try {
      const markdown = await buildInsightsReport(d);
      setCache({ markdown, generatedAt: Date.now(), days: d });
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [cache]);

  const DAY_OPTIONS: InsightsDays[] = [7, 30, 90, 365];

  return (
    <div className="insights-root">
      <div className="insights-toolbar">
        <div className="dv-tag-row" style={{ padding: 0, border: 0, margin: 0 }}>
          {DAY_OPTIONS.map((d) => (
            <button
              key={d}
              className={`dv-tag ${days === d ? "active" : ""}`}
              onClick={() => setDays(d)}
            >
              {d === 365 ? "all" : `${d}d`}
            </button>
          ))}
        </div>
        <button
          className="settings-btn-primary"
          style={{ fontSize: 16, padding: "3px 14px" }}
          onClick={() => void generate(days, false)}
          disabled={loading}
        >
          {loading ? "generating…" : "generate insights"}
        </button>
        {cache ? (
          <button
            className="dv-tag"
            onClick={() => void generate(days, true)}
            disabled={loading}
            title="Force regenerate without using cache"
          >
            regenerate
          </button>
        ) : null}
        {cache ? (
          <span className="mem-panel-mtime">
            generated {new Date(cache.generatedAt).toLocaleTimeString()}
          </span>
        ) : null}
      </div>

      {error ? <div className="mem-error">{error}</div> : null}

      {!cache && !loading ? (
        <div className="dataview-empty">
          Select a time window and click "generate insights" to compile a cross-session report.
        </div>
      ) : null}

      {loading ? <div className="dataview-empty">generating…</div> : null}

      {cache && !loading ? (
        <div className="insights-body">
          <Markdown text={cache.markdown} />
        </div>
      ) : null}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 3 — USAGE DETAIL
// ═══════════════════════════════════════════════════════════════════════════

interface UsageRecord {
  ts: number;           // unix seconds
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cost_usd: number;
  session_id: string;
}

interface DailyBar {
  date: string;
  input: number;
  output: number;
  cached: number;
}

interface ProviderPie {
  name: string;
  value: number; // cost_usd
}

interface ModelBar {
  model: string;
  cost: number;
}

interface UsageStats {
  todayCost: number;
  todayTokens: number;
  todayTurns: number;
  sevenDayCost: number;
  sevenDayTokens: number;
  sevenDayTurns: number;
  lifetimeCost: number;
  lifetimeTokens: number;
  lifetimeTurns: number;
}

type SortKey = "ts" | "provider" | "model" | "input_tokens" | "output_tokens" | "cached_tokens" | "cost_usd";
type SortDir = "asc" | "desc";

const RANGE_DAYS: Record<string, number> = {
  "1d": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: 99999,
};

function UsageTab(): React.JSX.Element {
  const [records, setRecords]     = useState<UsageRecord[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [stats, setStats]         = useState<UsageStats | null>(null);
  const [daily, setDaily]         = useState<DailyBar[]>([]);
  const [providers, setProviders] = useState<ProviderPie[]>([]);
  const [models, setModels]       = useState<ModelBar[]>([]);

  // Filters
  const [rangeKey, setRangeKey]       = useState("30d");
  const [provFilter, setProvFilter]   = useState("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [sortKey, setSortKey]         = useState<SortKey>("ts");
  const [sortDir, setSortDir]         = useState<SortDir>("desc");

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const now = Math.floor(Date.now() / 1000);
      const daysSec = (RANGE_DAYS[rangeKey] ?? 30) * 86400;
      const cutoff  = now - daysSec;

      const [allRows, statRows, dailyRows, providerRows, modelRows] = await Promise.all([
        safeQuery(
          `SELECT started_at as ts, provider, model,
                  input_tokens, output_tokens,
                  COALESCE(cached_tokens, 0) as cached_tokens,
                  COALESCE(cost_usd, 0) as cost_usd, session_id
           FROM turns WHERE started_at >= ${cutoff}
           ORDER BY started_at DESC LIMIT 2000`,
        ),
        safeQuery(
          `SELECT
             SUM(CASE WHEN started_at >= ${now - 86400}     THEN COALESCE(cost_usd, 0) ELSE 0 END)           as today_cost,
             SUM(CASE WHEN started_at >= ${now - 86400}     THEN input_tokens + output_tokens ELSE 0 END)    as today_tokens,
             SUM(CASE WHEN started_at >= ${now - 86400}     THEN 1 ELSE 0 END)                               as today_turns,
             SUM(CASE WHEN started_at >= ${now - 7 * 86400} THEN COALESCE(cost_usd, 0) ELSE 0 END)           as seven_cost,
             SUM(CASE WHEN started_at >= ${now - 7 * 86400} THEN input_tokens + output_tokens ELSE 0 END)    as seven_tokens,
             SUM(CASE WHEN started_at >= ${now - 7 * 86400} THEN 1 ELSE 0 END)                               as seven_turns,
             SUM(COALESCE(cost_usd, 0))                                                                       as life_cost,
             SUM(input_tokens + output_tokens)                                                                 as life_tokens,
             COUNT(*)                                                                                          as life_turns
           FROM turns`,
        ),
        safeQuery(
          `SELECT date(started_at, 'unixepoch') as date,
                  SUM(input_tokens) as input, SUM(output_tokens) as output,
                  SUM(COALESCE(cached_tokens, 0)) as cached
           FROM turns WHERE started_at >= ${now - 30 * 86400}
           GROUP BY date(started_at, 'unixepoch') ORDER BY date ASC`,
        ),
        safeQuery(
          `SELECT provider, SUM(COALESCE(cost_usd, 0)) as cost
           FROM turns GROUP BY provider ORDER BY cost DESC`,
        ),
        safeQuery(
          `SELECT model, SUM(COALESCE(cost_usd, 0)) as cost
           FROM turns GROUP BY model ORDER BY cost DESC LIMIT 10`,
        ),
      ]);

      setRecords(
        allRows.map((r) => ({
          ts:            Number(r["ts"]             ?? 0),
          provider:      String(r["provider"]       ?? ""),
          model:         String(r["model"]          ?? ""),
          input_tokens:  Number(r["input_tokens"]   ?? 0),
          output_tokens: Number(r["output_tokens"]  ?? 0),
          cached_tokens: Number(r["cached_tokens"]  ?? 0),
          cost_usd:      Number(r["cost_usd"]       ?? 0),
          session_id:    String(r["session_id"]     ?? ""),
        })),
      );

      const sr = statRows[0] ?? {};
      setStats({
        todayCost:      Number(sr["today_cost"]    ?? 0),
        todayTokens:    Number(sr["today_tokens"]  ?? 0),
        todayTurns:     Number(sr["today_turns"]   ?? 0),
        sevenDayCost:   Number(sr["seven_cost"]    ?? 0),
        sevenDayTokens: Number(sr["seven_tokens"]  ?? 0),
        sevenDayTurns:  Number(sr["seven_turns"]   ?? 0),
        lifetimeCost:   Number(sr["life_cost"]     ?? 0),
        lifetimeTokens: Number(sr["life_tokens"]   ?? 0),
        lifetimeTurns:  Number(sr["life_turns"]    ?? 0),
      });

      setDaily(
        dailyRows.map((r) => ({
          date:   shortDate(String(r["date"] ?? "")),
          input:  Number(r["input"]  ?? 0),
          output: Number(r["output"] ?? 0),
          cached: Number(r["cached"] ?? 0),
        })),
      );

      setProviders(
        providerRows
          .map((r) => ({ name: String(r["provider"] ?? ""), value: Number(r["cost"] ?? 0) }))
          .filter((p) => p.value > 0),
      );

      setModels(
        modelRows
          .map((r) => ({ model: String(r["model"] ?? ""), cost: Number(r["cost"] ?? 0) }))
          .filter((m) => m.cost > 0),
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [rangeKey]);

  useEffect(() => { void load(); }, [load]);

  const allProviders = [...new Set(records.map((r) => r.provider))].sort();
  const allModels    = [...new Set(records.map((r) => r.model))].sort();

  const filtered = records
    .filter((r) => provFilter  === "all" || r.provider === provFilter)
    .filter((r) => modelFilter === "all" || r.model    === modelFilter)
    .sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === "string" ? av.localeCompare(String(bv)) : Number(av) - Number(bv);
      return sortDir === "asc" ? cmp : -cmp;
    });

  function toggleSort(key: SortKey): void {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  async function handleExportCsv(): Promise<void> {
    const header = "timestamp,provider,model,input_tokens,output_tokens,cached_tokens,cost_usd,session_id";
    const rows = filtered.map((r) =>
      [
        new Date(r.ts * 1000).toISOString(),
        r.provider,
        `"${r.model}"`,
        r.input_tokens,
        r.output_tokens,
        r.cached_tokens,
        r.cost_usd.toFixed(6),
        r.session_id,
      ].join(","),
    );
    const csv = [header, ...rows].join("\n");
    const filename = `cero-usage-${new Date().toISOString().slice(0, 10)}.csv`;
    // Write to ~/Downloads/ — no file dialog plugin available.
    // Tauri BaseDirectory.Download (value 4) matches OS Downloads folder.
    try {
      await writeTextFile(filename, csv, { baseDir: BaseDirectory.Download });
      setExportMsg(`Saved to Downloads/${filename}`);
      setTimeout(() => setExportMsg(null), 4000);
    } catch {
      // Fallback: write next to the cero home folder
      try {
        await writeTextFile(`.cero/${filename}`, csv, { baseDir: BaseDirectory.Home });
        setExportMsg(`Saved to ~/.cero/${filename}`);
        setTimeout(() => setExportMsg(null), 4000);
      } catch (err2) {
        setError(`Export failed: ${String(err2)}`);
      }
    }
  }

  function SortIndicator({ col }: { readonly col: SortKey }): React.JSX.Element {
    if (sortKey !== col) return <span style={{ color: "var(--muted)" }}> ↕</span>;
    return <span style={{ color: "var(--accent)" }}>{sortDir === "asc" ? " ↑" : " ↓"}</span>;
  }

  return (
    <div className="usage-root">
      {/* ── stat cards ── */}
      {stats ? (
        <div className="stats-grid" style={{ marginBottom: 12, gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))" }}>
          <UsageStatCard label="today cost"    value={fmtUsd(stats.todayCost)}         sub={`${stats.todayTurns} turns`} />
          <UsageStatCard label="today tokens"  value={fmtTokens(stats.todayTokens)}    sub="" />
          <UsageStatCard label="7d cost"       value={fmtUsd(stats.sevenDayCost)}      sub={`${stats.sevenDayTurns} turns`} accent={C_AMBER} />
          <UsageStatCard label="7d tokens"     value={fmtTokens(stats.sevenDayTokens)} sub="" accent={C_AMBER} />
          <UsageStatCard label="lifetime cost" value={fmtUsd(stats.lifetimeCost)}      sub={`${stats.lifetimeTurns} turns`} />
          <UsageStatCard label="lifetime tok"  value={fmtTokens(stats.lifetimeTokens)} sub="" />
        </div>
      ) : null}

      {/* ── charts ── */}
      {!loading && (daily.length > 0 || providers.length > 0 || models.length > 0) ? (
        <div className="usage-charts">
          {daily.length > 0 ? (
            <div className="stats-chart-area" style={{ marginBottom: 10 }}>
              <div className="stats-chart-title">tokens by day (30d) · cached / input / output stacked</div>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={daily} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={AXIS_STYLE} interval="preserveStartEnd" />
                  <YAxis tickFormatter={fmtTokens} tick={AXIS_STYLE} width={48} />
                  <Tooltip
                    contentStyle={{ background: "var(--bg-tint)", border: "1px solid var(--border)", fontSize: 12 }}
                    formatter={(v: VT, name?: string | number) => [fmtTokens(Number(v ?? 0)), String(name ?? "")]}
                  />
                  <Bar dataKey="cached" stackId="a" fill={C_CYAN}   name="cached"  />
                  <Bar dataKey="input"  stackId="a" fill={C_ACCENT} name="input"   />
                  <Bar dataKey="output" stackId="a" fill={C_AMBER}  name="output"  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : null}

          <div className="usage-charts-row2">
            {providers.length > 0 ? (
              <div className="stats-chart-area" style={{ flex: 1 }}>
                <div className="stats-chart-title">cost by provider</div>
                <ResponsiveContainer width="100%" height={140}>
                  <PieChart>
                    <Pie data={providers} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={30} outerRadius={58} paddingAngle={2}>
                      {providers.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length] ?? C_ACCENT} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: "var(--bg-tint)", border: "1px solid var(--border)", fontSize: 12 }}
                      formatter={(v: VT) => [fmtUsd(Number(v ?? 0)), "cost"]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : null}
            {models.length > 0 ? (
              <div className="stats-chart-area" style={{ flex: 2 }}>
                <div className="stats-chart-title">cost by model (top 10)</div>
                <ResponsiveContainer width="100%" height={Math.max(100, models.length * 20)}>
                  <BarChart data={models} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                    <XAxis type="number" tickFormatter={(v: VT) => fmtUsd(Number(v ?? 0))} tick={AXIS_STYLE} />
                    <YAxis type="category" dataKey="model" tick={{ ...AXIS_STYLE, fontSize: 10 }} width={120} />
                    <Tooltip
                      contentStyle={{ background: "var(--bg-tint)", border: "1px solid var(--border)", fontSize: 12 }}
                      formatter={(v: VT) => [fmtUsd(Number(v ?? 0)), "cost"]}
                    />
                    <Bar dataKey="cost" fill={C_ACCENT} radius={[0, 2, 2, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* ── table toolbar ── */}
      <div className="usage-table-toolbar">
        <div className="dv-tag-row" style={{ padding: 0, border: 0, margin: 0, flexWrap: "nowrap" }}>
          {Object.keys(RANGE_DAYS).map((k) => (
            <button key={k} className={`dv-tag ${rangeKey === k ? "active" : ""}`} onClick={() => setRangeKey(k)}>
              {k}
            </button>
          ))}
        </div>
        <select
          className="usage-select"
          value={provFilter}
          onChange={(e) => setProvFilter(e.target.value)}
          aria-label="Filter by provider"
        >
          <option value="all">all providers</option>
          {allProviders.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select
          className="usage-select"
          value={modelFilter}
          onChange={(e) => setModelFilter(e.target.value)}
          aria-label="Filter by model"
        >
          <option value="all">all models</option>
          {allModels.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <span className="mem-panel-mtime">{filtered.length} records</span>
        <button className="dv-tag" style={{ marginLeft: "auto" }} onClick={() => void load()} disabled={loading}>
          refresh
        </button>
        <button
          className="settings-btn-primary"
          style={{ fontSize: 16, padding: "3px 14px" }}
          onClick={() => void handleExportCsv()}
          disabled={filtered.length === 0}
          aria-label="Export filtered records as CSV"
        >
          export CSV
        </button>
      </div>

      {exportMsg ? <div className="mem-error" style={{ color: "var(--cyan)", borderColor: "var(--cyan)", background: "rgba(103, 232, 249, 0.06)" }}>{exportMsg}</div> : null}
      {error     ? <div className="mem-error">{error}</div> : null}
      {loading   ? <div className="dataview-empty">loading…</div> : null}

      {!loading && filtered.length === 0 ? (
        <div className="dataview-empty">no usage records — run some sessions to populate data.</div>
      ) : null}

      {!loading && filtered.length > 0 ? (
        <div className="usage-table-wrap">
          <table className="usage-table">
            <thead>
              <tr>
                <th onClick={() => toggleSort("ts")}            className="usage-th">timestamp<SortIndicator col="ts" /></th>
                <th onClick={() => toggleSort("provider")}      className="usage-th">provider<SortIndicator col="provider" /></th>
                <th onClick={() => toggleSort("model")}         className="usage-th">model<SortIndicator col="model" /></th>
                <th onClick={() => toggleSort("input_tokens")}  className="usage-th usage-th-num">in<SortIndicator col="input_tokens" /></th>
                <th onClick={() => toggleSort("output_tokens")} className="usage-th usage-th-num">out<SortIndicator col="output_tokens" /></th>
                <th onClick={() => toggleSort("cached_tokens")} className="usage-th usage-th-num">cached<SortIndicator col="cached_tokens" /></th>
                <th onClick={() => toggleSort("cost_usd")}      className="usage-th usage-th-num">cost<SortIndicator col="cost_usd" /></th>
                <th className="usage-th">session</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={`${r.ts}-${i}`} className="usage-tr">
                  <td className="usage-td usage-td-ts">
                    {new Date(r.ts * 1000).toISOString().slice(0, 19).replace("T", " ")}
                  </td>
                  <td className="usage-td">{r.provider}</td>
                  <td className="usage-td usage-td-model">{r.model}</td>
                  <td className="usage-td usage-td-num">{fmtTokens(r.input_tokens)}</td>
                  <td className="usage-td usage-td-num">{fmtTokens(r.output_tokens)}</td>
                  <td className="usage-td usage-td-num">{fmtTokens(r.cached_tokens)}</td>
                  <td className="usage-td usage-td-num usage-td-cost">{fmtUsd(r.cost_usd)}</td>
                  <td className="usage-td usage-td-session">{r.session_id.slice(0, 8)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function UsageStatCard({
  label, value, sub, accent,
}: {
  readonly label: string;
  readonly value: string;
  readonly sub: string;
  readonly accent?: string;
}): React.JSX.Element {
  return (
    <div className="stats-card">
      <div className="stats-card-label">{label}</div>
      <div className="stats-card-value" style={{ fontSize: 24, color: accent ?? "var(--accent)" }}>
        {value}
      </div>
      {sub ? <div className="stats-card-sub">{sub}</div> : null}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TOP-LEVEL DataView
// ═══════════════════════════════════════════════════════════════════════════

type DataTab = "memory" | "insights" | "usage";

export function DataView(): React.JSX.Element {
  const [tab, setTab] = useState<DataTab>("memory");

  const TAB_LABELS: { id: DataTab; label: string }[] = [
    { id: "memory",   label: "Memory"   },
    { id: "insights", label: "Insights" },
    { id: "usage",    label: "Usage"    },
  ];

  return (
    <div className="dataview">
      <div className="dataview-header">
        <h2>DATA</h2>
        <div className="dv-tag-row" style={{ padding: 0, border: 0, margin: 0 }}>
          {TAB_LABELS.map((t) => (
            <button
              key={t.id}
              className={`dv-tag ${tab === t.id ? "active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="data-tab-content">
        {tab === "memory"   ? <MemoryTab   /> : null}
        {tab === "insights" ? <InsightsTab /> : null}
        {tab === "usage"    ? <UsageTab    /> : null}
      </div>
    </div>
  );
}
