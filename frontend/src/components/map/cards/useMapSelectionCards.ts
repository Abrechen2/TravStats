// Selections that come from OUTSIDE the map, on either renderer.
//
// The activity sidebar writes four Zustand stores — flight, cruise, lodging,
// place. Before the owner's 2026-09-20 ask ("wenn ich im Aktivitäts-Sidepanel
// einen Eintrag auswähle, soll der in der Karte gezeigt werden mit Details, so
// wie bei den Flügen — beim Globus und der 2D-Karte"), the flat map read two
// of them and the globe read none: selecting a hotel or a place moved nothing
// and showed nothing anywhere.
//
// One hook rather than two copies, because "what a row selection means" is not
// a property of the projection. What IS per-renderer stays a parameter: how to
// move the camera, and whether an emptied selection clears the card.

import { useCallback, useEffect, useMemo } from "react";
import type { Flight, GeoJSONFeature } from "../../../types";
import { useFlightSelectionStore } from "../../../store/flightSelectionStore";
import { useCruiseSelectionStore } from "../../../store/cruiseSelectionStore";
import { useLodgingSelectionStore } from "../../../store/lodgingSelectionStore";
import { usePlaceSelectionStore } from "../../../store/placeSelectionStore";
import {
  pinnedFromCruise,
  pinnedFromFlightSelection,
  pinnedFromLodging,
  pinnedFromPlace,
  pinnedFromSpecialFlight,
  withSelectedFlights,
} from "./buildFlatPinned";
import type { MapPinned } from "./pinnedTypes";

/** A map object with just the two methods focusing a selection needs. */
export interface FocusableMap {
  getZoom: () => number;
  flyTo: (options: {
    center: [number, number];
    zoom?: number;
    duration?: number;
    essential?: boolean;
  }) => void;
}

/**
 * Bring one point into view without ever zooming OUT.
 *
 * On a globe projection `flyTo({center})` IS "rotate that coordinate to face
 * the camera", so the near-side requirement and the centring one are the same
 * call and there is no bearing to set separately. The zoom floor stops a
 * selection landing at a whole-world view where the pin the card names is a
 * single pixel; a reader already closer than the floor stays where they are.
 */
export function focusMarker(
  map: FocusableMap | null | undefined,
  lngLat: [number, number],
  opts: { minZoom: number; duration: number }
): void {
  if (!map) return;
  map.flyTo({
    center: lngLat,
    zoom: Math.max(map.getZoom(), opts.minZoom),
    duration: opts.duration,
    essential: true,
  });
}

/**
 * How far in, and how long, each renderer goes when focusing a selection.
 *
 * Flat: 6 is roughly the "one city" level the flight bounding-box flyTo
 * already lands on for a short hop; below it a pin is unidentifiable.
 * Globe: 3.2, because below that the sphere shows most of a hemisphere, and a
 * slower flight because the camera is also rotating the earth round.
 */
export const FLAT_FOCUS = { minZoom: 6, duration: 600 } as const;
export const GLOBE_FOCUS = { minZoom: 3.2, duration: 1200 } as const;

/** The card kinds this hook owns — the ones an emptied selection may clear. */
const FLIGHT_KINDS: ReadonlyArray<MapPinned["kind"]> = ["arc", "trip", "specialFlight"];

export interface MapSelectionCardsOptions {
  /** The /geo features the route card reads its stats from. */
  flights: readonly GeoJSONFeature[];
  /** Hero colour for a route/trip card, resolved from the flight colour store. */
  flightColor: [number, number, number];
  /** Bring the selection's anchor into view. */
  focus: (lngLat: [number, number]) => void;
  setPinned: (next: MapPinned | null | ((prev: MapPinned | null) => MapPinned | null)) => void;
  /**
   * Delay before a flight card opens, so a camera move has started and the
   * card does not flash at the old anchor first. 0 opens immediately.
   */
  flightDelayMs?: number;
  /**
   * Whether an emptied selection clears the card this hook set.
   *
   * True on the flat map, where every route/trip card comes from the flight
   * store. FALSE on the globe, where clicking an arc pins a card WITHOUT
   * touching the store — clearing there would wipe the card the click just
   * opened.
   */
  clearOnEmpty?: boolean;
  /**
   * Whether the HOST already moves the camera for a flight selection.
   *
   * True on the flat map, which has a bounding-box `flyTo` so BOTH airports
   * land on screen. Focusing again 220 ms later snapped to the single-marker
   * zoom over the route midpoint and pushed both of them off it — two camera
   * commands fighting, the second one breaking the invariant the first exists
   * for. False on the globe, which has no framing rule of its own, so the card
   * is what brings the route round to the near side.
   */
  framesFlightSelection?: boolean;
}

export interface MapSelectionCards {
  /**
   * Let go of all four selections.
   *
   * What the card's close button has to do as well as hiding itself. Hiding
   * alone left the store holding the row, so selecting THE SAME row again set
   * the same object reference — same value from the selector, no re-render, no
   * effect, no card. The reader had to pick something else and come back.
   */
  clearSelections: () => void;
  /**
   * `"single"` when the selection IS one flight rather than the whole route —
   * only the primary action's wording changes. Derived here so both surfaces
   * say the same thing; it used to stop at `MapContainer3D`, and the globe
   * called one selected flight "Letzten Flug öffnen".
   */
  selectionScope: "single" | "route";
  /** The selected row behind a card action, or undefined once it is gone. */
  resolveSelectedFlight: (flightId: string) => Flight | undefined;
  /** What the trip card's "Details" action does — open the route sidebar. */
  openTripDetails: () => void;
  /**
   * What the card should read its route, stats and flight list from.
   *
   * The /geo set the map is drawing, PLUS any selected row it does not carry.
   * The "Reise" view draws one trip through `extraLayers` and passes
   * `flights={[]}`, so without this a flight row selected there produced no
   * card at all.
   */
  cardFlights: readonly GeoJSONFeature[];
}

export function useMapSelectionCards({
  flights,
  flightColor,
  focus,
  setPinned,
  flightDelayMs = 0,
  clearOnEmpty = false,
  framesFlightSelection = false,
}: MapSelectionCardsOptions): MapSelectionCards {
  const selectedFlights = useFlightSelectionStore((s) => s.selectedFlights);
  const selectedCruise = useCruiseSelectionStore((s) => s.selectedCruise);
  const selectedLodging = useLodgingSelectionStore((s) => s.selectedLodging);
  const selectedPlace = usePlaceSelectionStore((s) => s.selectedPlace);

  const clearFlights = useFlightSelectionStore((s) => s.clearSelection);
  const clearCruise = useCruiseSelectionStore((s) => s.clearSelection);
  const clearLodging = useLodgingSelectionStore((s) => s.clearSelection);
  const clearPlace = usePlaceSelectionStore((s) => s.clearSelection);

  const showDetails = useFlightSelectionStore((s) => s.showDetails);

  const clearSelections = useCallback((): void => {
    clearFlights();
    clearCruise();
    clearLodging();
    clearPlace();
  }, [clearFlights, clearCruise, clearLodging, clearPlace]);

  const cardFlights = useMemo(
    () => withSelectedFlights(flights, selectedFlights),
    [flights, selectedFlights]
  );

  useEffect(() => {
    if (selectedFlights.length === 0) {
      // Clear only what THIS effect can have set. Clearing anything else was a
      // real defect and not a theoretical one: the effect re-runs on an
      // unrelated dependency change, and a broader rule wiped the lodging and
      // place cards the moment they opened.
      if (clearOnEmpty) {
        setPinned((prev) => (prev && FLIGHT_KINDS.includes(prev.kind) ? null : prev));
      }
      return;
    }

    const open = (): void => {
      const first = selectedFlights[0];
      // A Sonder-Flug gets its own card shape: "dep → arr" is a lie for a
      // sightseeing loop, and an eclipse chase's anchor is the event rather
      // than the arrival airport.
      const next =
        selectedFlights.length === 1 && first.specialType
          ? pinnedFromSpecialFlight(first)
          : pinnedFromFlightSelection(
              selectedFlights.map((f) => f.id),
              cardFlights,
              flightColor
            );
      if (!next) return;
      setPinned(next);
      if (!framesFlightSelection) focus(next.anchorLngLat);
    };

    if (flightDelayMs === 0) {
      open();
      return;
    }
    const timer = setTimeout(open, flightDelayMs);
    return () => clearTimeout(timer);
  }, [
    selectedFlights,
    cardFlights,
    flightColor,
    focus,
    setPinned,
    flightDelayMs,
    clearOnEmpty,
    framesFlightSelection,
  ]);

  useEffect(() => {
    if (selectedCruise === null) {
      if (clearOnEmpty) setPinned((prev) => (prev?.kind === "cruise" ? null : prev));
      return;
    }
    const next = pinnedFromCruise(selectedCruise);
    setPinned(next);
    focus(next.anchorLngLat);
  }, [selectedCruise, focus, setPinned, clearOnEmpty]);

  useEffect(() => {
    if (selectedLodging === null) {
      if (clearOnEmpty) setPinned((prev) => (prev?.kind === "lodging" ? null : prev));
      return;
    }
    // Abstains for a lodging whose location never resolved — the sidebar row
    // already says it is not on the map, and a card with no anchor would have
    // to float somewhere arbitrary.
    const next = pinnedFromLodging(selectedLodging);
    if (!next) return;
    setPinned(next);
    focus(next.anchorLngLat);
  }, [selectedLodging, focus, setPinned, clearOnEmpty]);

  useEffect(() => {
    if (selectedPlace === null) {
      if (clearOnEmpty) setPinned((prev) => (prev?.kind === "place" ? null : prev));
      return;
    }
    const next = pinnedFromPlace(selectedPlace);
    setPinned(next);
    focus(next.anchorLngLat);
  }, [selectedPlace, focus, setPinned, clearOnEmpty]);

  const resolveSelectedFlight = useCallback(
    (flightId: string): Flight | undefined =>
      selectedFlights.find((f) => f.id === flightId) ?? selectedFlights[0],
    [selectedFlights]
  );

  const openTripDetails = useCallback((): void => {
    if (selectedFlights.length === 0) return;
    showDetails(selectedFlights, "route-details");
  }, [selectedFlights, showDetails]);

  return {
    cardFlights,
    clearSelections,
    selectionScope: selectedFlights.length === 1 ? "single" : "route",
    resolveSelectedFlight,
    openTripDetails,
  };
}
