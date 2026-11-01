import { describe, expect, it } from "vitest";
import {
  canHandOver,
  formatMinutes,
  newStage,
  newStation,
  nightTone,
  routeTotals,
  stageTone,
  wroteRecords,
} from "../routeModel";
import { routeState } from "./routeFixture";

describe("routeModel", () => {
  it("styles a stage by what stands behind it", () => {
    const state = routeState();
    const [booked, placeholder] = state.bookings;
    const base = newStage("a", "b");
    expect(stageTone({ ...base, mode: "ferry", bookingId: booked.id }, state.bookings)).toBe(
      "booked"
    );
    expect(stageTone({ ...base, mode: "ferry", bookingId: placeholder.id }, state.bookings)).toBe(
      "placeholder"
    );
    expect(stageTone({ ...base, mode: "ferry" }, state.bookings)).toBe("undecided");
    expect(stageTone(base, state.bookings)).toBe("own");
  });

  it("tells a spontaneous night from an idea tray with nothing in it", () => {
    const state = routeState();
    const station = newStation(state.stations[0].place);
    expect(nightTone(station, [])).toBe("spontaneous");
    expect(nightTone({ ...station, night: { kind: "idea", candidates: [] } }, [])).toBe(
      "undecided"
    );
    expect(nightTone({ ...station, night: { kind: "pitch" } }, [])).toBe("own");
  });

  it("reports an unknown total as null, never as zero kilometres", () => {
    const state = routeState({ measured: false });
    const totals = routeTotals(state);
    expect(totals.km).toBeNull();
    expect(totals.minutes).toBeNull();
    expect(totals.unmeasured).toBe(2);
    expect(routeTotals(routeState()).km).toBe(100);
  });

  it("formats drive times", () => {
    expect(formatMinutes(null)).toBeNull();
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(120)).toBe("2 h");
    expect(formatMinutes(330)).toBe("5 h 30 min");
  });

  it("offers a handover only for a reached station of a route plan", () => {
    const state = routeState();
    const schedule = {
      stations: [
        { stationId: "a", arriveDay: "2026-05-01", departDay: "2026-05-03" },
        { stationId: "b", arriveDay: "2026-05-10", departDay: null },
        { stationId: "c", arriveDay: null, departDay: null },
      ],
      stages: [],
      lastDay: null,
      conflicts: [],
      unresolved: [],
    };
    expect(canHandOver(state, "a", schedule, "2026-05-05")).toBe(true);
    expect(canHandOver(state, "b", schedule, "2026-05-05")).toBe(false);
    expect(canHandOver(state, "c", schedule, "2026-05-05")).toBe(false);
    expect(canHandOver({ ...state, shape: "stay" }, "a", schedule, "2026-05-05")).toBe(false);
  });

  it("separates a phone's stop (linked, nothing written by the plan) from a handover", () => {
    const state = routeState();
    const phone = { ...state, stationLinks: [{ stationId: "a", tripStopId: "x", created: [] }] };
    expect(wroteRecords(phone, "a")).toBe(false);
    const written = {
      ...state,
      stationLinks: [
        {
          stationId: "a",
          tripStopId: "x",
          created: [{ kind: "stop" as const, id: "x", version: "v" }],
        },
      ],
    };
    expect(wroteRecords(written, "a")).toBe(true);
  });
});
