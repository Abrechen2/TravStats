import { describe, it, expect } from "vitest";
import { buildDayPlan, foldQuietDays } from "../dayPlan";
import { routePlan, routeState } from "../../route/__tests__/routeFixture";
import { calendarDays } from "../../planContext";
import type { PlanItem, RouteSchedule } from "../../../../lib/api/travplan";

const item = (id: string, day: string | null, time: string | null, over: Partial<PlanItem> = {}) =>
  ({
    id,
    title: id,
    kind: "activity",
    day,
    time,
    duration: null,
    timezone: null,
    place: "",
    note: "",
    booked: false,
    bookingId: null,
    stationId: null,
    execution: "unconfirmed",
    source: null,
    ...over,
  }) as PlanItem;

const schedule = (): RouteSchedule => ({
  ...routePlan().schedule!,
  stages: [
    { stageId: "g1", departDay: "2026-05-03", arriveDay: "2026-05-03" },
    { stageId: "g2", departDay: "2026-05-04", arriveDay: "2026-05-04" },
  ],
});
const days = calendarDays("2026-05-01", "2026-05-07");

describe("day plan", () => {
  it("says where each night is spent and which leg is driven on which day", () => {
    const plan = buildDayPlan(routeState(), schedule(), days);
    expect(plan.days.map((d) => [d.day, d.night?.title ?? null])).toEqual([
      ["2026-05-01", "Kiel"],
      ["2026-05-02", "Kiel"],
      ["2026-05-03", "Gothenburg"],
      ["2026-05-04", "Oslo"],
      ["2026-05-05", "Oslo"],
      ["2026-05-06", "Oslo"],
      ["2026-05-07", null],
    ]);
    const travel = plan.days[2];
    expect(travel.legs.map((l) => `${l.from.title}>${l.to.title}`)).toEqual(["Kiel>Gothenburg"]);
    expect(travel.arrivals.map((s) => s.title)).toEqual(["Gothenburg"]);
    // The start is where the trip begins, not a place reached on day one.
    expect(plan.days[0].arrivals).toEqual([]);
    expect(plan.undated).toEqual([]);
  });

  it("leaves a day it cannot place without a night instead of guessing", () => {
    const unknown: RouteSchedule = {
      ...schedule(),
      stations: [
        { stationId: "a", arriveDay: "2026-05-01", departDay: "2026-05-03" },
        { stationId: "b", arriveDay: null, departDay: null },
        { stationId: "c", arriveDay: null, departDay: null },
      ],
      stages: [{ stageId: "g1", departDay: "2026-05-03", arriveDay: null }],
    };
    const plan = buildDayPlan(routeState({ measured: false }), unknown, days);
    expect(plan.days[3].night).toBeNull();
    expect(plan.days[2].legs).toHaveLength(1);
    expect(plan.undated.map((s) => s.title)).toEqual(["Gothenburg", "Oslo"]);
  });

  it("puts the day's plans in time order and leaves out what was skipped or cancelled", () => {
    const state = {
      ...routeState(),
      items: [
        item("dinner", "2026-05-02", "19:00"),
        item("museum", "2026-05-02", "10:00"),
        item("someday", "2026-05-02", null),
        item("skipped", "2026-05-02", "12:00", { execution: "skipped" }),
        item("other day", "2026-05-05", "09:00"),
      ],
      tasks: [
        { id: "t1", title: "Gas", due: "2026-05-02", done: false },
        { id: "t2", title: "Done", due: "2026-05-02", done: true },
      ],
    };
    const day = buildDayPlan(state, schedule(), days).days[1];
    expect(day.items.map((i) => i.id)).toEqual(["museum", "dinner", "someday"]);
    expect(day.tasks.map((t) => t.title)).toEqual(["Gas"]);
  });

  it("shows a booking with its leg, not twice", () => {
    const base = routeState();
    const state = {
      ...base,
      stages: base.stages.map((g) => (g.id === "g1" ? { ...g, bookingId: "bk-booked" } : g)),
    };
    const plan = buildDayPlan(state, schedule(), days);
    expect(plan.days[2].bookings.map((b) => b.id)).toEqual(["bk-hold"]);
  });
});

describe("folding quiet days", () => {
  it("folds empty days with the same night and keeps busy days apart", () => {
    const state = { ...routeState(), items: [item("museum", "2026-05-05", "10:00")] };
    const spans = foldQuietDays(buildDayPlan(state, schedule(), days).days);
    expect(spans.map((s) => [s.row.day, s.lastDay])).toEqual([
      ["2026-05-01", "2026-05-02"],
      ["2026-05-03", "2026-05-03"],
      ["2026-05-04", "2026-05-04"],
      ["2026-05-05", "2026-05-05"],
      ["2026-05-06", "2026-05-06"],
      ["2026-05-07", "2026-05-07"],
    ]);
  });
});
