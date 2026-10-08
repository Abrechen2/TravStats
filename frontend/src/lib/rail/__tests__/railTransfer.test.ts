import { describe, expect, it } from "vitest";
import type { TimePrecision, TimeValue } from "../../../shared/time";
import { railTransfer, railTransfers, type RailTransferLeg } from "../railTransfer";

/**
 * forgejo#234 — the truth table of what lies between two legs. Every time is
 * given as the server sends it (`times`, an instant plus its zone and
 * precision), so the cases measure `utc` and never a wall clock.
 */
function at(
  utc: string,
  local: string,
  zone: string,
  precision: TimePrecision = "minute"
): TimeValue {
  return { utc, local, zone, offset: "", precision };
}

/**
 * Real positions for the stations the cases name; any other name gets a spot
 * of its own, far from every other, so only the name and id decide for it.
 */
const POSITIONS: Record<string, { lat: number; lon: number }> = {
  "Frankfurt (Main) Hbf": { lat: 50.1071, lon: 8.6632 },
  Fulda: { lat: 50.5545, lon: 9.6839 },
  "Berlin Hbf": { lat: 52.525, lon: 13.3694 },
  "Paris Est": { lat: 48.8768, lon: 2.3591 },
  "Paris Nord": { lat: 48.8809, lon: 2.3553 },
  "Paris Gare de Lyon": { lat: 48.8443, lon: 2.3743 },
  "Lyon Part-Dieu": { lat: 45.7606, lon: 4.8594 },
  "London St Pancras": { lat: 51.5308, lon: -0.1238 },
  Sheffield: { lat: 53.378, lon: -1.4621 },
  "München Hbf": { lat: 48.1402, lon: 11.5586 },
  "Nürnberg Hbf": { lat: 49.4456, lon: 11.0827 },
};
const assigned = new Map<string, { lat: number; lon: number }>();
function position(name: string): { lat: number; lon: number } {
  const known = POSITIONS[name] ?? assigned.get(name);
  if (known) return known;
  const spot = { lat: -40 + assigned.size * 3, lon: 100 };
  assigned.set(name, spot);
  return spot;
}

function leg(
  from: string,
  to: string,
  departure: TimeValue | null,
  arrival: TimeValue | null,
  ids: { dep?: number | null; arr?: number | null } = {}
): RailTransferLeg {
  return {
    depStationName: from,
    arrStationName: to,
    depStationId: ids.dep ?? null,
    arrStationId: ids.arr ?? null,
    depLat: position(from).lat,
    depLon: position(from).lon,
    arrLat: position(to).lat,
    arrLon: position(to).lon,
    departureTime: departure?.utc ?? "2026-01-01T00:00:00.000Z",
    arrivalTime: arrival?.utc ?? null,
    depTimezone: departure?.zone ?? null,
    arrTimezone: arrival?.zone ?? null,
    times: { departure, arrival },
  };
}

const BERLIN = "Europe/Berlin";
const frankfurtFulda = leg(
  "Frankfurt (Main) Hbf",
  "Fulda",
  at("2026-09-26T04:15:00Z", "2026-09-26T06:15:00", BERLIN),
  at("2026-09-26T05:10:00Z", "2026-09-26T07:10:00", BERLIN)
);
const fuldaBerlin = (departureUtc: string, local: string): RailTransferLeg =>
  leg(
    "Fulda",
    "Berlin Hbf",
    at(departureUtc, local, BERLIN),
    at("2026-09-26T08:05:00Z", "2026-09-26T10:05:00", BERLIN)
  );

describe("railTransfer — the truth table", () => {
  it("normal: a 25-minute change at the same station, no hint", () => {
    expect(
      railTransfer(frankfurtFulda, fuldaBerlin("2026-09-26T05:35:00Z", "2026-09-26T07:35:00"))
    ).toEqual({ kind: "transfer", minutes: 25, station: { kind: "same" }, shortHint: false });
  });

  it("short: under ten minutes carries the hint; ten minutes does not", () => {
    const nine = railTransfer(
      frankfurtFulda,
      fuldaBerlin("2026-09-26T05:19:00Z", "2026-09-26T07:19:00")
    );
    expect(nine).toEqual({
      kind: "transfer",
      minutes: 9,
      station: { kind: "same" },
      shortHint: true,
    });
    const ten = railTransfer(
      frankfurtFulda,
      fuldaBerlin("2026-09-26T05:20:00Z", "2026-09-26T07:20:00")
    );
    expect(ten).toMatchObject({ kind: "transfer", minutes: 10, shortHint: false });
    const zero = railTransfer(
      frankfurtFulda,
      fuldaBerlin("2026-09-26T05:10:00Z", "2026-09-26T07:10:00")
    );
    expect(zero).toMatchObject({ kind: "transfer", minutes: 0, shortHint: true });
  });

  it("negative: the next train leaves before the previous one arrives — a conflict, not 0", () => {
    expect(
      railTransfer(frankfurtFulda, fuldaBerlin("2026-09-26T05:00:00Z", "2026-09-26T07:00:00"))
    ).toEqual({ kind: "conflict", minutes: -10, station: { kind: "same" } });
  });

  it("day-only: an arrival known only by its day is unknown, never 0", () => {
    const dayOnly = leg(
      "Frankfurt (Main) Hbf",
      "Fulda",
      at("2026-09-26T04:15:00Z", "2026-09-26T06:15:00", BERLIN),
      at("2026-09-25T22:00:00Z", "2026-09-26T00:00:00", BERLIN, "day")
    );
    expect(
      railTransfer(dayOnly, fuldaBerlin("2026-09-26T05:35:00Z", "2026-09-26T07:35:00"))
    ).toEqual({ kind: "unknown", reason: "time", station: { kind: "same" } });
  });

  it("day-only: a departure known only by its day is unknown too", () => {
    const next = leg(
      "Fulda",
      "Berlin Hbf",
      at("2026-09-25T22:00:00Z", "2026-09-26T00:00:00", BERLIN, "day"),
      null
    );
    expect(railTransfer(frankfurtFulda, next)).toEqual({
      kind: "unknown",
      reason: "time",
      station: { kind: "same" },
    });
  });

  it("missing: no arrival recorded is unknown", () => {
    const open = leg(
      "Frankfurt (Main) Hbf",
      "Fulda",
      at("2026-09-26T04:15:00Z", "2026-09-26T06:15:00", BERLIN),
      null
    );
    expect(railTransfer(open, fuldaBerlin("2026-09-26T05:35:00Z", "2026-09-26T07:35:00"))).toEqual({
      kind: "unknown",
      reason: "time",
      station: { kind: "same" },
    });
  });

  it("station change: by name when either end has no catalogue id", () => {
    const toParisEst = leg(
      "Frankfurt (Main) Hbf",
      "Paris Est",
      at("2026-09-26T05:00:00Z", "2026-09-26T07:00:00", "Europe/Paris"),
      at("2026-09-26T08:50:00Z", "2026-09-26T10:50:00", "Europe/Paris")
    );
    const fromParisLyon = leg(
      "Paris Gare de Lyon",
      "Lyon Part-Dieu",
      at("2026-09-26T10:00:00Z", "2026-09-26T12:00:00", "Europe/Paris"),
      at("2026-09-26T12:00:00Z", "2026-09-26T14:00:00", "Europe/Paris")
    );
    expect(railTransfer(toParisEst, fromParisLyon)).toEqual({
      kind: "transfer",
      minutes: 70,
      station: { kind: "change", meters: 3781 },
      shortHint: false,
    });
  });

  it("same station: one catalogue row or one name, whatever the other says", () => {
    const toKoeln = leg("A", "Köln Hbf", null, at("2026-09-26T05:00:00Z", "", BERLIN), { arr: 1 });
    const fromOtherRow = leg("Köln Hbf", "B", at("2026-09-26T05:20:00Z", "", BERLIN), null, {
      dep: 2,
    });
    expect(railTransfer(toKoeln, fromOtherRow)).toMatchObject({ station: { kind: "same" } });
    const fromSameRow = leg(
      "Koeln Hauptbahnhof",
      "B",
      at("2026-09-26T05:20:00Z", "", BERLIN),
      null,
      {
        dep: 1,
      }
    );
    expect(railTransfer(toKoeln, fromSameRow)).toMatchObject({ station: { kind: "same" } });
  });

  // Ruling 2026-10-08: the server groups Paris Est and Paris Nord into one
  // ride (within 1 km), but the traveller must walk ~530 m to another
  // station — the transfer line says so, with the straight-line distance.
  it("Paris Est → Paris Nord is a change of station, with its distance", () => {
    const toEst = leg("A", "Paris Est", null, at("2026-09-26T05:00:00Z", "", "Europe/Paris"));
    const fromNord = leg("Paris Nord", "B", at("2026-09-26T05:30:00Z", "", "Europe/Paris"), null);
    expect(railTransfer(toEst, fromNord)).toMatchObject({
      kind: "transfer",
      station: { kind: "change", meters: 534 },
    });
  });

  it("station change is still said when the wait is unknown", () => {
    const a = leg("A", "Paris Est", null, null);
    const b = leg("Paris Gare de Lyon", "B", at("2026-09-26T05:20:00Z", "", "Europe/Paris"), null);
    expect(railTransfer(a, b)).toEqual({
      kind: "unknown",
      reason: "time",
      station: { kind: "change", meters: 3781 },
    });
  });

  it("cross-zone: measured between instants, not wall clocks (Paris 10:00 → London 09:30 is +30)", () => {
    const toLondon = leg(
      "Paris Nord",
      "London St Pancras",
      at("2026-07-01T06:00:00Z", "2026-07-01T08:00:00", "Europe/Paris"),
      // 10:00 at Paris would be 08:00Z; the Eurostar arrives 09:00 London = 08:00Z.
      at("2026-07-01T08:00:00Z", "2026-07-01T09:00:00", "Europe/London")
    );
    const onward = leg(
      "London St Pancras",
      "Sheffield",
      at("2026-07-01T08:30:00Z", "2026-07-01T09:30:00", "Europe/London"),
      null
    );
    expect(railTransfer(toLondon, onward)).toEqual({
      kind: "transfer",
      minutes: 30,
      station: { kind: "same" },
      shortHint: false,
    });
  });

  it("DST fold: 02:40 (first) to 02:10 (second occurrence) is 30 minutes, not −30", () => {
    // 25 Oct 2026, Berlin: 02:40 CEST = 00:40Z; the repeated 02:10 CET = 01:10Z.
    const night = leg(
      "München Hbf",
      "Nürnberg Hbf",
      at("2026-10-24T23:30:00Z", "2026-10-25T01:30:00", BERLIN),
      at("2026-10-25T00:40:00Z", "2026-10-25T02:40:00", BERLIN)
    );
    const next = leg(
      "Nürnberg Hbf",
      "Berlin Hbf",
      at("2026-10-25T01:10:00Z", "2026-10-25T02:10:00", BERLIN),
      null
    );
    expect(railTransfer(night, next)).toEqual({
      kind: "transfer",
      minutes: 30,
      station: { kind: "same" },
      shortHint: false,
    });
  });

  it("past four hours the next leg is another ride, not a transfer", () => {
    const later = fuldaBerlin("2026-09-26T09:11:00Z", "2026-09-26T11:11:00");
    expect(railTransfer(frankfurtFulda, later)).toEqual({ kind: "separate" });
    const justInside = fuldaBerlin("2026-09-26T09:10:00Z", "2026-09-26T11:10:00");
    expect(railTransfer(frankfurtFulda, justInside)).toMatchObject({
      kind: "transfer",
      minutes: 240,
    });
  });
});

describe("railTransfers — a booking's legs in order", () => {
  it("gives one verdict per gap", () => {
    const verdicts = railTransfers([
      frankfurtFulda,
      fuldaBerlin("2026-09-26T05:35:00Z", "2026-09-26T07:35:00"),
    ]);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toMatchObject({ kind: "transfer", minutes: 25 });
    expect(railTransfers([frankfurtFulda])).toEqual([]);
    expect(railTransfers([])).toEqual([]);
  });

  it("reads the way back to a station already passed as another ride, however soon", () => {
    const back = leg(
      "Fulda",
      "Frankfurt (Main) Hbf",
      at("2026-09-26T06:00:00Z", "2026-09-26T08:00:00", BERLIN),
      at("2026-09-26T07:00:00Z", "2026-09-26T09:00:00", BERLIN)
    );
    expect(railTransfers([frankfurtFulda, back])).toEqual([{ kind: "separate" }]);
  });

  it("keeps a conflict visible even on the way back", () => {
    const back = leg(
      "Fulda",
      "Frankfurt (Main) Hbf",
      at("2026-09-26T05:00:00Z", "2026-09-26T07:00:00", BERLIN),
      null
    );
    expect(railTransfers([frankfurtFulda, back])[0]).toMatchObject({ kind: "conflict" });
  });
});

// Review 2026-10-08, important 1: a day-only departure is stored at local
// midnight and sorts first in its day, whether or not it ran first.
describe("railTransfers — legs whose order is not known", () => {
  const ab = leg(
    "A",
    "B",
    at("2026-09-26T04:15:00Z", "2026-09-26T06:15:00", BERLIN),
    at("2026-09-26T05:10:00Z", "2026-09-26T07:10:00", BERLIN)
  );
  const bcDayOnly = leg(
    "B",
    "C",
    at("2026-09-25T22:00:00Z", "2026-09-26T00:00:00", BERLIN, "day"),
    null
  );
  const cd = leg(
    "C",
    "D",
    at("2026-09-26T07:00:00Z", "2026-09-26T09:00:00", BERLIN),
    at("2026-09-26T08:00:00Z", "2026-09-26T10:00:00", BERLIN)
  );

  it("claims no wait, no change of station and no other ride around a day-only leg of the same day", () => {
    // The server's order: the day-only leg's midnight first.
    expect(railTransfers([bcDayOnly, ab, cd])).toEqual([
      { kind: "unknown", reason: "order" },
      { kind: "unknown", reason: "order" },
    ]);
  });

  it("measures again once the day-only leg ran on another day", () => {
    const xaDayBefore = leg(
      "X",
      "A",
      at("2026-09-24T22:00:00Z", "2026-09-25T00:00:00", BERLIN, "day"),
      null
    );
    const verdicts = railTransfers([xaDayBefore, ab, cd]);
    // A day apart: the order is known, the wait is not (no arrival, a day).
    expect(verdicts[0]).toEqual({ kind: "unknown", reason: "time", station: { kind: "same" } });
    expect(verdicts[1]).toMatchObject({
      kind: "transfer",
      minutes: 110,
      station: { kind: "change" },
    });
  });

  it("reads legs days apart as another ride even when a time is only a day", () => {
    const later = leg(
      "Fulda",
      "Berlin Hbf",
      at("2026-09-28T22:00:00Z", "2026-09-29T00:00:00", BERLIN, "day"),
      null
    );
    expect(railTransfers([frankfurtFulda, later])).toEqual([{ kind: "separate" }]);
    const nextDay = leg(
      "Fulda",
      "Berlin Hbf",
      at("2026-09-26T22:00:00Z", "2026-09-27T00:00:00", BERLIN, "day"),
      null
    );
    // The next day may still be a night-time change: unknown, not "another ride".
    expect(railTransfers([frankfurtFulda, nextDay])[0]).toMatchObject({ kind: "unknown" });
  });
});

// Re-review 1: the order is known only where the INSTANTS say so.
describe("railTransfers — order known only by instants (re-review N1, N2)", () => {
  const TOKYO = "Asia/Tokyo";
  it("N1: a day-only next leg with a timed leg of its own day after it claims nothing", () => {
    const bc = leg(
      "B",
      "C",
      at("2026-10-08T06:00:00Z", "2026-10-08T08:00:00", BERLIN),
      at("2026-10-08T07:00:00Z", "2026-10-08T09:00:00", BERLIN)
    );
    const deDayOnly = leg(
      "D",
      "E",
      at("2026-10-08T22:00:00Z", "2026-10-09T00:00:00", BERLIN, "day"),
      null
    );
    const cf = leg("C", "F", at("2026-10-09T08:00:00Z", "2026-10-09T10:00:00", BERLIN), null);
    // The server's order: the day-only leg's midnight before the 10:00 train.
    expect(railTransfers([bc, deDayOnly, cf])).toEqual([
      { kind: "unknown", reason: "order" },
      { kind: "unknown", reason: "order" },
    ]);
  });

  it("N1, the mirror: a day-only previous leg with a timed leg of its own day after it", () => {
    const abDayOnly = leg(
      "A",
      "B",
      at("2026-10-08T22:00:00Z", "2026-10-09T00:00:00", BERLIN, "day"),
      null
    );
    const cd = leg(
      "C",
      "D",
      at("2026-10-09T08:00:00Z", "2026-10-09T10:00:00", BERLIN),
      at("2026-10-09T09:00:00Z", "2026-10-09T11:00:00", BERLIN)
    );
    const be = leg("B", "E", at("2026-10-10T06:00:00Z", "2026-10-10T08:00:00", BERLIN), null);
    expect(railTransfers([abDayOnly, cd, be])).toEqual([
      { kind: "unknown", reason: "order" },
      { kind: "unknown", reason: "order" },
    ]);
  });

  it("a day-only leg alone on its day keeps both neighbours' order known", () => {
    const abDayOnly = leg(
      "A",
      "B",
      at("2026-10-08T22:00:00Z", "2026-10-09T00:00:00", BERLIN, "day"),
      null
    );
    const be = leg("B", "E", at("2026-10-10T06:00:00Z", "2026-10-10T08:00:00", BERLIN), null);
    expect(railTransfers([abDayOnly, be])).toEqual([
      { kind: "unknown", reason: "time", station: { kind: "same" } },
    ]);
  });

  it("N2: a Berlin day and a Tokyo clock inside that day are not ordered", () => {
    // 9 Oct in Berlin is 8 Oct 22:00Z – 9 Oct 22:00Z; 10 Oct 00:30 in Tokyo is 9 Oct 15:30Z.
    const berlinDay = leg(
      "A",
      "B",
      at("2026-10-08T22:00:00Z", "2026-10-09T00:00:00", BERLIN, "day"),
      null
    );
    const tokyo = leg("B", "C", at("2026-10-09T15:30:00Z", "2026-10-10T00:30:00", TOKYO), null);
    expect(railTransfers([berlinDay, tokyo])).toEqual([{ kind: "unknown", reason: "order" }]);
  });

  it("N2, the mirror: a Tokyo day and a Berlin clock inside it are not ordered", () => {
    // 10 Oct in Tokyo is 9 Oct 15:00Z – 10 Oct 15:00Z; 9 Oct 20:00 in Berlin is 9 Oct 18:00Z.
    const tokyoDay = leg(
      "A",
      "B",
      at("2026-10-09T15:00:00Z", "2026-10-10T00:00:00", TOKYO, "day"),
      null
    );
    const berlin = leg("B", "C", at("2026-10-09T18:00:00Z", "2026-10-09T20:00:00", BERLIN), null);
    expect(railTransfers([tokyoDay, berlin])).toEqual([{ kind: "unknown", reason: "order" }]);
  });

  it("N2: a clock after the whole Berlin day is ordered, whatever its own label", () => {
    const berlinDay = leg(
      "A",
      "B",
      at("2026-10-08T22:00:00Z", "2026-10-09T00:00:00", BERLIN, "day"),
      null
    );
    // 10 Oct 08:00 in Tokyo is 9 Oct 23:00Z, after Berlin's 9 Oct ended at 22:00Z.
    const tokyo = leg("B", "C", at("2026-10-09T23:00:00Z", "2026-10-10T08:00:00", TOKYO), null);
    expect(railTransfers([berlinDay, tokyo])[0]).toMatchObject({ kind: "unknown", reason: "time" });
  });

  it("a day-only leg on an autumn clock-change day spans its 25 hours", () => {
    // 25 Oct 2026 in Berlin runs from 24 Oct 22:00Z to 25 Oct 23:00Z.
    const longDay = leg(
      "A",
      "B",
      at("2026-10-24T22:00:00Z", "2026-10-25T00:00:00", BERLIN, "day"),
      null
    );
    const lateSameDay = leg(
      "B",
      "C",
      at("2026-10-25T22:30:00Z", "2026-10-25T23:30:00", BERLIN),
      null
    );
    expect(railTransfers([longDay, lateSameDay])).toEqual([{ kind: "unknown", reason: "order" }]);
  });
});
