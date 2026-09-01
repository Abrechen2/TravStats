import { calculateDistance } from "../../utils/geo";
import { classifyStay } from "../../shared/lodgingCounting";
import { classifyVisit } from "../../shared/placeCounting";
import { isCountableFlight } from "../../shared/flightCounting";

/**
 * "You were probably here."
 *
 * Matches unticked checklist targets against the travel the user has ALREADY
 * recorded — where they slept, which ports they called at, which airports they
 * landed at, which places they logged — and proposes the ones they were plainly
 * standing next to.
 *
 * ## It proposes. It never ticks.
 *
 * Nothing in this file writes anything. A suggestion is an offer with a reason
 * attached, and the user confirms it. Auto-ticking would inflate "Orte besucht"
 * with places nobody has been to, which is the exact failure
 * `shared/placeCounting.ts` exists to prevent — and it would do it invisibly,
 * because a wrongly-ticked site looks identical to a real one afterwards.
 *
 * ## Evidence is not proof, so it is graded
 *
 * A hotel 2 km from a cathedral is nearly conclusive. An airport 50 km away is
 * barely a hint — you may have changed planes and never left the terminal. The
 * two must not be offered in the same voice, so every suggestion carries the
 * anchor that produced it, the distance, and a confidence the UI can show.
 *
 * A CHANGE OF PLANES is filtered out entirely rather than downgraded: an
 * airport the user both arrived at and left again within a few hours is
 * evidence of a lounge, not of a country.
 */

/** What kind of recorded travel put the user near a target. */
export type SuggestionAnchorKind = "place" | "lodging" | "cruise_port" | "flight" | "photo";

/**
 * How far from a target an anchor may sit and still mean something, per kind.
 *
 * These are travel distances, not error bars. A hotel is booked in the town you
 * came to see; a cruise port is the gate to excursions that run well inland;
 * an airport is routinely an hour from the city it is named after. Each radius
 * is the honest reach of that kind of anchor, which is why they differ by
 * a factor of four rather than sharing one number.
 */
/**
 * How far an anchor may reach to raise a QUESTION.
 *
 * Forgejo #23: a flight anchor reached 60km, which produced 60 open suggestions
 * on a real account, nearly all from one connection through AMS — among them a
 * polder 29km from the gate. Sixty questions bury the handful that were worth
 * asking, and weak ones train people to tick without reading.
 *
 * 60km is defensible for FINDING: Schiphol genuinely is the gateway to half the
 * Netherlands. But a suggestion is not a search result — it is a question the
 * user answers with a tick in their own logbook, and the service already grades
 * a flight anchor as "low": you may have changed planes and never left the
 * terminal. It simply never acted on that grading.
 *
 * So a flight now reaches city scale — "you landed in Amsterdam, were you IN
 * Amsterdam" — while hotels, port calls and logged places keep their reach,
 * because each of those means the user was demonstrably on the ground there.
 */
const RADIUS_KM: Record<SuggestionAnchorKind, number> = {
  place: 15,
  lodging: 30,
  cruise_port: 40,
  flight: 15,
  /**
   * A photograph is the only anchor here that is not a proxy.
   *
   * Every other kind says where the user's TRAVEL was and infers where they
   * stood: a hotel is booked in the town you came to see, an airport is an hour
   * from the city it is named after. A geotagged photo is a GPS fix at the
   * moment the shutter opened — they were there, holding the camera.
   *
   * So this radius is a hand's breadth by comparison, and it should stay that
   * way. Widening it would not add evidence, it would spend the one anchor with
   * real precision on guesses the weaker anchors already make.
   */
  photo: 1,
};

/** Ranking of the kinds. Higher wins when two anchors both reach a target. */
const CONFIDENCE_RANK: Record<SuggestionAnchorKind, number> = {
  // Above a logged place and a hotel, and deliberately: those record a trip,
  // this records a position. When both reach a target, the photo is the better
  // answer to "how do you know".
  photo: 4,
  place: 3,
  lodging: 3,
  cruise_port: 2,
  flight: 1,
};

export type SuggestionConfidence = "high" | "medium" | "low";

const CONFIDENCE: Record<SuggestionAnchorKind, SuggestionConfidence> = {
  photo: "high",
  place: "high",
  lodging: "high",
  cruise_port: "medium",
  flight: "low",
};

/**
 * A connection, in hours. Two movements through one airport inside this window
 * are a change of planes, and the airport is dropped as evidence.
 *
 * Six hours is deliberately generous — a long layover is still a layover, and a
 * false "you have seen Rome" is worse than a missed hint the user can add by
 * hand anyway.
 */
const LAYOVER_HOURS = 6;

export interface SuggestionAnchor {
  kind: SuggestionAnchorKind;
  /** What to show the user: "Hotel Adlon", "Civitavecchia", "FCO". */
  label: string;
  lat: number;
  lon: number;
  /** When they were there. Null for an anchor that carries no date. */
  at: Date | null;
}

export interface SuggestionTarget {
  itemId: string;
  name: string;
  /** ISO country code, if the catalogue has one. Travels out with the hit. */
  country?: string | null;
  lat: number;
  lon: number;
}

export interface VisitSuggestion {
  itemId: string;
  /**
   * What the target is called, and where.
   *
   * Forgejo #22: a suggestion used to carry only an id, so a client drawing
   * "Warst du hier? Kölner Dom" had to fetch the whole catalogue — 1,248 rows
   * with descriptions — to resolve three names. `suggestVisits` already
   * receives both fields on its target and was dropping them on the way out.
   */
  name: string;
  country: string | null;
  confidence: SuggestionConfidence;
  /** Great-circle km between the target and the anchor, rounded. */
  distanceKm: number;
  anchorKind: SuggestionAnchorKind;
  anchorLabel: string;
  /** ISO date of the anchor, or null — what a tick would record as the visit. */
  visitedAt: string | null;
}

// ---------------------------------------------------------------- anchors

interface LodgingAnchorInput {
  name: string;
  lat: number | null;
  lon: number | null;
  checkIn: Date | null;
  checkOut: Date | null;
  status: string;
}

interface CruiseStopAnchorInput {
  portName: string | null;
  lat: number | null;
  lon: number | null;
  at: Date | null;
}

interface FlightAnchorInput {
  depIata: string | null;
  arrIata: string | null;
  depLat: number | null;
  depLon: number | null;
  arrLat: number | null;
  arrLon: number | null;
  departureTime: Date | null;
  arrivalTime: Date | null;
  status: string;
}

interface PlaceAnchorInput {
  name: string;
  lat: number;
  lon: number;
  visited: boolean;
  visits: readonly { visitedAt: Date | null }[];
}

/**
 * A geotagged photograph from a trip.
 *
 * `lat`/`lon` are populated on Immich import; a photo without them carries no
 * position and is dropped. `takenAt` may be absent — a photo with coordinates
 * and no date is still evidence of place, so it becomes a dated-less anchor
 * rather than being thrown away, exactly as the other kinds allow.
 */
interface PhotoAnchorInput {
  lat: number | null;
  lon: number | null;
  takenAt: Date | null;
  /** The trip the photo belongs to — what the user is shown as the reason. */
  tripName: string | null;
}

export interface AnchorSources {
  lodgings: readonly LodgingAnchorInput[];
  cruiseStops: readonly CruiseStopAnchorInput[];
  flights: readonly FlightAnchorInput[];
  places: readonly PlaceAnchorInput[];
  /** Optional so every existing caller keeps compiling and behaving identically. */
  photos?: readonly PhotoAnchorInput[];
}

const usable = (lat: number | null, lon: number | null): boolean =>
  lat !== null && lon !== null && Number.isFinite(lat) && Number.isFinite(lon);

/**
 * Turn the user's own rows into positioned, dated anchors.
 *
 * Only travel that HAPPENED becomes an anchor. A booked-but-not-yet hotel and a
 * flight next month say nothing about where somebody has been, and letting them
 * through would produce suggestions for trips that have not occurred — the same
 * future-date rule every count in this domain already obeys.
 */
export function buildAnchors(sources: AnchorSources): SuggestionAnchor[] {
  const anchors: SuggestionAnchor[] = [];

  for (const stay of sources.lodgings) {
    if (!usable(stay.lat, stay.lon)) continue;
    if (classifyStay(stay) !== "visited") continue;
    anchors.push({
      kind: "lodging",
      label: stay.name,
      lat: stay.lat as number,
      lon: stay.lon as number,
      at: stay.checkIn,
    });
  }

  for (const stop of sources.cruiseStops) {
    if (!usable(stop.lat, stop.lon)) continue;
    anchors.push({
      kind: "cruise_port",
      label: stop.portName ?? "",
      lat: stop.lat as number,
      lon: stop.lon as number,
      at: stop.at,
    });
  }

  for (const place of sources.places) {
    if (!place.visited) continue;
    if (!usable(place.lat, place.lon)) continue;
    const lastVisit = place.visits.reduce<Date | null>((latest, v) => {
      if (!v.visitedAt || classifyVisit(v) !== "visited") return latest;
      return latest === null || v.visitedAt > latest ? v.visitedAt : latest;
    }, null);
    anchors.push({
      kind: "place",
      label: place.name,
      lat: place.lat,
      lon: place.lon,
      at: lastVisit,
    });
  }

  for (const photo of sources.photos ?? []) {
    if (!usable(photo.lat, photo.lon)) continue;
    anchors.push({
      kind: "photo",
      // The trip is what the user recognises; a bare coordinate would tell them
      // nothing about why they are being asked. No trip name is possible in
      // principle, so the label degrades to empty rather than inventing one.
      label: photo.tripName ?? "",
      lat: photo.lat as number,
      lon: photo.lon as number,
      at: photo.takenAt,
    });
  }

  anchors.push(...buildFlightAnchors(sources.flights));
  return anchors;
}

/**
 * Airports the user actually stepped out of.
 *
 * Both ends of every flown leg are candidates, and then every airport whose
 * arrival and next departure sit inside the layover window is removed. That is
 * what stops "changed planes in Doha" from suggesting the whole of Qatar.
 */
function buildFlightAnchors(flights: readonly FlightAnchorInput[]): SuggestionAnchor[] {
  interface Movement {
    code: string;
    lat: number;
    lon: number;
    at: Date | null;
    direction: "in" | "out";
  }

  const movements: Movement[] = [];
  for (const flight of flights) {
    if (!isCountableFlight(flight)) continue;
    if (usable(flight.depLat, flight.depLon)) {
      movements.push({
        code: flight.depIata ?? "",
        lat: flight.depLat as number,
        lon: flight.depLon as number,
        at: flight.departureTime,
        direction: "out",
      });
    }
    if (usable(flight.arrLat, flight.arrLon)) {
      movements.push({
        code: flight.arrIata ?? "",
        lat: flight.arrLat as number,
        lon: flight.arrLon as number,
        at: flight.arrivalTime,
        direction: "in",
      });
    }
  }

  // Group by airport POSITION rather than by code: an airport with no IATA code
  // would otherwise all collapse into one bucket keyed on "".
  const byAirport = new Map<string, Movement[]>();
  for (const m of movements) {
    const key = `${m.lat.toFixed(3)},${m.lon.toFixed(3)}`;
    const list = byAirport.get(key);
    if (list) list.push(m);
    else byAirport.set(key, [m]);
  }

  const windowMs = LAYOVER_HOURS * 60 * 60 * 1000;
  const out: SuggestionAnchor[] = [];

  for (const group of byAirport.values()) {
    const dated = group.filter((m) => m.at !== null).sort((a, b) => a.at!.getTime() - b.at!.getTime());

    // A layover is an arrival followed closely by a departure, and BOTH sides
    // of that pair have to go. Dropping only the arrival leaves the departure
    // behind as an anchor, and the airport survives anyway — which is the bug
    // this loop was written wrong for the first time.
    const consumed = new Set<number>();
    for (let i = 0; i < dated.length - 1; i += 1) {
      const arrival = dated[i];
      const departure = dated[i + 1];
      if (
        arrival.direction === "in" &&
        departure.direction === "out" &&
        departure.at!.getTime() - arrival.at!.getTime() <= windowMs
      ) {
        consumed.add(i);
        consumed.add(i + 1);
        i += 1;
      }
    }

    // Undated movements cannot be paired at all, so they survive as weak
    // evidence rather than being thrown away.
    const kept: Movement[] = group.filter((m) => m.at === null);
    for (const [i, m] of dated.entries()) {
      if (!consumed.has(i)) kept.push(m);
    }

    // One anchor per airport is enough — the closest target match is the same
    // whichever movement produced it, and the earliest date reads better than
    // an arbitrary one.
    const best = kept.sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0))[0];
    if (best) {
      out.push({
        kind: "flight",
        label: best.code,
        lat: best.lat,
        lon: best.lon,
        at: best.at,
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------- matching

/** Degrees of latitude per grid cell. One degree ≈ 111 km, comfortably past
 *  the widest radius, so a target can only match anchors in its own cell or a
 *  neighbouring one. */
const CELL_DEG = 1;

const cellKey = (lat: number, lon: number): string =>
  `${Math.floor(lat / CELL_DEG)}:${Math.floor(lon / CELL_DEG)}`;

/**
 * Best suggestion per target, or nothing.
 *
 * Bucketed into a coarse grid first: 1250 world-heritage targets against a few
 * hundred anchors is a quarter-million distance calls done naively, on a
 * request the user waits for. The grid turns it into a handful per target.
 *
 * Longitude is NOT wrapped at the antimeridian — a target at 179.9°E will miss
 * an anchor at 179.9°W. That is one cell of the globe, in open ocean, and
 * pretending otherwise would cost more complexity than it buys.
 */
export function suggestVisits(
  targets: readonly SuggestionTarget[],
  anchors: readonly SuggestionAnchor[]
): VisitSuggestion[] {
  if (targets.length === 0 || anchors.length === 0) return [];

  const grid = new Map<string, SuggestionAnchor[]>();
  for (const anchor of anchors) {
    const key = cellKey(anchor.lat, anchor.lon);
    const cell = grid.get(key);
    if (cell) cell.push(anchor);
    else grid.set(key, [anchor]);
  }

  const suggestions: VisitSuggestion[] = [];

  for (const target of targets) {
    const latCell = Math.floor(target.lat / CELL_DEG);
    const lonCell = Math.floor(target.lon / CELL_DEG);

    let best: { anchor: SuggestionAnchor; distance: number } | null = null;
    for (let dLat = -1; dLat <= 1; dLat += 1) {
      for (let dLon = -1; dLon <= 1; dLon += 1) {
        const cell = grid.get(`${latCell + dLat}:${lonCell + dLon}`);
        if (!cell) continue;
        for (const anchor of cell) {
          const distance = calculateDistance(target.lat, target.lon, anchor.lat, anchor.lon);
          if (distance > RADIUS_KM[anchor.kind]) continue;
          if (best === null) {
            best = { anchor, distance };
            continue;
          }
          // A stronger KIND wins outright; within a kind, the closer one does.
          // Distance alone would let an airport 3 km away outrank the hotel the
          // user actually slept in 8 km away, which reads as the weaker claim.
          const rank = CONFIDENCE_RANK[anchor.kind] - CONFIDENCE_RANK[best.anchor.kind];
          if (rank > 0 || (rank === 0 && distance < best.distance)) {
            best = { anchor, distance };
          }
        }
      }
    }

    if (best === null) continue;
    suggestions.push({
      itemId: target.itemId,
      name: target.name,
      country: target.country ?? null,
      confidence: CONFIDENCE[best.anchor.kind],
      distanceKm: Math.round(best.distance),
      anchorKind: best.anchor.kind,
      anchorLabel: best.anchor.label,
      visitedAt: best.anchor.at ? best.anchor.at.toISOString() : null,
    });
  }

  const order: Record<SuggestionConfidence, number> = { high: 0, medium: 1, low: 2 };
  return suggestions.sort(
    (a, b) => order[a.confidence] - order[b.confidence] || a.distanceKm - b.distanceKm
  );
}
