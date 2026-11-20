import { useMemo, useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useDomainColors } from "../../hooks/useDomainColors";
import { useToursVisible } from "../../hooks/useToursVisible";
import { useTripTourGeometries } from "../../hooks/useTripTourGeometries";
import TripMap from "./TripMap";
import type { TripMapContent } from "./tripMapContent";
import type { TripBusJourney } from "../../types/bus";
import { buildBusLayers, busPathPoints } from "./tripBusLayer";
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
import { TripPlacesLegend } from "./TripPlacesStatus";

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
  const busColor = useDomainColors().colorOf("bus");
  // The map's projection, so rail, ferry, rental and bus are built for the globe on it.
  const [projection, setProjection] = useState<TripProjection>("mercator");
  const busLayers = useMemo(
    () => buildBusLayers(trip.busJourneys ?? [], busColor, projection === "globe"),
    [trip.busJourneys, busColor, projection]
  );
  const busPoints = useMemo(() => busPathPoints(trip.busJourneys ?? []), [trip.busJourneys]);
  const transport = useTripTransportLayers(trip, projection === "globe");
  const [recordingDay, setRecordingDay] = useState<string | null>(null);
  const [recordingSource, setRecordingSource] = useState<TrackOrigin | null>(null);
  const recording = useTripRecording(trip.id, recordingDay, recordingSource);
  const segments = recording.view?.segments;
  // A recipient needs TravTrack on here, not a history of their own.
  const shared = useSharedTripRoutes(trip.id, useTravTrackInstanceOn());
  // Hidden with the places domain, exactly as the timeline hides its cards.
  const placesVisible = usePlacesVisible();
  const placeColors = usePlaceColorStore((s) => s.config);
  const placeLayers = useMemo(
    () => (placesVisible ? buildTripPlaceLayers(placeVisits, placeColors) : []),
    [placesVisible, placeVisits, placeColors]
  );
  const placePoints = useMemo(
    () => (placesVisible ? tripPlacePoints(placeVisits) : []),
    [placesVisible, placeVisits]
  );
  const extraLayers = useMemo(
    () => [
      ...transport.layers,
      ...busLayers,
      ...buildSharedRouteLayers(shared.routes),
      ...buildRecordingLayers(segments ?? []),
      ...placeLayers,
    ],
    [transport.layers, busLayers, shared.routes, segments, placeLayers]
  );
  const extraPoints = useMemo(
    () => [
      ...transport.points,
      ...busPoints,
      ...sharedRoutePoints(shared.routes),
      ...recordingPoints(segments ?? []),
      ...placePoints,
    ],
    [transport.points, busPoints, shared.routes, segments, placePoints]
  );
  return (
    <>
      {failed && (
        <p role="status" className="mb-2 text-sm text-(--text-muted)">
          {t("trips:tours.map.loadError")}
        </p>
      )}
      <SharedRouteLegend routes={shared.routes} failed={shared.failed} />
      {placeLayers.length > 0 && <TripPlacesLegend />}
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
          />
        </WebGLGuard>
      )}
    </>
  );
}
