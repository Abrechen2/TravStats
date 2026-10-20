import { randomUUID } from "crypto";
import { emptyState, bookingSchema } from "../schema";
import { scheduleRoute } from "../routeSchedule";
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
  durationMinutes: null,
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

function sicily(cefaluNights = 3) {
  const ro = station("Rosenheim"),
    ge = station("Genoa"),
    pa = station("Palermo"),
    ce = station("Cefalu", { nights: cefaluNights });
  const stages = [stage(ro, ge), stage(ge, pa, { mode: "ferry", overnight: true }), stage(pa, ce)];
  return { ro, ge, pa, ce, stages };
}

describe("scheduleRoute", () => {
  it("lays out the Sicily route with an overnight ferry", () => {
    const { ro, ge, pa, ce, stages } = sicily();
    const s = scheduleRoute(route([ro, ge, pa, ce], stages));
    const by = (id: string) => s.stations.find((x) => x.stationId === id)!;
    expect(by(ro.id)).toMatchObject({ arriveDay: "2027-05-08", departDay: "2027-05-08" });
    expect(by(ge.id)).toMatchObject({ arriveDay: "2027-05-08", departDay: "2027-05-08" });
    expect(by(pa.id)).toMatchObject({ arriveDay: "2027-05-09", departDay: "2027-05-09" });
    expect(by(ce.id)).toMatchObject({ arriveDay: "2027-05-09", departDay: "2027-05-12" });
    expect(s.stages[1]).toMatchObject({ departDay: "2027-05-08", arriveDay: "2027-05-09" });
    expect(s.lastDay).toBe("2027-05-12");
    expect(s.conflicts).toEqual([]);
  });

  it("lengthening a stay shifts later stations", () => {
    const { ro, ge, pa, ce, stages } = sicily();
    const longer = [ro, { ...ge, nights: 2 }, pa, ce];
    const s = scheduleRoute(route(longer, stages));
    expect(s.stations[2].arriveDay).toBe("2027-05-11");
    expect(s.stations[3].departDay).toBe("2027-05-14");
  });

  it("adds drive time across midnight", () => {
    const a = station("A"),
      b = station("B");
    const g = stage(a, b, { departTime: "22:00", durationMinutes: 180 });
    const s = scheduleRoute(route([a, b], [g]));
    expect(s.stations[1].arriveDay).toBe("2027-05-09");
  });

  it("anchor never moves; conflict finding instead", () => {
    const { ro, ge, pa, ce } = sicily(0);
    const ret = station("Genoa again");
    const real = booking({ day: "2027-05-19" });
    const stages = [
      stage(ro, ge),
      stage(ge, pa, { mode: "ferry", overnight: true }),
      stage(pa, ce),
      stage(ce, ret, { mode: "ferry", bookingId: real.id }),
    ];
    // Nights 10 at Cefalu: ferry planned 2027-05-19 is reachable.
    const ok = scheduleRoute(
      route([ro, ge, pa, { ...ce, nights: 10 }, ret], stages, { bookings: [real] })
    );
    expect(ok.conflicts).toEqual([]);
    expect(ok.stages[3].departDay).toBe("2027-05-19");
    // Two more nights earlier: the route needs 2027-05-21, the ferry stays.
    const late = scheduleRoute(
      route([ro, ge, pa, { ...ce, nights: 12 }, ret], stages, { bookings: [real] })
    );
    expect(late.stages[3].departDay).toBe("2027-05-19");
    expect(late.stations[4].arriveDay).toBe("2027-05-19");
    expect(late.conflicts).toEqual([
      {
        kind: "anchor_shift",
        anchorId: stages[3].id,
        plannedDay: "2027-05-19",
        requiredDay: "2027-05-21",
      },
    ]);
  });

  it("an earlier arrival is a gap, not a conflict", () => {
    const { ro, ge, pa, ce } = sicily(0);
    const real = booking({ day: "2027-05-30" });
    const stages = [
      stage(ro, ge),
      stage(ge, pa, { overnight: true }),
      stage(pa, ce, { bookingId: real.id }),
    ];
    const s = scheduleRoute(route([ro, ge, pa, ce], stages, { bookings: [real] }));
    expect(s.conflicts).toEqual([]);
    expect(s.stages[2].departDay).toBe("2027-05-30");
  });

  it("a placeholder booking is not an anchor", () => {
    const { ro, ge, pa, ce } = sicily(0);
    const ph = booking({
      day: "2027-05-30",
      placeholder: true,
      estimate: { amount: 1, currency: "EUR" },
    });
    const stages = [
      stage(ro, ge),
      stage(ge, pa, { overnight: true }),
      stage(pa, ce, { bookingId: ph.id }),
    ];
    const s = scheduleRoute(route([ro, ge, pa, ce], stages, { bookings: [ph] }));
    expect(s.stages[2].departDay).toBe("2027-05-09");
  });

  it("a pinned station anchors its arrival and reports a late route", () => {
    const a = station("A", { nights: 5 }),
      b = station("B", { pinnedDay: "2027-05-10" });
    const s = scheduleRoute(route([a, b], [stage(a, b)]));
    expect(s.stations[1].arriveDay).toBe("2027-05-10");
    expect(s.conflicts).toEqual([
      { kind: "anchor_shift", anchorId: b.id, plannedDay: "2027-05-10", requiredDay: "2027-05-13" },
    ]);
  });

  it("no start day gives null days", () => {
    const { ro, ge, pa, ce, stages } = sicily();
    const s = scheduleRoute(route([ro, ge, pa, ce], stages, { startDay: null }));
    expect(s.stations.every((x) => x.arriveDay === null && x.departDay === null)).toBe(true);
    expect(s.stages.every((x) => x.departDay === null && x.arriveDay === null)).toBe(true);
    expect(s.lastDay).toBeNull();
    expect(s.conflicts).toEqual([]);
  });
});
