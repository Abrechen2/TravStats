/**
 * Seat positions, zones and cabin classes.
 *
 * Lifted out of `routes/stats.ts` for forgejo#49 — unchanged, a move rather
 * than a rewrite. `GET /stats/seats` and the composed `GET /stats/page` both
 * answer with this, from the same rows, so the two cannot drift into two
 * definitions of "window seat".
 */

import type { SeatStats } from "../../schemas/statsFlights";

/** Everything a seat figure is derived from. */
export interface SeatRow {
  seatNumber: string | null;
  seatClass: string | null;
}

const SEAT_PATTERN = /^(\d+)([A-Z]+)$/i;

export function computeSeatStats(flights: ReadonlyArray<SeatRow>): SeatStats {
  const seatCounts: Record<string, number> = {};

  let windowCount = 0;
  let middleCount = 0;
  let aisleCount = 0;
  let unknownCount = 0;
  let noSeatCount = 0;
  let frontCount = 0;
  let middleZoneCount = 0;
  let backCount = 0;
  let rowTotal = 0;
  let rowCountWithNumber = 0;
  const seatClassDistribution: Record<string, number> = {};

  for (const flight of flights) {
    // Count seat class distribution
    if (flight.seatClass) {
      seatClassDistribution[flight.seatClass] = (seatClassDistribution[flight.seatClass] ?? 0) + 1;
    }

    if (!flight.seatNumber) {
      noSeatCount++;
      continue;
    }

    // Count seat occurrences for mostCommonSeat
    const normalizedSeat = flight.seatNumber.toUpperCase();
    seatCounts[normalizedSeat] = (seatCounts[normalizedSeat] ?? 0) + 1;

    const match = SEAT_PATTERN.exec(flight.seatNumber);
    if (!match) {
      unknownCount++;
      continue;
    }

    const rowNumber = parseInt(match[1], 10);
    const letters = match[2].toUpperCase();
    const lastLetter = letters[letters.length - 1];

    // Row zone classification
    rowTotal += rowNumber;
    rowCountWithNumber++;

    if (rowNumber >= 1 && rowNumber <= 10) {
      frontCount++;
    } else if (rowNumber >= 11 && rowNumber <= 25) {
      middleZoneCount++;
    } else {
      backCount++;
    }

    // Position classification by last letter
    // Covers narrow-body (A-F: 3+3) and wide-body (A-K: 3+4+3) layouts:
    //   Window: A, F, K
    //   Middle: B, E, H, J (wide-body center section)
    //   Aisle:  C, D, G (narrow/wide-body aisle seats)
    if (lastLetter === "A" || lastLetter === "F" || lastLetter === "K") {
      windowCount++;
    } else if (
      lastLetter === "B" ||
      lastLetter === "E" ||
      lastLetter === "H" ||
      lastLetter === "J"
    ) {
      middleCount++;
    } else if (lastLetter === "C" || lastLetter === "D" || lastLetter === "G") {
      aisleCount++;
    } else {
      unknownCount++;
    }
  }

  // Most common seat
  let mostCommonSeat: string | null = null;
  let maxSeatCount = 0;
  for (const [seat, count] of Object.entries(seatCounts)) {
    if (count > maxSeatCount) {
      maxSeatCount = count;
      mostCommonSeat = seat;
    }
  }

  return {
    windowCount,
    middleCount,
    aisleCount,
    unknownCount,
    noSeatCount,
    frontCount,
    middleZoneCount,
    backCount,
    mostCommonSeat,
    seatClassDistribution,
    avgRowNumber:
      rowCountWithNumber > 0 ? Math.round((rowTotal / rowCountWithNumber) * 10) / 10 : null,
  };
}
