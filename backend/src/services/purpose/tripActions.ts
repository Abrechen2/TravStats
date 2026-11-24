import { prisma } from "../../db";
import { runUnfiltered } from "../provenance/recordedOnly";
import { purposeFromTripCategory, type Purpose } from "../../shared/purpose";

type Writer = {
  updateMany(args: {
    where: Record<string, unknown>;
    data: { purpose: Purpose | null };
  }): Promise<{ count: number }>;
};

/** The Prisma delegates of the eight purpose models. */
const DELEGATES = [
  "flight",
  "lodgingStay",
  "railJourney",
  "busJourney",
  "ferryJourney",
  "rentalBooking",
  "cruise",
  "placeVisit",
  "tripRoute",
] as const;

/**
 * Writes `purpose` onto the entries of a trip (every one, or — `onlyUnknown` — those with none),
 * or, with `tripId` null, onto every entry of every categorised trip. Returns how many changed.
 * Runs with no scope open: a hidden entry is still the user's entry.
 */
async function fill(
  userId: string,
  tripWhere: { tripId: string } | { tripId: { in: string[] } },
  purpose: Purpose,
  onlyUnknown: boolean
): Promise<number> {
  // One transaction: a failure part-way leaves no domain overwritten.
  return runUnfiltered(() =>
    prisma.$transaction(async (tx) => {
      let changed = 0;
      for (const name of DELEGATES) {
        const delegate = (tx as unknown as Record<string, Writer>)[name];
        // Purpose is the member's own view, never a share fact: nothing to propagate.
        const res = await delegate.updateMany({
          where: { userId, ...tripWhere, ...(onlyUnknown ? { purpose: null } : {}) },
          data: { purpose },
        });
        changed += res.count;
      }
      return changed;
    })
  );
}

type Counter = { count(args: { where: Record<string, unknown> }): Promise<number> };

/**
 * What "Zweck auf alle Einträge übertragen" would do, without doing it: the purpose and how many
 * entries it would change (UAT rc.45 — the action asks first, with the count). Null: no trip.
 */
export async function previewTripPurpose(
  userId: string,
  tripId: string,
  chosen: Purpose | undefined
): Promise<{ purpose: Purpose | null; wouldChange: number } | null> {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId },
    select: { category: true },
  });
  if (!trip) return null;
  const purpose = chosen ?? purposeFromTripCategory(trip.category);
  if (!purpose) return { purpose: null, wouldChange: 0 };
  const counts = await runUnfiltered(() =>
    Promise.all(
      DELEGATES.map((name) =>
        (prisma as unknown as Record<string, Counter>)[name].count({
          // `purpose: { not }` skips NULL in SQL, so the unset ones are counted on their own.
          where: { userId, tripId, OR: [{ purpose: null }, { purpose: { not: purpose } }] },
        })
      )
    )
  );
  return { purpose, wouldChange: counts.reduce((sum, n) => sum + n, 0) };
}

/** "Zweck auf alle Einträge übertragen": the trip's category (or a chosen purpose) onto its entries. */
export async function applyTripPurpose(
  userId: string,
  tripId: string,
  chosen: Purpose | undefined
): Promise<{ purpose: Purpose | null; changed: number } | null> {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId },
    select: { category: true },
  });
  if (!trip) return null;
  const purpose = chosen ?? purposeFromTripCategory(trip.category);
  if (!purpose) return { purpose: null, changed: 0 };
  return { purpose, changed: await fill(userId, { tripId }, purpose, false) };
}

/**
 * "Zweck aus der Reise-Kategorie übernehmen": a one-off, user-started pass that fills ONLY the
 * entries without a purpose, inside trips whose category says something.
 */
export async function fillPurposeFromTrips(userId: string): Promise<number> {
  const trips = await prisma.trip.findMany({
    where: { userId, category: { not: null } },
    select: { id: true, category: true },
  });
  const byPurpose = new Map<Purpose, string[]>();
  for (const t of trips) {
    const p = purposeFromTripCategory(t.category);
    if (p) byPurpose.set(p, [...(byPurpose.get(p) ?? []), t.id]);
  }
  let changed = 0;
  for (const [purpose, ids] of byPurpose) {
    changed += await fill(userId, { tripId: { in: ids } }, purpose, true);
  }
  return changed;
}
