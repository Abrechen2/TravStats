import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import type { WrappedChapters } from "../../../types/wrapped";
import StatCard from "../StatCard";

/**
 * The year in review's chapters beyond flights, cruises and rail
 * (forgejo#265): stays, places, roadtrips, day tours, rentals, bus rides.
 * One card per chapter the server sent — it sends `null` for a domain this
 * reader does not see, and a null draws nothing rather than a card of zeros.
 * Each card is its own figure: rental days are not travel days, a stay's
 * nights are not a roadtrip's, and nothing here adds them up.
 */
export default function WrappedChapterCards({
  chapters,
  count,
}: {
  chapters: WrappedChapters;
  count: (value: number) => string;
}): JSX.Element {
  const { t } = useTranslation(["stats"]);
  const { lodging, places, roadtrips, tours, rentals, bus } = chapters;
  return (
    <>
      {lodging !== null && (
        <StatCard
          title={t("stats:wrapped.chapters.stays")}
          value={count(lodging.stays)}
          description={
            lodging.nightsUnknown > 0
              ? t("stats:wrapped.chapters.staysDescUnknown", {
                  nights: count(lodging.nights),
                  count: lodging.nightsUnknown,
                })
              : t("stats:wrapped.chapters.staysDesc", { count: lodging.nights })
          }
        />
      )}
      {places !== null && (
        <StatCard
          title={t("stats:wrapped.chapters.places")}
          value={count(places.visits)}
          description={t("stats:wrapped.chapters.placesDesc", { count: places.places })}
        />
      )}
      {roadtrips !== null && (
        <StatCard
          title={t("stats:wrapped.chapters.roadtrips")}
          value={count(roadtrips.roadtrips)}
          description={t("stats:wrapped.chapters.roadtripsDesc")}
        />
      )}
      {tours !== null && (
        <StatCard
          title={t("stats:wrapped.chapters.tours")}
          value={count(tours.tours)}
          description={t("stats:wrapped.chapters.toursDesc")}
        />
      )}
      {rentals !== null && (
        <StatCard
          title={t("stats:wrapped.chapters.rentals")}
          value={count(rentals.rentals)}
          description={t("stats:wrapped.chapters.rentalsDesc", { count: rentals.days })}
        />
      )}
      {bus !== null && (
        <StatCard
          title={t("stats:wrapped.chapters.bus")}
          value={count(bus.rides)}
          description={
            bus.nights > 0
              ? t("stats:wrapped.chapters.busDescNights", { km: count(bus.km), count: bus.nights })
              : t("stats:wrapped.chapters.busDesc", { km: count(bus.km) })
          }
        />
      )}
    </>
  );
}

/** Whether any chapter the server sent holds something — "is the year empty" counts these too. */
export function chaptersHoldAnything(chapters: WrappedChapters | undefined): boolean {
  if (!chapters) return false;
  const { lodging, places, roadtrips, tours, rentals, bus } = chapters;
  return (
    (lodging?.stays ?? 0) > 0 ||
    (places?.visits ?? 0) > 0 ||
    (roadtrips?.roadtrips ?? 0) > 0 ||
    (tours?.tours ?? 0) > 0 ||
    (rentals?.rentals ?? 0) > 0 ||
    (bus?.rides ?? 0) > 0
  );
}
