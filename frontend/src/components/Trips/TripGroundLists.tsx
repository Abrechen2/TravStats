import type { JSX } from "react";
import { LogisticsTable } from "./LogisticsTable";
import { useTranslation } from "../../hooks/useTranslation";
import { railDeparture } from "../../lib/entityTimes";
import { formatStationTime } from "../../lib/railTime";
import type { Trip } from "../../types";
import { dateLocaleForLanguage } from "../../lib/units";

/** How many train, bus and ferry rides a trip holds — what the logistics tab calls "empty" by. */
export function groundRideCount(
  trip: Pick<Trip, "railJourneys" | "busJourneys" | "ferryJourneys">
): number {
  return (
    (trip.railJourneys?.length ?? 0) +
    (trip.busJourneys?.length ?? 0) +
    (trip.ferryJourneys?.length ?? 0)
  );
}

type GroundRide = Parameters<typeof railDeparture>[0] & {
  id: string;
  depStationName: string;
  arrStationName: string;
};

/**
 * One ground domain as a logistics panel, drawn like the flight and cruise
 * panels beside it. Owner, 2026-11-20: a ferry stood there as a bare link
 * with an emoji, and train and bus rides had a look of their own. Times are
 * the departure terminal's own clock.
 */
function GroundPanel({
  title,
  rides,
  basePath,
  testId,
}: {
  title: string;
  rides: readonly GroundRide[];
  basePath: string;
  testId: string;
}): JSX.Element {
  const { t, i18n } = useTranslation(["trips", "common"]);
  const locale = dateLocaleForLanguage(i18n.language);
  return (
    <LogisticsTable
      title={title}
      tableKey={`trip-ground-${testId}`}
      testId={testId}
      whatLabel={t("trips:detail.logistics.route")}
      rows={rides.map((r) => {
        const departure = railDeparture(r);
        return {
          id: r.id,
          sortWhen: departure?.utc ?? null,
          when: departure ? formatStationTime(departure, locale) : "—",
          sortWhat: `${r.depStationName} ${r.arrStationName}`,
          what: `${r.depStationName} → ${r.arrStationName}`,
          to: `${basePath}/${r.id}`,
        };
      })}
    />
  );
}

/** The train, bus and ferry panels of the logistics tab; each only when the trip holds some. */
export function TripGroundLists({ trip }: { trip: Trip }): JSX.Element {
  const { t } = useTranslation(["trips"]);
  const rail = trip.railJourneys ?? [];
  const bus = trip.busJourneys ?? [];
  const ferry = trip.ferryJourneys ?? [];
  return (
    <>
      {rail.length > 0 && (
        <GroundPanel
          title={t("trips:detail.logistics.rail")}
          rides={rail}
          basePath="/rail"
          testId="trip-rail-list"
        />
      )}
      {bus.length > 0 && (
        <GroundPanel
          title={t("trips:detail.logistics.bus")}
          rides={bus}
          basePath="/bus"
          testId="trip-bus-list"
        />
      )}
      {ferry.length > 0 && (
        <GroundPanel
          title={t("trips:detail.logistics.ferries")}
          rides={ferry}
          basePath="/ferry"
          testId="trip-ferry-list"
        />
      )}
    </>
  );
}
