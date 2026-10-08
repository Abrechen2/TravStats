import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  groupRailLegs,
  MAX_TRANSFER_MINUTES,
  SAME_STATION_KM,
  sameStation,
  type GroupableRailLeg,
} from "../railJourneyGrouping";

/**
 * The server's runner for `shared/rail/transferVectors.json` (forgejo#234
 * review). The web's transfer verdicts mirror this file's station identity
 * and four-hour limit; the web runs the same file
 * (`frontend/src/lib/rail/__tests__/railTransferVectors.test.ts`), so the two
 * rules cannot drift apart unnoticed.
 */
interface StationVector {
  id: number | null;
  name: string;
  lat: number;
  lon: number;
}
interface VectorFile {
  sameStationKm: number;
  maxTransferMinutes: number;
  sameStation: Array<{ id: string; a: StationVector; b: StationVector; same: boolean }>;
  transferLimit: Array<{ id: string; waitMinutes: number; change: boolean }>;
}

const VECTORS_PATH = path.resolve(__dirname, "../../../../shared/rail/transferVectors.json");
const vectors = JSON.parse(readFileSync(VECTORS_PATH, "utf8")) as VectorFile;

const STATION_A = { id: 1, name: "Frankfurt (Main) Hbf", lat: 50.1071, lon: 8.6632 };
const STATION_B = { id: 2, name: "Mannheim Hbf", lat: 49.4794, lon: 8.4697 };
const STATION_C = { id: 3, name: "Basel SBB", lat: 47.5476, lon: 7.5897 };

function leg(
  id: string,
  from: StationVector,
  to: StationVector,
  departure: Date,
  arrival: Date
): GroupableRailLeg {
  return {
    id,
    bookingId: "b1",
    depStationId: from.id,
    depStationName: from.name,
    depLat: from.lat,
    depLon: from.lon,
    arrStationId: to.id,
    arrStationName: to.name,
    arrLat: to.lat,
    arrLon: to.lon,
    departureTime: departure,
    arrivalTime: arrival,
    depPrecision: "minute",
    arrPrecision: "minute",
  };
}

describe("shared/rail/transferVectors.json — the server", () => {
  it("names the constants the server uses", () => {
    expect(vectors.sameStationKm).toBe(SAME_STATION_KM);
    expect(vectors.maxTransferMinutes).toBe(MAX_TRANSFER_MINUTES);
  });

  it.each(vectors.sameStation.map((c) => [c.id, c] as const))("sameStation: %s", (_id, c) => {
    expect(sameStation(c.a, c.b)).toBe(c.same);
    expect(sameStation(c.b, c.a)).toBe(c.same);
  });

  it.each(vectors.transferLimit.map((c) => [c.id, c] as const))("transfer limit: %s", (_id, c) => {
    const arrival = new Date("2026-09-26T08:00:00Z");
    const departure = new Date(arrival.getTime() + c.waitMinutes * 60_000);
    const groups = groupRailLegs([
      leg("l1", STATION_A, STATION_B, new Date("2026-09-26T07:00:00Z"), arrival),
      leg("l2", STATION_B, STATION_C, departure, new Date(departure.getTime() + 3_600_000)),
    ]);
    expect(groups.length === 1).toBe(c.change);
  });
});
