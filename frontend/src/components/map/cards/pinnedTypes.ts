// What a map card is asked to describe.
//
// The owner ruled on 2026-09-20, with the globe's click card and the flat
// map's five ad-hoc tooltips side by side, that the globe card is the one to
// keep — "Globus soll überall genutzt werden". That makes the card map chrome,
// not globe chrome, so the payload it reads has to be the intersection both
// renderers can supply rather than the globe's layer datum.
//
// Every shape here is a SUBSET of the globe's own `globeLayerTypes.ts` datums
// (`ArcDatum`, `PointDatum`, `CruisePathDatum`), which is what lets `GlobePinned`
// stay assignable to `MapPinned` with no cast and no change on the globe side.
// Widening a field here is therefore not free: it has to stay something the
// globe layer datum already carries.

/** One end of a route — whatever identity the renderer could resolve. */
export interface CardEndpoint {
  iata?: string;
  icao?: string;
  name?: string;
  city?: string | null;
  country?: string | null;
}

/** A route: the airport PAIR, not one flight. `flightIds` is every flight on it. */
export interface RouteCardDatum {
  departure: CardEndpoint;
  arrival: CardEndpoint;
  flightIds: string[];
  count: number;
  /** The arc's resolved colour, from the flight colour store. */
  color: [number, number, number];
}

/** An airport or a port marker. */
export interface MarkerCardDatum {
  iata: string;
  name: string;
  icao?: string;
  city?: string | null;
  country?: string | null;
  /** Visits / flights touching this marker. */
  size: number;
  lastVisit?: string;
}

export interface CruiseCardDatum {
  cruiseId: string;
  cruiseLabel: string;
}

/**
 * A selection that is NOT one airport pair — the flat map's trip/journey
 * grouping. It has no single route to head the card with, so the card counts
 * the flights instead and lists them.
 */
export interface TripCardDatum {
  flightIds: string[];
  color: [number, number, number];
}

/**
 * A Sonder-Flug. Self-describing on purpose: a sightseeing loop or an eclipse
 * chase has no meaningful `dep → arr` (both ends are the same airport, or the
 * interesting coordinate is the event), so the renderer resolves the label,
 * icon and colour from `specialTypeMeta` and the card only prints them.
 */
export interface SpecialFlightCardDatum {
  flightId: string;
  /**
   * The raw `SpecialType` key, NOT a localised label — same reason
   * `PlaceCardDatum.category` is raw: a finished string would put `t` in the
   * caller's effect dependency list, and `t` is a fresh function on every
   * render.
   */
  specialType: string;
  icon: string;
  routeLabel: string;
  color: [number, number, number];
  aircraft?: string | null;
  eventLabel?: string | null;
  departureTime?: string | null;
}

/**
 * A lodging. Self-describing for the same reason the Sonder-Flug datum is:
 * "which stay" is a question with a rule behind it (`shared/lodgingTiming.ts`
 * owns nights, and a stay can be dated to the day, the month, the year or not
 * at all), and the card must not answer it a second, different way.
 */
export interface LodgingCardDatum {
  lodgingId: string;
  name: string;
  city?: string | null;
  /** ISO 3166-1 alpha-2, already resolved — `Lodging.country` is free text. */
  country?: string | null;
  checkIn?: string | null;
  checkOut?: string | null;
  /**
   * `null` rather than 0 when nothing in the record says — a same-day stay and
   * an unknown span are both 0, and only one of them is a fact
   * (`shared/lodgingTiming.ts`'s `nightsKnown`).
   */
  nights?: number | null;
  /** Already formatted with its currency; the card does no money maths. */
  price?: string | null;
}

/** A place (POI). */
export interface PlaceCardDatum {
  placeId: string;
  name: string;
  /**
   * The raw `PlaceCategory` key, NOT a localised label. The card translates
   * it — handing it a finished string would put `t` in the caller's effect
   * dependency list, and `t` is a fresh function on every render, which is an
   * effect that sets state on every render (it took the test runner out of
   * memory before this was a key).
   */
  category?: string | null;
  city?: string | null;
  country?: string | null;
  /** Visits that have actually happened. */
  visitCount?: number | null;
  lastVisit?: string | null;
  /** Logbook (`true`) or wishlist (`false`) — a wishlist entry counts nothing. */
  visited?: boolean;
}

/**
 * `anchorLngLat` is where the card's tail points:
 * - airport/port: the marker's own [lng, lat]
 * - arc/cruise: the clicked coordinate, so the card attaches where the user
 *   actually tapped the line rather than to an aggregated midpoint
 */
export type MapPinned =
  | { kind: "arc"; data: RouteCardDatum; anchorLngLat: [number, number] }
  | { kind: "airport"; data: MarkerCardDatum; anchorLngLat: [number, number] }
  | { kind: "port"; data: MarkerCardDatum; anchorLngLat: [number, number] }
  | { kind: "cruise"; data: CruiseCardDatum; anchorLngLat: [number, number] }
  | { kind: "trip"; data: TripCardDatum; anchorLngLat: [number, number] }
  | { kind: "specialFlight"; data: SpecialFlightCardDatum; anchorLngLat: [number, number] }
  | { kind: "lodging"; data: LodgingCardDatum; anchorLngLat: [number, number] }
  | { kind: "place"; data: PlaceCardDatum; anchorLngLat: [number, number] };

/**
 * What the hover tooltip draws: pre-rendered HTML plus the screen point it
 * sits beside. HTML rather than a React tree because hover fires at 60–120 Hz
 * — see `HoverTooltip.tsx` for why that matters.
 */
export interface HoverTooltipState {
  html: string;
  x: number;
  y: number;
}
