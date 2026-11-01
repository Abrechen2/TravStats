/** Ferry crossings (dennis/TravStats forgejo#293). */
import type { JSX } from "react";
import { LegTripCard, type LegTripDomain } from "../legs/LegTripCard";
import type { TripFerryJourney } from "../../types/ferry";

const FERRY: LegTripDomain = {
  ns: "ferry",
  icon: "⛴",
  openKey: "ferry:details",
  service: (ride) => {
    const ferry = ride as TripFerryJourney;
    return [ferry.operator, ferry.vesselName].filter(Boolean).join(" · ") || null;
  },
};

/** A ferry crossing on the trip timeline. */
export function FerryTripCard(props: {
  ride: TripFerryJourney;
  date: string;
  dateLabel: string;
}): JSX.Element {
  return <LegTripCard domain={FERRY} {...props} />;
}
