import { prisma } from "../../db";
import { haversineKm } from "../../shared/geo/haversine";
import type { CompanionUseKind } from "./companionJoins";
import type { TogetherEntry } from "./companionTogether";

/** A shared journey, named so the reader can open the record it came from. */
export interface CompanionJourney {
  /** `YYYY-MM-DD`, on the entry's own clock. */
  day: string;
  kind: CompanionUseKind;
  id: string;
  /** The editable record, or null where the entry has no page of its own. */
  href: string | null;
}

/**
 * The first and last shared journey. A journey is an entry that proves a day;
 * a trip is the umbrella over its flights and rides, so it is named only when
 * none of its days is covered by a shared flight or ride — otherwise a trip and
 * its first flight would tie on that day and the trip would always win, while a
 * shared trip years before any shared flight must still be the first journey. Ties on
 * the day go to the earlier kind in display order, then the smaller id, so the
 * answer does not depend on load order.
 */
export function firstAndLastJourney(
  entries: readonly TogetherEntry[],
  kindOrder: readonly CompanionUseKind[]
): { first: CompanionJourney | null; last: CompanionJourney | null } {
  const dated = entries.filter((e) => e.dayKeys.length > 0);
  const journeyDays = new Set(dated.filter((e) => e.kind !== "trip").flatMap((e) => e.dayKeys));
  const pool = dated.filter((e) => e.kind !== "trip" || !e.dayKeys.some((d) => journeyDays.has(d)));
  const rank = (e: TogetherEntry): number => kindOrder.indexOf(e.kind);
  const tie = (a: TogetherEntry, b: TogetherEntry): number =>
    rank(a) - rank(b) || a.entry.id.localeCompare(b.entry.id);
  const edge = (e: TogetherEntry, which: "first" | "last"): string => {
    const days = [...e.dayKeys].sort();
    return which === "first" ? days[0] : days[days.length - 1];
  };
  const pick = (which: "first" | "last"): CompanionJourney | null => {
    let best: TogetherEntry | null = null;
    for (const e of pool) {
      if (best === null) {
        best = e;
        continue;
      }
      const d = edge(e, which).localeCompare(edge(best, which));
      if ((which === "first" ? d < 0 : d > 0) || (d === 0 && tie(e, best) < 0)) best = e;
    }
    return best === null
      ? null
      : { day: edge(best, which), kind: best.kind, id: best.entry.id, href: best.entry.href };
  };
  return { first: pick("first"), last: pick("last") };
}

/** The columns are NOT NULL, so a flight with no airport coordinates carries 0/0 — unknown, not Null Island. */
function hasEndpoints(f: { depLat: number; depLon: number; arrLat: number; arrLon: number }) {
  return !(f.depLat === 0 && f.depLon === 0) && !(f.arrLat === 0 && f.arrLon === 0);
}

/**
 * Kilometres of the shared flights whose distance is known: the stored route
 * distance first, the great circle between the two airports second (the rule
 * `/stats/records` uses). A flight with neither abstains, and a companion with
 * no measurable flight gets null, never 0.
 */
export async function sharedFlightKm(
  userId: string,
  byCompanion: ReadonlyMap<string, readonly TogetherEntry[]>
): Promise<Map<string, number | null>> {
  const ids = new Set<string>();
  for (const entries of byCompanion.values()) {
    for (const e of entries) if (e.kind === "flight") ids.add(e.entry.id);
  }
  const rows =
    ids.size === 0
      ? []
      : await prisma.flight.findMany({
          where: { userId, id: { in: [...ids] } },
          select: {
            id: true,
            routeDistance: true,
            depLat: true,
            depLon: true,
            arrLat: true,
            arrLon: true,
          },
        });
  const km = new Map<string, number>();
  for (const f of rows) {
    if (typeof f.routeDistance === "number" && f.routeDistance > 0) {
      km.set(f.id, f.routeDistance);
    } else if (hasEndpoints(f)) {
      km.set(f.id, haversineKm({ lat: f.depLat, lon: f.depLon }, { lat: f.arrLat, lon: f.arrLon }));
    }
  }
  const out = new Map<string, number | null>();
  for (const [companionId, entries] of byCompanion) {
    const known = entries.filter((e) => e.kind === "flight" && km.has(e.entry.id));
    out.set(
      companionId,
      known.length === 0 ? null : Math.round(known.reduce((s, e) => s + km.get(e.entry.id)!, 0))
    );
  }
  return out;
}
