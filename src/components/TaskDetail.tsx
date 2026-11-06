import { useEffect, useState } from "react";
import { score, scoreColor } from "../lib/score";
import { placeOptions, taskDescendantIds, uid } from "../lib/tree";
import { deleteTask, dropItem, newTask, patchTask, saveTask, useData } from "../state/store";
import { toast } from "../state/ui";
import { STATUSES, type Status, type Task } from "../types";
import { Composer } from "./Composer";
import { RepeatEditor } from "./RepeatEditor";

/** Text input that saves on blur, so typing doesn't spam the database. */
function useDraft(value: string, save: (v: string) => void) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return { value: v, onChange: (e: { target: { value: string } }) => setV(e.target.value), onBlur: () => v !== value && save(v) };
}

function Scale({ label, hint, value, onChange }: { label: string; hint: string; value: number | null; onChange: (n: number | null) => void }) {
  return (
    <div className="scale">
      <span className="scale-label">
        {label} <b>{value ?? "not set"}</b>
        <span className="muted small"> {hint}</span>
      </span>
      <div className="scale-picks" role="group" aria-label={label}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button key={n} className={value === n ? "on" : ""} aria-pressed={value === n} onClick={() => onChange(value === n ? null : n)}>
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

export function TaskDetail({
  task,
  onClose,
  onTag,
  onOpen,
}: {
  task: Task;
  onClose: () => void;
  onTag: (t: string) => void;
  onOpen: (id: string) => void;
}) {
  const { lists, tasks } = useData();
  const kids = tasks.filter((t) => t.parentId === task.id).sort((a, b) => a.order - b.order);
  const parent = task.parentId ? tasks.find((t) => t.id === task.parentId) : null;
  const p = (patch: Partial<Task>) => void patchTask(task.id, patch);
  const title = useDraft(task.title, (v) => v.trim() && p({ title: v.trim() }));
  const notes = useDraft(task.notes, (v) => p({ notes: v }));
  const waiting = useDraft(task.waitingOn, (v) => p({ waitingOn: v.trim() }));
  const [tagInput, setTagInput] = useState("");
  const [linkInput, setLinkInput] = useState("");
  const [subInput, setSubInput] = useState("");
  const [updInput, setUpdInput] = useState("");
  const s = score(task);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const places = placeOptions(lists);

  const moveTo = (space: string, listId: string | null) =>
    void dropItem({ kind: "task", id: task.id }, listId ? { kind: "list", id: listId, pos: "inside" } : { kind: "space", id: space, pos: "inside" });

  const addTags = () => {
    const tags = tagInput
      .split(/[,\s]+/)
      .map((t) => t.replace(/^#/, "").toLowerCase())
      .filter(Boolean);
    if (tags.length) p({ tags: [...new Set([...task.tags, ...tags])] });
    setTagInput("");
  };

  return (
    <div className="detail-wrap" onClick={onClose}>
      <aside className="detail" onClick={(e) => e.stopPropagation()}>
        <header className="detail-head">
          <button
            className={`check big ${task.status === "done" ? "checked" : ""}`}
            onClick={() => p({ status: task.status === "done" ? "todo" : "done" })}
            aria-label="Toggle done"
          >
            {task.status === "done" ? "✓" : ""}
          </button>
          <textarea className="detail-title" rows={1} {...title} />
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="detail-body">
          {parent && (
            <div className="parent-line">
              <span className="muted small">Sub-task of</span>
              <button className="link" onClick={() => onOpen(parent.id)}>
                {parent.title}
              </button>
              <button className="link small" onClick={() => moveTo(task.space, task.listId)}>
                Make it its own task
              </button>
            </div>
          )}
          <section className="talk">
            <h4>🎙 Talk about this</h4>
            <p className="muted small">
              Say what's going on — “waiting on Jordan for the report, Michael said Thursday” — and it'll update status, notes and the log.
            </p>
            <Composer compact placeholder="What's the latest?" opts={() => ({ focusTaskId: task.id })} />
          </section>

          <div className="field-grid">
            <label>
              Status
              <select value={task.status} onChange={(e) => p({ status: e.target.value as Status })}>
                {STATUSES.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.label}
                  </option>
                ))}
              </select>
            </label>
            {(task.status === "waiting" || task.status === "blocked" || task.waitingOn) && (
              <label>
                Waiting on
                <input placeholder="Who / what?" {...waiting} />
              </label>
            )}
            <label>
              List
              <select
                value={`${task.space}:${task.listId ?? ""}`}
                onChange={(e) => {
                  const [space, listId] = e.target.value.split(":");
                  moveTo(space, listId || null);
                }}
              >
                {places.map((pl) => (
                  <option key={pl.value} value={pl.value}>
                    {pl.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Due
              <input type="date" value={task.dueDate ?? ""} onChange={(e) => p({ dueDate: e.target.value || null })} />
            </label>
          </div>

          <RepeatEditor task={task} onChange={(patch) => p(patch)} />

          <section className="scores">
            {s !== null && (
              <div className="score-big" style={{ color: scoreColor(s), borderColor: scoreColor(s) }}>
                <b>{s}</b>
                <span>score</span>
              </div>
            )}
            <div className="scales">
              <Scale label="Priority" hint="how important" value={task.priority} onChange={(n) => p({ priority: n })} />
              <Scale label="Urgency" hint="how soon" value={task.urgency} onChange={(n) => p({ urgency: n })} />
              <Scale label="Effort" hint="how much work" value={task.effort} onChange={(n) => p({ effort: n })} />
            </div>
          </section>

          <section>
            <h4>Tags</h4>
            <div className="chips">
              {task.tags.map((t) => (
                <span key={t} className="chip tag">
                  <button className="link" onClick={() => onTag(t)}>
                    #{t}
                  </button>
                  <button className="x" onClick={() => p({ tags: task.tags.filter((x) => x !== t) })} aria-label={`Remove ${t}`}>
                    ✕
                  </button>
                </span>
              ))}
              <input
                className="inline-input"
                placeholder="add tag"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onBlur={addTags}
                onKeyDown={(e) => e.key === "Enter" && addTags()}
              />
            </div>
          </section>

          <section>
            <h4>Sub-tasks</h4>
            {kids.map((k) => (
              <div key={k.id} className={`subtask ${k.status === "done" ? "done" : ""}`}>
                <input
                  type="checkbox"
                  aria-label={`Mark ${k.title} done`}
                  checked={k.status === "done"}
                  onChange={() => void patchTask(k.id, { status: k.status === "done" ? "todo" : "done" })}
                />
                <button className="subtask-title" onClick={() => onOpen(k.id)}>
                  {k.title}
                </button>
              </div>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!subInput.trim()) return;
                void saveTask(newTask({ title: subInput.trim(), space: task.space, listId: task.listId, parentId: task.id }));
                setSubInput("");
              }}
            >
              <input className="inline-input wide" placeholder="＋ Add a sub-task" value={subInput} onChange={(e) => setSubInput(e.target.value)} />
            </form>
          </section>

          <section>
            <h4>Links</h4>
            {task.links.map((l, i) => (
              <div key={i} className="link-row">
                <a href={l.url} target="_blank" rel="noreferrer">
                  🔗 {l.label || l.url}
                </a>
                <button className="x" onClick={() => p({ links: task.links.filter((_, j) => j !== i) })}>
                  ✕
                </button>
              </div>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const v = linkInput.trim();
                if (!v) return;
                const [url, ...label] = v.split(/\s+/);
                p({ links: [...task.links, { url: /^https?:\/\//.test(url) ? url : `https://${url}`, label: label.join(" ") || undefined }] });
                setLinkInput("");
              }}
            >
              <input className="inline-input wide" placeholder="＋ Paste a link (optionally followed by a label)" value={linkInput} onChange={(e) => setLinkInput(e.target.value)} />
            </form>
          </section>

          <section>
            <h4>Notes</h4>
            <textarea className="notes" rows={5} placeholder="Anything worth remembering…" {...notes} />
          </section>

          <section>
            <h4>Progress log</h4>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!updInput.trim()) return;
                p({ updates: [...task.updates, { id: uid(), at: Date.now(), text: updInput.trim() }] });
                setUpdInput("");
              }}
            >
              <input className="inline-input wide" placeholder="＋ Add an update by hand" value={updInput} onChange={(e) => setUpdInput(e.target.value)} />
            </form>
            <ol className="log">
              {[...task.updates].reverse().map((u) => (
                <li key={u.id}>
                  <time>{new Date(u.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time>
                  <span>{u.text}</span>
                  {u.raw && (
                    <details>
                      <summary className="muted small">what you said</summary>
                      <p className="muted small">{u.raw}</p>
                    </details>
                  )}
                  <button className="x" onClick={() => p({ updates: task.updates.filter((x) => x.id !== u.id) })}>
                    ✕
                  </button>
                </li>
              ))}
              {!task.updates.length && <li className="muted small">No updates yet.</li>}
            </ol>
          </section>

          <footer className="detail-foot">
            <span className="muted small">
              Created {new Date(task.createdAt).toLocaleDateString()}
              {task.completedAt ? ` · Done ${new Date(task.completedAt).toLocaleDateString()}` : ""}
            </span>
            <button
              className="btn danger"
              onClick={() => {
                const extra = taskDescendantIds(tasks, task.id).size - 1;
                const removing = deleteTask(task.id);
                onClose();
                toast(`Deleted “${task.title}”${extra ? ` and ${extra} sub-task${extra === 1 ? "" : "s"}` : ""}`, {
                  action: { label: "Undo", run: () => void removing.then((removed) => removed.forEach(saveTask)) },
                });
              }}
            >
              Delete
            </button>
          </footer>
        </div>
      </aside>
    </div>
  );
}
