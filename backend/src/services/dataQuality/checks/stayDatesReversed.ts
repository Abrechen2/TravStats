import type { DataQualityFinding } from "../types";

/**
 * A stay whose check-out precedes its check-in — the record against itself.
 *
 * The one check here with no third party in it. Nothing external is being
 * doubted: the row states two dates and they cannot both be true, so this is
 * the least arguable finding of the three and still a question rather than a
 * verdict. The likely cause is a transposition (a booking read as 03.09 → 09.03
 * in the other order), and only the user knows which way round it should be —
 * so the row is left exactly as written.
 *
 * Every downstream figure already survives this without help: night counting
 * derives from the dates, so a reversed pair yields a negative or absent span
 * rather than a wrong total. This does not correct anything. It asks.
 *
 * ## Why the flag sits on the LODGING and not on the stay
 *
 * The subject the user can act on is the house — that is the page with the stay
 * editor on it. A lodging with two reversed stays is one question ("these dates
 * disagree"), not two, and `details.stays` carries every offending pair so
 * fixing one and leaving the other keeps the flag open with an honest, shorter
 * list.
 *
 * Equal dates are NOT flagged: a same-day arrival and departure is a real thing
 * (a day room, a stay that fell through), and `shared/lodgingTiming.ts` already
 * distinguishes it from an unknown span via `nightsKnown`.
 */

export interface StayDates {
  id: string;
  checkIn: Date | null;
  checkOut: Date | null;
}

export interface LodgingWithStays {
  id: string;
  stays: readonly StayDates[];
}

type ReversedStay = StayDates & { checkIn: Date; checkOut: Date };

const isReversed = (stay: StayDates): stay is ReversedStay =>
  stay.checkIn !== null &&
  stay.checkOut !== null &&
  stay.checkOut.getTime() < stay.checkIn.getTime();

export function findReversedStayDates(lodgings: readonly LodgingWithStays[]): DataQualityFinding[] {
  const findings: DataQualityFinding[] = [];

  for (const lodging of lodgings) {
    const reversed = lodging.stays.filter(isReversed);
    if (reversed.length === 0) continue;

    findings.push({
      entityType: "lodging",
      entityId: lodging.id,
      kind: "stay_dates_reversed",
      details: {
        stays: reversed.map((stay) => ({
          stayId: stay.id,
          // ISO strings, not Date objects: `details` is a JSON column, and a
          // Date would come back out of Postgres as a string anyway. Writing
          // the string makes what is stored and what is read the same thing.
          checkIn: stay.checkIn.toISOString(),
          checkOut: stay.checkOut.toISOString(),
        })),
      },
    });
  }

  return findings;
}
