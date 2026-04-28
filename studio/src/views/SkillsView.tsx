import { useState } from "react";
import { type Skill, deleteSkill, saveSkill, useSkills } from "../hooks/useCeroData";

export interface SkillsViewProps {
  readonly snapshotVersion: number;
}

export function SkillsView({ snapshotVersion }: SkillsViewProps): React.JSX.Element {
  const { items, loading, refresh } = useSkills(snapshotVersion);
  const [selected, setSelected] = useState<Skill | null>(null);
  const [filter, setFilter] = useState("");

  const filtered = filter.trim().length === 0
    ? items
    : items.filter((s) =>
        (s.name + " " + s.problem + " " + s.tags.join(" "))
          .toLowerCase()
          .includes(filter.toLowerCase()),
      );

  return (
    <div className="dataview">
      <div className="dataview-header">
        <h2>SKILLS <span className="dataview-count">{items.length}</span></h2>
        <input
          className="dataview-search"
          placeholder="filtrar..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {loading ? <div className="dataview-empty">cargando…</div> : null}
      {!loading && items.length === 0 ? (
        <div className="dataview-empty">no hay skills aún. cero las creará a medida que detecte patrones reusables.</div>
      ) : null}
      <div className="dataview-list">
        {filtered.map((s) => {
          const rate = s.applied_count > 0 ? Math.round((s.success_count / s.applied_count) * 100) : null;
          return (
            <div key={s.id} className="dv-row" onClick={() => setSelected(s)}>
              <div className="dv-row-main">
                <div className="dv-row-title">{s.name}</div>
                <div className="dv-row-sub">{s.problem.slice(0, 120)}{s.problem.length > 120 ? "…" : ""}</div>
              </div>
              <div className="dv-row-meta">
                <span className="dv-pill">{s.category}</span>
                <span className="dv-pill">{s.state}</span>
                <span className="dv-pill">v{s.version}</span>
                {rate !== null ? <span className="dv-pill dv-pill-accent">{rate}%</span> : <span className="dv-pill">unproven</span>}
                <span className="dv-pill">{s.applied_count}× applied</span>
              </div>
            </div>
          );
        })}
      </div>
      {selected ? (
        <SkillDetailModal
          skill={selected}
          onClose={() => setSelected(null)}
          onDelete={async () => {
            await deleteSkill(selected);
            setSelected(null);
            await refresh();
          }}
          onSave={async (updated) => {
            await saveSkill(selected, updated);
            setSelected(updated);
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function SkillDetailModal({
  skill,
  onClose,
  onDelete,
  onSave,
}: {
  readonly skill: Skill;
  readonly onClose: () => void;
  readonly onDelete: () => Promise<void>;
  readonly onSave: (updated: Skill) => Promise<void>;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => JSON.stringify(skill, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const rate = skill.applied_count > 0
    ? Math.round((skill.success_count / skill.applied_count) * 100)
    : null;

  const handleSave = async (): Promise<void> => {
    let parsed: Skill;
    try {
      parsed = JSON.parse(draft) as Skill;
    } catch (err) {
      setParseError(`JSON parse error: ${String(err)}`);
      return;
    }
    if (typeof parsed?.id !== "string") {
      setParseError("missing required field: id");
      return;
    }
    if (parsed.id !== skill.id) {
      setParseError(`id cannot change (was ${skill.id})`);
      return;
    }
    setParseError(null);
    try {
      await onSave(parsed);
      setEditing(false);
    } catch (err) {
      setParseError(String(err));
    }
  };

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>{skill.name}</h2>
          <button className="settings-close" onClick={onClose}>✕</button>
        </div>
        <div className="settings-body">
          {editing ? (
            <>
              <p style={{ fontSize: 12, opacity: 0.7, marginTop: 0 }}>
                Edit the skill JSON directly. id cannot change. Save validates parse + id match.
              </p>
              <textarea
                className="json-edit-textarea"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
              />
              {parseError ? <div className="json-edit-error">{parseError}</div> : null}
            </>
          ) : null}
          {editing ? null : (
            <>
              <div className="dv-detail-meta">
                <span className="dv-pill">{skill.category}</span>
                <span className="dv-pill">{skill.state}</span>
                <span className="dv-pill">v{skill.version}</span>
                <span className="dv-pill">{skill.source}</span>
                {rate !== null ? <span className="dv-pill dv-pill-accent">success {rate}%</span> : null}
                <span className="dv-pill">applied {skill.applied_count}×</span>
                {skill.parent_id ? <span className="dv-pill">parent: {skill.parent_id}</span> : null}
              </div>

              <h3 className="dv-section-h">PROBLEM</h3>
              <div className="dv-detail-text">{skill.problem}</div>

              <h3 className="dv-section-h">SOLUTION STEPS</h3>
              <ol className="dv-steps">
                {skill.solution_steps.map((step, i) => (
                  <li key={i}>
                    {step.description}
                    {step.tools_hint && step.tools_hint.length > 0 ? (
                      <span className="dv-tools">
                        {" "}{step.tools_hint.map((t) => <code key={t} className="md-inline">{t}</code>)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>

              {skill.preconditions.length > 0 ? (
                <>
                  <h3 className="dv-section-h">PRECONDITIONS</h3>
                  <ul className="dv-list">
                    {skill.preconditions.map((p, i) => <li key={i}>{p}</li>)}
                  </ul>
                </>
              ) : null}

              {skill.postconditions.length > 0 ? (
                <>
                  <h3 className="dv-section-h">POSTCONDITIONS</h3>
                  <ul className="dv-list">
                    {skill.postconditions.map((p, i) => <li key={i}>{p}</li>)}
                  </ul>
                </>
              ) : null}

              <div className="dv-meta-footer">
                <span>id: <code className="md-inline">{skill.id}</code></span>
                <span>created: {new Date(skill.created_at).toISOString().slice(0, 16).replace("T", " ")}</span>
              </div>
            </>
          )}
        </div>
        <div className="settings-footer">
          {editing ? (
            <>
              <button
                className="settings-btn-secondary"
                onClick={() => {
                  setDraft(JSON.stringify(skill, null, 2));
                  setParseError(null);
                  setEditing(false);
                }}
                style={{ marginRight: "auto" }}
              >
                cancel
              </button>
              <button className="settings-btn-primary" onClick={() => void handleSave()}>save</button>
            </>
          ) : (
          <>
          <button
            className="settings-btn-secondary"
            onClick={() => setEditing(true)}
          >
            edit JSON
          </button>
          <button
            className="settings-btn-secondary"
            onClick={() => {
              if (confirm(`Borrar skill "${skill.name}"? Esta acción no se puede deshacer.`)) {
                void onDelete();
              }
            }}
            style={{ borderColor: "var(--red)", color: "var(--red)" }}
          >
            delete
          </button>
          <button className="settings-btn-primary" onClick={onClose}>close</button>
          </>
          )}
        </div>
      </div>
    </div>
  );
}
