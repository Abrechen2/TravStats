// The trip map's own markers, answering a hover and a click (forgejo#323).
//
// Until now clicking a flight arc, an airport or a stop on the trip map only
// moved the camera, and only a hotel had a tooltip. The flight arcs and the
// airports are read as journeys (`journeyFromTripFlight`), so they open the
// same route and station cards a train or a coach does on the dashboard;
// a stop opens its own small card. The camera still moves — `TripMap`'s click
// handler runs after the layer's.
//
// Both projections build these layers under the SAME ids (`TripMapGlobeLayers`
// mirrors the flat ones), so one pass by id covers the flat map and the globe.

import type { Layer, PickingInfo } from "@deck.gl/core";
import { useMapCardSelectionStore } from "../../store/mapCardSelectionStore";
import { indexStops, tallyJourneys, journeyRouteKey } from "../map/cards/journeys/journeyStats";
import {
  groupRoutes,
  journeyRoutePinned,
  journeyStopPinned,
  type JourneyRouteHover,
  type JourneyStopHover,
} from "../map/cards/journeys/journeyLayerCards";
import type { MapJourney, TripStopCardDatum } from "../map/cards/journeys/journeyTypes";

interface ArcDatum {
  flightId: string;
  color: [number, number, number];
}

interface PointDatum {
  position: [number, number];
  color: [number, number, number];
  card?: TripStopCardDatum;
}

const select = useMapCardSelectionStore.getState;

function anchor(info: PickingInfo, fallback: [number, number]): [number, number] {
  const c = info.coordinate;
  return c && c.length >= 2 ? [c[0], c[1]] : fallback;
}

function decorateArcs(layer: Layer, flights: readonly MapJourney[]): Layer {
  const byId = new Map(flights.map((f) => [f.id, f]));
  const routes = groupRoutes(flights);
  const data = (layer.props.data as ArcDatum[]).map((d) => {
    const seed = byId.get(d.flightId);
    if (!seed) return d;
    const journeyRoute: JourneyRouteHover = {
      domain: "flight",
      dep: seed.dep,
      arr: seed.arr,
      ...tallyJourneys(routes.get(journeyRouteKey(seed)) ?? [seed]),
      color: d.color,
    };
    return { ...d, journeyRoute };
  });
  return layer.clone({
    data,
    onClick: (info: PickingInfo<ArcDatum>) => {
      const seed = info.object ? byId.get(info.object.flightId) : undefined;
      if (!seed || !info.object) return;
      const at = anchor(info, [seed.dep.lon, seed.dep.lat]);
      select().select(journeyRoutePinned(routes, seed, info.object.color, at));
    },
  } as Parameters<Layer["clone"]>[0]);
}

function decorateAirports(layer: Layer, flights: readonly MapJourney[]): Layer {
  // Indexed once: each airport scanning every flight was airports × flights.
  const stops = indexStops(flights);
  const data = (layer.props.data as PointDatum[]).map((d) => {
    const pinned = journeyStopPinned(stops, d.position, d.color);
    if (!pinned || pinned.kind !== "journeyStop") return d;
    const journeyStop: JourneyStopHover = {
      domain: "flight",
      stop: pinned.data.stop,
      ...tallyJourneys(pinned.data.journeys),
      color: d.color,
    };
    return { ...d, journeyStop };
  });
  return layer.clone({
    data,
    onClick: (info: PickingInfo<PointDatum>) => {
      if (!info.object) return;
      const pinned = journeyStopPinned(stops, info.object.position, info.object.color);
      if (pinned) select().select(pinned);
    },
  } as Parameters<Layer["clone"]>[0]);
}

function decorateStops(layer: Layer): Layer {
  const data = (layer.props.data as PointDatum[]).map((d) =>
    d.card ? { ...d, tripStopCard: d.card } : d
  );
  return layer.clone({
    data,
    onClick: (info: PickingInfo<PointDatum>) => {
      const d = info.object;
      if (!d?.card) return;
      select().select({ kind: "tripStop", data: d.card, anchorLngLat: d.position });
    },
  } as Parameters<Layer["clone"]>[0]);
}

/** The trip map's layers, its flights, airports and stops now carrying their cards. */
export function decorateTripMapLayers(
  layers: readonly Layer[],
  flights: readonly MapJourney[]
): Layer[] {
  return layers.map((layer) => {
    if (typeof layer?.clone !== "function" || !Array.isArray(layer.props?.data)) return layer;
    if (layer.id === "trip-flight-arcs") return decorateArcs(layer, flights);
    if (layer.id === "trip-airports") return decorateAirports(layer, flights);
    if (layer.id === "trip-stops") return decorateStops(layer);
    return layer;
  });
}
