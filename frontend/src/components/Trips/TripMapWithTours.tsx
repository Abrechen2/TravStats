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
import { useTripTransportLayers, type TripTransportContent } from "./tripTransportLayers";
import type { TripProjection } from "./TripMapGlobeLayers";

/**
 * The trip detail page's "Karte" tab: the trip, and — while tours are visible
 * — the lines of its tours, and the positions the Companion recorded during
 * it (forgejo#316). Split from `TripDetailPage`, which is over the file-size
 * limit and may not grow.
 */
export default function TripMapWithTours({
  trip,
}: {
  /** `busJourneys` (forgejo#180): already stripped by the page when bus is hidden. */
  trip: TripMapContent & TripTransportContent & { id: string; busJourneys?: TripBusJourney[] };
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
  const extraLayers = useMemo(
    () => [...transport.layers, ...busLayers, ...buildRecordingLayers(segments ?? [])],
    [transport.layers, busLayers, segments]
  );
  const extraPoints = useMemo(
    () => [...transport.points, ...busPoints, ...recordingPoints(segments ?? [])],
    [transport.points, busPoints, segments]
  );
  return (
    <>
      {failed && (
        <p role="status" className="mb-2 text-sm text-(--text-muted)">
          {t("trips:tours.map.loadError")}
        </p>
      )}
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
      <TripMap
        trip={trip}
        tourGeometries={geometries}
        extraLayers={extraLayers}
        extraPoints={extraPoints}
        onProjectionChange={setProjection}
      />
    </>
  );
}
