// StatsView — usage dashboard for cero studio.
//
// Data sources: ~/.cero/usage.db (turns, skill_usages), ~/.cero/cron.db (cron_jobs, cron_outputs).
// Gracefully renders "no data" states when DBs are absent (fresh install).
// Charts rendered with recharts.

import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
  type TooltipValueType,
} from "recharts";

// recharts formatter receives TooltipValueType (number|string|ReadonlyArray<...>|undefined)
type VT = TooltipValueType | undefined;
import { useStatsData, type DailyUsage, type ModelUsage, type SkillStat } from "../hooks/useStatsData";

// ─── palette — read from CSS tokens so charts respect the active theme ────────

function getCssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Evaluated lazily at render time so theme switches take effect immediately.
const C_ACCENT = (): string => getCssVar("--accent") || "#b894f5";
const C_CYAN   = (): string => getCssVar("--cyan")   || "#6ad7d1";
const C_AMBER  = (): string => getCssVar("--amber")  || "#e5a83a";
const C_RED    = (): string => getCssVar("--red")    || "#d96a6a";
const AXIS_STYLE = { fill: "#666", fontSize: 11, fontFamily: "JetBrains Mono, monospace" };

// ─── stat card ───────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  readonly label: string;
  readonly value: string | number;
  readonly sub?: string;
  readonly accent?: string;
}): React.JSX.Element {
  return (
    <div className="stats-card">
      <div className="stats-card-label">{label}</div>
      <div className="stats-card-value" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      {sub ? <div className="stats-card-sub">{sub}</div> : null}
    </div>
  );
}

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
  // "YYYY-MM-DD" → "MM/DD"
  return d.slice(5).replace("-", "/");
}

// ─── charts ──────────────────────────────────────────────────────────────────

function TokensChart({ daily }: { readonly daily: DailyUsage[] }): React.JSX.Element {
  if (daily.length === 0) {
    return <div className="stats-empty">no usage data yet</div>;
  }
  const data = daily.map((d) => ({
    date: shortDate(d.date),
    input: d.input_tokens,
    output: d.output_tokens,
    turns: d.turns,
  }));
  return (
    <div className="stats-chart-area">
      <div className="stats-chart-title">tokens / day (30d)</div>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="date" tick={AXIS_STYLE} interval="preserveStartEnd" />
          <YAxis tickFormatter={fmtTokens} tick={AXIS_STYLE} width={48} />
          <Tooltip
            contentStyle={{ background: "var(--bg-tint)", border: "1px solid var(--border)", fontSize: 12 }}
            formatter={(v: VT, name?: string | number) => [fmtTokens(Number(v ?? 0)), String(name ?? "")]}
          />
          <Area type="monotone" dataKey="output" stackId="1" stroke={C_ACCENT()} fill={C_ACCENT()} fillOpacity={0.4} />
          <Area type="monotone" dataKey="input"  stackId="1" stroke={C_CYAN()}   fill={C_CYAN()}   fillOpacity={0.3} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function CostChart({ daily }: { readonly daily: DailyUsage[] }): React.JSX.Element {
  if (daily.every((d) => d.cost_usd === 0)) return null as unknown as React.JSX.Element;
  const data = daily.map((d) => ({ date: shortDate(d.date), cost: d.cost_usd }));
  return (
    <div className="stats-chart-area">
      <div className="stats-chart-title">cost USD / day</div>
      <ResponsiveContainer width="100%" height={140}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="date" tick={AXIS_STYLE} interval="preserveStartEnd" />
          <YAxis tickFormatter={(v: VT) => `$${Number(v ?? 0).toFixed(3)}`} tick={AXIS_STYLE} width={60} />
          <Tooltip
            contentStyle={{ background: "var(--bg-tint)", border: "1px solid var(--border)", fontSize: 12 }}
            formatter={(v: VT) => [fmtUsd(Number(v ?? 0)), "cost"]}
          />
          <Area type="monotone" dataKey="cost" stroke={C_AMBER()} fill={C_AMBER()} fillOpacity={0.35} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ModelsChart({ models }: { readonly models: ModelUsage[] }): React.JSX.Element {
  if (models.length === 0) return null as unknown as React.JSX.Element;
  return (
    <div className="stats-chart-area">
      <div className="stats-chart-title">tokens by model</div>
      <ResponsiveContainer width="100%" height={160}>
        <PieChart>
          <Pie
            data={models}
            dataKey="total_tokens"
            nameKey="model"
            cx="50%"
            cy="50%"
            innerRadius={40}
            outerRadius={72}
            paddingAngle={2}
          >
            {models.map((_, i) => {
              const palette = [C_ACCENT(), C_CYAN(), C_AMBER(), C_RED()];
              return <Cell key={i} fill={palette[i % palette.length] ?? C_ACCENT()} />;
            })}
          </Pie>
          <Legend
            formatter={(v: string) => <span style={{ fontSize: 11, color: "var(--fg)" }}>{v}</span>}
          />
          <Tooltip
            contentStyle={{ background: "var(--bg-tint)", border: "1px solid var(--border)", fontSize: 12 }}
            formatter={(v: VT, name?: string | number) => [fmtTokens(Number(v ?? 0)), String(name ?? "")]}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function SkillsChart({ skills }: { readonly skills: SkillStat[] }): React.JSX.Element {
  if (skills.length === 0) return null as unknown as React.JSX.Element;
  const data = skills.slice(0, 12).map((s) => ({
    name: s.name.length > 14 ? `${s.name.slice(0, 13)}…` : s.name,
    applied: s.applied,
    success: s.success_rate ?? 0,
  }));
  return (
    <div className="stats-chart-area">
      <div className="stats-chart-title">top skills</div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
          <XAxis type="number" tick={AXIS_STYLE} />
          <YAxis type="category" dataKey="name" tick={AXIS_STYLE} width={96} />
          <Tooltip
            contentStyle={{ background: "var(--bg-tint)", border: "1px solid var(--border)", fontSize: 12 }}
          />
          <Bar dataKey="applied" fill={C_ACCENT()} radius={0} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── main view ────────────────────────────────────────────────────────────────

export function StatsView(): React.JSX.Element {
  const { data, loading, error, refresh } = useStatsData();
  const { daily, models, skills, cron, totalSessions, skillCount, lessonCount, totalCostUsd, totalTokens } = data;

  const totalTurns = daily.reduce((s, d) => s + d.turns, 0);

  return (
    <div className="dataview">
      <div className="dataview-header">
        <h2>STATS</h2>
        <button className="dv-tag" style={{ marginLeft: "auto" }} onClick={refresh}>
          refresh
        </button>
      </div>

      {error ? (
        <div className="dataview-empty" style={{ color: "var(--muted)" }}>
          stats unavailable: {error}
        </div>
      ) : null}

      {loading ? <div className="dataview-empty">loading…</div> : null}

      {!loading ? (
        <>
          <div className="stats-grid">
            <StatCard label="sessions"  value={totalSessions} />
            <StatCard label="turns"     value={totalTurns}    sub="last 30d" />
            <StatCard label="tokens"    value={fmtTokens(totalTokens)} sub="last 30d" />
            <StatCard label="cost"      value={fmtUsd(totalCostUsd)}   sub="last 30d" accent={C_AMBER()} />
            <StatCard label="skills"    value={skillCount} />
            <StatCard label="lessons"   value={lessonCount} />
            <StatCard label="cron jobs" value={`${cron.enabled}/${cron.total}`} sub="enabled/total" />
            <StatCard
              label="cron success"
              value={cron.ok_runs + cron.error_runs > 0
                ? `${Math.round((cron.ok_runs / (cron.ok_runs + cron.error_runs)) * 100)}%`
                : "—"}
              sub={`${cron.ok_runs} ok · ${cron.error_runs} err`}
              accent={cron.error_runs > 0 ? C_RED() : C_CYAN()}
            />
          </div>

          <TokensChart daily={daily} />
          <CostChart   daily={daily} />
          <ModelsChart models={models} />
          <SkillsChart skills={skills} />

          {daily.length === 0 && models.length === 0 && skills.length === 0 ? (
            <div className="stats-empty">
              no usage data found — run some tasks in cero to populate stats.
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
