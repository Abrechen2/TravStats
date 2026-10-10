import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import type { WrappedChapters } from "../../../types/wrapped";
import StatCard from "../StatCard";
import CountingHelp from "../counting/CountingHelp";
import type { CountingEntry } from "../counting/countingEntry";

/**
 * The year in review's chapters beyond flights, cruises and rail
 * (forgejo#265): stays, places, roadtrips, day tours, rentals, bus rides.
 * One card per chapter the server sent — it sends `null` for a domain this
 * reader does not see, and a null draws nothing rather than a card of zeros.
 * Each card is its own figure: rental days are not travel days, a stay's
 * nights are not a roadtrip's, and nothing here adds them up.
 *
 * Every number opens the rows its chapter counted (`wrapped*` measures,
 * `services/evidence/metricEvidenceWrapped.ts`), scoped to the one year on
 * screen, and the cards close with one "So wird gezählt" for the chapters
 * drawn, spanning the grid they sit in.
 */
export default function WrappedChapterCards({
  chapters,
  count,
  year,
}: {
  chapters: WrappedChapters;
  count: (value: number) => string;
  /** The year in review's one year — the population every chapter counted. */
  year: number;
}): JSX.Element {
  const { t } = useTranslation(["stats"]);
  const { lodging, places, roadtrips, tours, rentals, bus } = chapters;
  const evidence = (key: string, renderedValue: number) => ({
    kind: "metric" as const,
    key,
    scope: { period: "year" as const, year },
    renderedValue,
  });
  const help: CountingEntry[] = [
    lodging !== null && {
      term: t("stats:wrapped.chapters.stays"),
      helpKey: "stats:wrapped.help.stays",
    },
    places !== null && {
      term: t("stats:wrapped.chapters.places"),
      helpKey: "stats:wrapped.help.places",
    },
    roadtrips !== null && {
      term: t("stats:wrapped.chapters.roadtrips"),
      helpKey: "stats:wrapped.help.roadtrips",
    },
    tours !== null && {
      term: t("stats:wrapped.chapters.tours"),
      helpKey: "stats:wrapped.help.tours",
    },
    rentals !== null && {
      term: t("stats:wrapped.chapters.rentals"),
      helpKey: "stats:wrapped.help.rentals",
    },
    bus !== null && { term: t("stats:wrapped.chapters.bus"), helpKey: "stats:wrapped.help.bus" },
  ].filter((entry): entry is CountingEntry => entry !== false);
  return (
    <>
      {lodging !== null && (
        <StatCard
          title={t("stats:wrapped.chapters.stays")}
          value={count(lodging.stays)}
          evidence={evidence("wrappedStayCount", lodging.stays)}
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
          evidence={evidence("wrappedPlaceVisitCount", places.visits)}
          description={t("stats:wrapped.chapters.placesDesc", { count: places.places })}
        />
      )}
      {roadtrips !== null && (
        <StatCard
          title={t("stats:wrapped.chapters.roadtrips")}
          value={count(roadtrips.roadtrips)}
          evidence={evidence("wrappedRoadtripCount", roadtrips.roadtrips)}
          description={t("stats:wrapped.chapters.roadtripsDesc")}
        />
      )}
      {tours !== null && (
        <StatCard
          title={t("stats:wrapped.chapters.tours")}
          value={count(tours.tours)}
          evidence={evidence("wrappedTourCount", tours.tours)}
          description={t("stats:wrapped.chapters.toursDesc")}
        />
      )}
      {rentals !== null && (
        <StatCard
          title={t("stats:wrapped.chapters.rentals")}
          value={count(rentals.rentals)}
          evidence={evidence("wrappedRentalCount", rentals.rentals)}
          description={t("stats:wrapped.chapters.rentalsDesc", { count: rentals.days })}
        />
      )}
      {bus !== null && (
        <StatCard
          title={t("stats:wrapped.chapters.bus")}
          value={count(bus.rides)}
          evidence={evidence("wrappedBusRideCount", bus.rides)}
          description={[
            // Unknown stays unknown (review I4): no "0 km" for unmeasured rides.
            bus.km === null
              ? t("stats:wrapped.chapters.busNoKm")
              : t("stats:wrapped.chapters.busDesc", { km: count(bus.km) }),
            (bus.unmeasured ?? 0) > 0 && bus.km !== null
              ? t("stats:wrapped.chapters.busUnmeasured", { count: bus.unmeasured })
              : null,
            bus.nights > 0 ? t("stats:wrapped.chapters.busNights", { count: bus.nights }) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        />
      )}
      {help.length > 0 && (
        <div className="col-span-full">
          <CountingHelp testId="wrapped-chapters-help" entries={help} />
        </div>
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
