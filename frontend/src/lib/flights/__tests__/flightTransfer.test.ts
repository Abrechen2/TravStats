import { describe, it, expect } from "vitest";
import {
  flightTransfer,
  flightTransfers,
  SEPARATE_JOURNEY_AFTER_MINUTES,
  type TransferSegment,
} from "../flightTransfer";
import type { TimePrecision, TimeValue } from "../../../shared/time";

const AIRPORTS: Record<string, { icao: string; lat: number; lon: number; zone: string }> = {
  MUC: { icao: "EDDM", lat: 48.354, lon: 11.786, zone: "Europe/Berlin" },
  FRA: { icao: "EDDF", lat: 50.033, lon: 8.571, zone: "Europe/Berlin" },
  JFK: { icao: "KJFK", lat: 40.64, lon: -73.779, zone: "America/New_York" },
  LHR: { icao: "EGLL", lat: 51.47, lon: -0.454, zone: "Europe/London" },
  LGW: { icao: "EGKK", lat: 51.148, lon: -0.19, zone: "Europe/London" },
};

/** A wall clock at an airport plus the instant it is, as the server sends it. */
function at(
  local: string,
  utc: string,
  zone: string,
  offset: string,
  precision: TimePrecision = "minute"
): TimeValue {
  return { local, utc, zone, offset, precision };
}

function seg(
  from: string,
  to: string,
  dep: TimeValue | null,
  arr: TimeValue | null
): TransferSegment {
  const a = AIRPORTS[from];
  const b = AIRPORTS[to];
  return {
    depIata: from,
    depIcao: a.icao,
    arrIata: to,
    arrIcao: b.icao,
    depLat: a.lat,
    depLon: a.lon,
    arrLat: b.lat,
    arrLon: b.lon,
    departureTime: dep?.utc ?? "",
    arrivalTime: arr?.utc ?? "",
    times: { departure: dep, arrival: arr },
  } as TransferSegment;
}

const cest = (local: string, utc: string, p: TimePrecision = "minute") =>
  at(local, utc, "Europe/Berlin", "+02:00", p);

const MUC_FRA = seg(
  "MUC",
  "FRA",
  cest("2026-10-12T07:00:00", "2026-10-12T05:00:00Z"),
  cest("2026-10-12T08:05:00", "2026-10-12T06:05:00Z")
);

/** forgejo#218 — the gap between two segments, judged on instants, never on hope. */
describe("flightTransfer", () => {
  it("measures a connection at the same airport", () => {
    const next = seg(
      "FRA",
      "JFK",
      cest("2026-10-12T09:00:00", "2026-10-12T07:00:00Z"),
      at("2026-10-12T11:30:00", "2026-10-12T15:30:00Z", "America/New_York", "-04:00")
    );
    expect(flightTransfer(MUC_FRA, next)).toEqual({
      kind: "transfer",
      minutes: 55,
      airport: { kind: "same" },
    });
  });

  it("reports a next departure before the landing as a conflict, never as a wait of 0", () => {
    const next = seg("FRA", "JFK", cest("2026-10-12T07:55:00", "2026-10-12T05:55:00Z"), null);
    expect(flightTransfer(MUC_FRA, next)).toMatchObject({ kind: "conflict", minutes: -10 });
  });

  it("names a change of airport with the straight-line distance", () => {
    const into = seg(
      "FRA",
      "LHR",
      cest("2026-10-12T09:00:00", "2026-10-12T07:00:00Z"),
      at("2026-10-12T09:45:00", "2026-10-12T08:45:00Z", "Europe/London", "+01:00")
    );
    const out = seg(
      "LGW",
      "JFK",
      at("2026-10-12T14:00:00", "2026-10-12T13:00:00Z", "Europe/London", "+01:00"),
      null
    );
    const verdict = flightTransfer(into, out);
    expect(verdict).toMatchObject({ kind: "transfer", minutes: 255 });
    expect(verdict.kind === "transfer" && verdict.airport).toEqual({
      kind: "change",
      from: "LHR",
      to: "LGW",
      km: 40,
    });
  });

  it("claims nothing about the airport when a code is missing", () => {
    const next = {
      ...seg("FRA", "JFK", cest("2026-10-12T09:00:00", "2026-10-12T07:00:00Z"), null),
    };
    next.depIata = null as unknown as string;
    next.depIcao = null as unknown as string;
    expect(flightTransfer(MUC_FRA, next)).toMatchObject({ airport: { kind: "unconfirmed" } });
  });

  it("keeps a day-only departure unmeasured, never 0", () => {
    const next = seg(
      "FRA",
      "JFK",
      cest("2026-10-12T00:00:00", "2026-10-11T22:00:00Z", "day"),
      null
    );
    expect(flightTransfer(MUC_FRA, next)).toEqual({
      kind: "unknown",
      reason: "time",
      airport: { kind: "same" },
    });
  });

  it("reads a wait over 24 hours as another journey, at the minute", () => {
    const after = (minutes: number) =>
      seg(
        "FRA",
        "JFK",
        {
          ...cest(
            "x",
            new Date(Date.parse("2026-10-12T06:05:00Z") + minutes * 60_000).toISOString()
          ),
          local: "2026-10-13T08:05:00",
        },
        null
      );
    expect(flightTransfer(MUC_FRA, after(SEPARATE_JOURNEY_AFTER_MINUTES))).toMatchObject({
      kind: "transfer",
      minutes: 1440,
    });
    expect(flightTransfer(MUC_FRA, after(SEPARATE_JOURNEY_AFTER_MINUTES + 1))).toEqual({
      kind: "separate",
    });
  });
});

describe("flightTransfers", () => {
  it("reads the return to an airport already passed as another journey", () => {
    const back = seg(
      "FRA",
      "MUC",
      cest("2026-10-12T18:00:00", "2026-10-12T16:00:00Z"),
      cest("2026-10-12T19:00:00", "2026-10-12T17:00:00Z")
    );
    expect(flightTransfers([MUC_FRA, back])).toEqual([{ kind: "separate" }]);
  });

  it("withholds every claim where a day-only segment shares the day", () => {
    const dayOnly = seg(
      "FRA",
      "LHR",
      cest("2026-10-12T00:00:00", "2026-10-11T22:00:00Z", "day"),
      null
    );
    const later = seg(
      "LHR",
      "JFK",
      at("2026-10-12T15:00:00", "2026-10-12T14:00:00Z", "Europe/London", "+01:00"),
      null
    );
    // Stored order: the day-only one sorts first at its midnight.
    expect(flightTransfers([dayOnly, MUC_FRA, later])).toEqual([
      { kind: "unknown", reason: "order" },
      { kind: "unknown", reason: "order" },
    ]);
  });

  it("knows the order once the day-only segment lies on another day", () => {
    const dayBefore = seg(
      "MUC",
      "FRA",
      cest("2026-10-11T00:00:00", "2026-10-10T22:00:00Z", "day"),
      null
    );
    const next = seg("FRA", "JFK", cest("2026-10-12T09:00:00", "2026-10-12T07:00:00Z"), null);
    expect(flightTransfers([dayBefore, next])).toEqual([
      { kind: "unknown", reason: "time", airport: { kind: "same" } },
    ]);
  });

  it("reads day-only segments days apart as separate journeys", () => {
    const out = seg("MUC", "FRA", cest("2026-10-01T00:00:00", "2026-09-30T22:00:00Z", "day"), null);
    const on = seg("FRA", "JFK", cest("2026-10-05T00:00:00", "2026-10-04T22:00:00Z", "day"), null);
    expect(flightTransfers([out, on])).toEqual([{ kind: "separate" }]);
  });

  it("measures a connection across zones on instants", () => {
    const into = seg(
      "JFK",
      "LHR",
      at("2026-10-12T18:00:00", "2026-10-12T22:00:00Z", "America/New_York", "-04:00"),
      at("2026-10-13T06:10:00", "2026-10-13T05:10:00Z", "Europe/London", "+01:00")
    );
    const out = seg(
      "LHR",
      "MUC",
      at("2026-10-13T08:00:00", "2026-10-13T07:00:00Z", "Europe/London", "+01:00"),
      cest("2026-10-13T10:55:00", "2026-10-13T08:55:00Z")
    );
    expect(flightTransfers([into, out])).toEqual([
      { kind: "transfer", minutes: 110, airport: { kind: "same" } },
    ]);
  });
});
