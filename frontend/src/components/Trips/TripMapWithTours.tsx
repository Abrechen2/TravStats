import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useToursVisible } from "../../hooks/useToursVisible";
import { useTripTourGeometries } from "../../hooks/useTripTourGeometries";
import TripMap from "./TripMap";
import type { TripMapContent } from "./tripMapContent";

/**
 * The trip detail page's "Karte" tab: the trip, and — while tours are visible
 * — the lines of its tours. Split from `TripDetailPage`, which is over the
 * file-size limit and may not grow.
 */
export default function TripMapWithTours({
  trip,
}: {
  trip: TripMapContent & { id: string };
}): JSX.Element {
  const { t } = useTranslation(["trips"]);
  const toursVisible = useToursVisible();
  const { geometries, failed } = useTripTourGeometries(trip.id, toursVisible);
  return (
    <>
      {failed && (
        <p role="status" className="mb-2 text-sm text-(--text-muted)">
          {t("trips:tours.map.loadError")}
        </p>
      )}
      <TripMap trip={trip} tourGeometries={geometries} />
    </>
  );
}
