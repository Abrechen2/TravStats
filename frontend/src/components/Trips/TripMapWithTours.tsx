import { useMemo, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useToursVisible } from "../../hooks/useToursVisible";
import { useTripTourGeometries } from "../../hooks/useTripTourGeometries";
import TripMap from "./TripMap";
import type { TripMapContent } from "./tripMapContent";
import type { TripBusJourney } from "../../types/bus";
import { buildBusLayers } from "./tripBusLayer";

/**
 * The trip detail page's "Karte" tab: the trip, and — while tours are visible
 * — the lines of its tours. Split from `TripDetailPage`, which is over the
 * file-size limit and may not grow.
 */
export default function TripMapWithTours({
  trip,
}: {
  /** `busJourneys` (forgejo#180): already stripped by the page when bus is hidden. */
  trip: TripMapContent & { id: string; busJourneys?: TripBusJourney[] };
}): JSX.Element {
  const { t } = useTranslation(["trips"]);
  const toursVisible = useToursVisible();
  const { geometries, failed } = useTripTourGeometries(trip.id, toursVisible);
  const busLayers = useMemo(() => buildBusLayers(trip.busJourneys ?? []), [trip.busJourneys]);
  return (
    <>
      {failed && (
        <p role="status" className="mb-2 text-sm text-(--text-muted)">
          {t("trips:tours.map.loadError")}
        </p>
      )}
      <TripMap trip={trip} tourGeometries={geometries} extraLayers={busLayers} />
    </>
  );
}
