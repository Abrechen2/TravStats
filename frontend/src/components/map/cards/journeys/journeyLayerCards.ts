// Makes a journey domain's map layers answer a hover and a click (forgejo#323).
//
// The rail, bus, ferry and rental layers are built in four builders with four
// datum shapes, but every one of them is either a LINE whose datum names its
// journeys (`id` / `memberIds`, from `groupMapData`) or a POINT at a station's
// position. So instead of teaching each builder about cards, this one pass
// recognises the two by layer id and decorates them: each datum gains the
// summary its hover tooltip prints, and the layer gains a click that opens the
// shared map card through `mapCardSelectionStore`. A builder that forgets
// nothing here cannot forget a domain either.

import type { Layer, PickingInfo } from "@deck.gl/core";
import type { Rgb } from "../../../../lib/domainColor";
import { useMapCardSelectionStore } from "../../../../store/mapCardSelectionStore";
import type { MapPinned } from "../pinnedTypes";
import type { TimeValue } from "../../../../shared/time";
import type { JourneyDomain, JourneyEnd, MapJourney } from "./journeyTypes";
import {
  endKey,
  indexStops,
  journeyRouteKey,
  modeOf,
  sumJourneyDistance,
  tallyJourneys,
} from "./journeyStats";
import { routeDistanceSourceKeys } from "./journeyProvenance";
import { getJourneyRouteFigures } from "./journeyRouteFigures";
import { getJourneyStopFigures, type StopDestination } from "./journeyStopFigures";
import { routeSubject, type JourneySubject } from "./journeySubject";

/**
 * A route's profile at a glance (owner, 2026-10-21) — every field null when
 * it cannot be derived, and then left out of the tooltip.
 */
export interface JourneyRouteProfile {
  /** Σ km of the travelled journeys that recorded one; null when none did. */
  distanceKm: number | null;
  /** i18n keys of what that distance measures. */
  distanceSourceKeys: string[];
  avgDurationMin: number | null;
  /** The last journey that happened, on its places' clocks. */
  last: { departure: TimeValue | null; arrival: TimeValue | null } | null;
  operator: string | null;
  /** What the picture shows — a ship, a car model, a train category. */
  subject: JourneySubject | null;
}

/** What a line's hover tooltip prints — precomputed, because hover runs at 60–120 Hz. */
export interface JourneyRouteHover {
  domain: JourneyDomain;
  dep: JourneyEnd;
  arr: JourneyEnd;
  travelled: number;
  planned: number;
  color: Rgb;
  /** Absent on a datum decorated before profiles existed. */
  profile?: JourneyRouteProfile;
}

/** What a station's hover tooltip prints. */
export interface JourneyStopHover {
  domain: JourneyDomain;
  stop: JourneyEnd;
  travelled: number;
  planned: number;
  color: Rgb;
  departures?: number;
  destinations?: StopDestination[];
  lastVisit?: TimeValue | null;
}

/** The profile of one route's journeys. */
export function journeyRouteProfile(journeys: readonly MapJourney[]): JourneyRouteProfile {
  const distance = sumJourneyDistance(journeys);
  const figures = getJourneyRouteFigures(journeys);
  return {
    distanceKm: distance.measuredCount > 0 ? distance.knownKm : null,
    distanceSourceKeys: routeDistanceSourceKeys(journeys),
    avgDurationMin: figures.duration?.averageMin ?? null,
    last: figures.last
      ? { departure: figures.last.departure, arrival: figures.last.arrival }
      : null,
    operator: modeOf(journeys.map((j) => j.operator)),
    subject: routeSubject(journeys),
  };
}

/** Lines: rail `-paths`, bus/ferry `-paths`, rental `-links`, the trip map's `-rides`. */
const ROUTE_LAYER = /-(paths|links|rides)$/;
/** Points: rail `-stations`, bus/ferry `-terminals`, rental `-points`. */
const STOP_LAYER = /-(stations|terminals|points)$/;

const HIGHLIGHT: [number, number, number, number] = [255, 255, 255, 80];

interface LineDatum {
  id?: string;
  memberIds?: string[];
}

interface PointDatum {
  position: [number, number] | [number, number, number];
}

/** The pinned card for the route `seed` is on — every journey of it, either direction. */
export function journeyRoutePinned(
  routes: ReadonlyMap<string, MapJourney[]>,
  seed: MapJourney,
  color: Rgb,
  anchor: [number, number]
): MapPinned {
  return {
    kind: "journeyRoute",
    data: {
      domain: seed.domain,
      dep: seed.dep,
      arr: seed.arr,
      journeys: routes.get(journeyRouteKey(seed)) ?? [seed],
      color,
    },
    anchorLngLat: anchor,
  };
}

/**
 * The pinned card for the station at `position`, or null when no journey
 * touches it. Hand in `indexStops(journeys)` when asking for many stations.
 */
export function journeyStopPinned(
  journeys: readonly MapJourney[] | ReadonlyMap<string, MapJourney[]>,
  position: readonly number[],
  color: Rgb
): MapPinned | null {
  const key = endKey({ lon: position[0], lat: position[1] });
  const stops = Array.isArray(journeys)
    ? indexStops(journeys as readonly MapJourney[])
    : (journeys as ReadonlyMap<string, MapJourney[]>);
  const touching = stops.get(key) ?? [];
  if (touching.length === 0) return null;
  const first = touching[0];
  const stop = endKey(first.dep) === key ? first.dep : first.arr;
  return {
    kind: "journeyStop",
    data: { domain: first.domain, stop, journeys: touching, color },
    anchorLngLat: [position[0], position[1]],
  };
}

/** Journeys grouped by their unordered route key, cancelled ones left out. */
export function groupRoutes(journeys: readonly MapJourney[]): Map<string, MapJourney[]> {
  const routes = new Map<string, MapJourney[]>();
  for (const j of journeys) {
    if (j.status === "cancelled") continue;
    const key = journeyRouteKey(j);
    const list = routes.get(key);
    if (list) list.push(j);
    else routes.set(key, [j]);
  }
  return routes;
}

function anchorOf(info: PickingInfo, fallback: JourneyEnd): [number, number] {
  const c = info.coordinate;
  return c && c.length >= 2 ? [c[0], c[1]] : [fallback.lon, fallback.lat];
}

function decorateRoute(
  layer: Layer,
  byId: ReadonlyMap<string, MapJourney>,
  routes: ReadonlyMap<string, MapJourney[]>,
  color: Rgb
): Layer {
  const seedOf = (d: LineDatum): MapJourney | undefined => {
    for (const id of d.memberIds ?? (d.id ? [d.id] : [])) {
      const j = byId.get(id);
      if (j) return j;
    }
    return undefined;
  };
  // One profile per route, however many segments draw it.
  const profiles = new Map<string, JourneyRouteProfile>();
  const data = ((layer.props.data as LineDatum[] | undefined) ?? []).map((d) => {
    const seed = seedOf(d);
    if (!seed) return d;
    const key = journeyRouteKey(seed);
    const onRoute = routes.get(key) ?? [seed];
    let profile = profiles.get(key);
    if (!profile) {
      profile = journeyRouteProfile(onRoute);
      profiles.set(key, profile);
    }
    const journeyRoute: JourneyRouteHover = {
      domain: seed.domain,
      dep: seed.dep,
      arr: seed.arr,
      ...tallyJourneys(onRoute),
      color,
      profile,
    };
    return { ...d, journeyRoute };
  });
  return layer.clone({
    data,
    pickable: true,
    autoHighlight: true,
    highlightColor: HIGHLIGHT,
    onClick: (info: PickingInfo<LineDatum>) => {
      const seed = info.object ? seedOf(info.object) : undefined;
      if (!seed) return;
      useMapCardSelectionStore
        .getState()
        .select(journeyRoutePinned(routes, seed, color, anchorOf(info, seed.dep)));
    },
  } as Parameters<Layer["clone"]>[0]);
}

function decorateStop(layer: Layer, stops: ReadonlyMap<string, MapJourney[]>, color: Rgb): Layer {
  const data = ((layer.props.data as PointDatum[] | undefined) ?? []).map((d) => {
    const pinned = journeyStopPinned(stops, d.position, color);
    if (!pinned || pinned.kind !== "journeyStop") return d;
    const figures = getJourneyStopFigures(pinned.data.journeys, endKey(pinned.data.stop));
    const journeyStop: JourneyStopHover = {
      domain: pinned.data.domain,
      stop: pinned.data.stop,
      ...tallyJourneys(pinned.data.journeys),
      color,
      departures: figures.departures,
      destinations: figures.destinations,
      lastVisit: figures.lastVisit,
    };
    return { ...d, journeyStop };
  });
  return layer.clone({
    data,
    pickable: true,
    onClick: (info: PickingInfo<PointDatum>) => {
      if (!info.object) return;
      const pinned = journeyStopPinned(stops, info.object.position, color);
      if (pinned) useMapCardSelectionStore.getState().select(pinned);
    },
  } as Parameters<Layer["clone"]>[0]);
}

/**
 * The same layers, each line and station now answering a hover and a click.
 * Layers that are neither (the station NAME labels) pass through untouched.
 */
export function withJourneyCards(
  layers: readonly Layer[],
  journeys: readonly MapJourney[],
  color: Rgb
): Layer[] {
  if (journeys.length === 0) return [...layers];
  const byId = new Map(journeys.map((j) => [j.id, j]));
  const routes = groupRoutes(journeys);
  const stops = indexStops(journeys);
  return layers.map((layer) => {
    if (typeof layer?.clone !== "function" || !Array.isArray(layer.props?.data)) return layer;
    if (ROUTE_LAYER.test(layer.id)) return decorateRoute(layer, byId, routes, color);
    if (STOP_LAYER.test(layer.id)) return decorateStop(layer, stops, color);
    return layer;
  });
}
