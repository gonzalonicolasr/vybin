import { useState } from "react";
import { deleteLesson, saveLesson, useLessons, type Lesson } from "../hooks/useCeroData";

export interface LessonsViewProps {
  readonly snapshotVersion: number;
}

export function LessonsView({ snapshotVersion }: LessonsViewProps): React.JSX.Element {
  const { items, loading, refresh } = useLessons(snapshotVersion);
  const [selected, setSelected] = useState<Lesson | null>(null);
  const [filter, setFilter] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const allTags = new Set<string>();
  items.forEach((l) => l.applies_to.forEach((t) => allTags.add(t)));
  const tags = [...allTags].sort();

  const filtered = items.filter((l) => {
    if (tagFilter && !l.applies_to.includes(tagFilter)) return false;
    if (filter.trim().length === 0) return true;
    const f = filter.toLowerCase();
    return (
      l.title.toLowerCase().includes(f) ||
      l.what_learned.toLowerCase().includes(f) ||
      l.applies_to.join(" ").toLowerCase().includes(f)
    );
  });

  return (
    <div className="dataview">
      <div className="dataview-header">
        <h2>LESSONS <span className="dataview-count">{items.length}</span></h2>
        <input
          className="dataview-search"
          placeholder="filtrar..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {tags.length > 0 ? (
        <div className="dv-tag-row">
          <button
            className={`dv-tag ${tagFilter === null ? "active" : ""}`}
            onClick={() => setTagFilter(null)}
          >
            all
          </button>
          {tags.map((t) => (
            <button
              key={t}
              className={`dv-tag ${tagFilter === t ? "active" : ""}`}
              onClick={() => setTagFilter(t === tagFilter ? null : t)}
            >
              {t}
            </button>
          ))}
        </div>
      ) : null}
      {loading ? <div className="dataview-empty">cargando…</div> : null}
      {!loading && items.length === 0 ? (
        <div className="dataview-empty">no hay lessons todavía. al cerrar una sesión, cero extrae 1-3 lessons.</div>
      ) : null}
      <div className="dataview-list">
        {filtered.map((l) => (
          <div key={l.id} className="dv-row" onClick={() => setSelected(l)}>
            <div className="dv-row-main">
              <div className="dv-row-title">{l.title}</div>
              <div className="dv-row-sub">{l.what_learned.slice(0, 160)}{l.what_learned.length > 160 ? "…" : ""}</div>
            </div>
            <div className="dv-row-meta">
              <span className="dv-pill dv-pill-dim">{new Date(l.ts).toISOString().slice(0, 10)}</span>
              {l.applies_to.slice(0, 3).map((t) => (
                <span key={t} className="dv-pill">{t}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
      {selected ? (
        <LessonDetailModal
          lesson={selected}
          onClose={() => setSelected(null)}
          onDelete={async () => {
            await deleteLesson(selected);
            setSelected(null);
            await refresh();
          }}
          onSave={async (updated) => {
            await saveLesson(selected, updated);
            setSelected(updated);
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function LessonDetailModal({
  lesson,
  onClose,
  onDelete,
  onSave,
}: {
  readonly lesson: Lesson;
  readonly onClose: () => void;
  readonly onDelete: () => Promise<void>;
  readonly onSave: (updated: Lesson) => Promise<void>;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => JSON.stringify(lesson, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Escape" && !editing) onClose();
  };

  const handleSave = async (): Promise<void> => {
    let parsed: Lesson;
    try {
      parsed = JSON.parse(draft) as Lesson;
    } catch (err) {
      setParseError(`JSON parse error: ${String(err)}`);
      return;
    }
    if (typeof parsed?.id !== "string") {
      setParseError("missing required field: id");
      return;
    }
    if (parsed.id !== lesson.id) {
      setParseError(`id cannot change (was ${lesson.id})`);
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
    <div className="settings-backdrop" onClick={onClose} onKeyDown={handleKeyDown}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>{lesson.title}</h2>
          <button className="settings-close" onClick={onClose} aria-label="close">✕</button>
        </div>
        <div className="settings-body">
          {editing ? (
            <>
              <p style={{ fontSize: 12, opacity: 0.7, marginTop: 0 }}>
                Edit the lesson JSON directly. id cannot change.
              </p>
              <textarea
                className="json-edit-textarea"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
              />
              {parseError ? <div className="json-edit-error">{parseError}</div> : null}
            </>
          ) : (
            <>
              <div className="dv-detail-meta">
                <span className="dv-pill">{new Date(lesson.ts).toISOString().slice(0, 16).replace("T", " ")}</span>
                <span className="dv-pill">session: <code className="md-inline">{lesson.session_id}</code></span>
              </div>
              <h3 className="dv-section-h">WHAT LEARNED</h3>
              <div className="dv-detail-text">{lesson.what_learned}</div>
              {lesson.applies_to.length > 0 ? (
                <>
                  <h3 className="dv-section-h">APPLIES TO</h3>
                  <div className="dv-tag-row">
                    {lesson.applies_to.map((t) => (
                      <span key={t} className="dv-tag">{t}</span>
                    ))}
                  </div>
                </>
              ) : null}
              <div className="dv-meta-footer">
                <span>id: <code className="md-inline">{lesson.id}</code></span>
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
                  setDraft(JSON.stringify(lesson, null, 2));
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
                  if (confirm(`Borrar lesson "${lesson.title}"? Esta acción no se puede deshacer.`)) {
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
