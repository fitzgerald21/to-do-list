import { describeRepeat, firstDue, fmtDay, MONTH_NAMES, ordinal, prettyDay, presets, WEEKDAY_NAMES } from "../lib/recurrence";
import type { Repeat, Task } from "../types";

const UNITS: Record<Repeat["freq"], [string, string]> = {
  day: ["day", "days"],
  week: ["week", "weeks"],
  month: ["month", "months"],
  year: ["year", "years"],
};

/** "Repeat" section in the task panel: quick presets plus a full custom editor. */
export function RepeatEditor({ task, onChange }: { task: Task; onChange: (patch: Partial<Task>) => void }) {
  const r = task.repeat ?? null;
  const opts = presets(task.dueDate);
  const anchor = task.dueDate ? new Date(task.dueDate + "T12:00:00") : new Date();

  const set = (next: Repeat | null) => {
    if (!next) return onChange({ repeat: null });
    const patch: Partial<Task> = { repeat: { ...next, done: r?.done ?? 0 } };
    if (!task.dueDate) patch.dueDate = firstDue(next);
    onChange(patch);
  };
  const up = (patch: Partial<Repeat>) => r && set({ ...r, ...patch });

  const presetIndex = r ? opts.findIndex((o) => describeRepeat(o.rule, task.dueDate) === describeRepeat({ ...r, until: null, count: null }, task.dueDate)) : -1;

  return (
    <section className="repeat">
      <h4>🔁 Repeat</h4>
      <select
        value={r ? (presetIndex >= 0 ? String(presetIndex) : "custom") : "none"}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "none") set(null);
          else if (v === "custom") set(r ?? { freq: "week", interval: 1, weekdays: [anchor.getDay()], from: "due" });
          else set({ ...opts[Number(v)].rule, until: r?.until ?? null, count: r?.count ?? null });
        }}
      >
        <option value="none">Doesn't repeat</option>
        {opts.map((o, i) => (
          <option key={i} value={i}>
            {o.label}
          </option>
        ))}
        <option value="custom">Custom…</option>
      </select>

      {r && (
        <div className="repeat-box">
          <div className="repeat-summary">
            {describeRepeat(r, task.dueDate)}
            {task.dueDate && <span className="muted"> · next {prettyDay(task.dueDate)}</span>}
          </div>

          <div className="repeat-row">
            Every
            <input type="number" min={1} max={365} value={r.interval} onChange={(e) => up({ interval: Math.max(1, Number(e.target.value) || 1) })} />
            <select
              value={r.freq}
              onChange={(e) => {
                const freq = e.target.value as Repeat["freq"];
                set({
                  freq,
                  interval: r.interval,
                  from: r.from,
                  until: r.until,
                  count: r.count,
                  ...(freq === "week" ? { weekdays: [anchor.getDay()] } : {}),
                  ...(freq === "month" || freq === "year" ? { monthMode: "day" as const, monthDay: anchor.getDate() } : {}),
                  ...(freq === "year" ? { month: anchor.getMonth() } : {}),
                });
              }}
            >
              {(Object.keys(UNITS) as Repeat["freq"][]).map((f) => (
                <option key={f} value={f}>
                  {UNITS[f][r.interval === 1 ? 0 : 1]}
                </option>
              ))}
            </select>
          </div>

          {r.from === "due" && r.freq === "week" && (
            <div className="weekday-picks">
              {WEEKDAY_NAMES.map((name, i) => {
                const on = r.weekdays?.includes(i);
                return (
                  <button
                    key={i}
                    className={`chip ${on ? "active-day" : ""}`}
                    title={name}
                    onClick={() => {
                      const cur = new Set(r.weekdays ?? []);
                      if (on) cur.delete(i);
                      else cur.add(i);
                      up({ weekdays: [...cur].sort() });
                    }}
                  >
                    {name.slice(0, 2)}
                  </button>
                );
              })}
            </div>
          )}

          {r.from === "due" && (r.freq === "month" || r.freq === "year") && (
            <div className="repeat-row wrap">
              {r.freq === "year" && (
                <>
                  In
                  <select value={r.month ?? anchor.getMonth()} onChange={(e) => up({ month: Number(e.target.value) })}>
                    {MONTH_NAMES.map((m, i) => (
                      <option key={i} value={i}>
                        {m}
                      </option>
                    ))}
                  </select>
                </>
              )}
              on
              <select
                value={r.monthMode ?? "day"}
                onChange={(e) => {
                  const mode = e.target.value as NonNullable<Repeat["monthMode"]>;
                  if (mode === "day") up({ monthMode: "day", monthDay: r.monthDay ?? anchor.getDate() });
                  else if (mode === "weekday") up({ monthMode: "weekday", nth: r.nth ?? Math.min(4, Math.ceil(anchor.getDate() / 7)), weekday: r.weekday ?? anchor.getDay() });
                  else up({ monthMode: "last" });
                }}
              >
                <option value="day">day</option>
                <option value="weekday">the</option>
                <option value="last">the last day</option>
              </select>
              {(r.monthMode ?? "day") === "day" && (
                <input type="number" min={1} max={31} value={r.monthDay ?? anchor.getDate()} onChange={(e) => up({ monthDay: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })} />
              )}
              {r.monthMode === "weekday" && (
                <>
                  <select value={r.nth ?? 1} onChange={(e) => up({ nth: Number(e.target.value) })}>
                    {[1, 2, 3, 4, -1].map((n) => (
                      <option key={n} value={n}>
                        {ordinal(n)}
                      </option>
                    ))}
                  </select>
                  <select value={r.weekday ?? anchor.getDay()} onChange={(e) => up({ weekday: Number(e.target.value) })}>
                    {WEEKDAY_NAMES.map((n, i) => (
                      <option key={i} value={i}>
                        {n}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
          )}

          <div className="repeat-row wrap">
            Count from
            <select value={r.from} onChange={(e) => up({ from: e.target.value as Repeat["from"] })}>
              <option value="due">the due date (fixed schedule)</option>
              <option value="completion">when I finish it</option>
            </select>
          </div>

          <div className="repeat-row wrap">
            Ends
            <select
              value={r.until ? "until" : r.count ? "count" : "never"}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "never") up({ until: null, count: null });
                if (v === "until") {
                  const d = new Date();
                  d.setMonth(d.getMonth() + 3);
                  up({ count: null, until: fmtDay(d) });
                }
                if (v === "count") up({ until: null, count: (r.done ?? 0) + 10 });
              }}
            >
              <option value="never">never</option>
              <option value="until">on a date</option>
              <option value="count">after a number of times</option>
            </select>
            {r.until && <input type="date" value={r.until} onChange={(e) => up({ until: e.target.value || null })} />}
            {r.count ? (
              <>
                <input type="number" min={1} value={r.count} onChange={(e) => up({ count: Math.max(1, Number(e.target.value) || 1) })} />
                times
              </>
            ) : null}
          </div>
          {(r.done ?? 0) > 0 && <div className="muted small">Completed {r.done} time{r.done === 1 ? "" : "s"} so far.</div>}
        </div>
      )}
    </section>
  );
}
