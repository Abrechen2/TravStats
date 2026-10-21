import { randomUUID } from "crypto";
import { emptyState } from "../schema";
import { applyOperation } from "../operations";
import { compareVariants, fuelEstimate } from "../variants";
import type {
  PlanBooking,
  PlanItem,
  PlanOperation,
  PlanStage,
  PlanState,
  PlanStation,
  PlanVehicle,
} from "../types";

const uid = () => randomUUID();
const station = (title: string, extra: Partial<PlanStation> = {}): PlanStation => ({
  id: uid(),
  title,
  place: { name: title, lat: 50, lon: 10, country: "DE", zone: null, ref: null },
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
  distanceKm: 100,
  metricsSource: "user",
  fallbackReason: null,
  bookingId: null,
  overnight: false,
  note: "",
  ...extra,
});
const booking = (extra: Partial<PlanBooking> = {}): PlanBooking => ({
  id: uid(),
  kind: "ferry",
  title: "Ferry",
  reference: null,
  provider: "",
  day: null,
  endDay: null,
  time: null,
  timezone: null,
  amount: null,
  paid: 0,
  currency: "EUR",
  place: "",
  documentIds: [],
  source: "manual",
  details: {},
  placeholder: false,
  estimate: null,
  stageId: null,
  ...extra,
});
const item = (stationId: string | null): PlanItem => ({
  id: uid(),
  title: "Day trip",
  kind: "activity",
  day: null,
  time: null,
  duration: null,
  timezone: null,
  place: "",
  note: "",
  booked: false,
  bookingId: null,
  stationId,
  execution: "unconfirmed",
  source: null,
});
const apply = (state: PlanState, op: PlanOperation) => applyOperation(state, op, 1);
const vehicle: PlanVehicle = {
  kind: "motorhome",
  lengthM: 7,
  consumptionPer100: 11,
  fuelPrice: 1.75,
  fuelCurrency: "EUR",
};
const route = () => {
  const a = station("A"),
    b = station("B"),
    c = station("C", { nights: 3 });
  const g1 = stage(a.id, b.id, { distanceKm: 1000 }),
    g2 = stage(b.id, c.id, { distanceKm: 1130 });
  return { a, b, c, g1, g2 };
};

describe("Plan variants", () => {
  it("switching variants does not lose a day trip or a booking", () => {
    const { a, b, c, g1, g2 } = route();
    const hotel = booking({ kind: "hotel", title: "Hotel", amount: 90 });
    const placeholder = booking({
      placeholder: true,
      stageId: g2.id,
      estimate: { amount: 200, currency: "EUR" },
    });
    const dayTrip = item(c.id);
    const base: PlanState = {
      ...emptyState(),
      shape: "route",
      stations: [a, b, c],
      stages: [g1, g2],
      bookings: [hotel, placeholder],
      items: [dayTrip],
    };
    const withB = apply(base, { type: "create_variant", name: "B", copyActive: false });
    expect(withB.variants).toHaveLength(1);
    expect(withB.variants[0]).toMatchObject({ name: "B", stations: [], stages: [] });
    const switched = apply(withB, { type: "activate_variant", variantId: withB.variants[0].id });
    expect(switched.stations).toEqual([]);
    expect(switched.activeVariantName).toBe("B");
    expect(switched.variants[0]).toMatchObject({ name: "A" });
    expect(switched.variants[0].stations.map((s) => s.id)).toEqual([a.id, b.id, c.id]);
    // The day trip is kept, unanchored; both bookings stay untouched.
    expect(switched.items).toEqual([{ ...withB.items[0], stationId: null }]);
    expect(switched.items.map((i) => i.id)).toEqual([dayTrip.id]);
    expect(switched.bookings).toEqual(withB.bookings);
    expect(switched.bookings.map((b) => b.id)).toEqual([hotel.id, placeholder.id]);
    const back = apply(switched, { type: "activate_variant", variantId: switched.variants[0].id });
    expect(back.stations.map((s) => s.id)).toEqual([a.id, b.id, c.id]);
    expect(back.activeVariantName).toBe("A");
  });

  it("keeps a day trip anchored when the same place keeps its id in the copy", () => {
    const { a, b, g1 } = route();
    const base: PlanState = {
      ...emptyState(),
      shape: "route",
      stations: [a, b],
      stages: [g1],
      items: [item(a.id)],
    };
    const copied = apply(base, { type: "create_variant", name: "B", copyActive: true });
    expect(copied.variants[0].stations.map((s) => s.id)).toEqual([a.id, b.id]);
    const switched = apply(copied, { type: "activate_variant", variantId: copied.variants[0].id });
    expect(switched.items[0].stationId).toBe(a.id);
  });

  it("keeps station links and weather through a variant round trip", () => {
    const { a, b, g1 } = route();
    const link = { stationId: a.id, tripStopId: uid() };
    const weather = {
      stationId: a.id,
      kind: "forecast" as const,
      source: "open-meteo",
      fetchedAt: "2027-05-01T08:00:00.000Z",
      window: null,
      days: [],
    };
    const base: PlanState = {
      ...emptyState(),
      shape: "route",
      stations: [a, b],
      stages: [g1],
      stationLinks: [link],
      stationWeather: [weather],
    };
    const withB = apply(base, { type: "create_variant", name: "B", copyActive: false });
    const switched = apply(withB, { type: "activate_variant", variantId: withB.variants[0].id });
    const back = apply(switched, { type: "activate_variant", variantId: switched.variants[0].id });
    expect(back.stations.map((s) => s.id)).toEqual([a.id, b.id]);
    expect(back.stationLinks).toEqual([link]);
    expect(back.stationWeather).toEqual([weather]);
    // Once no route holds the station any more, its links and weather go.
    const dropped = apply(switched, { type: "remove_variant", variantId: switched.variants[0].id });
    expect(dropped.stationLinks).toEqual([]);
    expect(dropped.stationWeather).toEqual([]);
  });

  it("fuel estimate is null when any drive distance is unknown", () => {
    const { a, b, c } = route();
    const stages = [
      stage(a.id, b.id, { distanceKm: 500 }),
      stage(b.id, c.id, { distanceKm: null }),
    ];
    expect(fuelEstimate(stages, vehicle)).toBeNull();
    expect(fuelEstimate([stage(a.id, b.id)], { ...vehicle, fuelPrice: null })).toBeNull();
    expect(fuelEstimate([stage(a.id, b.id)], null)).toBeNull();
  });

  it("fuel estimate 2130 km at 11 l and 1.75 €/l is 410.03 EUR", () => {
    const { a, c, g1, g2 } = route();
    expect(fuelEstimate([g1, g2], vehicle)).toEqual({ amount: 410.03, currency: "EUR" });
    // A ferry crossing burns no fuel and needs no distance.
    const ferry = stage(a.id, c.id, { mode: "ferry", distanceKm: null });
    expect(fuelEstimate([g1, g2, ferry], vehicle)).toEqual({ amount: 410.03, currency: "EUR" });
  });

  it("fourth variant is refused", () => {
    let state: PlanState = { ...emptyState(), shape: "route" };
    state = apply(state, { type: "create_variant", name: "B", copyActive: false });
    state = apply(state, { type: "create_variant", name: "C", copyActive: false });
    expect(() => apply(state, { type: "create_variant", name: "D", copyActive: false })).toThrow(
      expect.objectContaining({ code: "PLAN_VARIANT_LIMIT", statusCode: 409 })
    );
  });

  it("renames and removes only existing inactive variants", () => {
    let state: PlanState = { ...emptyState(), shape: "route" };
    state = apply(state, { type: "create_variant", name: "B", copyActive: false });
    const id = state.variants[0].id;
    state = apply(state, { type: "rename_variant", variantId: id, name: "Coast" });
    expect(state.variants[0].name).toBe("Coast");
    expect(() => apply(state, { type: "remove_variant", variantId: uid() })).toThrow(
      expect.objectContaining({ code: "PLAN_ITEM_NOT_FOUND" })
    );
    state = apply(state, { type: "remove_variant", variantId: id });
    expect(state.variants).toEqual([]);
  });

  describe("compareVariants", () => {
    it("measures each variant by its own stages and flags what it cannot price", () => {
      const { a, b, c, g1, g2 } = route();
      const ferry = stage(b.id, c.id, { mode: "ferry", distanceKm: null });
      const onboard = station("Deck", { nights: 2, night: { kind: "onboard" } });
      const ferryNight = stage(b.id, onboard.id, {
        mode: "ferry",
        overnight: true,
        distanceKm: null,
      });
      const priced = booking({ stageId: g2.id, amount: 60 });
      const estimated = booking({
        placeholder: true,
        stageId: g2.id,
        estimate: { amount: 40, currency: "EUR" },
      });
      const foreign = booking({ stageId: ferry.id, amount: 50, currency: "USD" });
      const base: PlanState = {
        ...emptyState(),
        shape: "route",
        currency: "EUR",
        stations: [a, b, c],
        stages: [g1, g2],
        variants: [
          { id: uid(), name: "B", stations: [a, b, onboard], stages: [g1, ferryNight, ferry] },
        ],
        bookings: [priced, estimated, foreign],
        vehicle,
      };
      const [active, other] = compareVariants(base);
      expect(active).toMatchObject({
        id: null,
        name: "A",
        active: true,
        driveKm: 2130,
        driveDays: 2,
        destinationNights: 5,
        stageCosts: { amount: 100, currency: "EUR" },
        fuel: { amount: 410.03, currency: "EUR" },
        unknownCosts: 0,
      });
      expect(other).toMatchObject({
        name: "B",
        active: false,
        driveKm: 1000,
        driveDays: 1,
        destinationNights: 2,
        stageCosts: null,
        // the overnight ferry has no price; the B→C ferry (and its USD amount)
        // joins no consecutive stations of this variant, so it is reported, not counted
        unknownCosts: 1,
        obsoleteStageIds: [ferry.id],
      });
      expect(other.fuel).toEqual({ amount: 192.5, currency: "EUR" });
    });

    it("a route with a leg no stage covers has no drive total and no fuel", () => {
      const { a, b, c, g1, g2 } = route();
      const reordered: PlanState = {
        ...emptyState(),
        shape: "route",
        stations: [a, c, b],
        stages: [g1, g2],
        vehicle,
      };
      expect(compareVariants(reordered)[0]).toMatchObject({
        driveKm: null,
        driveDays: 0,
        fuel: null,
      });
    });

    it("after a reorder, totals count only the stages of the new order; old ones are reported", () => {
      const { a, b, c, g1, g2 } = route();
      // Was A→B→C; B moved behind C, then the user added A→C and C→B.
      const ac = stage(a.id, c.id, { distanceKm: 500 }),
        cb = stage(c.id, b.id, { distanceKm: 600 });
      const oldFerry = stage(b.id, c.id, { mode: "ferry", distanceKm: null });
      const state: PlanState = {
        ...emptyState(),
        shape: "route",
        currency: "EUR",
        stations: [a, c, b],
        stages: [g1, g2, oldFerry, ac, cb],
        bookings: [
          booking({ stageId: g2.id, amount: 60 }),
          booking({ stageId: cb.id, amount: 25 }),
        ],
        vehicle,
      };
      expect(compareVariants(state)[0]).toMatchObject({
        driveKm: 1100,
        driveDays: 2,
        stageCosts: { amount: 25, currency: "EUR" },
        unknownCosts: 0,
        fuel: { amount: 211.75, currency: "EUR" },
        obsoleteStageIds: [g1.id, g2.id, oldFerry.id],
      });
    });

    it("reports driveKm null when a drive distance is unknown and 0 with no drives", () => {
      const { a, b, g1 } = route();
      const unknown = stage(a.id, b.id, { distanceKm: null });
      const state: PlanState = {
        ...emptyState(),
        shape: "route",
        stations: [a, b],
        stages: [unknown, g1],
      };
      expect(compareVariants(state)[0].driveKm).toBeNull();
      const ferryOnly = [stage(a.id, b.id, { mode: "ferry" })];
      expect(compareVariants({ ...state, stages: ferryOnly })[0].driveKm).toBe(0);
    });
  });
});
