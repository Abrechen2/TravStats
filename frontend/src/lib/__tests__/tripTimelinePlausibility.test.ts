import { describe, it, expect } from "vitest";
import { findTimelineInconsistencies } from "../tripTimelinePlausibility";
import type { TimelineEvent } from "../tripTimelineEvents";
import type { TimeValue } from "../../shared/time";

const EDT = { zone: "America/New_York", offset: "-04:00" };
const CDT = { zone: "America/Chicago", offset: "-05:00" };
/** A value at a real zone: `local` is the wall clock, `utc` derived from the offset. */
function at(local: string, z: { zone: string; offset: string }): TimeValue {
  const sign = z.offset[0] === "-" ? 1 : -1;
  const [h, m] = z.offset.slice(1).split(":").map(Number);
  const utc = new Date(Date.parse(`${local}Z`) + sign * (h * 60 + m) * 60000).toISOString();
  return { utc, zone: z.zone, offset: z.offset, local, precision: "minute" };
}
/** A wall clock stored as if it were UTC — no zone known. */
const naive = (local: string): TimeValue => ({
  utc: `${local}.000Z`,
  zone: null,
  offset: "+00:00",
  local,
  precision: "minute",
});
const day = (d: string): TimeValue => ({
  utc: `${d}T00:00:00.000Z`,
  zone: null,
  offset: "+00:00",
  local: `${d}T00:00:00`,
  precision: "day",
});

const MCO = { iata: "MCO", lat: 28.43, lon: -81.31 };
const ORD = { iata: "ORD", lat: 41.97, lon: -87.9 };
const MIA = { iata: "MIA", lat: 25.79, lon: -80.29 };

const flight = (id: string, from: typeof MCO, to: typeof MCO, dep: TimeValue, arr: TimeValue) =>
  ({
    id: `flight-${id}`,
    kind: "flight",
    date: dep.utc,
    when: dep,
    end: arr,
    title: "",
    subtitle: null,
    flight: {
      id,
      depIata: from.iata,
      arrIata: to.iata,
      depLat: from.lat,
      depLon: from.lon,
      arrLat: to.lat,
      arrLon: to.lon,
    },
  }) as unknown as TimelineEvent;

const rental = (
  id: string,
  kind: "rental-pickup" | "rental-return",
  p: typeof MCO,
  when: TimeValue
) =>
  ({
    id: `${kind}-${id}`,
    kind,
    date: when.utc,
    when,
    rental: {
      id,
      status: "completed",
      pickupIata: p.iata,
      returnIata: p.iata,
      pickupLat: p.lat,
      pickupLon: p.lon,
      returnLat: p.lat,
      returnLon: p.lon,
    },
  }) as unknown as TimelineEvent;

const stay = (
  id: string,
  lodgingId: string,
  kind: "lodging-checkin" | "lodging-checkout",
  d: string,
  p?: typeof MCO
) =>
  ({
    id: `${kind}-${id}`,
    kind,
    date: `${d}T00:00:00.000Z`,
    when: day(d),
    stay: { id, lodgingId, lodging: { lat: p?.lat ?? null, lon: p?.lon ?? null } },
  }) as unknown as TimelineEvent;

const codes = (events: TimelineEvent[]) =>
  findTimelineInconsistencies(events).map((f) => `${f.code}:${f.eventId}`);

describe("timeline plausibility — Florida 2009", () => {
  const leave = flight(
    "f1",
    MCO,
    ORD,
    at("2009-04-15T06:50:00", EDT),
    at("2009-04-15T08:20:00", CDT)
  );
  const pickup = rental("r1", "rental-pickup", MCO, at("2009-04-08T10:00:00", EDT));

  it("flags a rental return of 07:29 stored in UTC that lies after the departure from that airport", () => {
    const ret = rental("r1", "rental-return", MCO, naive("2009-04-15T07:29:00"));
    expect(codes([pickup, leave, ret])).toEqual(["rentalReturnAfterDeparture:rental-return-r1"]);
  });

  it("raises nothing when the car came back in time that day", () => {
    const ret = rental("r1", "rental-return", MCO, at("2009-04-15T05:10:00", EDT));
    expect(codes([pickup, leave, ret])).toEqual([]);
  });

  it("abstains when the return has no time of day", () => {
    const ret = rental("r1", "rental-return", MCO, day("2009-04-15"));
    expect(codes([pickup, leave, ret])).toEqual([]);
  });

  it("flags a return dated on a later day than the departure it should precede", () => {
    const ret = rental("r1", "rental-return", MCO, day("2009-04-16"));
    expect(codes([pickup, leave, ret])).toEqual(["rentalReturnAfterDeparture:rental-return-r1"]);
  });
});

describe("timeline plausibility — rentals", () => {
  it("flags a pickup earlier on the arrival day than the landing", () => {
    const land = flight(
      "f",
      ORD,
      MCO,
      at("2009-04-08T06:00:00", CDT),
      at("2009-04-08T09:30:00", EDT)
    );
    const pick = rental("r", "rental-pickup", MCO, at("2009-04-08T08:45:00", EDT));
    expect(codes([land, pick])).toEqual(["rentalPickupBeforeArrival:rental-pickup-r"]);
  });

  it("raises nothing for a pickup after the landing", () => {
    const land = flight(
      "f",
      ORD,
      MCO,
      at("2009-04-08T06:00:00", CDT),
      at("2009-04-08T09:30:00", EDT)
    );
    const pick = rental("r", "rental-pickup", MCO, at("2009-04-08T10:15:00", EDT));
    expect(codes([land, pick])).toEqual([]);
  });

  it("flags a return before its own pickup", () => {
    const events = [
      rental("r", "rental-pickup", MCO, at("2009-04-10T10:00:00", EDT)),
      rental("r", "rental-return", MCO, at("2009-04-09T10:00:00", EDT)),
    ];
    expect(codes(events)).toEqual(["rentalReturnBeforePickup:rental-return-r"]);
  });

  it("flags a second car collected while the first one is still out", () => {
    const events = [
      rental("a", "rental-pickup", MCO, at("2009-04-08T10:00:00", EDT)),
      rental("a", "rental-return", MCO, at("2009-04-12T10:00:00", EDT)),
      rental("b", "rental-pickup", MIA, at("2009-04-10T10:00:00", EDT)),
      rental("b", "rental-return", MIA, at("2009-04-14T10:00:00", EDT)),
    ];
    expect(codes(events)).toEqual(["rentalsOverlap:rental-pickup-b"]);
  });
});

describe("timeline plausibility — legs", () => {
  it("flags a leg that departs before the previous one has arrived", () => {
    const a = flight("a", MCO, ORD, at("2009-04-15T06:50:00", EDT), at("2009-04-15T08:20:00", CDT));
    const b = flight("b", ORD, MIA, at("2009-04-15T08:00:00", CDT), at("2009-04-15T11:00:00", EDT));
    expect(codes([a, b])).toEqual(["legBeforeArrival:flight-b"]);
  });

  it("raises nothing for a connection with a layover", () => {
    const a = flight("a", MCO, ORD, at("2009-04-15T06:50:00", EDT), at("2009-04-15T08:20:00", CDT));
    const b = flight("b", ORD, MIA, at("2009-04-15T09:30:00", CDT), at("2009-04-15T12:30:00", EDT));
    expect(codes([a, b])).toEqual([]);
  });

  it("abstains when a leg has no arrival time", () => {
    const a = {
      ...flight("a", MCO, ORD, at("2009-04-15T06:50:00", EDT), at("2009-04-15T08:20:00", CDT)),
      end: null,
    };
    const b = flight("b", ORD, MIA, at("2009-04-15T07:00:00", CDT), at("2009-04-15T11:00:00", EDT));
    expect(codes([a as TimelineEvent, b])).toEqual([]);
  });

  it("does not compare two zone-less clocks at different places across zones", () => {
    const a = flight("a", MCO, ORD, naive("2009-04-15T06:50:00"), at("2009-04-15T08:20:00", CDT));
    const b = flight("b", MIA, MCO, at("2009-04-15T05:00:00", EDT), at("2009-04-15T06:00:00", EDT));
    expect(codes([a, b])).toEqual([]);
  });
});

describe("timeline plausibility — lodging", () => {
  it("flags two stays in different places on the same night", () => {
    const events = [
      stay("s1", "h1", "lodging-checkin", "2009-04-08"),
      stay("s1", "h1", "lodging-checkout", "2009-04-12"),
      stay("s2", "h2", "lodging-checkin", "2009-04-10"),
      stay("s2", "h2", "lodging-checkout", "2009-04-14"),
    ];
    expect(codes(events)).toEqual(["stayOverlap:lodging-checkin-s2"]);
  });

  it("raises nothing for a same-day hand-over between two hotels", () => {
    const events = [
      stay("s1", "h1", "lodging-checkin", "2009-04-08"),
      stay("s1", "h1", "lodging-checkout", "2009-04-12"),
      stay("s2", "h2", "lodging-checkin", "2009-04-12"),
      stay("s2", "h2", "lodging-checkout", "2009-04-14"),
    ];
    expect(codes(events)).toEqual([]);
  });

  it("flags a check-in dated before the traveller reached the hotel's town", () => {
    const land = flight(
      "f",
      ORD,
      MCO,
      at("2009-04-09T06:00:00", CDT),
      at("2009-04-09T09:30:00", EDT)
    );
    const events = [land, stay("s", "h", "lodging-checkin", "2009-04-08", MCO)];
    expect(codes(events)).toEqual(["checkInBeforeArrival:lodging-checkin-s"]);
  });

  it("flags a check-out after the traveller flew out and did not return", () => {
    const leave = flight(
      "f",
      MCO,
      ORD,
      at("2009-04-15T06:50:00", EDT),
      at("2009-04-15T08:20:00", CDT)
    );
    const events = [
      stay("s", "h", "lodging-checkin", "2009-04-08", MCO),
      stay("s", "h", "lodging-checkout", "2009-04-17", MCO),
      leave,
    ];
    expect(codes(events)).toContain("checkOutAfterDeparture:lodging-checkout-s");
  });

  it("abstains when the hotel has no position", () => {
    const land = flight(
      "f",
      ORD,
      MCO,
      at("2009-04-09T06:00:00", CDT),
      at("2009-04-09T09:30:00", EDT)
    );
    expect(codes([land, stay("s", "h", "lodging-checkin", "2009-04-08")])).toEqual([]);
  });
});

describe("timeline plausibility — review follow-ups", () => {
  it("flags an overlap whichever stay's id sorts first", () => {
    const events = [
      stay("z", "h1", "lodging-checkin", "2009-04-08"),
      stay("z", "h1", "lodging-checkout", "2009-04-12"),
      stay("a", "h2", "lodging-checkin", "2009-04-10"),
      stay("a", "h2", "lodging-checkout", "2009-04-14"),
    ];
    expect(codes(events)).toEqual(["stayOverlap:lodging-checkin-a"]);
  });

  it("accepts a rental kept over a side trip that came back before the return", () => {
    const pick = rental("r", "rental-pickup", MCO, at("2009-04-08T10:00:00", EDT));
    const out = flight(
      "o",
      MCO,
      ORD,
      at("2009-04-10T06:00:00", EDT),
      at("2009-04-10T08:00:00", CDT)
    );
    const back = flight(
      "b",
      ORD,
      MCO,
      at("2009-04-11T06:00:00", CDT),
      at("2009-04-11T09:00:00", EDT)
    );
    const ret = rental("r", "rental-return", MCO, at("2009-04-12T10:00:00", EDT));
    expect(codes([pick, out, back, ret])).toEqual([]);
  });

  it("still flags a check-out after leaving when a later trip returns after the check-out", () => {
    const leave = flight(
      "o",
      MCO,
      ORD,
      at("2009-04-10T06:00:00", EDT),
      at("2009-04-10T08:00:00", CDT)
    );
    const back = flight(
      "b",
      ORD,
      MCO,
      at("2009-04-20T06:00:00", CDT),
      at("2009-04-20T09:00:00", EDT)
    );
    const events = [
      stay("s", "h", "lodging-checkin", "2009-04-08", MCO),
      stay("s", "h", "lodging-checkout", "2009-04-12", MCO),
      leave,
      back,
    ];
    expect(codes(events)).toContain("checkOutAfterDeparture:lodging-checkout-s");
  });

  it("flags two date-only pickups that fall inside each other", () => {
    const events = [
      rental("a", "rental-pickup", MCO, day("2009-04-08")),
      rental("a", "rental-return", MCO, day("2009-04-12")),
      rental("b", "rental-pickup", MIA, day("2009-04-10")),
      rental("b", "rental-return", MIA, day("2009-04-14")),
    ];
    expect(codes(events)).toEqual(["rentalsOverlap:rental-pickup-b"]);
  });
});

describe("timeline plausibility — false results (forgejo#426, round 2)", () => {
  const LIS = { iata: "LIS", lat: 38.77, lon: -9.13 };
  const lisbon = (local: string) => at(local, { zone: "Europe/Lisbon", offset: "+00:00" });

  it("still warns when the only way back is a late flight on the return day, after the return", () => {
    const out = flight(
      "o",
      MCO,
      ORD,
      at("2009-04-10T08:00:00", EDT),
      at("2009-04-10T09:30:00", CDT)
    );
    const back = flight(
      "b",
      ORD,
      MCO,
      at("2009-04-12T20:00:00", CDT),
      at("2009-04-12T23:30:00", EDT)
    );
    const away = flight(
      "a",
      MCO,
      MIA,
      at("2009-04-12T09:00:00", EDT),
      at("2009-04-12T10:00:00", EDT)
    );
    const ret = rental("r", "rental-return", MCO, at("2009-04-12T12:00:00", EDT));
    expect(codes([out, away, back, ret])).toContain("rentalReturnAfterDeparture:rental-return-r");
  });

  it("does not flag a hotel night in the starting city before the trip", () => {
    const out = flight(
      "o",
      MCO,
      ORD,
      at("2009-04-09T08:00:00", EDT),
      at("2009-04-09T09:30:00", CDT)
    );
    const home = flight(
      "h",
      ORD,
      MCO,
      at("2009-04-12T08:00:00", CDT),
      at("2009-04-12T11:30:00", EDT)
    );
    const events = [out, home, stay("s", "h", "lodging-checkin", "2009-04-08", MCO)];
    expect(codes(events)).toEqual([]);
  });

  it("does not flag a pickup followed by a side trip that returns the same day", () => {
    const land = flight(
      "f",
      ORD,
      MCO,
      at("2009-04-08T06:00:00", CDT),
      at("2009-04-08T09:30:00", EDT)
    );
    const pick = rental("r", "rental-pickup", MCO, at("2009-04-08T10:30:00", EDT));
    const side = flight(
      "s",
      MCO,
      MIA,
      at("2009-04-08T12:00:00", EDT),
      at("2009-04-08T13:00:00", EDT)
    );
    const back = flight(
      "t",
      MIA,
      MCO,
      at("2009-04-08T17:00:00", EDT),
      at("2009-04-08T18:00:00", EDT)
    );
    expect(codes([land, pick, side, back])).toEqual([]);
  });

  it("keeps the pickup warning when the first arrival is after the pickup", () => {
    const land = flight(
      "f",
      LIS,
      MCO,
      lisbon("2009-04-08T06:00:00"),
      at("2009-04-08T09:30:00", EDT)
    );
    const pick = rental("r", "rental-pickup", MCO, at("2009-04-08T08:45:00", EDT));
    const side = flight(
      "s",
      MCO,
      MIA,
      at("2009-04-08T12:00:00", EDT),
      at("2009-04-08T13:00:00", EDT)
    );
    const back = flight(
      "t",
      MIA,
      MCO,
      at("2009-04-08T17:00:00", EDT),
      at("2009-04-08T18:00:00", EDT)
    );
    expect(codes([land, pick, side, back])).toEqual(["rentalPickupBeforeArrival:rental-pickup-r"]);
  });

  it("flags a pickup before the arrival of a second visit to the station's town", () => {
    const first = flight(
      "f",
      ORD,
      MCO,
      at("2009-04-06T06:00:00", CDT),
      at("2009-04-06T09:30:00", EDT)
    );
    const away = flight(
      "a",
      MCO,
      MIA,
      at("2009-04-07T12:00:00", EDT),
      at("2009-04-07T13:00:00", EDT)
    );
    const second = flight(
      "s",
      MIA,
      MCO,
      at("2009-04-08T11:00:00", EDT),
      at("2009-04-08T12:00:00", EDT)
    );
    const pick = rental("r", "rental-pickup", MCO, at("2009-04-08T09:00:00", EDT));
    expect(codes([first, away, second, pick])).toEqual([
      "rentalPickupBeforeArrival:rental-pickup-r",
    ]);
  });
});
