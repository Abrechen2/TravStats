// Turning a flat-map selection into the shared card's payload.
//
// The globe builds `MapPinned` straight out of its layer datums, because its
// layers already carry the endpoint identity the card wants. The flat map does
// not: its selection lives in the Zustand stores as `Flight` rows, and the
// endpoint country/city only exist on the enriched `/geo` features. So this
// module is the flat map's half of the owner's 2026-09-20 ruling — the adapter
// that lets both surfaces mount the SAME card.
//
// Pure: no React, no stores, no map instance.

import type { Flight, GeoJSONFeature } from "../../../types";
import type { Cruise } from "../../../types/cruise";
import type { Lodging } from "../../../types/lodging";
import type { Place } from "../../../types/place";
import { SPECIAL_TYPE_META, type SpecialType } from "../../specialFlights/specialTypeMeta";
import { getSpecialTooltipAnchor } from "../../specialFlights/specialTooltipAnchor";
import { calculateDistance } from "../../../lib/geo";
import type { CardEndpoint, MapPinned } from "./pinnedTypes";

type LngLat = [number, number];

function endpointOf(side: GeoJSONFeature["properties"]["departureAirport"]): CardEndpoint {
  return {
    iata: side.iata,
    icao: side.icao,
    name: side.name,
    city: side.city,
    country: side.country,
  };
}

function midpoint(a: LngLat, b: LngLat): LngLat {
  // Wrap the shorter way round, the same rule GlobeView's `flyToArc` uses —
  // without it a trans-Pacific route anchors its card in central Asia.
  const lngDiff = b[0] - a[0];
  const wrapped = lngDiff > 180 ? b[0] - 360 : lngDiff < -180 ? b[0] + 360 : b[0];
  return [(a[0] + wrapped) / 2, (a[1] + b[1]) / 2];
}

function coordsOf(f: GeoJSONFeature): { from: LngLat; to: LngLat } | null {
  const dep = f.properties.departureAirport;
  const arr = f.properties.arrivalAirport;
  // The LineString is the populated one — `departureAirport.lat/lon` are not
  // filled by /geo (a standing gotcha in CLAUDE.md), so the geometry wins and
  // the airport fields are only the fallback.
  const line = f.geometry?.coordinates;
  if (line && line.length >= 2) {
    return { from: line[0] as LngLat, to: line[line.length - 1] as LngLat };
  }
  if (dep.lon == null || dep.lat == null || arr.lon == null || arr.lat == null) return null;
  return { from: [dep.lon, dep.lat], to: [arr.lon, arr.lat] };
}

/** Screen-space-free bounding centre of a set of points, wrap-naive. */
function centreOf(points: LngLat[]): LngLat | null {
  if (points.length === 0) return null;
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  return [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
}

/**
 * A selected `Flight` row as the enriched /geo feature the card reads.
 *
 * The card's stats, its flight list and its route all come from the /geo set
 * the map is drawing. The "Reise" view draws ONE trip through `extraLayers`
 * and passes `flights={[]}`, so that set is empty there and a flight row
 * selected in the sidebar produced no card at all — while the `MapTooltip`
 * this card replaced read the selection store and never touched /geo.
 *
 * What a `Flight` cannot supply is the endpoint COUNTRY and CITY, which only
 * /geo enrichment carries; the card degrades to the plane glyph instead of a
 * flag there, rather than inventing one. Everything else — codes, names,
 * coordinates, airline, aircraft, times, distance — is on the row.
 */
export function geoFromFlightRow(flight: Flight): GeoJSONFeature {
  const distance =
    flight.routeDistance ??
    calculateDistance(flight.depLat, flight.depLon, flight.arrLat, flight.arrLon);
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [flight.depLon, flight.depLat],
        [flight.arrLon, flight.arrLat],
      ],
    },
    properties: {
      id: flight.id,
      airline: flight.airline,
      flightNumber: flight.flightNumber,
      aircraft: flight.aircraft,
      departureAirport: {
        iata: flight.depIata,
        icao: flight.depIcao,
        name: flight.depName,
        lat: flight.depLat,
        lon: flight.depLon,
      },
      arrivalAirport: {
        iata: flight.arrIata,
        icao: flight.arrIcao,
        name: flight.arrName,
        lat: flight.arrLat,
        lon: flight.arrLon,
      },
      departureTime: flight.departureTime,
      arrivalTime: flight.arrivalTime,
      status: flight.status,
      distance,
    },
  } as GeoJSONFeature;
}

/**
 * Every selected row the /geo set does not carry, added to it.
 *
 * Returns `geo` unchanged when nothing is missing, so the common case costs
 * one `Set` and no new array identity for the memo downstream.
 */
export function withSelectedFlights(
  geo: readonly GeoJSONFeature[],
  selected: readonly Flight[]
): readonly GeoJSONFeature[] {
  if (selected.length === 0) return geo;
  const have = new Set(geo.map((f) => f.properties.id));
  const missing = selected.filter((f) => !have.has(f.id));
  if (missing.length === 0) return geo;
  return [...geo, ...missing.map(geoFromFlightRow)];
}

/**
 * The card for a flight selection.
 *
 * One airport PAIR — however many flights, in either direction — is the route
 * card, which is what the ruling asks for: "route = the airport pair". Any
 * wider selection (a trip, a journey) has no single route to head a card with,
 * so it becomes the trip card and lists its flights instead.
 */
export function pinnedFromFlightSelection(
  selectedIds: readonly string[],
  geo: readonly GeoJSONFeature[],
  color: [number, number, number]
): MapPinned | null {
  const ids = new Set(selectedIds);
  const matched = geo.filter((f) => ids.has(f.properties.id));
  if (matched.length === 0) return null;

  const airports = new Set<string>();
  for (const f of matched) {
    const dep = f.properties.departureAirport.iata;
    const arr = f.properties.arrivalAirport.iata;
    if (dep) airports.add(dep);
    if (arr) airports.add(arr);
  }

  const points: LngLat[] = [];
  for (const f of matched) {
    const c = coordsOf(f);
    if (c) points.push(c.from, c.to);
  }

  if (airports.size <= 2) {
    const first = matched[0];
    const c = coordsOf(first);
    const anchor = c ? midpoint(c.from, c.to) : (centreOf(points) ?? [0, 0]);
    return {
      kind: "arc",
      anchorLngLat: anchor,
      data: {
        departure: endpointOf(first.properties.departureAirport),
        arrival: endpointOf(first.properties.arrivalAirport),
        flightIds: matched.map((f) => f.properties.id),
        count: matched.length,
        color,
      },
    };
  }

  return {
    kind: "trip",
    anchorLngLat: centreOf(points) ?? [0, 0],
    data: { flightIds: matched.map((f) => f.properties.id), color },
  };
}

/** The card for an airport marker click. Identity comes from whichever /geo
 *  feature touches it first; the count is every flight that does. */
export function pinnedFromAirport(
  iata: string,
  lon: number,
  lat: number,
  geo: readonly GeoJSONFeature[]
): MapPinned {
  let identity: CardEndpoint = { iata };
  let size = 0;
  for (const f of geo) {
    const dep = f.properties.departureAirport;
    const arr = f.properties.arrivalAirport;
    const side = dep.iata === iata ? dep : arr.iata === iata ? arr : null;
    if (!side) continue;
    size += 1;
    if (!identity.name && side.name) identity = endpointOf(side);
  }
  return {
    kind: "airport",
    anchorLngLat: [lon, lat],
    data: {
      iata,
      name: identity.name ?? iata,
      icao: identity.icao,
      city: identity.city,
      country: identity.country,
      size,
    },
  };
}

/**
 * The card for a cruise.
 *
 * Anchored to the middle of the itinerary rather than to the click point: a
 * cruise leg spans thousands of kilometres, so the tap coordinate is usually
 * an empty stretch of sea far from anything the reader is looking at. (The
 * card this replaced dodged the same problem by pinning itself to the bottom
 * of the viewport, which detached it from the thing it described.)
 */
export function pinnedFromCruise(cruise: Cruise): MapPinned {
  const coords: LngLat[] = [];
  if (cruise.departurePort) coords.push([cruise.departurePort.lon, cruise.departurePort.lat]);
  for (const stop of cruise.stops) {
    if (stop.port) coords.push([stop.port.lon, stop.port.lat]);
  }
  if (cruise.arrivalPort) coords.push([cruise.arrivalPort.lon, cruise.arrivalPort.lat]);

  const label = cruise.ship?.name ?? cruise.shipNameOverride ?? cruise.cruiseLine ?? "";
  return {
    kind: "cruise",
    anchorLngLat: centreOf(coords) ?? [0, 0],
    data: { cruiseId: cruise.id, cruiseLabel: label },
  };
}

/**
 * The card for a Sonder-Flug.
 *
 * `dep → arr` is misleading here — a sightseeing loop or a ZeroG parabola ends
 * where it started, and an eclipse chase's interesting coordinate is the event
 * rather than the arrival airport — so the route label and the anchor both
 * follow the type.
 */
export function pinnedFromSpecialFlight(flight: Flight): MapPinned | null {
  const type = flight.specialType as SpecialType | null | undefined;
  if (!type) return null;
  const meta = SPECIAL_TYPE_META[type];
  const anchor = getSpecialTooltipAnchor(flight);
  if (!anchor) return null;

  const dep = flight.depIata ?? flight.depIcao ?? null;
  const arr = flight.arrIata ?? flight.arrIcao ?? null;
  const isLoopType = type === "sightseeing" || type === "zerog" || type === "rocket_launch";
  const routeLabel = isLoopType
    ? (dep ?? arr ?? "?")
    : dep && arr && dep !== arr
      ? `${dep} → ${arr}`
      : (dep ?? arr ?? "?");

  return {
    kind: "specialFlight",
    anchorLngLat: anchor,
    data: {
      flightId: flight.id,
      specialType: type,
      icon: meta.icon,
      routeLabel,
      color: meta.rgb,
      aircraft: flight.aircraft,
      eventLabel: flight.eventLabel,
      departureTime: flight.departureTime,
    },
  };
}

/**
 * The card for a lodging.
 *
 * Nothing to build for one whose location never resolved — `Lodging.lat/lon`
 * are nullable, and a card with no anchor would have to float somewhere
 * arbitrary. The activity row already marks those rows as not-on-the-map; this
 * returns `null` so the click stays the honest no-op it is.
 *
 * The row goes through UNCHANGED: `LodgingCardDatum` is a structural subset of
 * `Lodging`, which is what lets the globe's pin click hand the card the same
 * record without a second shape in between.
 */
export function pinnedFromLodging(lodging: Lodging): MapPinned | null {
  if (lodging.lat == null || lodging.lon == null) return null;
  return { kind: "lodging", anchorLngLat: [lodging.lon, lodging.lat], data: lodging };
}

/**
 * The card for a place.
 *
 * `lat`/`lon` are NOT NULL on a place, so unlike a lodging this never abstains
 * — the type says a place that cannot be drawn is not creatable.
 */
export function pinnedFromPlace(place: Place): MapPinned {
  return { kind: "place", anchorLngLat: [place.lon, place.lat], data: place };
}
