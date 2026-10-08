/**
 * The web's runner for `shared/rail/transferVectors.json` (review 2026-10-08,
 * important 2). The server runs the same file against its grouping rule
 * (`backend/src/shared/__tests__/railTransferVectors.test.ts`), so the web's
 * "Bahnhofswechsel" and "Eigene Fahrt" cannot drift from the rides the server
 * groups. Read from disk, not imported, so it never enters the bundle.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  railTransfer,
  SAME_STATION_KM,
  SEPARATE_RIDE_AFTER_MINUTES,
  sameStation,
  type RailTransferLeg,
} from "../railTransfer";

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

const VECTORS_PATH = resolve(__dirname, "../../../../../shared/rail/transferVectors.json");
const vectors = JSON.parse(readFileSync(VECTORS_PATH, "utf8")) as VectorFile;

function timedLeg(departureUtc: string, arrivalUtc: string): RailTransferLeg {
  const at = (utc: string) => ({
    utc,
    local: "",
    zone: "Europe/Berlin",
    offset: "",
    precision: "minute" as const,
  });
  return {
    depStationName: "Mannheim Hbf",
    arrStationName: "Mannheim Hbf",
    depStationId: 3,
    arrStationId: 3,
    depLat: 49.4794,
    depLon: 8.4697,
    arrLat: 49.4794,
    arrLon: 8.4697,
    departureTime: departureUtc,
    arrivalTime: arrivalUtc,
    depTimezone: "Europe/Berlin",
    arrTimezone: "Europe/Berlin",
    times: { departure: at(departureUtc), arrival: at(arrivalUtc) },
  };
}

describe("shared/rail/transferVectors.json — the web", () => {
  it("names the constants the web uses", () => {
    expect(vectors.sameStationKm).toBe(SAME_STATION_KM);
    expect(vectors.maxTransferMinutes).toBe(SEPARATE_RIDE_AFTER_MINUTES);
  });

  it.each(vectors.sameStation.map((c) => [c.id, c] as const))("sameStation: %s", (_id, c) => {
    expect(sameStation(c.a, c.b)).toBe(c.same);
    expect(sameStation(c.b, c.a)).toBe(c.same);
  });

  it.each(vectors.transferLimit.map((c) => [c.id, c] as const))("transfer limit: %s", (_id, c) => {
    const arrival = Date.parse("2026-09-26T08:00:00Z");
    const departure = new Date(arrival + c.waitMinutes * 60_000).toISOString();
    const previous = timedLeg("2026-09-26T07:00:00.000Z", "2026-09-26T08:00:00.000Z");
    const next = timedLeg(
      departure,
      new Date(arrival + (c.waitMinutes + 60) * 60_000).toISOString()
    );
    expect(railTransfer(previous, next).kind === "transfer").toBe(c.change);
  });
});
