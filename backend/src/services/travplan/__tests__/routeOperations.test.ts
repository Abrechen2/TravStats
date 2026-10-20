import { randomUUID } from "crypto";
import { emptyState } from "../schema";
import { applyOperation } from "../operations";
import type { PlanOperation, PlanPlace, PlanState, PlanStation, PlanStage } from "../types";

const uid = () => randomUUID();
const place = (name: string): PlanPlace => ({
  name,
  lat: 50,
  lon: 10,
  country: "DE",
  zone: null,
  ref: null,
});
const station = (title: string, extra: Partial<PlanStation> = {}): PlanStation => ({
  id: uid(),
  title,
  place: place(title),
  nights: 1,
  pinnedDay: null,
  night: { kind: "spontaneous" },
  note: "",
  ...extra,
});
const stage = (from: string, to: string, extra: Partial<PlanStage> = {}): PlanStage => ({
  id: uid(),
  fromStationId: from,
  toStationId: to,
  mode: "drive",
  departDay: null,
  departTime: null,
  durationMinutes: null,
  distanceKm: null,
  metricsSource: null,
  fallbackReason: null,
  bookingId: null,
  overnight: false,
  note: "",
  ...extra,
});
const apply = (state: PlanState, op: PlanOperation) => applyOperation(state, op, 1);
const withRoute = (): { state: PlanState; a: PlanStation; b: PlanStation; c: PlanStation } => {
  const a = station("A"),
    b = station("B"),
    c = station("C");
  const state: PlanState = {
    ...emptyState(),
    shape: "route",
    stations: [a, b, c],
    stages: [stage(a.id, b.id), stage(b.id, c.id)],
  };
  return { state, a, b, c };
};
const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
};

describe("route operations", () => {
  it("removing a station drops its stages and keeps its day trips", () => {
    const { state, a, b, c } = withRoute();
    const item = {
      id: uid(),
      title: "Day trip",
      kind: "activity" as const,
      day: null,
      time: null,
      duration: null,
      timezone: null,
      place: "",
      note: "",
      booked: false,
      bookingId: null,
      stationId: b.id,
      execution: "unconfirmed" as const,
      source: null,
    };
    state.items.push(item);
    state.stationLinks.push({ stationId: b.id, tripStopId: uid() });
    const next = apply(state, { type: "remove", collection: "stations", id: b.id });
    expect(next.stations.map((s) => s.id)).toEqual([a.id, c.id]);
    expect(next.stages).toHaveLength(0);
    expect(next.items).toHaveLength(1);
    expect(next.items[0].stationId).toBeNull();
    expect(next.stationLinks).toHaveLength(0);
  });

  it("move_station reorders and keeps ids", () => {
    const { state, a, b, c } = withRoute();
    const next = apply(state, { type: "move_station", id: c.id, toIndex: 0 });
    expect(next.stations.map((s) => s.id)).toEqual([c.id, a.id, b.id]);
    expect(next.stages).toHaveLength(2);
  });

  it("onboard night needs an overnight ferry arriving", () => {
    const { state, b } = withRoute();
    const op: PlanOperation = {
      type: "station_night",
      stationId: b.id,
      night: { kind: "onboard" },
    };
    expect(codeOf(() => apply(state, op))).toBe("PLAN_INVALID_NIGHT");
    const ferry = structuredClone(state);
    ferry.stages[0] = { ...ferry.stages[0], mode: "ferry", overnight: true };
    expect(apply(ferry, op).stations[1].night).toEqual({ kind: "onboard" });
    const dayFerry = structuredClone(state);
    dayFerry.stages[0] = { ...dayFerry.stages[0], mode: "ferry", overnight: false };
    expect(codeOf(() => apply(dayFerry, op))).toBe("PLAN_INVALID_NIGHT");
  });

  it("booked night must reference a lodging booking", () => {
    const { state, a } = withRoute();
    const booking = (kind: "hotel" | "rail") => ({
      id: uid(),
      kind,
      title: "Stay",
      reference: null,
      provider: "",
      day: "2027-06-01",
      endDay: "2027-06-02",
      time: null,
      timezone: null,
      amount: null,
      paid: 0,
      currency: "EUR",
      place: "A",
      documentIds: [],
      source: "manual",
      details: {},
    });
    const rail = booking("rail"),
      hotel = booking("hotel");
    let s = apply(state, { type: "upsert", collection: "bookings", value: rail });
    s = apply(s, { type: "upsert", collection: "bookings", value: hotel });
    const op = (bookingId: string): PlanOperation => ({
      type: "station_night",
      stationId: a.id,
      night: { kind: "booked", bookingId },
    });
    expect(codeOf(() => apply(s, op(rail.id)))).toBe("PLAN_INVALID_NIGHT");
    expect(codeOf(() => apply(s, op(uid())))).toBe("PLAN_INVALID_NIGHT");
    expect(apply(s, op(hotel.id)).stations[0].night).toEqual({
      kind: "booked",
      bookingId: hotel.id,
    });
  });

  it("station_night with place updates the station place", () => {
    const { state, a } = withRoute();
    const here = place("Campsite Lake");
    const kept = apply(state, { type: "station_night", stationId: a.id, night: { kind: "pitch" } });
    expect(kept.stations[0].place.name).toBe("A");
    expect(kept.stations[0].night).toEqual({ kind: "pitch" });
    const moved = apply(state, {
      type: "station_night",
      stationId: a.id,
      night: { kind: "pitch" },
      place: here,
    });
    expect(moved.stations[0].place).toEqual(here);
  });

  it("shape cannot go back to stay while stations exist", () => {
    const { state } = withRoute();
    expect(codeOf(() => apply(state, { type: "route_settings", shape: "stay" }))).toBe(
      "PLAN_SHAPE_IN_USE"
    );
    const empty = { ...emptyState(), shape: "route" as const };
    expect(apply(empty, { type: "route_settings", shape: "stay" }).shape).toBe("stay");
  });

  it("route_settings sets and clears the vehicle", () => {
    const base = emptyState();
    const vehicle = {
      kind: "motorhome" as const,
      lengthM: 7,
      consumptionPer100: 11,
      fuelPrice: null,
      fuelCurrency: null,
    };
    const set = apply(base, { type: "route_settings", shape: "route", vehicle });
    expect(set.shape).toBe("route");
    expect(set.vehicle).toEqual(vehicle);
    expect(apply(set, { type: "route_settings", vehicle: null }).vehicle).toBeNull();
    expect(apply(set, { type: "route_settings", shape: "route" }).vehicle).toEqual(vehicle);
  });

  it("upsert of a station keeps its position in the route", () => {
    const { state, a, b } = withRoute();
    const next = apply(state, {
      type: "upsert",
      collection: "stations",
      value: { ...a, title: "A2" },
    });
    expect(next.stations.map((s) => s.title)).toEqual(["A2", "B", "C"]);
    expect(b.id).toBe(next.stations[1].id);
  });

  describe("onboard cascade", () => {
    const ferryRoute = () => {
      const { state, a, b } = withRoute();
      const s = structuredClone(state);
      s.stages[0] = { ...s.stages[0], mode: "ferry", overnight: true };
      s.stations[1] = { ...s.stations[1], night: { kind: "onboard" } };
      return { s, a, b, ferry: s.stages[0] };
    };
    it("removing the arriving ferry stage turns the onboard night spontaneous", () => {
      const { s, ferry } = ferryRoute();
      const next = apply(s, { type: "remove", collection: "stages", id: ferry.id });
      expect(next.stations[1].night).toEqual({ kind: "spontaneous" });
    });
    it("removing the departure station does the same", () => {
      const { s, a } = ferryRoute();
      const next = apply(s, { type: "remove", collection: "stations", id: a.id });
      expect(next.stations.map((x) => x.title)).toEqual(["B", "C"]);
      expect(next.stations[0].night).toEqual({ kind: "spontaneous" });
    });
    it("changing the stage to a day ferry does the same", () => {
      const { s, ferry } = ferryRoute();
      const next = apply(s, {
        type: "upsert",
        collection: "stages",
        value: { ...ferry, overnight: false },
      });
      expect(next.stations[1].night).toEqual({ kind: "spontaneous" });
    });
  });

  it("stage upsert adds a stage and edits one in place", () => {
    const { state, a, c } = withRoute();
    const extra = stage(a.id, c.id, { note: "shortcut" });
    const added = apply(state, { type: "upsert", collection: "stages", value: extra });
    expect(added.stages).toHaveLength(3);
    const edited = apply(added, {
      type: "upsert",
      collection: "stages",
      value: { ...state.stages[0], distanceKm: 120 },
    });
    expect(edited.stages[0].distanceKm).toBe(120);
    expect(edited.stages).toHaveLength(3);
  });

  it("unknown ids answer 404 PLAN_ITEM_NOT_FOUND", () => {
    const { state } = withRoute();
    for (const op of [
      { type: "remove", collection: "stations", id: uid() },
      { type: "remove", collection: "stages", id: uid() },
      { type: "move_station", id: uid(), toIndex: 0 },
      { type: "station_night", stationId: uid(), night: { kind: "pitch" } },
    ] as PlanOperation[])
      expect(codeOf(() => apply(state, op))).toBe("PLAN_ITEM_NOT_FOUND");
  });

  it("a hotel booking behind a booked night cannot be removed or changed to another kind", () => {
    // Today's bookings rules (PLAN_PROTECTED) already close every path that could
    // strand a booked night: no remove, no kind change; refresh/undo keep kinds.
    const { state, a } = withRoute();
    const hotel = {
      id: uid(),
      kind: "hotel",
      title: "Stay",
      reference: null,
      provider: "",
      day: "2027-06-01",
      endDay: "2027-06-02",
      time: null,
      timezone: null,
      amount: null,
      paid: 0,
      currency: "EUR",
      place: "A",
      documentIds: [],
      source: "manual",
      details: {},
    };
    let s = apply(state, { type: "upsert", collection: "bookings", value: hotel });
    s = apply(s, {
      type: "station_night",
      stationId: a.id,
      night: { kind: "booked", bookingId: hotel.id },
    });
    expect(codeOf(() => apply(s, { type: "remove", collection: "bookings", id: hotel.id }))).toBe(
      "PLAN_PROTECTED"
    );
    expect(
      codeOf(() =>
        apply(s, { type: "upsert", collection: "bookings", value: { ...hotel, kind: "rail" } })
      )
    ).toBe("PLAN_PROTECTED");
  });
});
