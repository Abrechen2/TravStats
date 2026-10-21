// Tour and roadtrip lines that answer a hover and a click (forgejo#323).
//
// A tour's legs run between its own stops, which the dashboard's geometry
// batch does not name — so a leg is not a route between two places the way a
// train ride is. The thing a reader means when tapping a tour line is the
// TOUR: its name, how it was travelled, how far, how much climbing, when. The
// card is that, read from the summary `GET /tours` already sent.

import type { Layer, PickingInfo } from "@deck.gl/core";
import type { TourSummary } from "../../../../lib/api/tourIndex";
import { useMapCardSelectionStore } from "../../../../store/mapCardSelectionStore";
import type { MapPinned } from "../pinnedTypes";
import type { TourCardDatum } from "./journeyTypes";

interface TourLineDatum {
  routeId?: string;
  color?: [number, number, number];
}

/** A summary's distance, or null — a tour without measured legs has none yet. */
function knownKm(km: number | null | undefined): number | null {
  return typeof km === "number" && km > 0 ? km : null;
}

export function tourCardDatum(tour: TourSummary, color: [number, number, number]): TourCardDatum {
  return {
    id: tour.id,
    name: tour.name,
    kind: tour.kind === "roadtrip" ? "roadtrip" : "tour",
    mode: tour.mode || null,
    tripName: tour.tripName,
    distanceKm: knownKm(tour.distanceKm),
    ascentM: tour.ascentM != null && tour.ascentM > 0 ? tour.ascentM : null,
    stopCount: tour.stopCount > 0 ? tour.stopCount : null,
    startDate: tour.date ?? tour.startDate,
    endDate: tour.date ? null : tour.endDate,
    color,
  };
}

export function tourPinned(datum: TourCardDatum, anchor: [number, number]): MapPinned {
  return { kind: "tour", data: datum, anchorLngLat: anchor };
}

/**
 * The tour layer, each leg carrying its tour's card (`tourCard`, read by the
 * hover tooltip) and opening it on click. A leg whose tour is not in the
 * summary list keeps its plain label tooltip.
 */
export function withTourCards(layers: readonly Layer[], tours: readonly TourSummary[]): Layer[] {
  if (tours.length === 0) return [...layers];
  const byId = new Map(tours.map((tour) => [tour.id, tour]));
  return layers.map((layer) => {
    if (typeof layer?.clone !== "function" || !Array.isArray(layer.props?.data)) return layer;
    const data = (layer.props.data as TourLineDatum[]).map((d) => {
      const tour = d.routeId ? byId.get(d.routeId) : undefined;
      return tour && d.color ? { ...d, tourCard: tourCardDatum(tour, d.color) } : d;
    });
    return layer.clone({
      data,
      onClick: (info: PickingInfo<TourLineDatum & { tourCard?: TourCardDatum }>) => {
        const card = info.object?.tourCard;
        const c = info.coordinate;
        if (!card || !c) return;
        useMapCardSelectionStore.getState().select(tourPinned(card, [c[0], c[1]]));
      },
    } as Parameters<Layer["clone"]>[0]);
  });
}
