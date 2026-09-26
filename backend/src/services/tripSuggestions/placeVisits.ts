import { haversineKm } from "../../shared/geo/haversine";
import { PLACE_VISIT_NEAR_KM } from "../../shared/tripSuggestionRules";
import type { LinkableDomain, PlaceContext, PresenceEntry, TripSuggestion } from "./types";

/**
 * "An diesem Tag warst du hier": an own place the user slept, docked or
 * changed trains beside, on days it has no visit.
 *
 * The same stance as `places/visitSuggestions.ts` — it proposes, it never
 * ticks, and only travel that HAPPENED is evidence: a booked hotel next month
 * says nothing about where anybody has been. It differs in what it matches:
 * that file offers checklist TARGETS within a town's reach, this one the
 * user's OWN places within walking distance (`PLACE_VISIT_NEAR_KM`).
 *
 * One open question per PLACE, about the most recent stay, port call or ride
 * beside it without a visit — not one per day, and not one per stay: a hotel
 * the user returns to every year beside a café they logged once would
 * otherwise ask eight times at once (measured on a synthetic 2000-entry
 * account: 3,680 questions for 500 places). Answering it — yes or no — settles
 * that place up to that day; a later stay beside it asks again.
 */

/** The domains whose rows put the user on the ground at a known spot. */
const ANCHOR_DOMAINS: ReadonlySet<string> = new Set(["lodging", "cruise", "rail"]);

/** Grid cell in degrees — a few times the radius, so the neighbourhood stays small. */
const CELL_DEG = 0.05;
const KM_PER_LAT_DEG = 111.32;

const cellKey = (latCell: number, lonCell: number): string => `${latCell}:${lonCell}`;

interface AnchorPoint {
  entry: PresenceEntry;
  lat: number;
  lon: number;
  day: string;
}

export function placeVisitProposals(
  entries: readonly PresenceEntry[],
  places: readonly PlaceContext[],
  answered: readonly { kind: string; targetId: string | null; memberKeys: readonly string[] }[] = []
): TripSuggestion[] {
  const dayOf = new Map(entries.map((e) => [e.key, e.startDay]));
  // Per place, the latest anchor day the user already answered about.
  const settledUntil = new Map<string, string>();
  for (const a of answered) {
    if (a.kind !== "place_visit" || a.targetId === null) continue;
    for (const key of a.memberKeys) {
      const day = dayOf.get(key);
      const seen = settledUntil.get(a.targetId);
      if (day !== undefined && (seen === undefined || day > seen))
        settledUntil.set(a.targetId, day);
    }
  }

  const grid = new Map<string, AnchorPoint[]>();
  for (const entry of entries) {
    if (entry.state !== "happened" || !ANCHOR_DOMAINS.has(entry.domain)) continue;
    for (const point of entry.points) {
      const key = cellKey(Math.floor(point.lat / CELL_DEG), Math.floor(point.lon / CELL_DEG));
      grid.set(key, [...(grid.get(key) ?? []), { entry, ...point }]);
    }
  }
  if (grid.size === 0) return [];

  const out: TripSuggestion[] = [];
  for (const place of places) {
    const latCell = Math.floor(place.lat / CELL_DEG);
    const lonCell = Math.floor(place.lon / CELL_DEG);
    const kmPerLonCell = KM_PER_LAT_DEG * Math.cos((place.lat * Math.PI) / 180) * CELL_DEG;
    // Near a pole a cell is metres wide; the scan widens instead of dividing by ~zero.
    const lonSpan = kmPerLonCell > 0.01 ? Math.ceil(PLACE_VISIT_NEAR_KM / kmPerLonCell) : 360;

    const best = new Map<string, { anchor: AnchorPoint; km: number }>();
    for (let dLat = -1; dLat <= 1; dLat += 1) {
      for (let dLon = -lonSpan; dLon <= lonSpan; dLon += 1) {
        for (const anchor of grid.get(cellKey(latCell + dLat, lonCell + dLon)) ?? []) {
          const km = haversineKm(place, anchor);
          if (km > PLACE_VISIT_NEAR_KM) continue;
          const seen = best.get(anchor.entry.key);
          if (!seen || km < seen.km) best.set(anchor.entry.key, { anchor, km });
        }
      }
    }

    const settled = settledUntil.get(place.id);
    const open = [...best.values()]
      .filter(({ anchor: { entry } }) => {
        if (settled !== undefined && entry.startDay <= settled) return false;
        return !place.visitDays.some((d) => d >= entry.startDay && d <= entry.endDay);
      })
      .sort((a, b) => b.anchor.day.localeCompare(a.anchor.day));
    const latest = open[0];
    if (latest) {
      const { anchor, km } = latest;
      const { entry } = anchor;
      out.push({
        id: `place_visit:${place.id}:${entry.key}`,
        kind: "place_visit",
        startDay: anchor.day,
        endDay: anchor.day,
        nights: null,
        planned: false,
        destination: place.name,
        signals: [],
        zoneUnknown: entry.zoneUnknown ? 1 : 0,
        members: [],
        place: { id: place.id, name: place.name },
        anchor: {
          key: entry.key,
          domain: entry.domain as LinkableDomain,
          label: entry.label,
          tripId: entry.tripId,
        },
        distanceM: Math.round(km * 1000),
      });
    }
  }
  return out;
}
