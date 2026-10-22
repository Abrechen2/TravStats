import { useMemo } from "react";
import type { Layer } from "@deck.gl/core";
import { useDomainColors } from "../../hooks/useDomainColors";
import { useDomainVisible } from "../../hooks/useDomainVisible";
import { buildRailPaths, type RailPathSource } from "../layers/railPathsLayer";
import { buildRentalPoints, type RentalMapSource } from "../layers/rentalLayer";
import { buildRailMapLayers } from "../Dashboard/tabs/railMapOverlay";
import { buildRentalMapLayers } from "../Dashboard/tabs/rentalMapOverlay";
import { buildTerminalRideMapLayers } from "../Dashboard/tabs/terminalRideMapOverlay";
import { busPaths } from "./tripBusLayer";
import type { LngLat } from "./tripMapBounds";
import type { Trip } from "../../types";
import type { RentalBooking } from "../../types/rental";

/** What the trip map needs of a trip's train rides, ferry crossings and rentals. */
export type TripTransportContent = Partial<
  Pick<Trip, "railJourneys" | "ferryJourneys" | "rentalBookings">
>;

const NONE: readonly never[] = [];
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A train ride the server sent its stations for — an older server's slim row is left off. */
const railPlaced = (j: NonNullable<Trip["railJourneys"]>[number]): j is typeof j & RailPathSource =>
  isNum(j.depLat) && isNum(j.depLon) && isNum(j.arrLat) && isNum(j.arrLon);

/** A rental the server sent its branches and one-way flag for. */
const rentalPlaced = (
  r: NonNullable<Trip["rentalBookings"]>[number]
): r is typeof r & RentalMapSource =>
  isNum(r.pickupLat) &&
  isNum(r.pickupLon) &&
  isNum(r.returnLat) &&
  isNum(r.returnLon) &&
  typeof r.oneWay === "boolean" &&
  r.routeId !== undefined;

/**
 * The trip map's train rides, ferry crossings and rental cars (beta.22 UAT:
 * the map drew none of them). Built by the dashboard's own layer builders, so
 * the two maps cannot draw a domain differently, in the domain colour store's
 * colour, each behind its domain gate — and the points they cover, so the
 * camera frames them and a trip made only of them is not called empty. A ferry
 * follows its stored sea lane where one exists, else the chord (`busPaths`).
 * `onGlobe` builds the globe variant — lifted to the dashboard globe's
 * altitude, as the trip map's globe projection needs (Codex review before
 * 2.7.0-beta.23); `TripMap` adds the earth occlusion to every caller layer.
 */
export function useTripTransportLayers(
  trip: TripTransportContent,
  onGlobe = false
): {
  layers: Layer[];
  points: LngLat[];
} {
  const { colorOf } = useDomainColors();
  const railOn = useDomainVisible("rail");
  const ferryOn = useDomainVisible("ferry");
  const rentalOn = useDomainVisible("rental");
  const railColor = colorOf("rail");
  const ferryColor = colorOf("ferry");
  const rentalColor = colorOf("rental");
  return useMemo(() => {
    const rail = railOn ? (trip.railJourneys ?? NONE).filter(railPlaced) : NONE;
    const ferry = ferryOn ? (trip.ferryJourneys ?? NONE) : NONE;
    const rental = rentalOn ? (trip.rentalBookings ?? NONE).filter(rentalPlaced) : NONE;
    const layers: Layer[] = [
      ...(rail.length > 0 ? buildRailMapLayers(rail, railColor, onGlobe, "trip-rail") : []),
      ...buildTerminalRideMapLayers(ferry, ferryColor, onGlobe, "trip-ferry", "important", "ferry"),
      // A trip row's `times` may be partial; the card reads each end with `?.`.
      ...(rental.length > 0
        ? buildRentalMapLayers(
            rental as readonly (RentalMapSource & Partial<RentalBooking>)[],
            rentalColor,
            onGlobe,
            "trip-rental"
          )
        : []),
    ];
    const points: LngLat[] = [
      ...buildRailPaths(rail).flatMap((p) => p.path),
      ...busPaths(ferry).flatMap((p) => p.path),
      ...buildRentalPoints(rental).map((p) => p.position),
    ];
    return { layers, points };
  }, [
    trip.railJourneys,
    trip.ferryJourneys,
    trip.rentalBookings,
    railOn,
    ferryOn,
    rentalOn,
    railColor,
    ferryColor,
    rentalColor,
    onGlobe,
  ]);
}
