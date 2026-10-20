import { randomUUID } from "crypto";
import { emptyState, bookingSchema } from "../schema";
import { routeFindings } from "../routeRules";
import { checkPlan } from "../rules";
import type { PlanBooking, PlanPlace, PlanStage, PlanState, PlanStation } from "../types";

const uid = () => randomUUID();
const place = (name: string): PlanPlace => ({
  name,
  lat: 0,
  lon: 0,
  country: null,
  zone: null,
  ref: null,
});
const station = (title: string, extra: Partial<PlanStation> = {}): PlanStation => ({
  id: uid(),
  title,
  place: place(title),
  nights: 0,
  pinnedDay: null,
  night: { kind: "spontaneous" },
  note: "",
  ...extra,
});
const stage = (a: PlanStation, b: PlanStation, extra: Partial<PlanStage> = {}): PlanStage => ({
  id: uid(),
  fromStationId: a.id,
  toStationId: b.id,
  mode: "drive",
  departDay: null,
  departTime: null,
  // A known duration, so the days after a stage are known (owner, 2026-10-20).
  durationMinutes: 60,
  distanceKm: null,
  metricsSource: null,
  fallbackReason: null,
  bookingId: null,
  overnight: false,
  note: "",
  ...extra,
});
const booking = (extra: Record<string, unknown> = {}): PlanBooking =>
  bookingSchema.parse({
    id: uid(),
    kind: "ferry",
    title: "Ferry",
    reference: null,
    provider: "",
    day: "2027-05-19",
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
    ...extra,
  });
const route = (
  stations: PlanStation[],
  stages: PlanStage[],
  extra: Partial<PlanState> = {}
): PlanState => ({
  ...emptyState(),
  shape: "route",
  startDay: "2027-05-08",
  stations,
  stages,
  ...extra,
});
const TODAY = "2027-05-01";
const codes = (state: PlanState, today = TODAY) => routeFindings(state, today).map((f) => f.code);
const one = (state: PlanState, code: string, today = TODAY) =>
  routeFindings(state, today).find((f) => f.code === code);
const placeholder = () =>
  booking({ placeholder: true, estimate: { amount: 300, currency: "EUR" } });

describe("route findings", () => {
  it("stageUndecided: a ferry with neither booking nor placeholder, but not a drive", () => {
    const a = station("Genoa"),
      b = station("Palermo"),
      c = station("Cefalu");
    const state = route([a, b, c], [stage(a, b, { mode: "ferry" }), stage(b, c)]);
    const found = routeFindings(state, TODAY).filter((f) => f.code === "stageUndecided");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      section: "route",
      severity: "info",
      params: { from: "Genoa", to: "Palermo", mode: "ferry" },
    });
  });

  it("stageUndecided: goes away once the stage carries a placeholder", () => {
    const a = station("Genoa"),
      b = station("Palermo");
    const ph = placeholder();
    const state = route([a, b], [stage(a, b, { mode: "ferry", bookingId: ph.id })], {
      bookings: [ph],
    });
    expect(codes(state)).not.toContain("stageUndecided");
  });

  it("placeholderDue: info inside 21 days, attention inside 7, silent beyond or when past", () => {
    const a = station("Genoa", { nights: 1 }),
      b = station("Palermo");
    const ph = placeholder();
    const state = route([a, b], [stage(a, b, { mode: "ferry", bookingId: ph.id })], {
      bookings: [ph],
    });
    // the ferry leaves on 2027-05-09
    expect(one(state, "placeholderDue", "2027-04-25")).toMatchObject({
      severity: "info",
      params: { title: "Ferry", days: 14 },
    });
    expect(one(state, "placeholderDue", "2027-05-05")?.severity).toBe("attention");
    expect(one(state, "placeholderDue", "2027-04-01")).toBeUndefined();
    expect(one(state, "placeholderDue", "2027-05-10")).toBeUndefined();
  });

  it("placeholderDue: boundaries at 21 (info), 22 (none) and 7 (attention) days", () => {
    const a = station("Genoa", { nights: 1 }),
      b = station("Palermo");
    const ph = placeholder();
    const state = route([a, b], [stage(a, b, { mode: "ferry", bookingId: ph.id })], {
      bookings: [ph],
    });
    // the ferry leaves on 2027-05-09
    expect(one(state, "placeholderDue", "2027-04-18")).toMatchObject({
      severity: "info",
      params: { days: 21, count: 21 },
    });
    expect(one(state, "placeholderDue", "2027-04-17")).toBeUndefined();
    expect(one(state, "placeholderDue", "2027-05-02")?.severity).toBe("attention");
    expect(one(state, "placeholderDue", "2027-05-01")?.severity).toBe("info"); // 8 days
  });

  it("placeholderDue: a booked ferry is not a placeholder", () => {
    const a = station("Genoa"),
      b = station("Palermo");
    const real = booking();
    const state = route([a, b], [stage(a, b, { mode: "ferry", bookingId: real.id })], {
      bookings: [real],
    });
    expect(codes(state, "2027-05-07")).not.toContain("placeholderDue");
  });

  it("nightUndecided: only an idea night with zero candidates", () => {
    const candidate = { id: uid(), title: "Camping", place: null, url: null, note: "" };
    const state = route(
      [
        station("A", { nights: 2, night: { kind: "idea", candidates: [] } }),
        station("B", { nights: 2, night: { kind: "idea", candidates: [candidate] } }),
      ],
      []
    );
    const found = routeFindings(state, TODAY).filter((f) => f.code === "nightUndecided");
    expect(found.map((f) => f.params)).toEqual([{ station: "A" }]);
  });

  it("spontaneous and pitch nights never produce a finding", () => {
    const c = station("C", { nights: 2, night: { kind: "spontaneous" } }),
      d = station("D", { nights: 2, night: { kind: "pitch" } });
    const state = route([c, d], [stage(c, d)]);
    expect(routeFindings(state, TODAY)).toEqual([]);
  });

  it("scheduleConflict: a booked ferry the route reaches late", () => {
    const a = station("Genoa", { nights: 3 }),
      b = station("Palermo");
    const real = booking({ day: "2027-05-09" });
    const state = route([a, b], [stage(a, b, { mode: "ferry", bookingId: real.id })], {
      bookings: [real],
    });
    expect(one(state, "scheduleConflict")).toMatchObject({
      severity: "attention",
      params: { anchor: "Genoa → Palermo", plannedDay: "2027-05-09", requiredDay: "2027-05-11" },
    });
  });

  it("longDrive: the limit follows the pace", () => {
    const a = station("Rosenheim"),
      b = station("Genoa");
    const state = route([a, b], [stage(a, b, { durationMinutes: 450 })], { pace: "balanced" });
    expect(one(state, "longDrive")?.params).toEqual({
      from: "Rosenheim",
      to: "Genoa",
      hours: 7.5,
    });
    expect(codes({ ...state, pace: "relaxed" })).toContain("longDrive");
    expect(codes({ ...state, pace: "busy" })).not.toContain("longDrive");
  });

  it("ferryConnection: under two hours between arrival and the ferry", () => {
    const a = station("Rosenheim"),
      b = station("Genoa"),
      c = station("Palermo");
    const ferry = booking({ day: "2027-05-08", time: "14:00" });
    const build = (time: string) =>
      route(
        [a, b, c],
        [
          stage(a, b, { departTime: "08:00", durationMinutes: 300 }),
          stage(b, c, { mode: "ferry", bookingId: ferry.id }),
        ],
        { bookings: [{ ...ferry, time }] }
      );
    // arrival 13:00, ferry 14:00 leaves 60 minutes
    expect(one(build("14:00"), "ferryConnection")).toMatchObject({
      severity: "attention",
      params: { ferry: "Ferry", minutes: 60 },
    });
    expect(codes(build("14:59"))).toContain("ferryConnection");
    expect(codes(build("15:00"))).not.toContain("ferryConnection");
  });

  it("dayTripOutside: an activity dated outside the days in its station", () => {
    const a = station("Cefalu", { nights: 2 });
    const item = (day: string, title: string) => ({
      id: uid(),
      title,
      kind: "activity" as const,
      day,
      time: null,
      duration: null,
      timezone: null,
      place: "",
      note: "",
      booked: false,
      bookingId: null,
      stationId: a.id,
      execution: "unconfirmed" as const,
      source: null,
    });
    const state = route([a], [], {
      items: [item("2027-05-09", "Beach"), item("2027-05-20", "Etna")],
    });
    const found = routeFindings(state, TODAY).filter((f) => f.code === "dayTripOutside");
    expect(found.map((f) => f.params)).toEqual([{ title: "Etna", station: "Cefalu" }]);
  });

  it("stageMissing: a leg between two stations without a stage, e.g. after a reorder", () => {
    const a = station("A"),
      b = station("B"),
      c = station("C");
    const state = route([a, c, b], [stage(a, b), stage(b, c)]);
    const found = routeFindings(state, TODAY).filter((f) => f.code === "stageMissing");
    expect(found.map((f) => f.params)).toEqual([
      { from: "A", to: "C" },
      { from: "C", to: "B" },
    ]);
    expect(found[0].severity).toBe("attention");
    expect(codes(route([a, b, c], [stage(a, b), stage(b, c)]))).not.toContain("stageMissing");
  });

  it("durationMissing: a stage whose arrival nothing determines", () => {
    const a = station("A"),
      b = station("B"),
      c = station("C");
    const real = booking({ day: "2027-05-08", arrivalDay: "2027-05-09" });
    const state = route(
      [a, b, c],
      [
        stage(a, b, { mode: "ferry", bookingId: real.id, durationMinutes: null }),
        stage(b, c, { durationMinutes: null }),
      ],
      { bookings: [real] }
    );
    const found = routeFindings(state, TODAY).filter((f) => f.code === "durationMissing");
    expect(found.map((f) => f.params)).toEqual([{ from: "B", to: "C" }]);
    expect(found[0].severity).toBe("attention");
    const timed = route([a, b], [stage(a, b, { durationMinutes: 90 })]);
    const overnight = route([a, b], [stage(a, b, { overnight: true, durationMinutes: null })]);
    expect(codes(timed)).not.toContain("durationMissing");
    expect(codes(overnight)).not.toContain("durationMissing");
  });

  it("decisions: conscious hides a finding, a dismissal only until its facts change", () => {
    const a = station("Genoa"),
      b = station("Palermo");
    const state = route([a, b], [stage(a, b, { mode: "ferry" })]);
    const finding = one(state, "stageUndecided")!;
    const decide = (choice: "conscious" | "dismissed", fingerprint = finding.fingerprint) => ({
      ...state,
      decisions: [{ id: finding.id, fingerprint, choice, decidedAt: "2027-05-01T00:00:00Z" }],
    });
    expect(codes(decide("conscious", "stale"))).not.toContain("stageUndecided");
    expect(codes(decide("dismissed"))).not.toContain("stageUndecided");
    expect(codes(decide("dismissed", "stale"))).toContain("stageUndecided");
  });
});

describe("checkPlan wiring", () => {
  it("route findings appear for shape route and not for stay", () => {
    const a = station("Genoa"),
      b = station("Palermo");
    const state = route([a, b], [stage(a, b, { mode: "ferry" })]);
    expect(checkPlan(state, TODAY).map((f) => f.code)).toContain("stageUndecided");
    expect(checkPlan({ ...state, shape: "stay" }, TODAY).map((f) => f.code)).not.toContain(
      "stageUndecided"
    );
  });
});
