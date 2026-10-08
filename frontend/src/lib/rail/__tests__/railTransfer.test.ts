import { describe, expect, it } from "vitest";
import type { TimePrecision, TimeValue } from "../../../shared/time";
import {
  normalizeStationName,
  railTransfer,
  railTransfers,
  sameStation,
  type RailTransferLeg,
} from "../railTransfer";

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
    ).toEqual({ kind: "transfer", minutes: 25, stationChange: false, shortHint: false });
  });

  it("short: under ten minutes carries the hint; ten minutes does not", () => {
    const nine = railTransfer(
      frankfurtFulda,
      fuldaBerlin("2026-09-26T05:19:00Z", "2026-09-26T07:19:00")
    );
    expect(nine).toEqual({ kind: "transfer", minutes: 9, stationChange: false, shortHint: true });
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
    ).toEqual({ kind: "conflict", minutes: -10, stationChange: false });
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
    ).toEqual({ kind: "unknown", stationChange: false });
  });

  it("day-only: a departure known only by its day is unknown too", () => {
    const next = leg(
      "Fulda",
      "Berlin Hbf",
      at("2026-09-25T22:00:00Z", "2026-09-26T00:00:00", BERLIN, "day"),
      null
    );
    expect(railTransfer(frankfurtFulda, next)).toEqual({ kind: "unknown", stationChange: false });
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
      stationChange: false,
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
      stationChange: true,
      shortHint: false,
    });
  });

  it("station change: by catalogue id when both ends have one, whatever the names say", () => {
    const a = leg("A", "Köln Hbf", null, at("2026-09-26T05:00:00Z", "", BERLIN), { arr: 1 });
    const b = leg("Köln Hbf", "B", at("2026-09-26T05:20:00Z", "", BERLIN), null, { dep: 2 });
    expect(railTransfer(a, b)).toMatchObject({ stationChange: true });
    const c = leg("Koeln Hauptbahnhof", "B", at("2026-09-26T05:20:00Z", "", BERLIN), null, {
      dep: 1,
    });
    expect(railTransfer(a, c)).toMatchObject({ stationChange: false });
  });

  it("station change is still said when the wait is unknown", () => {
    const a = leg("A", "Paris Est", null, null);
    const b = leg("Paris Nord", "B", at("2026-09-26T05:20:00Z", "", "Europe/Paris"), null);
    expect(railTransfer(a, b)).toEqual({ kind: "unknown", stationChange: true });
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
      stationChange: false,
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
      stationChange: false,
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

describe("station identity", () => {
  it("folds case, accents and punctuation", () => {
    expect(normalizeStationName("  Köln  Hbf. ")).toBe("koln hbf");
    expect(sameStation({ id: null, name: "Köln Hbf" }, { id: 4, name: "koln hbf" })).toBe(true);
    expect(sameStation({ id: null, name: "" }, { id: null, name: "" })).toBe(false);
  });
});
