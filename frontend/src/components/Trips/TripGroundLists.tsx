import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { railDeparture } from "../../lib/entityTimes";
import { formatStationTime } from "../../lib/railTime";
import type { Trip } from "../../types";
import type { TripBusJourney } from "../../types/bus";
import { TripRailList } from "../rail/RailTripCard";
import { dateLocaleForLanguage } from "../../lib/units";

/** How many train and bus rides a trip holds — what the logistics tab calls "empty" by. */
export function groundRideCount(
  trip: Pick<Trip, "railJourneys" | "busJourneys" | "ferryJourneys">
): number {
  return (
    (trip.railJourneys?.length ?? 0) +
    (trip.busJourneys?.length ?? 0) +
    (trip.ferryJourneys?.length ?? 0)
  );
}

/**
 * The trip's bus rides as a logistics list, beside its train rides (forgejo#288
 * sweep). Times are the departure terminal's own clock, as the rail list's.
 */
export function TripBusList({ rides }: { rides: readonly TripBusJourney[] }): JSX.Element {
  const { t, i18n } = useTranslation(["bus"]);
  const locale = dateLocaleForLanguage(i18n.language);
  return (
    <div
      className="rounded-xl"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
      data-testid="trip-bus-list"
    >
      <div className="px-4 py-3 text-sm font-semibold">
        {t("bus:trip.listTitle", { count: rides.length })}
      </div>
      <ul className="text-sm">
        {rides.map((r) => {
          const departure = railDeparture(r);
          return (
            <li
              key={r.id}
              className="flex justify-between gap-3 px-4 py-2.5"
              style={{ borderTop: "1px solid var(--color-border)" }}
            >
              <span style={{ color: "var(--text-muted)" }}>
                {departure ? formatStationTime(departure, locale) : "—"}
              </span>
              <span className="flex-1">
                {r.depStationName} → {r.arrStationName}
              </span>
              <Link to={`/bus/${r.id}`} className="text-xs" style={{ color: "var(--accent)" }}>
                {t("bus:trip.open")}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The train and bus lists of the logistics tab; each only when the trip holds some. */
export function TripGroundLists({ trip }: { trip: Trip }): JSX.Element {
  const rail = trip.railJourneys ?? [];
  const bus = trip.busJourneys ?? [];
  return (
    <>
      {(trip.ferryJourneys ?? []).map((ride) => (
        <Link key={ride.id} to={`/ferry/${ride.id}`}>
          ⛴ {ride.depStationName} → {ride.arrStationName}
        </Link>
      ))}
      {rail.length > 0 && <TripRailList journeys={rail} />}
      {bus.length > 0 && <TripBusList rides={bus} />}
    </>
  );
}
