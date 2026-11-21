// Everything the trip map draws, derived from the trip once: the lines, the
// dots, which of them a chosen day leaves faint, and the numbers and names that
// go with them. Pure — `TripMap` memoises it — so the day filter, the numbering
// and the label set are testable without a map.

import { stayNights } from "../../lib/lodgingDateDisplay";
import type { Lodging } from "../../types/lodging";
import {
  tripArcWaypoints,
  type TripCruisePath,
  type TripFlightArc,
  type TripPointDatum,
} from "./TripMapGlobeLayers";
import { resolveTripStopColor, type TripMapColorConfig } from "./tripMapColors";
import type { TripMapContent } from "./tripMapContent";
import { buildTripFlightArcs } from "./tripMapFlightArcs";
import { buildTripCruisePaths } from "./tripCruisePaths";
import {
  cruiseSpan,
  flightSpan,
  spanHasDay,
  staySpan,
  stopSpan,
  type DaySpan,
} from "./tripMapDays";
import { numberInTripOrder, type SequenceInput } from "./tripMapSequence";
import type { TripLabelItem } from "./tripMapLabels";
import type { DirectionLine } from "./tripMapArrows";
import type { LayerGroup } from "./tripMapGroups";
import { toGlobeLodgingPoints } from "./TripMapGlobeLayers";

/** A visited place, as the map needs it (the page loads the full rows). */
export interface TripMapPlace {
  id: string;
  visitId: string;
  name: string;
  position: [number, number];
  /** The visits' days taken together, for the card and the numbering. */
  span: DaySpan | null;
  /** Each visit's own days: a place visited on the 1st and the 3rd is not on the 2nd. */
  visitSpans?: readonly (DaySpan | null)[];
  subtitle: string | null;
  /** Declaration order, for the tie-break inside one day. */
  order: number;
}

export interface TripMapData {
  flightArcs: TripFlightArc[];
  cruisePaths: TripCruisePath[];
  airportPoints: TripPointDatum[];
  lodgings: Lodging[];
  lodgingPoints: TripPointDatum[];
  stopPoints: TripPointDatum[];
  /** Per house: the days it was slept in, the stay the timeline anchors on, and whether the day filter leaves it faint. */
  lodgingMeta: Map<string, { span: DaySpan | null; stayId: string; dim: boolean }>;
  stopMeta: Map<string, { span: DaySpan | null; seq?: number }>;
  /** `stop:<id>` / `place:<id>` → the number shown on the map. */
  seqByKey: Map<string, number>;
  cruiseSpans: Map<string, DaySpan | null>;
  labelItems: TripLabelItem[];
  directionLines: DirectionLine[];
}

const isOff = (span: DaySpan | null, day: string | null): boolean =>
  day !== null && !spanHasDay(span, day);

const placeOff = (p: TripMapPlace, day: string | null): boolean =>
  day !== null && !(p.visitSpans ?? [p.span]).some((s) => spanHasDay(s, day));

const unionSpan = (spans: readonly (DaySpan | null)[]): DaySpan | null => {
  const dated = spans.filter((s): s is DaySpan => s !== null);
  if (dated.length === 0) return null;
  return {
    start: dated.map((s) => s.start).reduce((a, b) => (a < b ? a : b)),
    end: dated.map((s) => s.end).reduce((a, b) => (a > b ? a : b)),
  };
};

export function buildTripMapData(
  trip: TripMapContent,
  colors: TripMapColorConfig,
  cruiseGeometry: Parameters<typeof buildTripCruisePaths>[1],
  day: string | null,
  places: readonly TripMapPlace[]
): TripMapData {
  const flights = trip.flights ?? [];
  const flightSpans = new Map(flights.map((f) => [f.id, flightSpan(f)]));
  const cruiseSpans = new Map((trip.cruises ?? []).map((c) => [c.id, cruiseSpan(c)]));

  const flightArcs = buildTripFlightArcs(flights, colors.flight).map((arc) => ({
    ...arc,
    dim: isOff(flightSpans.get(arc.flightId) ?? null, day),
  }));
  const cruisePaths = buildTripCruisePaths(trip.cruises ?? [], cruiseGeometry, colors.cruise).map(
    (p) => ({ ...p, dim: isOff(cruiseSpans.get(p.cruiseId) ?? null, day) })
  );

  // An airport is faint only when every flight through it is.
  const airports = new Map<string, TripPointDatum>();
  for (const f of flights) {
    const off = isOff(flightSpans.get(f.id) ?? null, day);
    const ends = [
      { code: f.depIata, lat: f.depLat, lon: f.depLon },
      { code: f.arrIata, lat: f.arrLat, lon: f.arrLon },
    ];
    for (const { code, lat, lon } of ends) {
      if (lat == null || lon == null || (lat === 0 && lon === 0)) continue;
      const key = code ?? `${lat},${lon}`;
      const seen = airports.get(key);
      if (seen) {
        if (!off) seen.dim = false;
        continue;
      }
      airports.set(key, {
        position: [lon, lat],
        label: code ?? "",
        color: colors.airport,
        radiusMeters: 30000,
        kind: "airport",
        entityId: key,
        dim: off,
      });
    }
  }

  // One entry per HOUSE, counted on THIS trip (see TripMap's history for why).
  const byHouse = new Map<
    string,
    { lodging: Lodging; stays: number; nights: number; spans: (DaySpan | null)[]; stayId: string }
  >();
  for (const stay of trip.lodgingStays ?? []) {
    const house = stay.lodging;
    if (!house || house.lat == null || house.lon == null) continue;
    const seen = byHouse.get(house.id);
    if (seen) {
      seen.stays += 1;
      seen.nights += stayNights(stay);
      seen.spans.push(staySpan(stay));
    } else {
      byHouse.set(house.id, {
        lodging: house,
        stays: 1,
        nights: stayNights(stay),
        spans: [staySpan(stay)],
        stayId: stay.id,
      });
    }
  }
  const lodgingMeta: TripMapData["lodgingMeta"] = new Map();
  const lodgings: Lodging[] = [];
  for (const [id, h] of byHouse) {
    lodgings.push({ ...h.lodging, stayCount: h.stays, nights: h.nights });
    // Faint only if NO stay of the house is on the day (a round trip sleeps there twice).
    const dim = day !== null && !h.spans.some((s) => spanHasDay(s, day));
    lodgingMeta.set(id, { span: unionSpan(h.spans), stayId: h.stayId, dim });
  }
  const lodgingPoints = toGlobeLodgingPoints(lodgings, colors.lodging).map((p, i) => ({
    ...p,
    entityId: lodgings[i]?.id,
    dim: lodgingMeta.get(lodgings[i]?.id ?? "")?.dim ?? false,
  }));

  // Stops and places share one numbering.
  const stopList = (trip.stops ?? []).map((s, order) => ({
    s,
    order,
    key: `stop:${(s as { id?: string }).id ?? order}`,
    span: stopSpan(s),
  }));
  const seqInputs: SequenceInput[] = [
    ...stopList
      .filter(({ s }) => s.lat != null && s.lon != null)
      .map(({ key, span, order }) => ({ key, kind: "stop" as const, span, order })),
    ...places.map((p) => ({
      key: `place:${p.id}`,
      kind: "place" as const,
      span: p.span,
      order: 10_000 + p.order,
    })),
  ];
  const seq = numberInTripOrder(seqInputs);
  const stopMeta: TripMapData["stopMeta"] = new Map();
  const stopPoints: TripPointDatum[] = [];
  for (const { s, key, span } of stopList) {
    if (s.lat == null || s.lon == null) continue;
    const rgb = resolveTripStopColor(s.domain, colors.domains);
    const number = seq.get(key);
    stopMeta.set(key, { span, seq: number });
    stopPoints.push({
      position: [s.lon, s.lat],
      label: s.title,
      color: rgb,
      radiusMeters: 60000,
      kind: "stop",
      entityId: key,
      dim: isOff(span, day),
      seq: number,
      card: {
        title: s.title,
        domain: s.domain,
        startDate: s.startDate ?? null,
        endDate: s.endDate ?? null,
        color: rgb,
      },
    });
  }

  const labelItems: TripLabelItem[] = [
    ...airportsToLabels([...airports.values()]),
    ...stopPoints.map((p) => ({
      position: p.position,
      text: p.label,
      kind: "stop" as const,
      seq: p.seq,
      dim: p.dim,
    })),
    ...places.map((p) => ({
      position: p.position,
      text: p.name,
      kind: "place" as const,
      seq: seq.get(`place:${p.id}`),
      dim: placeOff(p, day),
    })),
  ];

  const directionLines: DirectionLine[] = [
    ...flightArcs.map((a) => ({
      id: `flight:${a.flightId}`,
      group: "flights" as const,
      path: tripArcWaypoints(a).map((p): [number, number] => [p[0], p[1]]),
      color: a.color,
      dim: a.dim,
    })),
    ...cruisePaths.map((p, i) => ({
      id: `cruise:${p.cruiseId}:${i}`,
      group: "cruise" as const,
      path: p.path,
      color: p.color,
      dim: p.dim,
    })),
  ];

  return {
    flightArcs,
    cruisePaths,
    airportPoints: [...airports.values()],
    lodgings,
    lodgingPoints,
    stopPoints,
    lodgingMeta,
    stopMeta,
    seqByKey: seq,
    cruiseSpans,
    labelItems,
    directionLines,
  };
}

function airportsToLabels(airports: readonly TripPointDatum[]): TripLabelItem[] {
  return airports.map((a) => ({
    position: a.position,
    text: a.label,
    kind: "airport",
    dim: a.dim,
  }));
}

export function emptyTripMapData(): TripMapData {
  return {
    flightArcs: [],
    cruisePaths: [],
    airportPoints: [],
    lodgings: [],
    lodgingPoints: [],
    stopPoints: [],
    lodgingMeta: new Map(),
    stopMeta: new Map(),
    seqByKey: new Map(),
    cruiseSpans: new Map(),
    labelItems: [],
    directionLines: [],
  };
}

/** The data with the groups the reader switched off in the legend taken out. */
export function withoutHiddenGroups(
  data: TripMapData,
  hidden: ReadonlySet<LayerGroup>
): TripMapData {
  if (hidden.size === 0) return data;
  const labelGroup: Record<TripLabelItem["kind"], LayerGroup> = {
    airport: "flights",
    stop: "stops",
    place: "places",
  };
  return {
    ...data,
    flightArcs: hidden.has("flights") ? [] : data.flightArcs,
    airportPoints: hidden.has("flights") ? [] : data.airportPoints,
    cruisePaths: hidden.has("cruise") ? [] : data.cruisePaths,
    lodgings: hidden.has("lodging") ? [] : data.lodgings,
    lodgingPoints: hidden.has("lodging") ? [] : data.lodgingPoints,
    stopPoints: hidden.has("stops") ? [] : data.stopPoints,
    labelItems: data.labelItems.filter((i) => !hidden.has(labelGroup[i.kind])),
    directionLines: data.directionLines.filter((l) => !hidden.has(l.group)),
  };
}

/** The points the chosen day's entries sit on, for framing the map around the day. */
export function dayFocusPoints(
  data: TripMapData,
  places: readonly TripMapPlace[],
  day: string | null,
  /** Rail, ferry, bus and rental points the caller already narrowed to the day. */
  callerPoints: readonly [number, number][] = []
): [number, number][] {
  if (day === null) return [];
  const pts: [number, number][] = [...callerPoints];
  for (const a of data.flightArcs) if (!a.dim) pts.push(a.source, a.target);
  for (const p of data.cruisePaths) if (!p.dim) pts.push(...p.path);
  for (const p of data.airportPoints) if (!p.dim) pts.push(p.position);
  for (const p of data.stopPoints) if (!p.dim) pts.push(p.position);
  for (const p of data.lodgingPoints) if (!p.dim) pts.push(p.position);
  for (const p of places) if (!placeOff(p, day)) pts.push(p.position);
  return pts;
}
