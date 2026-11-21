import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { railDeparture } from "../../lib/entityTimes";
import { formatStationTime } from "../../lib/railTime";
import type { Trip } from "../../types";
import { dateLocaleForLanguage } from "../../lib/units";
import { PanelHeader } from "./TripDetailPanels";

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
  const { t, i18n } = useTranslation(["trips"]);
  const locale = dateLocaleForLanguage(i18n.language);
  return (
    <div
      className="rounded-xl"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
      data-testid={testId}
    >
      <PanelHeader>
        {title} ({rides.length})
      </PanelHeader>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            <th className="text-left px-4 py-2">{t("trips:detail.logistics.date")}</th>
            <th className="text-left px-4 py-2">{t("trips:detail.logistics.route")}</th>
            <th className="text-right px-4 py-2">↗</th>
          </tr>
        </thead>
        <tbody>
          {rides.map((r) => {
            const departure = railDeparture(r);
            return (
              <tr key={r.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                <td
                  className="px-4 py-2.5 whitespace-nowrap"
                  style={{ color: "var(--text-muted)" }}
                >
                  {departure ? formatStationTime(departure, locale) : "—"}
                </td>
                <td className="px-4 py-2.5">
                  {r.depStationName} → {r.arrStationName}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link
                    to={`${basePath}/${r.id}`}
                    className="text-xs"
                    style={{ color: "var(--accent)" }}
                  >
                    {t("trips:detail.logistics.open")}
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
