// UserModelView — v0.4 interactive identity card.
// Replaces the raw JSON viewer with a designed "what your agent knows about you"
// card with sections for expertise, projects, communication prefs, preferences,
// a growth timeline, and inline editing with save/cancel.

import { useState, useCallback, useMemo } from "react";
import {
  useUserModel,
  saveUserModel,
  type UserModel,
  type ExpertiseArea,
  type Project,
  type Preference,
  type UserModelHistoryEntry,
} from "../hooks/useCeroData";
import { useToastContext } from "../hooks/ToastContext";

// ─────────────── completeness score ───────────────

export function computeCompleteness(model: UserModel): number {
  const expertiseScore = Math.min(model.expertise_areas.length / 5, 1) * 30;
  const projectScore = Math.min(model.current_projects.length / 3, 1) * 25;
  const prefScore = Math.min(model.preferences.length / 5, 1) * 20;
  const commScore = Object.keys(model.communication_prefs).length > 0 ? 15 : 0;
  const versionScore = model.version > 5 ? 10 : 0;
  return Math.min(
    Math.round(expertiseScore + projectScore + prefScore + commScore + versionScore),
    100,
  );
}

// ─────────────── avatar ───────────────

function avatarChar(model: UserModel): string {
  const first = model.expertise_areas[0];
  if (first) return first.area.slice(0, 1).toUpperCase();
  return "?";
}

// ─────────────── relative time ───────────────

function relTime(ts: number): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toISOString().slice(0, 10);
}

// ─────────────── circular progress ───────────────

function CircularScore({ pct }: { readonly pct: number }): React.JSX.Element {
  const r = 18;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg
      width={48}
      height={48}
      style={{ flexShrink: 0, imageRendering: "pixelated" }}
      aria-label={`completeness ${pct}%`}
    >
      <circle
        cx={24}
        cy={24}
        r={r}
        fill="none"
        stroke="var(--border)"
        strokeWidth={4}
      />
      <circle
        cx={24}
        cy={24}
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={4}
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeDashoffset={circ / 4}
        strokeLinecap="square"
      />
      <text
        x={24}
        y={28}
        textAnchor="middle"
        fill="var(--accent)"
        fontFamily="var(--pixel-font)"
        fontSize={13}
      >
        {pct}%
      </text>
    </svg>
  );
}

// ─────────────── pixel bar chart ───────────────

function PixelBar({
  value,
  max,
  color = "var(--accent)",
}: {
  readonly value: number;
  readonly max: number;
  readonly color?: string;
}): React.JSX.Element {
  const pct = max === 0 ? 0 : Math.min((value / max) * 100, 100);
  return (
    <div
      style={{
        height: 4,
        background: "var(--border)",
        position: "relative",
        marginTop: 4,
        imageRendering: "pixelated",
      }}
      aria-label={`${value} of ${max}`}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: `${pct}%`,
          background: color,
        }}
      />
    </div>
  );
}

// ─────────────── section wrapper ───────────────

function Section({
  title,
  children,
  action,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
  readonly action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="um-section">
      <div className="um-section-header">
        <span className="um-section-title">{title}</span>
        {action ?? null}
      </div>
      {children}
    </div>
  );
}

// ─────────────── expertise section ───────────────

// Future-use: rank for sorting expertise by level.
// Removed (was triggering noUnusedLocals); reintroduce when sort flow lands.

const LEVEL_COLOR: Record<string, string> = {
  beginner: "var(--dim)",
  intermediate: "var(--cyan)",
  advanced: "var(--accent)",
  expert: "var(--magenta)",
};

function ExpertiseSection({
  areas,
  onChange,
}: {
  readonly areas: ExpertiseArea[];
  readonly onChange: (next: ExpertiseArea[]) => void;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [newArea, setNewArea] = useState<ExpertiseArea>({
    area: "",
    level: "intermediate",
    evidence_count: 0,
  });
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<ExpertiseArea | null>(null);
  const [confirmDeleteIdx, setConfirmDeleteIdx] = useState<number | null>(null);

  const maxEvidence = useMemo(
    () => Math.max(...areas.map((a) => a.evidence_count), 1),
    [areas],
  );

  const handleDelete = (idx: number): void => {
    onChange(areas.filter((_, i) => i !== idx));
    setExpanded(null);
    setConfirmDeleteIdx(null);
  };

  const handleEditSave = (idx: number): void => {
    if (!editDraft) return;
    onChange(areas.map((a, i) => (i === idx ? editDraft : a)));
    setEditIdx(null);
    setEditDraft(null);
  };

  const handleAdd = (): void => {
    if (!newArea.area.trim()) return;
    onChange([...areas, { ...newArea, area: newArea.area.trim() }]);
    setNewArea({ area: "", level: "intermediate", evidence_count: 0 });
    setAddMode(false);
  };

  if (areas.length === 0 && !addMode) {
    return (
      <Section
        title="EXPERTISE"
        action={
          <button className="um-add-btn" onClick={() => setAddMode(true)}>
            + add
          </button>
        }
      >
        <div className="um-empty">no expertise areas yet — cero will detect them as you work</div>
      </Section>
    );
  }

  return (
    <Section
      title="EXPERTISE"
      action={
        !addMode ? (
          <button className="um-add-btn" onClick={() => setAddMode(true)}>
            + add
          </button>
        ) : null
      }
    >
      {areas.map((area, idx) => {
        const isExpanded = expanded === idx;
        const isEditing = editIdx === idx;
        return (
          <div key={idx} className={`um-expertise-row${isExpanded ? " um-expertise-row-open" : ""}`}>
            <div
              className="um-expertise-main"
              onClick={() => {
                if (!isEditing) setExpanded(isExpanded ? null : idx);
              }}
              style={{ cursor: "pointer" }}
            >
              <span className="um-expertise-name">{area.area}</span>
              <span
                className="dv-pill"
                style={{
                  borderColor: LEVEL_COLOR[area.level] ?? "var(--dim)",
                  color: LEVEL_COLOR[area.level] ?? "var(--dim)",
                }}
              >
                {area.level}
              </span>
              <span className="um-evidence-count">×{area.evidence_count}</span>
            </div>
            <PixelBar
              value={area.evidence_count}
              max={maxEvidence}
              color={LEVEL_COLOR[area.level] ?? "var(--accent)"}
            />
            {isExpanded && !isEditing && (
              <div className="um-expertise-detail">
                {area.last_evidence_at ? (
                  <span className="um-expertise-meta">
                    last evidence: {relTime(area.last_evidence_at)}
                  </span>
                ) : null}
                <div className="um-expertise-actions">
                  <button
                    className="um-action-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditIdx(idx);
                      setEditDraft({ ...area });
                    }}
                  >
                    edit
                  </button>
                  {confirmDeleteIdx === idx ? (
                    <>
                      <button
                        className="um-action-btn um-action-danger"
                        onClick={(e) => { e.stopPropagation(); handleDelete(idx); }}
                      >
                        confirm delete
                      </button>
                      <button
                        className="um-action-btn"
                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteIdx(null); }}
                      >
                        cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="um-action-btn um-action-danger"
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteIdx(idx); }}
                    >
                      delete
                    </button>
                  )}
                </div>
              </div>
            )}
            {isEditing && editDraft && (
              <div className="um-edit-row" onClick={(e) => e.stopPropagation()}>
                <input
                  className="um-inline-input"
                  value={editDraft.area}
                  onChange={(e) => setEditDraft({ ...editDraft, area: e.target.value })}
                  aria-label="expertise area name"
                />
                <select
                  className="um-inline-select"
                  value={editDraft.level}
                  onChange={(e) =>
                    setEditDraft({
                      ...editDraft,
                      level: e.target.value as ExpertiseArea["level"],
                    })
                  }
                  aria-label="expertise level"
                >
                  {["beginner", "intermediate", "advanced", "expert"].map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
                <button className="um-action-btn" onClick={() => handleEditSave(idx)}>
                  save
                </button>
                <button
                  className="um-action-btn"
                  onClick={() => { setEditIdx(null); setEditDraft(null); }}
                >
                  cancel
                </button>
              </div>
            )}
          </div>
        );
      })}
      {addMode && (
        <div className="um-add-row">
          <input
            className="um-inline-input"
            placeholder="area name (e.g. TypeScript)"
            value={newArea.area}
            onChange={(e) => setNewArea({ ...newArea, area: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") setAddMode(false); }}
            aria-label="new expertise area"
            autoFocus
          />
          <select
            className="um-inline-select"
            value={newArea.level}
            onChange={(e) =>
              setNewArea({ ...newArea, level: e.target.value as ExpertiseArea["level"] })
            }
            aria-label="new expertise level"
          >
            {["beginner", "intermediate", "advanced", "expert"].map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <button className="um-action-btn um-action-accent" onClick={handleAdd}>
            add
          </button>
          <button className="um-action-btn" onClick={() => setAddMode(false)}>
            cancel
          </button>
        </div>
      )}
    </Section>
  );
}

// ─────────────── projects section ───────────────

const STATUS_COLOR: Record<string, string> = {
  active: "var(--accent)",
  paused: "var(--amber)",
  archived: "var(--muted)",
};

function ProjectsSection({
  projects,
  onChange,
}: {
  readonly projects: Project[];
  readonly onChange: (next: Project[]) => void;
}): React.JSX.Element {
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Project | null>(null);
  const [confirmDeleteIdx, setConfirmDeleteIdx] = useState<number | null>(null);

  const handleDelete = (idx: number): void => {
    onChange(projects.filter((_, i) => i !== idx));
    setConfirmDeleteIdx(null);
  };

  const handleEditSave = (idx: number): void => {
    if (!editDraft) return;
    onChange(projects.map((p, i) => (i === idx ? editDraft : p)));
    setEditIdx(null);
    setEditDraft(null);
  };

  if (projects.length === 0) {
    return (
      <Section title="CURRENT PROJECTS">
        <div className="um-empty">no projects tracked yet — cero will detect them from your working directories</div>
      </Section>
    );
  }

  return (
    <Section title="CURRENT PROJECTS">
      {projects.map((p, idx) => {
        const isEditing = editIdx === idx;
        return (
          <div key={idx} className="um-project-row">
            {isEditing && editDraft ? (
              <div className="um-edit-row">
                <input
                  className="um-inline-input"
                  value={editDraft.name}
                  onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                  aria-label="project name"
                />
                <select
                  className="um-inline-select"
                  value={editDraft.status}
                  onChange={(e) =>
                    setEditDraft({
                      ...editDraft,
                      status: e.target.value as Project["status"],
                    })
                  }
                  aria-label="project status"
                >
                  {["active", "paused", "archived"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <button className="um-action-btn" onClick={() => handleEditSave(idx)}>
                  save
                </button>
                <button
                  className="um-action-btn"
                  onClick={() => { setEditIdx(null); setEditDraft(null); }}
                >
                  cancel
                </button>
              </div>
            ) : (
              <div className="um-project-main">
                <span className="um-project-name">{p.name}</span>
                {p.cwd ? (
                  <code className="md-inline um-project-cwd">{p.cwd}</code>
                ) : null}
                <span
                  className="dv-pill"
                  style={{
                    borderColor: STATUS_COLOR[p.status] ?? "var(--dim)",
                    color: STATUS_COLOR[p.status] ?? "var(--dim)",
                  }}
                >
                  {p.status}
                </span>
                <span className="um-project-age">{relTime(p.last_active_at)}</span>
                <div className="um-expertise-actions">
                  <button
                    className="um-action-btn"
                    onClick={() => { setEditIdx(idx); setEditDraft({ ...p }); }}
                  >
                    edit
                  </button>
                  {confirmDeleteIdx === idx ? (
                    <>
                      <button
                        className="um-action-btn um-action-danger"
                        onClick={() => handleDelete(idx)}
                      >
                        confirm delete
                      </button>
                      <button
                        className="um-action-btn"
                        onClick={() => setConfirmDeleteIdx(null)}
                      >
                        cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="um-action-btn um-action-danger"
                      onClick={() => setConfirmDeleteIdx(idx)}
                    >
                      delete
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </Section>
  );
}

// ─────────────── communication prefs section ───────────────

function CommPrefsSection({
  prefs,
  onChange,
}: {
  readonly prefs: Record<string, unknown>;
  readonly onChange: (next: Record<string, unknown>) => void;
}): React.JSX.Element {
  const LANG_OPTIONS = ["en", "es", "pt", "fr", "de", "zh", "ja"];
  const TONE_OPTIONS = ["concise", "neutral", "detailed"];
  const EMOJI_OPTIONS = ["none", "minimal", "free"];

  const language = (prefs["language"] as string) ?? "en";
  const tone = (prefs["tone"] as string) ?? "neutral";
  const emojiUsage = (prefs["emoji_usage"] as string) ?? "minimal";

  const set = (key: string, value: string): void => {
    onChange({ ...prefs, [key]: value });
  };

  return (
    <Section title="COMMUNICATION">
      <div className="um-comm-grid">
        <div className="um-comm-field">
          <span className="um-comm-label">language</span>
          <div className="um-pill-group">
            {LANG_OPTIONS.map((l) => (
              <button
                key={l}
                className={`um-pill-toggle${language === l ? " um-pill-active" : ""}`}
                onClick={() => set("language", l)}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="um-comm-field">
          <span className="um-comm-label">tone</span>
          <div className="um-pill-group">
            {TONE_OPTIONS.map((t) => (
              <button
                key={t}
                className={`um-pill-toggle${tone === t ? " um-pill-active" : ""}`}
                onClick={() => set("tone", t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="um-comm-field">
          <span className="um-comm-label">emoji</span>
          <div className="um-pill-group">
            {EMOJI_OPTIONS.map((e) => (
              <button
                key={e}
                className={`um-pill-toggle${emojiUsage === e ? " um-pill-active" : ""}`}
                onClick={() => set("emoji_usage", e)}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}

// ─────────────── preferences section ───────────────

const CONFIDENCE_COLOR = (c: number): string => {
  if (c >= 0.8) return "var(--accent)";
  if (c >= 0.5) return "var(--cyan)";
  return "var(--dim)";
};

function PreferencesSection({
  preferences,
  onChange,
}: {
  readonly preferences: Preference[];
  readonly onChange: (next: Preference[]) => void;
}): React.JSX.Element {
  const [confirmDeleteIdx, setConfirmDeleteIdx] = useState<number | null>(null);

  const handleDelete = (idx: number): void => {
    onChange(preferences.filter((_, i) => i !== idx));
    setConfirmDeleteIdx(null);
  };

  if (preferences.length === 0) {
    return (
      <Section title="PREFERENCES">
        <div className="um-empty">no preferences recorded yet — agent-inferred preferences appear here</div>
      </Section>
    );
  }

  return (
    <Section title="PREFERENCES">
      {preferences.map((p, idx) => (
        <div key={idx} className="um-pref-row">
          <span className="um-pref-key">{p.key}</span>
          <span className="um-pref-eq">=</span>
          <span className="um-pref-val">{String(p.value)}</span>
          <span
            className="dv-pill"
            style={{
              borderColor: p.source === "explicit" ? "var(--accent)" : "var(--border)",
              color: p.source === "explicit" ? "var(--accent)" : "var(--dim)",
            }}
          >
            {p.source}
          </span>
          <PixelBar value={p.confidence} max={1} color={CONFIDENCE_COLOR(p.confidence)} />
          <div className="um-expertise-actions">
            {confirmDeleteIdx === idx ? (
              <>
                <button
                  className="um-action-btn um-action-danger"
                  onClick={() => handleDelete(idx)}
                >
                  confirm delete
                </button>
                <button
                  className="um-action-btn"
                  onClick={() => setConfirmDeleteIdx(null)}
                >
                  cancel
                </button>
              </>
            ) : (
              <button
                className="um-action-btn um-action-danger"
                onClick={() => setConfirmDeleteIdx(idx)}
              >
                delete
              </button>
            )}
          </div>
        </div>
      ))}
    </Section>
  );
}

// ─────────────── growth timeline ───────────────

function GrowthTimeline({
  history,
  currentVersion,
}: {
  readonly history: UserModelHistoryEntry[];
  readonly currentVersion: number;
}): React.JSX.Element {
  const events = useMemo(() => {
    // Build version-tagged events from history entries, newest → oldest
    const sorted = [...history].sort((a, b) => a.ts - b.ts);
    return sorted.slice(-12); // last 12 events max
  }, [history]);

  if (events.length === 0) {
    return (
      <Section title="GROWTH TIMELINE">
        <div className="um-empty">v{currentVersion} — learning accumulates here after each session</div>
      </Section>
    );
  }

  return (
    <Section title="GROWTH TIMELINE">
      <div className="um-timeline">
        {events.map((e, idx) => {
          const changedFields = Object.keys(e.patch).join(", ");
          return (
            <div key={idx} className="um-timeline-event">
              <div className="um-timeline-dot" />
              <div className="um-timeline-line" />
              <div className="um-timeline-body">
                <span className="um-timeline-ts">{relTime(e.ts)}</span>
                <span className="um-timeline-source dv-pill">{e.source}</span>
                {changedFields ? (
                  <span className="um-timeline-fields">{changedFields}</span>
                ) : null}
                {e.reason ? (
                  <span className="um-timeline-reason">{e.reason}</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ─────────────── identity card header ───────────────

function IdentityHeader({
  model,
  completeness,
  name,
  onNameChange,
}: {
  readonly model: UserModel;
  readonly completeness: number;
  readonly name: string;
  readonly onNameChange: (n: string) => void;
}): React.JSX.Element {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(name);
  const avatar = avatarChar(model);

  const commitName = (): void => {
    onNameChange(nameDraft.trim() || "anon");
    setEditingName(false);
  };

  return (
    <div className="um-identity-header">
      <div className="um-avatar" aria-label="user avatar">
        {avatar}
      </div>
      <div className="um-identity-meta">
        {editingName ? (
          <input
            className="um-name-input"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") {
                setNameDraft(name);
                setEditingName(false);
              }
            }}
            autoFocus
            aria-label="user name"
          />
        ) : (
          <button
            className="um-name-btn"
            onClick={() => { setEditingName(true); setNameDraft(name); }}
            title="click to edit"
          >
            {name}
          </button>
        )}
        <div className="um-identity-badges">
          <span className="dv-pill dv-pill-accent">v{model.version}</span>
          <span className="um-last-updated">
            updated {relTime(model.last_updated_at)}
          </span>
        </div>
      </div>
      <CircularScore pct={completeness} />
    </div>
  );
}

// ─────────────── main view ───────────────

export interface UserModelViewProps {
  readonly snapshotVersion: number;
}

export function UserModelView({ snapshotVersion }: UserModelViewProps): React.JSX.Element {
  const { model, loading, refresh } = useUserModel(snapshotVersion);
  const { toast } = useToastContext();
  const [draft, setDraft] = useState<UserModel | null>(null);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // draft is what the user is editing; falls back to model when not dirty
  const effective = draft ?? model;
  const isDirty = draft !== null;
  const completeness = effective ? computeCompleteness(effective) : 0;

  // Derive a display name — use first expertise area or "anon"
  const [displayName, setDisplayName] = useState("anon");

  const patchDraft = useCallback((patch: Partial<UserModel>): void => {
    setDraft((prev) => {
      const base = prev ?? model;
      if (!base) return prev;
      return { ...base, ...patch };
    });
  }, [model]);

  const handleSave = useCallback(async (): Promise<void> => {
    if (!draft) return;
    setSaving(true);
    try {
      await saveUserModel(draft);
      toast.success("user model saved");
      await refresh();
      setDraft(null);
    } catch (err) {
      toast.error(`save failed: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [draft, refresh, toast]);

  const handleCancel = useCallback((): void => {
    setDraft(null);
  }, []);

  if (loading) {
    return (
      <div className="dataview">
        <div className="dataview-empty">loading…</div>
      </div>
    );
  }

  if (!effective) {
    return (
      <div className="dataview">
        <div className="dataview-empty">
          no user model yet — cero builds one as it learns from your sessions
        </div>
      </div>
    );
  }

  return (
    <div className="dataview um-view">
      {/* ── view header ── */}
      <div className="dataview-header">
        <h2>
          IDENTITY <span className="dataview-count">v{effective.version}</span>
        </h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            className="dv-tag"
            onClick={() => setShowHistory((s) => !s)}
          >
            {showHistory ? "card" : `history (${effective.history.length})`}
          </button>
        </div>
      </div>

      {showHistory ? (
        <HistoryPanel history={effective.history} />
      ) : (
        <div className="um-body">
          {/* ── identity header card ── */}
          <IdentityHeader
            model={effective}
            completeness={completeness}
            name={displayName}
            onNameChange={setDisplayName}
          />

          {/* ── sections ── */}
          <ExpertiseSection
            areas={effective.expertise_areas}
            onChange={(next) => patchDraft({ expertise_areas: next })}
          />
          <ProjectsSection
            projects={effective.current_projects}
            onChange={(next) => patchDraft({ current_projects: next })}
          />
          <CommPrefsSection
            prefs={effective.communication_prefs}
            onChange={(next) => patchDraft({ communication_prefs: next })}
          />
          <PreferencesSection
            preferences={effective.preferences}
            onChange={(next) => patchDraft({ preferences: next })}
          />
          <GrowthTimeline
            history={effective.history}
            currentVersion={effective.version}
          />

          {/* ── footer ── */}
          <div className="um-footer">
            <span className="um-meta-text">
              last updated: {new Date(effective.last_updated_at).toISOString().slice(0, 16).replace("T", " ")}
            </span>
            {isDirty && (
              <div className="um-save-bar">
                <button
                  className="settings-btn-secondary"
                  onClick={handleCancel}
                  disabled={saving}
                >
                  cancel
                </button>
                <button
                  className="settings-btn-primary"
                  onClick={() => void handleSave()}
                  disabled={saving}
                >
                  {saving ? "saving…" : "save changes"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────── history panel ───────────────

function HistoryPanel({
  history,
}: {
  readonly history: ReadonlyArray<UserModelHistoryEntry>;
}): React.JSX.Element {
  if (history.length === 0) {
    return <div className="dataview-empty">no history entries yet</div>;
  }
  const sorted = [...history].sort((a, b) => b.ts - a.ts);
  return (
    <div className="dataview-list">
      {sorted.map((entry, i) => (
        <div key={i} className="dv-row">
          <div className="dv-row-main">
            <div className="dv-row-title">
              {new Date(entry.ts).toISOString().slice(0, 16).replace("T", " ")} · {entry.source}
            </div>
            {entry.reason ? <div className="dv-row-sub">{entry.reason}</div> : null}
            <pre className="dv-history-patch">{JSON.stringify(entry.patch, null, 2)}</pre>
          </div>
        </div>
      ))}
    </div>
  );
}
