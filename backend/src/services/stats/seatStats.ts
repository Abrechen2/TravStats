/**
 * Seat positions, zones and cabin classes.
 *
 * Lifted out of `routes/stats.ts` for forgejo#49 — unchanged, a move rather
 * than a rewrite. `GET /stats/seats` and the composed `GET /stats/page` both
 * answer with this, from the same rows, so the two cannot drift into two
 * definitions of "window seat".
 */

import type { SeatStats } from "../../schemas/statsFlights";
import { seatPositionOf, type SeatPosition } from "./seatPosition";

/** Everything a seat figure is derived from. */
export interface SeatRow {
  seatNumber: string | null;
  seatClass: string | null;
  /** The aircraft type — decides which letters are windows (`seatPosition.ts`). */
  aircraft?: string | null;
}

const SEAT_PATTERN = /^(\d+)([A-Z]+)$/i;

export type { SeatPosition };
export type SeatZone = "front" | "middle" | "back";

/** What one flight's seat says — the ONE reading every seat figure counts. */
export interface SeatFacts {
  /** The seat upper-cased; null without a seat number. */
  seat: string | null;
  /** Null without a seat; `unknown` for a seat the pattern or the cabin layout cannot place. */
  position: SeatPosition | null;
  /** Rows 1–10 front, 11–25 middle, anything else back; null without a row. */
  zone: SeatZone | null;
  row: number | null;
}

export function seatFactsOf(flight: SeatRow): SeatFacts {
  if (!flight.seatNumber) return { seat: null, position: null, zone: null, row: null };
  const seat = flight.seatNumber.toUpperCase();
  const match = SEAT_PATTERN.exec(flight.seatNumber);
  if (!match) return { seat, position: "unknown", zone: null, row: null };
  const row = parseInt(match[1], 10);
  const letters = match[2].toUpperCase();
  const lastLetter = letters[letters.length - 1];
  const zone: SeatZone =
    row >= 1 && row <= 10 ? "front" : row >= 11 && row <= 25 ? "middle" : "back";
  const position = seatPositionOf(lastLetter, flight.aircraft, flight.seatClass);
  return { seat, position, zone, row };
}

export function computeSeatStats(flights: ReadonlyArray<SeatRow>): SeatStats {
  const seatCounts: Record<string, number> = {};
  const positions: Record<SeatPosition, number> = { window: 0, middle: 0, aisle: 0, unknown: 0 };
  const zones: Record<SeatZone, number> = { front: 0, middle: 0, back: 0 };
  let noSeatCount = 0;
  let rowTotal = 0;
  let rowCountWithNumber = 0;
  const seatClassDistribution: Record<string, number> = {};

  for (const flight of flights) {
    if (flight.seatClass) {
      seatClassDistribution[flight.seatClass] = (seatClassDistribution[flight.seatClass] ?? 0) + 1;
    }
    const facts = seatFactsOf(flight);
    if (facts.seat === null || facts.position === null) {
      noSeatCount++;
      continue;
    }
    seatCounts[facts.seat] = (seatCounts[facts.seat] ?? 0) + 1;
    positions[facts.position]++;
    if (facts.row !== null && facts.zone !== null) {
      rowTotal += facts.row;
      rowCountWithNumber++;
      zones[facts.zone]++;
    }
  }

  // Most common seat — the first to reach the highest count.
  let mostCommonSeat: string | null = null;
  let maxSeatCount = 0;
  for (const [seat, count] of Object.entries(seatCounts)) {
    if (count > maxSeatCount) {
      maxSeatCount = count;
      mostCommonSeat = seat;
    }
  }

  return {
    windowCount: positions.window,
    middleCount: positions.middle,
    aisleCount: positions.aisle,
    unknownCount: positions.unknown,
    noSeatCount,
    frontCount: zones.front,
    middleZoneCount: zones.middle,
    backCount: zones.back,
    mostCommonSeat,
    seatClassDistribution,
    avgRowNumber:
      rowCountWithNumber > 0 ? Math.round((rowTotal / rowCountWithNumber) * 10) / 10 : null,
  };
}
