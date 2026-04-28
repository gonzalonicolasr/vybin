// SchedulerView — list, create, and manage cero cronjobs.
//
// Data source: ~/.cero/cron.db (via Rust cron_db_query — read-only SQLite).
// Mutations: cron_action Tauri command → delegates to `cero scheduler <action>`.
// Live updates: 5s polling via useCronJobs hook.

import { useCallback, useEffect, useState } from "react";
import { useCronJobs, cronAction, queryOutputs, type CronJob, type CronOutput } from "../hooks/useCronData";
import { Markdown } from "../Markdown";

// ─── relative time helper ─────────────────────────────────────────────────────

function relTime(ms: number | null): string {
  if (ms === null) return "—";
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const past = diff < 0;
  if (abs < 60_000)   return past ? "just now" : "in <1m";
  if (abs < 3600_000) return `${past ? "" : "in "}${Math.round(abs / 60000)}m${past ? " ago" : ""}`;
  if (abs < 86400_000) return `${past ? "" : "in "}${Math.round(abs / 3600000)}h${past ? " ago" : ""}`;
  return `${past ? "" : "in "}${Math.round(abs / 86400000)}d${past ? " ago" : ""}`;
}

function fmtDate(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

// ─── state badge ─────────────────────────────────────────────────────────────

function StateBadge({ state }: { readonly state: string }): React.JSX.Element {
  const color =
    state === "running"   ? "var(--amber)"  :
    state === "paused"    ? "var(--muted)"  :
    state === "error"     ? "var(--red)"    :
    state === "completed" ? "var(--cyan)"   :
    "var(--accent)";
  return (
    <span className="dv-pill" style={{ borderColor: color, color }}>{state}</span>
  );
}

function StatusBadge({ status }: { readonly status: "ok" | "error" | null }): React.JSX.Element {
  if (!status) return <span className="dv-pill dv-pill-dim">no runs</span>;
  const color = status === "ok" ? "var(--cyan)" : "var(--red)";
  return <span className="dv-pill" style={{ borderColor: color, color }}>{status}</span>;
}

// ─── create job form ──────────────────────────────────────────────────────────

interface CreateDraft {
  name: string;
  prompt: string;
  schedule_display: string;
  deliver: string;
  repeat_infinite: boolean;
  repeat_times: string;
  workdir: string;
  skills: string;  // comma-separated
}

function emptyDraft(): CreateDraft {
  return {
    name: "",
    prompt: "",
    schedule_display: "",
    deliver: "local",
    repeat_infinite: true,
    repeat_times: "1",
    workdir: "",
    skills: "",
  };
}

function CreateJobModal({
  onClose,
  onCreated,
}: {
  readonly onClose: () => void;
  readonly onCreated: () => Promise<void>;
}): React.JSX.Element {
  const [draft, setDraft] = useState<CreateDraft>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const up = <K extends keyof CreateDraft>(k: K, v: CreateDraft[K]): void =>
    setDraft((prev) => ({ ...prev, [k]: v }));

  const handleCreate = async (): Promise<void> => {
    setError(null);
    if (!draft.prompt.trim()) { setError("Prompt is required"); return; }
    if (!draft.schedule_display.trim()) { setError("Schedule is required"); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: draft.name.trim() || null,
        prompt: draft.prompt.trim(),
        schedule_display: draft.schedule_display.trim(),
        deliver: draft.deliver,
        repeat_times: draft.repeat_infinite ? null : parseInt(draft.repeat_times, 10) || 1,
        workdir: draft.workdir.trim() || null,
        skills: draft.skills.trim()
          ? draft.skills.split(",").map((s) => s.trim()).filter(Boolean)
          : [],
      };
      await cronAction("create", undefined, payload);
      await onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div
        className="settings-modal"
        style={{ width: "min(680px, 94vw)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <h2>CREATE CRONJOB</h2>
          <button className="settings-close" onClick={onClose}>✕</button>
        </div>
        <div className="settings-body">
          <div className="settings-section">
            <h3>IDENTITY</h3>
            <div className="settings-section-body">
              <label className="settings-field">
                <span className="settings-field-label">name (optional)</span>
                <input value={draft.name} onChange={(e) => up("name", e.target.value)} placeholder="daily-standup" />
              </label>
              <label className="settings-field settings-field-required">
                <span className="settings-field-label">prompt</span>
                <textarea
                  value={draft.prompt}
                  onChange={(e) => up("prompt", e.target.value)}
                  placeholder="Summarise yesterday's git log and post to Telegram"
                  rows={4}
                  style={{
                    background: "var(--bg-tint)", border: "1px solid var(--border)",
                    color: "var(--fg)", fontFamily: "var(--code-font)", fontSize: 13,
                    padding: "6px 10px", outline: "none", resize: "vertical", width: "100%",
                  }}
                />
              </label>
            </div>
          </div>

          <div className="settings-section">
            <h3>SCHEDULE</h3>
            <div className="settings-section-body">
              <label className="settings-field settings-field-required">
                <span className="settings-field-label">schedule expression (cron or "every Xm / daily 09:00 / once at 2025-06-01T09:00")</span>
                <input
                  value={draft.schedule_display}
                  onChange={(e) => up("schedule_display", e.target.value)}
                  placeholder="0 9 * * 1-5  or  every 30m  or  daily 09:00"
                />
              </label>
              <label className="settings-field">
                <span className="settings-field-label">repeat</span>
                <div style={{ display: "flex", gap: 14, alignItems: "center", padding: "4px 0" }}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer", fontSize: 18 }}>
                    <input
                      type="radio" name="repeat" value="infinite"
                      checked={draft.repeat_infinite}
                      onChange={() => up("repeat_infinite", true)}
                    />
                    infinite
                  </label>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer", fontSize: 18 }}>
                    <input
                      type="radio" name="repeat" value="n"
                      checked={!draft.repeat_infinite}
                      onChange={() => up("repeat_infinite", false)}
                    />
                    N times
                  </label>
                  {!draft.repeat_infinite ? (
                    <input
                      type="number"
                      value={draft.repeat_times}
                      onChange={(e) => up("repeat_times", e.target.value)}
                      min={1} style={{ width: 80, background: "var(--bg-tint)", border: "1px solid var(--border)", color: "var(--fg)", fontFamily: "var(--code-font)", fontSize: 13, padding: "4px 8px", outline: "none" }}
                    />
                  ) : null}
                </div>
              </label>
            </div>
          </div>

          <div className="settings-section">
            <h3>DELIVERY</h3>
            <div className="settings-section-body">
              <label className="settings-field">
                <span className="settings-field-label">deliver to</span>
                <select value={draft.deliver} onChange={(e) => up("deliver", e.target.value)}>
                  {["local", "telegram", "discord", "origin"].map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </label>
              <label className="settings-field">
                <span className="settings-field-label">working directory (optional)</span>
                <input value={draft.workdir} onChange={(e) => up("workdir", e.target.value)} placeholder="/path/to/project" />
              </label>
              <label className="settings-field">
                <span className="settings-field-label">skills to inject (comma-separated, optional)</span>
                <input value={draft.skills} onChange={(e) => up("skills", e.target.value)} placeholder="git-summary,slack-post" />
              </label>
            </div>
          </div>
        </div>

        {error ? <div className="settings-error settings-error-sticky">{error}</div> : null}

        <div className="settings-footer">
          <button className="settings-btn-secondary" onClick={onClose} disabled={saving}>cancel</button>
          <button className="settings-btn-primary" onClick={handleCreate} disabled={saving}>
            {saving ? "creating…" : "create job"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── job detail modal ─────────────────────────────────────────────────────────

function JobDetailModal({
  job,
  onClose,
  onAction,
}: {
  readonly job: CronJob;
  readonly onClose: () => void;
  readonly onAction: (action: string, jobId: string) => Promise<void>;
}): React.JSX.Element {
  const [outputs, setOutputs] = useState<CronOutput[]>([]);
  const [loadingOutputs, setLoadingOutputs] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [expandedRun, setExpandedRun] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        const out = await queryOutputs(job.id, 10);
        if (!cancelled) { setOutputs(out); }
      } finally {
        if (!cancelled) setLoadingOutputs(false);
      }
    })();
    return (): void => { cancelled = true; };
  }, [job.id]);

  const act = async (action: string): Promise<void> => {
    if (action === "delete" && !confirm(`Delete job "${job.name || job.id}"? This cannot be undone.`)) return;
    setActionBusy(true);
    try {
      await onAction(action, job.id);
      onClose();
    } finally {
      setActionBusy(false);
    }
  };

  const successCount = outputs.filter((o) => o.success).length;
  const rate = outputs.length > 0 ? Math.round((successCount / outputs.length) * 100) : null;

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div
        className="settings-modal"
        style={{ width: "min(740px, 96vw)", maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <h2>{job.name || job.id.slice(0, 8)}</h2>
          <button className="settings-close" onClick={onClose}>✕</button>
        </div>
        <div className="settings-body">
          <div className="dv-detail-meta" style={{ flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
            <StateBadge state={job.state} />
            <StatusBadge status={job.last_status} />
            {rate !== null ? <span className="dv-pill dv-pill-accent">{rate}% success</span> : null}
            <span className="dv-pill">{job.schedule_display}</span>
            <span className="dv-pill">{job.deliver ?? "local"}</span>
            {job.repeat_times !== null ? <span className="dv-pill">{job.repeat_completed}/{job.repeat_times} runs</span> : null}
          </div>

          <h3 className="dv-section-h">PROMPT</h3>
          <div className="dv-detail-text" style={{ background: "var(--bg-tint)", border: "1px solid var(--border)", padding: "8px 12px", marginBottom: 8, fontFamily: "var(--code-font)", fontSize: 13, whiteSpace: "pre-wrap" }}>
            {job.prompt}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 24px", marginBottom: 10 }}>
            <InfoRow label="next run" value={relTime(job.next_run_at)} />
            <InfoRow label="last run" value={fmtDate(job.last_run_at)} />
            <InfoRow label="created" value={fmtDate(job.created_at)} />
            {job.workdir ? <InfoRow label="workdir" value={job.workdir} /> : null}
            {job.provider ? <InfoRow label="provider" value={`${job.provider} / ${job.model ?? ""}`} /> : null}
          </div>

          {job.skills.length > 0 ? (
            <>
              <h3 className="dv-section-h">SKILLS</h3>
              <div className="dv-detail-meta">{job.skills.map((s) => <span key={s} className="dv-pill">{s}</span>)}</div>
            </>
          ) : null}

          {job.last_error ? (
            <>
              <h3 className="dv-section-h" style={{ color: "var(--red)" }}>LAST ERROR</h3>
              <div style={{ color: "var(--red)", fontFamily: "var(--code-font)", fontSize: 12, padding: "6px 10px", background: "rgba(217,106,106,0.08)", border: "1px solid var(--red)", marginBottom: 8 }}>
                {job.last_error}
              </div>
            </>
          ) : null}

          <h3 className="dv-section-h">LAST {outputs.length} OUTPUTS</h3>
          {loadingOutputs ? <div className="dataview-empty" style={{ fontSize: 18 }}>loading…</div> : null}
          {!loadingOutputs && outputs.length === 0 ? (
            <div className="dataview-empty" style={{ fontSize: 18 }}>no outputs yet</div>
          ) : null}
          {outputs.map((out, i) => (
            <div key={i} className="sched-output">
              <div
                className="sched-output-header"
                onClick={() => setExpandedRun(expandedRun === i ? null : i)}
              >
                <span style={{ color: out.success ? "var(--cyan)" : "var(--red)" }}>
                  {out.success ? "ok" : "err"}
                </span>
                <span style={{ color: "var(--dim)", fontSize: 17 }}>{fmtDate(out.run_at)}</span>
                {out.error_message ? <span style={{ color: "var(--red)", fontSize: 17 }}>{out.error_message}</span> : null}
                <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 16 }}>
                  {expandedRun === i ? "▲" : "▼"}
                </span>
              </div>
              {expandedRun === i && out.output_markdown ? (
                <div className="sched-output-body">
                  <Markdown text={out.output_markdown} />
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <div className="settings-footer">
          <button
            className="settings-btn-secondary"
            style={{ borderColor: "var(--red)", color: "var(--red)", marginRight: "auto" }}
            onClick={() => act("delete")}
            disabled={actionBusy}
          >delete</button>
          {job.state === "paused" ? (
            <button className="settings-btn-secondary" onClick={() => act("resume")} disabled={actionBusy}>resume</button>
          ) : (
            <button className="settings-btn-secondary" onClick={() => act("pause")} disabled={actionBusy || job.state === "completed"}>pause</button>
          )}
          <button className="settings-btn-secondary" onClick={() => act("run-now")} disabled={actionBusy}>run now</button>
          <button className="settings-btn-primary" onClick={onClose}>close</button>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { readonly label: string; readonly value: string }): React.JSX.Element {
  return (
    <div>
      <span style={{ color: "var(--dim)", fontSize: 17 }}>{label}:</span>{" "}
      <span style={{ color: "var(--fg)", fontSize: 18 }}>{value}</span>
    </div>
  );
}

// ─── main view ────────────────────────────────────────────────────────────────

type StateFilter = "all" | "scheduled" | "running" | "paused" | "completed" | "error";

export function SchedulerView(): React.JSX.Element {
  const { jobs, loading, error, refresh } = useCronJobs(5000);
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [enabledFilter, setEnabledFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CronJob | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const filtered = jobs.filter((j) => {
    if (stateFilter !== "all" && j.state !== stateFilter) return false;
    if (enabledFilter === "enabled" && !j.enabled) return false;
    if (enabledFilter === "disabled" && j.enabled) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!j.name.toLowerCase().includes(q) && !j.prompt.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const handleAction = useCallback(async (action: string, jobId: string): Promise<void> => {
    setActionError(null);
    try {
      await cronAction(action, jobId);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, [refresh]);

  const STATE_FILTERS: StateFilter[] = ["all", "scheduled", "running", "paused", "completed", "error"];

  return (
    <div className="dataview">
      <div className="dataview-header">
        <h2>SCHEDULER <span className="dataview-count">{jobs.length}</span></h2>
        <input
          className="dataview-search"
          placeholder="search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="dv-tag" style={{ marginLeft: "auto" }} onClick={() => setShowCreate(true)}>
          + create job
        </button>
      </div>

      {actionError ? (
        <div className="settings-error" style={{ marginBottom: 8, fontSize: 17 }}>{actionError}</div>
      ) : null}

      <div className="dv-tag-row" style={{ gap: 6 }}>
        {STATE_FILTERS.map((s) => (
          <button key={s} className={`dv-tag ${stateFilter === s ? "active" : ""}`} onClick={() => setStateFilter(s)}>{s}</button>
        ))}
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {(["all", "enabled", "disabled"] as const).map((e) => (
            <button key={e} className={`dv-tag ${enabledFilter === e ? "active" : ""}`} onClick={() => setEnabledFilter(e)}>{e}</button>
          ))}
        </span>
      </div>

      {loading ? <div className="dataview-empty">loading…</div> : null}
      {!loading && error ? (
        <div className="dataview-empty" style={{ color: "var(--muted)" }}>
          {error.includes("no such table") || error.includes("cron.db")
            ? "No scheduler database found. Cron jobs will appear here once you create one via cero scheduler."
            : error}
        </div>
      ) : null}
      {!loading && !error && jobs.length === 0 ? (
        <div className="dataview-empty">
          no jobs yet — click "+ create job" to schedule your first cronjob.
        </div>
      ) : null}

      <div className="dataview-list">
        {filtered.map((job) => {
          const successIcon = job.last_status === "ok" ? "✓" : job.last_status === "error" ? "✗" : "·";
          const successColor = job.last_status === "ok" ? "var(--cyan)" : job.last_status === "error" ? "var(--red)" : "var(--muted)";
          return (
            <div key={job.id} className="dv-row" onClick={() => setSelected(job)}>
              <div className="dv-row-main">
                <div className="dv-row-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: successColor, fontSize: 20 }}>{successIcon}</span>
                  {job.name || <span style={{ color: "var(--dim)" }}>{job.id.slice(0, 12)}</span>}
                  {!job.enabled ? <span className="dv-pill dv-pill-dim" style={{ fontSize: 11 }}>disabled</span> : null}
                </div>
                <div className="dv-row-sub">
                  {job.prompt.slice(0, 100)}{job.prompt.length > 100 ? "…" : ""}
                </div>
              </div>
              <div className="dv-row-meta">
                <StateBadge state={job.state} />
                <span className="dv-pill">{job.schedule_display}</span>
                <span className="dv-pill dv-pill-dim" title="next run">{relTime(job.next_run_at)}</span>
                {job.deliver && job.deliver !== "local" ? <span className="dv-pill">{job.deliver}</span> : null}
              </div>
            </div>
          );
        })}
      </div>

      {selected ? (
        <JobDetailModal
          job={selected}
          onClose={() => setSelected(null)}
          onAction={async (action, jobId) => {
            await handleAction(action, jobId);
            setSelected(null);
          }}
        />
      ) : null}

      {showCreate ? (
        <CreateJobModal
          onClose={() => setShowCreate(false)}
          onCreated={refresh}
        />
      ) : null}
    </div>
  );
}
