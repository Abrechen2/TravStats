import { dayOf, type PreparedStay } from "./prepare";
import type { RevisitGap, RevisitHouse, Revisits } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Coming back to the same house (forgejo#258 item 2).
 *
 * Years come from any stay that can be filed in one — a stay known only as
 * "summer 2014" still proves 2014. The longest GAP needs two real dates on both
 * sides, because "some time in 2014" to "March 2019" is not a number of days;
 * such a pair is skipped rather than guessed. Overlapping or touching stays at
 * one house are one visit, not a gap of zero.
 */
export function computeRevisits(counted: readonly PreparedStay[]): Revisits {
  const byHouse = new Map<string, PreparedStay[]>();
  for (const p of counted) {
    const list = byHouse.get(p.stay.lodgingId);
    if (list) list.push(p);
    else byHouse.set(p.stay.lodgingId, [p]);
  }

  const houses: RevisitHouse[] = [];
  let longestGap: RevisitGap | null = null;
  let sameHouseYearsMax = 0;
  let returnedHouses = 0;

  for (const [lodgingId, stays] of byHouse) {
    const name = stays[0].stay.lodgingName;
    if (stays.length >= 2) returnedHouses += 1;
    const years = [...new Set(stays.flatMap((p) => (p.year === null ? [] : [p.year])))].sort(
      (a, b) => a - b
    );
    if (years.length > sameHouseYearsMax) sameHouseYearsMax = years.length;
    if (years.length >= 2) houses.push({ lodgingId, name, years, stays: stays.length });

    const dated = stays
      .filter((p) => p.timing.walkable)
      .sort((a, b) => a.stay.checkIn!.getTime() - b.stay.checkIn!.getTime());
    for (let i = 1; i < dated.length; i += 1) {
      const before = dated[i - 1].stay;
      const after = dated[i].stay;
      const days = Math.round((after.checkIn!.getTime() - before.checkOut!.getTime()) / DAY_MS);
      if (days <= 0) continue;
      if (!longestGap || days > longestGap.days) {
        longestGap = {
          lodgingId,
          name,
          days,
          fromStayId: before.id,
          toStayId: after.id,
          from: dayOf(before.checkOut!),
          to: dayOf(after.checkIn!),
        };
      }
    }
  }

  houses.sort((a, b) => b.years.length - a.years.length || b.stays - a.stays);
  return { houses, longestGap, sameHouseYearsMax, returnedHouses };
}
