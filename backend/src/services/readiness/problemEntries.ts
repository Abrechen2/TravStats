/**
 * The "falsch getrackt" checks (owner, 2026-11-23): each one is a rule over the
 * account's own entries, written ONCE here and read twice — as a count for the
 * check (`problemFacts.ts`) and as the list the readiness page shows under it
 * (`GET /readiness/items/:id/entries`). A count and a list that each had their
 * own query would drift apart the first time one of them was touched.
 *
 * Every count runs on an indexed `user_id` column; the lists are capped.
 */
import { prisma } from "../../db";
import { placeZone } from "../timeMigration/core";
import { findTripCountryMismatches } from "./tripCountryCheck";

export interface ProblemEntry {
  id: string;
  /** What the row is, for the icon and the wording. */
  kind: "flight" | "lodging" | "visit" | "trip" | "stay";
  label: string;
  /** ISO instant or day the entry is dated by, where it has one. */
  date: string | null;
  /** The entry's own page in the web app. */
  href: string;
}

export interface ProblemRule {
  count(userId: string): Promise<number>;
  list(userId: string, limit: number): Promise<ProblemEntry[]>;
}

export const ENTRY_LIST_LIMIT = 100;

const flightLabel = (f: {
  flightNumber: string | null;
  depIata: string | null;
  arrIata: string | null;
}): string => [f.flightNumber, `${f.depIata ?? "?"}–${f.arrIata ?? "?"}`].filter(Boolean).join(" ");

const FLIGHT_SELECT = {
  id: true,
  flightNumber: true,
  depIata: true,
  arrIata: true,
  departureTime: true,
} as const;

/** Flights a time can still be added to: not cancelled, not written down from memory. */
const liveFlight = (userId: string) => ({
  userId,
  status: { not: "cancelled" },
  OR: [{ provenance: null }, { provenance: { not: "remembered" } }],
});

function flightRule(where: (userId: string) => object): ProblemRule {
  return {
    count: (userId) => prisma.flight.count({ where: where(userId) }),
    list: async (userId, limit) => {
      const rows = await prisma.flight.findMany({
        where: where(userId),
        select: FLIGHT_SELECT,
        orderBy: [{ departureTime: { sort: "desc", nulls: "last" } }, { id: "asc" }],
        take: limit,
      });
      return rows.map((f) => ({
        id: f.id,
        kind: "flight" as const,
        label: flightLabel(f),
        date: f.departureTime ? f.departureTime.toISOString() : null,
        href: `/flights/${f.id}`,
      }));
    },
  };
}

/**
 * A departure stored as an exact UTC minute that is really "midnight, time unknown":
 * the local clock in the departure's own zone reads 00:00 to the minute. The UTC
 * hour pre-filter (00, 22, 23 — midnight in the zones around Europe, where the old
 * imports came from) keeps the zone conversion off every other row; a zone name
 * Postgres does not know is skipped rather than failing the whole read.
 */
async function midnightPlaceholderIds(userId: string, limit: number | null): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT f.id FROM flights f
    WHERE f.user_id = ${userId}
      AND f.departure_time IS NOT NULL AND f.dep_timezone IS NOT NULL
      AND f.dep_time_semantics = 'UTC'
      AND coalesce(f.dep_precision, 'minute') = 'minute'
      AND f.status <> 'cancelled'
      AND extract(minute FROM f.departure_time) = 0 AND extract(second FROM f.departure_time) = 0
      AND extract(hour FROM f.departure_time) IN (0, 22, 23)
      AND EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = f.dep_timezone)
      AND ((f.departure_time AT TIME ZONE 'UTC') AT TIME ZONE f.dep_timezone)::time = '00:00'
    ORDER BY f.departure_time DESC, f.id
    LIMIT ${limit ?? 1_000_000}`;
  return rows.map((r) => r.id);
}

/** Places visited twice on one local day: each (place, day) pair is one entry. */
async function duplicateVisitRows(userId: string, limit: number | null) {
  return prisma.$queryRaw<{ id: string; place_id: string; name: string; day: Date }[]>`
    SELECT min(v.id) AS id, v.place_id, min(p.name) AS name, v.visited_at::date AS day
    FROM place_visits v JOIN places p ON p.id = v.place_id
    WHERE v.user_id = ${userId} AND v.visited_at IS NOT NULL
    GROUP BY v.place_id, v.visited_at::date HAVING count(*) > 1
    ORDER BY day DESC, v.place_id
    LIMIT ${limit ?? 1_000_000}`;
}

/** Trips holding two priced bookings for the same amount, or one booking number twice. */
async function doublePricedRows(userId: string, limit: number | null) {
  return prisma.$queryRaw<{ id: string; name: string; start_date: Date | null }[]>`
    SELECT t.id, t.name, t.start_date FROM trips t
    WHERE t.user_id = ${userId} AND EXISTS (
      SELECT 1 FROM bookings a JOIN bookings b ON a.trip_id = b.trip_id AND a.id < b.id
      WHERE a.trip_id = t.id AND a.user_id = ${userId} AND b.user_id = ${userId}
        AND a.price IS NOT NULL AND b.price IS NOT NULL AND a.price > 0
        AND (
          (abs(a.price - b.price) < 0.005 AND coalesce(a.currency, '') = coalesce(b.currency, ''))
          OR (a.pnr IS NOT NULL AND a.pnr <> '' AND upper(a.pnr) = upper(b.pnr))
        )
    )
    ORDER BY t.start_date DESC NULLS LAST, t.id
    LIMIT ${limit ?? 1_000_000}`;
}

// ---- Stored zones that disagree with the place (the re-resolve dry run's resolver)

const ZONE_CACHE_MS = 5 * 60 * 1000;
const zoneCache = new Map<string, { at: number; entries: ProblemEntry[] }>();

/** Test seam. */
export function resetZoneMismatchCache(): void {
  zoneCache.clear();
}

/**
 * Stays and visits whose frozen zone is not the one `placeZone` gives their place
 * today — the rows the admin's re-resolve dry run would list for this account.
 * Resolving runs per row in memory, so the answer is kept a few minutes per account.
 */
async function zoneMismatches(userId: string): Promise<ProblemEntry[]> {
  const hit = zoneCache.get(userId);
  if (hit && Date.now() - hit.at < ZONE_CACHE_MS) return hit.entries;
  const [stays, visits] = await Promise.all([
    prisma.lodgingStay.findMany({
      where: { stayZone: { not: null }, lodging: { userId, lat: { not: null }, lon: { not: null } } },
      select: {
        id: true,
        stayZone: true,
        checkInAt: true,
        lodging: { select: { id: true, name: true, lat: true, lon: true } },
      },
    }),
    prisma.placeVisit.findMany({
      where: { userId, visitedZone: { not: null } },
      select: {
        id: true,
        visitedZone: true,
        visitedAtUtc: true,
        place: { select: { id: true, name: true, lat: true, lon: true } },
      },
    }),
  ]);
  const entries: ProblemEntry[] = [];
  for (const s of stays) {
    const zone = placeZone(s.lodging).zone;
    if (zone && zone !== s.stayZone) {
      entries.push({
        id: s.id,
        kind: "stay",
        label: `${s.lodging.name} (${s.stayZone} → ${zone})`,
        date: s.checkInAt ? s.checkInAt.toISOString() : null,
        href: `/lodging/${s.lodging.id}`,
      });
    }
  }
  for (const v of visits) {
    const zone = placeZone(v.place).zone;
    if (zone && zone !== v.visitedZone) {
      entries.push({
        id: v.id,
        kind: "visit",
        label: `${v.place.name} (${v.visitedZone} → ${zone})`,
        date: v.visitedAtUtc ? v.visitedAtUtc.toISOString() : null,
        href: `/places/${v.place.id}`,
      });
    }
  }
  zoneCache.set(userId, { at: Date.now(), entries });
  return entries;
}

const dayIso = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/** Keyed by the catalogue id of the check that reads it. */
export const PROBLEM_RULES = {
  "user.flightsNoTimes": flightRule((userId) => ({ ...liveFlight(userId), departureTime: null })),
  "user.flightsNoArrival": flightRule((userId) => ({
    ...liveFlight(userId),
    departureTime: { not: null },
    arrivalTime: null,
  })),
  "user.flightsLegacyTime": flightRule((userId) => ({
    userId,
    AND: [
      { OR: [{ depTimeSemantics: "LEGACY_FAKE_UTC" }, { arrTimeSemantics: "LEGACY_FAKE_UTC" }] },
    ],
  })),
  "user.flightsDateOnly": flightRule((userId) => ({
    ...liveFlight(userId),
    AND: [{ OR: [{ depTimeSemantics: "DATE_ONLY" }, { depPrecision: "day" }] }],
  })),
  "user.flightsMidnightPlaceholder": {
    count: async (userId) => (await midnightPlaceholderIds(userId, null)).length,
    list: async (userId, limit) => {
      const ids = await midnightPlaceholderIds(userId, limit);
      return flightRule(() => ({ userId, id: { in: ids } })).list(userId, limit);
    },
  },
  "user.staysNoCoords": {
    count: (userId) =>
      prisma.lodging.count({ where: { userId, OR: [{ lat: null }, { lon: null }] } }),
    list: async (userId, limit) => {
      const rows = await prisma.lodging.findMany({
        where: { userId, OR: [{ lat: null }, { lon: null }] },
        select: { id: true, name: true, city: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: limit,
      });
      return rows.map((l) => ({
        id: l.id,
        kind: "lodging" as const,
        label: l.city ? `${l.name}, ${l.city}` : l.name,
        date: null,
        href: `/lodging/${l.id}`,
      }));
    },
  },
  "user.duplicateVisits": {
    count: async (userId) => (await duplicateVisitRows(userId, null)).length,
    list: async (userId, limit) =>
      (await duplicateVisitRows(userId, limit)).map((r) => ({
        id: r.id,
        kind: "visit" as const,
        label: r.name,
        date: dayIso(r.day),
        href: `/places/${r.place_id}`,
      })),
  },
  "user.tripCountryMismatch": {
    count: async (userId) => (await findTripCountryMismatches(userId)).length,
    list: async (userId, limit) =>
      (await findTripCountryMismatches(userId)).slice(0, limit).map((t) => ({
        id: t.id,
        kind: "trip" as const,
        label: `${t.name} (+${t.missing.join(", ")})`,
        date: dayIso(t.startDate),
        href: `/trips/${t.id}`,
      })),
  },
  "user.packageDoublePriced": {
    count: async (userId) => (await doublePricedRows(userId, null)).length,
    list: async (userId, limit) =>
      (await doublePricedRows(userId, limit)).map((t) => ({
        id: t.id,
        kind: "trip" as const,
        label: t.name,
        date: dayIso(t.start_date),
        href: `/trips/${t.id}`,
      })),
  },
  "user.zoneMismatch": {
    count: async (userId) => (await zoneMismatches(userId)).length,
    list: async (userId, limit) => (await zoneMismatches(userId)).slice(0, limit),
  },
} as const satisfies Record<string, ProblemRule>;

export type ProblemRuleId = keyof typeof PROBLEM_RULES;

export function problemRuleOf(id: string): ProblemRule | null {
  return Object.prototype.hasOwnProperty.call(PROBLEM_RULES, id)
    ? PROBLEM_RULES[id as ProblemRuleId]
    : null;
}
