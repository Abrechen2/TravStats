import { describe, it, expect } from "vitest";
import { buildTimelineEvents } from "../tripTimelineEvents";
import { sortTimelineEvents } from "../tripTimeline";
import type { Trip } from "../../types";
import type { TimeValue } from "../../shared/time";

/**
 * A stay's check-in/out TIME is the booking's nominal 11:00 / 15:00, not when
 * the traveller left or arrived. Measured on the owner's data: 11 check-outs at
 * 11:00 sat BELOW a flight that left at 10:35 the same day ("Hotel vor
 * Hinflug"). Travel the same day wins over a nominal lodging time.
 */
const BER = { zone: "Europe/Berlin", offset: "+02:00" } as const;
const tv = (local: string, utc: string, z: { zone: string; offset: string } = BER): TimeValue => ({
  utc,
  ...z,
  local,
  precision: "minute",
});
const dayTv = (date: string): TimeValue => ({
  utc: `${date}T00:00:00.000Z`,
  zone: null,
  offset: "",
  local: `${date}T00:00:00`,
  precision: "day",
});

type Flight = NonNullable<Trip["flights"]>[number];
type Stay = NonNullable<Trip["lodgingStays"]>[number];

const flight = (id: string, dep: TimeValue, arr: TimeValue): Flight =>
  ({
    id,
    depIata: "AAA",
    arrIata: "BBB",
    departureTime: dep.utc,
    arrivalTime: arr.utc,
    times: { departure: dep, arrival: arr },
  }) as unknown as Flight;

const stay = (id: string, checkIn: TimeValue, checkOut: TimeValue): Stay =>
  ({
    id,
    checkIn: checkIn.utc,
    checkOut: checkOut.utc,
    times: {
      checkIn: { date: checkIn.local.slice(0, 10), zone: null, precision: "day" },
      checkOut: { date: checkOut.local.slice(0, 10), zone: null, precision: "day" },
      checkInAt: checkIn,
      checkOutAt: checkOut,
    },
  }) as unknown as Stay;

const order = (trip: Partial<Trip>) =>
  buildTimelineEvents({ id: "t", ...trip } as Trip, []).map((e) => e.id);

describe("trip timeline — a nominal lodging time yields to the day's travel", () => {
  it("puts a check-out at 11:00 BEFORE a flight that departs at 10:35 the same day", () => {
    const f = flight(
      "f",
      tv("2026-05-10T10:35:00", "2026-05-10T08:35:00.000Z"),
      tv("2026-05-10T12:40:00", "2026-05-10T10:40:00.000Z")
    );
    const s = stay(
      "h",
      tv("2026-05-07T15:00:00", "2026-05-07T13:00:00.000Z"),
      tv("2026-05-10T11:00:00", "2026-05-10T09:00:00.000Z")
    );
    expect(order({ flights: [f], lodgingStays: [s] })).toEqual([
      "lodging-checkin-h",
      "lodging-checkout-h",
      "flight-f",
    ]);
  });

  it("puts a check-in at 15:00 AFTER a flight that arrives at 18:00 the same day", () => {
    // The flight leaves at 16:00 — after the nominal check-in time — and lands at 18:00.
    const f = flight(
      "f",
      tv("2026-05-10T16:00:00", "2026-05-10T14:00:00.000Z"),
      tv("2026-05-10T18:00:00", "2026-05-10T16:00:00.000Z")
    );
    const s = stay(
      "h",
      tv("2026-05-10T15:00:00", "2026-05-10T13:00:00.000Z"),
      tv("2026-05-12T11:00:00", "2026-05-12T09:00:00.000Z")
    );
    expect(order({ flights: [f], lodgingStays: [s] })).toEqual([
      "flight-f",
      "lodging-checkin-h",
      "lodging-checkout-h",
    ]);
  });

  it("keeps an overnight flight on its departure day and the arrival-day check-in after it", () => {
    const f = flight(
      "f",
      tv("2026-05-10T22:00:00", "2026-05-10T20:00:00.000Z"),
      tv("2026-05-11T06:00:00", "2026-05-11T04:00:00.000Z")
    );
    const s = stay(
      "h",
      tv("2026-05-11T00:30:00", "2026-05-10T22:30:00.000Z"),
      tv("2026-05-13T11:00:00", "2026-05-13T09:00:00.000Z")
    );
    // The check-in's own nominal time (00:30) is before the 06:00 landing: a
    // 05:00 entry (a lounge note) would otherwise sort after it.
    const events = sortTimelineEvents([
      { id: "in", kind: "lodging-checkin", when: s.times!.checkInAt! },
      { id: "f", kind: "flight", when: f.times!.departure!, end: f.times!.arrival },
      { id: "early", kind: "stop", when: tv("2026-05-11T05:00:00", "2026-05-11T03:00:00.000Z") },
    ]);
    expect(events.map((e) => e.id)).toEqual(["f", "early", "in"]);
  });

  it("orders a multi-zone day: check-out, flight across zones, check-in at the destination", () => {
    // Berlin 08:30 → New York arrival 12:10 local (16:10Z); the New York hotel says 15:00 local (19:00Z).
    const NYC = { zone: "America/New_York", offset: "-04:00" };
    const f = flight(
      "f",
      tv("2026-05-10T08:30:00", "2026-05-10T06:30:00.000Z"),
      tv("2026-05-10T12:10:00", "2026-05-10T16:10:00.000Z", NYC)
    );
    const out = stay(
      "ber",
      tv("2026-05-07T15:00:00", "2026-05-07T13:00:00.000Z"),
      tv("2026-05-10T12:00:00", "2026-05-10T10:00:00.000Z")
    );
    const inn = stay(
      "nyc",
      tv("2026-05-10T11:00:00", "2026-05-10T15:00:00.000Z", NYC),
      tv("2026-05-14T11:00:00", "2026-05-14T15:00:00.000Z", NYC)
    );
    expect(order({ flights: [f], lodgingStays: [inn, out] })).toEqual([
      "lodging-checkin-ber",
      "lodging-checkout-ber",
      "flight-f",
      "lodging-checkin-nyc",
      "lodging-checkout-nyc",
    ]);
  });

  it("puts a timed rail leg ahead of the check-in that follows their arrival", () => {
    const rail = {
      id: "r",
      departureTime: "2026-05-10T14:00:00.000Z",
      arrivalTime: "2026-05-10T16:00:00.000Z",
      times: {
        departure: tv("2026-05-10T16:00:00", "2026-05-10T14:00:00.000Z"),
        arrival: tv("2026-05-10T18:00:00", "2026-05-10T16:00:00.000Z"),
      },
    };
    const s = stay(
      "h",
      tv("2026-05-10T15:00:00", "2026-05-10T13:00:00.000Z"),
      tv("2026-05-11T11:00:00", "2026-05-11T09:00:00.000Z")
    );
    expect(
      order({ railJourneys: [rail] as unknown as Trip["railJourneys"], lodgingStays: [s] })
    ).toEqual(["rail-r", "lodging-checkin-h", "lodging-checkout-h"]);
  });

  it("puts a timed check-out before a ferry, a bus and a rental pickup, and a check-in after a rental return", () => {
    const co = tv("2026-05-10T11:00:00", "2026-05-10T09:00:00.000Z");
    const earlier = (hh: string) => tv(`2026-05-10T${hh}:00`, `2026-05-10T${hh}:00.000Z`);
    const events = sortTimelineEvents([
      { id: "ferry", kind: "ferry", when: earlier("08:00"), end: earlier("09:30") },
      { id: "out", kind: "lodging-checkout", when: co },
      { id: "pick", kind: "rental-pickup", when: earlier("09:00") },
      { id: "ret", kind: "rental-return", when: earlier("17:00") },
      {
        id: "in",
        kind: "lodging-checkin",
        when: tv("2026-05-10T15:00:00", "2026-05-10T13:00:00.000Z"),
      },
    ]);
    expect(events.map((e) => e.id)).toEqual(["out", "ferry", "pick", "ret", "in"]);
  });

  it("keeps real times: a timed check-in before a LATER flight departure stays before it", () => {
    const f = flight(
      "f",
      tv("2026-05-10T23:00:00", "2026-05-10T21:00:00.000Z"),
      tv("2026-05-11T01:30:00", "2026-05-10T23:30:00.000Z")
    );
    const s = stay(
      "h",
      tv("2026-05-10T15:00:00", "2026-05-10T13:00:00.000Z"),
      tv("2026-05-10T22:00:00", "2026-05-10T20:00:00.000Z")
    );
    // The flight lands on the 11th, so it is no arrival of the 10th.
    expect(order({ flights: [f], lodgingStays: [s] })).toEqual([
      "lodging-checkin-h",
      "lodging-checkout-h",
      "flight-f",
    ]);
  });

  it("still puts the diary last and a time-less check-out first", () => {
    const f = flight(
      "f",
      tv("2026-05-10T10:35:00", "2026-05-10T08:35:00.000Z"),
      tv("2026-05-10T12:40:00", "2026-05-10T10:40:00.000Z")
    );
    const s = {
      id: "h",
      checkIn: "2026-05-07T00:00:00.000Z",
      checkOut: "2026-05-10T00:00:00.000Z",
    } as unknown as Stay;
    const j = { id: "j", date: dayTv("2026-05-10").utc } as unknown as NonNullable<
      Trip["journalEntries"]
    >[number];
    expect(order({ flights: [f], lodgingStays: [s], journalEntries: [j] })).toEqual([
      "lodging-checkin-h",
      "lodging-checkout-h",
      "flight-f",
      "journal-j",
    ]);
  });
});
