import { describe, expect, it } from "vitest";
import { describeRepeat, firstDue, nextDue, rollForward } from "./recurrence";
import { normalizeRepeat } from "./ai/schema";
import { parseOffline } from "./ai/fallback";
import type { Repeat, Task } from "../types";

const R = (r: Partial<Repeat>): Repeat => ({ freq: "day", interval: 1, from: "due", ...r });

describe("nextDue", () => {
  // 2026-11-06 is a Friday.
  it("days and fixed intervals", () => {
    expect(nextDue(R({ interval: 3 }), "2026-11-06", "2026-11-06")).toBe("2026-11-09");
    expect(nextDue(R({ freq: "week", interval: 2 }), "2026-11-06", "2026-11-06")).toBe("2026-11-20");
  });
  it("specific weekdays, every N weeks", () => {
    const mwf = R({ freq: "week", weekdays: [1, 3, 5] });
    expect(nextDue(mwf, "2026-11-06", "2026-11-06")).toBe("2026-11-09"); // Fri -> Mon
    expect(nextDue(mwf, "2026-11-09", "2026-11-09")).toBe("2026-11-11"); // Mon -> Wed
    const biweeklyTue = R({ freq: "week", interval: 2, weekdays: [2] });
    expect(nextDue(biweeklyTue, "2026-11-10", "2026-11-10")).toBe("2026-11-24");
    const weekdays = R({ freq: "week", weekdays: [1, 2, 3, 4, 5] });
    expect(nextDue(weekdays, "2026-11-06", "2026-11-06")).toBe("2026-11-09");
  });
  it("monthly on a day, clamped to short months", () => {
    expect(nextDue(R({ freq: "month", monthMode: "day", monthDay: 15 }), "2026-11-03", "2026-11-03")).toBe("2026-11-15");
    expect(nextDue(R({ freq: "month", monthMode: "day", monthDay: 31 }), "2027-01-31", "2027-01-31")).toBe("2027-02-28");
    expect(nextDue(R({ freq: "month", monthMode: "day", monthDay: 31 }), "2027-02-28", "2027-02-28")).toBe("2027-03-31");
  });
  it("Nth / last weekday and last day of month", () => {
    expect(nextDue(R({ freq: "month", monthMode: "weekday", nth: 2, weekday: 2 }), "2026-11-10", "2026-11-10")).toBe("2026-12-08");
    expect(nextDue(R({ freq: "month", monthMode: "weekday", nth: -1, weekday: 5 }), "2026-11-27", "2026-11-27")).toBe("2026-12-25");
    expect(nextDue(R({ freq: "month", monthMode: "last" }), "2026-11-30", "2026-11-30")).toBe("2026-12-31");
    expect(nextDue(R({ freq: "month", interval: 3, monthMode: "day", monthDay: 1 }), "2026-10-01", "2026-10-01")).toBe("2027-01-01");
  });
  it("yearly, including '4th Thursday of November' and Feb 29", () => {
    expect(nextDue(R({ freq: "year", month: 2, monthMode: "day", monthDay: 3 }), "2026-03-03", "2026-03-03")).toBe("2027-03-03");
    expect(nextDue(R({ freq: "year", month: 10, monthMode: "weekday", nth: 4, weekday: 4 }), "2026-11-26", "2026-11-26")).toBe("2027-11-25");
    expect(nextDue(R({ freq: "year", month: 1, monthMode: "day", monthDay: 29 }), "2028-02-29", "2028-02-29")).toBe("2029-02-28");
  });
  it("from completion counts from the day you finish", () => {
    expect(nextDue(R({ interval: 3, from: "completion" }), "2026-11-01", "2026-11-06")).toBe("2026-11-09");
  });
  it("a fixed schedule that fell behind skips to the next date after today", () => {
    expect(nextDue(R({ freq: "week", weekdays: [1] }), "2026-10-19", "2026-11-06")).toBe("2026-11-09");
  });
  it("stops at until / count", () => {
    expect(nextDue(R({ until: "2026-11-08" }), "2026-11-07", "2026-11-07")).toBe("2026-11-08"); // inclusive
    expect(nextDue(R({ until: "2026-11-08" }), "2026-11-08", "2026-11-08")).toBeNull();
    expect(nextDue(R({ count: 3, done: 1 }), "2026-11-07", "2026-11-07")).toBe("2026-11-08");
    expect(nextDue(R({ count: 3, done: 2 }), "2026-11-07", "2026-11-07")).toBeNull();
  });
});

describe("rollForward + describe", () => {
  it("resets the task and logs the completion", () => {
    const t = {
      id: "t", title: "Status email to Kathy", notes: "", space: "work", listId: null, status: "in_progress", waitingOn: "",
      priority: 5, effort: 5, urgency: 5, tags: [], links: [], updates: [],
      dueDate: "2026-11-06", repeat: R({ freq: "week", weekdays: [5] }), order: 0, createdAt: 0, updatedAt: 0, completedAt: null,
    } as Task;
    const next = rollForward(t, new Date(2026, 10, 6, 15).getTime())!;
    expect(next.dueDate).toBe("2026-11-13");
    expect(next.status).toBe("todo");
    expect(next.repeat!.done).toBe(1);
    expect(next.updates[0].text).toMatch(/Repeats, next due/);
  });
  it("describes rules in plain English", () => {
    expect(describeRepeat(R({ freq: "week", weekdays: [1, 2, 3, 4, 5] }))).toBe("Every weekday");
    expect(describeRepeat(R({ freq: "week", interval: 2, weekdays: [1, 4] }))).toBe("Every 2 weeks on Mon, Thu");
    expect(describeRepeat(R({ freq: "month", monthMode: "weekday", nth: -1, weekday: 5 }))).toBe("Monthly on the last Friday");
    expect(describeRepeat(R({ freq: "year", month: 10, monthMode: "weekday", nth: 4, weekday: 4 }))).toBe("Yearly on the 4th Thursday of November");
    expect(describeRepeat(R({ interval: 3, from: "completion" }))).toBe("3 days after each completion");
    expect(describeRepeat(R({ freq: "month", monthMode: "day", monthDay: 1, count: 6 }))).toBe("Monthly on the 1st, 6 times (0 done)");
  });
  it("firstDue picks the next matching day for a new repeating task", () => {
    expect(firstDue(R({ freq: "week", weekdays: [1] }), "2026-11-06")).toBe("2026-11-09");
    expect(firstDue(R({ freq: "week", weekdays: [5] }), "2026-11-06")).toBe("2026-11-06");
    expect(firstDue(R({ freq: "month", monthMode: "last" }), "2026-11-06")).toBe("2026-11-30");
  });
});

describe("parsing repeats", () => {
  it("normalises the model's repeat object (months 1-12)", () => {
    expect(normalizeRepeat({ freq: "year", interval: 1, weekdays: [], month_mode: "weekday", month_day: null, nth: 4, weekday: 4, month: 11, from: "due", until: null, count: null }))
      .toEqual({ freq: "year", interval: 1, from: "due", monthMode: "weekday", nth: 4, weekday: 4, month: 10 });
    expect(normalizeRepeat({ freq: "none" })).toBe("off");
    expect(normalizeRepeat(null)).toBeNull();
  });
  it("offline parser understands simple repeats", () => {
    expect(parseOffline("water plants every 3 days").actions[0]).toMatchObject({ title: "Water plants", repeat: { freq: "day", interval: 3 } });
    expect(parseOffline("standup notes every weekday").actions[0].repeat).toMatchObject({ freq: "week", weekdays: [1, 2, 3, 4, 5] });
    expect(parseOffline("take out trash every tuesday").actions[0].repeat).toMatchObject({ freq: "week", weekdays: [2] });
    expect(parseOffline("pay rent monthly").actions[0].repeat).toMatchObject({ freq: "month", interval: 1 });
  });
});
