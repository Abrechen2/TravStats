import { prisma } from "../../db";
import { runUnfiltered } from "../provenance/recordedOnly";
import type { Purpose } from "../../shared/purpose";
import {
  DEFAULT_KEY_OF_KIND,
  parsePurposeKey,
  purposeKeyFromTripCategory,
} from "../../shared/purposeCatalogue";
import { AppError } from "../../middleware/errorHandler";

type Writer = {
  updateMany(args: {
    where: Record<string, unknown>;
    data: { purpose: string | null };
  }): Promise<{ count: number }>;
};

/** A purpose to apply: its kind and detailed key (a legacy kind stands for its default key). */
export interface ChosenPurpose {
  kind: Purpose;
  key: string | null;
}

/**
 * Reads a purpose value the caller chose (legacy kind, built-in or own custom key). A custom key
 * of another account, or an unknown one, is refused with `PURPOSE_UNKNOWN`.
 */
export async function resolveChosenPurpose(
  userId: string,
  value: string | undefined | null
): Promise<ChosenPurpose | undefined> {
  if (value === undefined || value === null) return undefined;
  const parsed = parsePurposeKey(value);
  if (parsed?.type === "legacy") return { kind: parsed.kind, key: null };
  if (parsed?.type === "builtin") return { kind: parsed.kind, key: parsed.key };
  if (parsed?.type === "custom") {
    const custom = await prisma.customPurpose.findFirst({
      where: { id: parsed.id, userId },
      select: { kind: true },
    });
    if (custom) return { kind: custom.kind as Purpose, key: parsed.key };
  }
  throw new AppError("Unknown purpose", 400, "PURPOSE_UNKNOWN", "purpose");
}

const fromCategory = (category: string | null): ChosenPurpose | undefined => {
  const key = purposeKeyFromTripCategory(category);
  const parsed = parsePurposeKey(key);
  return parsed?.type === "builtin" ? { kind: parsed.kind, key: parsed.key } : undefined;
};

/** What a write stores: the key when there is one (the hook splits it), else the kind. */
const writeValue = (p: ChosenPurpose): string => p.key ?? p.kind;

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
  purpose: ChosenPurpose,
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
          data: { purpose: writeValue(purpose) },
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
  chosen: ChosenPurpose | undefined
): Promise<{ purpose: Purpose | null; purposeKey: string | null; wouldChange: number } | null> {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId },
    select: { category: true },
  });
  if (!trip) return null;
  const purpose = chosen ?? fromCategory(trip.category);
  if (!purpose) return { purpose: null, purposeKey: null, wouldChange: 0 };
  const differs = [
    { purpose: null },
    { purpose: { not: purpose.kind } },
    // A row with no detail already reads as the kind's default key, so it only differs from a
    // detail that is not the default. `{ not }` skips NULL in SQL.
    ...(purpose.key ? [{ purpose: purpose.kind, purposeKey: { not: purpose.key } }] : []),
    ...(purpose.key && purpose.key !== DEFAULT_KEY_OF_KIND[purpose.kind]
      ? [{ purposeKey: null }]
      : []),
  ];
  const counts = await runUnfiltered(() =>
    Promise.all(
      DELEGATES.map((name) =>
        (prisma as unknown as Record<string, Counter>)[name].count({
          // `purpose: { not }` skips NULL in SQL, so the unset ones are counted on their own.
          where: { userId, tripId, OR: differs },
        })
      )
    )
  );
  return {
    purpose: purpose.kind,
    purposeKey: purpose.key,
    wouldChange: counts.reduce((sum, n) => sum + n, 0),
  };
}

/** "Zweck auf alle Einträge übertragen": the trip's category (or a chosen purpose) onto its entries. */
export async function applyTripPurpose(
  userId: string,
  tripId: string,
  chosen: ChosenPurpose | undefined
): Promise<{ purpose: Purpose | null; purposeKey: string | null; changed: number } | null> {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId },
    select: { category: true },
  });
  if (!trip) return null;
  const purpose = chosen ?? fromCategory(trip.category);
  if (!purpose) return { purpose: null, purposeKey: null, changed: 0 };
  return {
    purpose: purpose.kind,
    purposeKey: purpose.key,
    changed: await fill(userId, { tripId }, purpose, false),
  };
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
  const byKey = new Map<string, { purpose: ChosenPurpose; ids: string[] }>();
  for (const t of trips) {
    const p = fromCategory(t.category);
    if (!p?.key) continue;
    const entry = byKey.get(p.key) ?? { purpose: p, ids: [] };
    byKey.set(p.key, { ...entry, ids: [...entry.ids, t.id] });
  }
  let changed = 0;
  for (const { purpose, ids } of byKey.values()) {
    changed += await fill(userId, { tripId: { in: ids } }, purpose, true);
  }
  return changed;
}
