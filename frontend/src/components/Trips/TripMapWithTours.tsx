import { useCallback, useMemo, useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useDomainColors } from "../../hooks/useDomainColors";
import { useToursVisible } from "../../hooks/useToursVisible";
import { useTripTourGeometries } from "../../hooks/useTripTourGeometries";
import TripMap from "./TripMap";
import type { TripMapContent } from "./tripMapContent";
import type { TripBusJourney } from "../../types/bus";
import { buildBusLayers, busPathPoints, busPaths } from "./tripBusLayer";
import { useTripRecording } from "../../hooks/useTripRecording";
import type { TrackOrigin } from "../../lib/api/trackOrigin";
import { buildRecordingLayers, recordingPoints } from "./recording/recordingLayers";
import TripRecordingPanel from "./recording/TripRecordingPanel";
import { useTravTrackInstanceOn } from "../../hooks/useTravTrackVisible";
import { useSharedTripRoutes } from "../../hooks/useSharedTripRoutes";
import SharedRouteLegend from "./recording/SharedRouteLegend";
import { buildSharedRouteLayers, sharedRoutePoints } from "./recording/sharedRouteLayers";
import { useTripTransportLayers, type TripTransportContent } from "./tripTransportLayers";
import type { TripProjection } from "./TripMapGlobeLayers";
import WebGLGuard from "../map/WebGLGuard";
import { usePlacesVisible } from "../../hooks/usePlacesVisible";
import { usePlaceColorStore } from "../../store/placeColorStore";
import type { TripPlaceVisit } from "../../hooks/useTripPlaceVisits";
import { buildTripPlaceLayers, tripPlacePoints } from "./tripPlaceLayer";
import { TripMapDayStrip } from "./TripMapDayStrip";
import { rentalSpan, railSpan, rideSpan, splitByDay, tripDays, visitSpan } from "./tripMapDays";
import type { TripMapPlace } from "./tripMapData";
import { placeInfo } from "./tripMapInfo";
import { useTripMapInfoStore } from "../../store/tripMapInfoStore";
import { useMapCardSelectionStore } from "../../store/mapCardSelectionStore";
import { hexToRgb } from "../../lib/domainColor";
import type { DirectionLine } from "./tripMapArrows";
import type { Layer } from "@deck.gl/core";

/** How much of a layer a day filter leaves on screen for the days not chosen. */
const DIM_LAYER_OPACITY = 0.22;
const NO_LAYERS: Layer[] = [];

/** The same layers, faint and inert; their names go, a faint name is noise. */
function dimmed(layers: readonly Layer[]): Layer[] {
  return layers
    .filter((layer) => !layer.id.endsWith("labels"))
    .map((layer) =>
      layer.clone({
        id: `${layer.id}-dim`,
        opacity: DIM_LAYER_OPACITY,
        pickable: false,
      } as Parameters<Layer["clone"]>[0])
    );
}

const NO_PLACE_VISITS: TripPlaceVisit[] = [];

/**
 * The trip detail page's "Karte" tab: the trip, and — while tours are visible
 * — the lines of its tours, and the positions the Companion recorded during
 * it (forgejo#316), and the routes other members of a shared trip share with
 * the reader (TravTrack plan T7), read-only. Split from `TripDetailPage`, which is over the file-size
 * limit and may not grow.
 */
export default function TripMapWithTours({
  trip,
  placeVisits = NO_PLACE_VISITS,
  placesLoading = false,
}: {
  /** `busJourneys` (forgejo#180): already stripped by the page when bus is hidden. */
  trip: TripMapContent & TripTransportContent & { id: string; busJourneys?: TripBusJourney[] };
  /** The places visited on the trip, loaded once by the page (`useTripPlaceVisits`). */
  placeVisits?: readonly TripPlaceVisit[];
  /**
   * The places are still on their way. The map frames the trip once, on its
   * first points, so it waits for them rather than leaving a place outside
   * the frame.
   */
  placesLoading?: boolean;
}): JSX.Element {
  const { t } = useTranslation(["trips"]);
  const toursVisible = useToursVisible();
  const { geometries, failed } = useTripTourGeometries(trip.id, toursVisible);
  // The day filter: the chosen day's entries are drawn as ever, the rest of the
  // trip is built a second time and drawn faint.
  const days = useMemo(
    () =>
      tripDays(
        trip,
        placeVisits.map((v) => v.visit)
      ),
    [trip, placeVisits]
  );
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const day = pickedDay !== null && days.includes(pickedDay) ? pickedDay : null;
  const split = useMemo(() => {
    const bus = splitByDay(trip.busJourneys ?? [], rideSpan, day);
    const rail = splitByDay(trip.railJourneys ?? [], railSpan, day);
    const ferry = splitByDay(trip.ferryJourneys ?? [], rideSpan, day);
    const rental = splitByDay(trip.rentalBookings ?? [], rentalSpan, day);
    const visits = splitByDay(placeVisits, (v) => visitSpan(v.visit), day);
    return {
      bus,
      visits,
      active: {
        railJourneys: rail.active,
        ferryJourneys: ferry.active,
        rentalBookings: rental.active,
      },
      rest: { railJourneys: rail.rest, ferryJourneys: ferry.rest, rentalBookings: rental.rest },
    };
  }, [
    trip.busJourneys,
    trip.railJourneys,
    trip.ferryJourneys,
    trip.rentalBookings,
    placeVisits,
    day,
  ]);
  const busColor = useDomainColors().colorOf("bus");
  // The map's projection, so rail, ferry, rental and bus are built for the globe on it.
  const [projection, setProjection] = useState<TripProjection>("mercator");
  const onGlobe = projection === "globe";
  const busLayers = useMemo(
    () => buildBusLayers(split.bus.active, busColor, onGlobe),
    [split.bus.active, busColor, onGlobe]
  );
  const busLayersDim = useMemo(
    () => dimmed(buildBusLayers(split.bus.rest, busColor, onGlobe)),
    [split.bus.rest, busColor, onGlobe]
  );
  const busPoints = useMemo(() => busPathPoints(trip.busJourneys ?? []), [trip.busJourneys]);
  const transport = useTripTransportLayers(split.active, onGlobe);
  const transportRest = useTripTransportLayers(split.rest, onGlobe);
  const transportDim = useMemo(() => dimmed(transportRest.layers), [transportRest.layers]);
  const [recordingDay, setRecordingDay] = useState<string | null>(null);
  const [recordingSource, setRecordingSource] = useState<TrackOrigin | null>(null);
  const recording = useTripRecording(trip.id, recordingDay, recordingSource);
  const segments = recording.view?.segments;
  // A recipient needs TravTrack on here, not a history of their own.
  const shared = useSharedTripRoutes(trip.id, useTravTrackInstanceOn());
  // Hidden with the places domain, exactly as the timeline hides its cards.
  const placesVisible = usePlacesVisible();
  const placeColors = usePlaceColorStore((s) => s.config);
  const places = useMemo<TripMapPlace[]>(() => {
    if (!placesVisible) return [];
    const seen = new Map<string, TripMapPlace>();
    for (const { place, visit } of placeVisits) {
      if (seen.has(place.id) || !Number.isFinite(place.lat) || !Number.isFinite(place.lon))
        continue;
      seen.set(place.id, {
        id: place.id,
        visitId: visit.id,
        name: place.name,
        position: [place.lon, place.lat],
        span: visitSpan(visit),
        subtitle: place.city ?? place.category ?? null,
        order: seen.size,
      });
    }
    return [...seen.values()];
  }, [placesVisible, placeVisits]);
  const openPlace = useCallback(
    (placeId: string): void => {
      const p = places.find((x) => x.id === placeId);
      if (!p) return;
      useMapCardSelectionStore.getState().clear();
      useTripMapInfoStore.getState().open(placeInfo({ ...p, tripId: trip.id }));
    },
    [places, trip.id]
  );
  const placeLayers = useMemo(
    () =>
      placesVisible ? buildTripPlaceLayers(split.visits.active, placeColors, openPlace) : NO_LAYERS,
    [placesVisible, split.visits.active, placeColors, openPlace]
  );
  const placeLayersDim = useMemo(
    () =>
      placesVisible ? dimmed(buildTripPlaceLayers(split.visits.rest, placeColors)) : NO_LAYERS,
    [placesVisible, split.visits.rest, placeColors]
  );
  const placePoints = useMemo(
    () => (placesVisible ? tripPlacePoints(placeVisits) : []),
    [placesVisible, placeVisits]
  );
  const extraLayers = useMemo(
    () => [
      ...busLayersDim,
      ...transportDim,
      ...placeLayersDim,
      ...transport.layers,
      ...busLayers,
      ...buildSharedRouteLayers(shared.routes),
      ...buildRecordingLayers(segments ?? []),
      ...placeLayers,
    ],
    [
      busLayersDim,
      transportDim,
      placeLayersDim,
      transport.layers,
      busLayers,
      shared.routes,
      segments,
      placeLayers,
    ]
  );
  const extraDirectionLines = useMemo<DirectionLine[]>(
    () => [
      ...transport.lines,
      ...transportRest.lines.map((l) => ({ ...l, dim: true })),
      ...busPaths(split.bus.active).map((p) => ({
        id: `bus:${p.id}`,
        group: "bus" as const,
        path: p.path,
        color: hexToRgb(busColor),
      })),
      ...busPaths(split.bus.rest).map((p) => ({
        id: `bus:${p.id}`,
        group: "bus" as const,
        path: p.path,
        color: hexToRgb(busColor),
        dim: true,
      })),
    ],
    [transport.lines, transportRest.lines, split.bus, busColor]
  );
  const extraPoints = useMemo(
    () => [
      ...transport.points,
      ...transportRest.points,
      ...busPoints,
      ...sharedRoutePoints(shared.routes),
      ...recordingPoints(segments ?? []),
      ...placePoints,
    ],
    [transport.points, transportRest.points, busPoints, shared.routes, segments, placePoints]
  );
  return (
    <>
      {failed && (
        <p role="status" className="mb-2 text-sm text-(--text-muted)">
          {t("trips:tours.map.loadError")}
        </p>
      )}
      <TripMapDayStrip days={days} day={day} onChange={setPickedDay} />
      <SharedRouteLegend routes={shared.routes} failed={shared.failed} />
      <TripRecordingPanel
        tripId={trip.id}
        view={recording.view}
        failed={recording.failed}
        failedCode={recording.failedCode}
        day={recordingDay}
        onDayChange={setRecordingDay}
        source={recordingSource}
        onSourceChange={(next) => {
          setRecordingDay(null);
          setRecordingSource(next);
        }}
        onDeleted={recording.reload}
      />
      {!(placesVisible && placesLoading) && (
        <WebGLGuard>
          <TripMap
            trip={trip}
            tourGeometries={geometries}
            extraLayers={extraLayers}
            extraPoints={extraPoints}
            onProjectionChange={setProjection}
            tripId={trip.id}
            day={day}
            places={places}
            extraDirectionLines={extraDirectionLines}
          />
        </WebGLGuard>
      )}
    </>
  );
}
