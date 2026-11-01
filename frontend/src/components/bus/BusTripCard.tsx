import type { JSX } from "react";
import { LegTripCard, type LegTripDomain } from "../legs/LegTripCard";
import type { TripBusJourney } from "../../types/bus";

const BUS: LegTripDomain = {
  ns: "bus",
  icon: "🚌",
  openKey: "bus:tripCard.open",
  service: (ride) => {
    const bus = ride as TripBusJourney;
    return [bus.operator, bus.lineName].filter(Boolean).join(" · ") || null;
  },
};

/** A bus ride on the trip timeline (forgejo#180). */
export function BusTripCard(props: {
  ride: TripBusJourney;
  date: string;
  dateLabel: string;
}): JSX.Element {
  return <LegTripCard domain={BUS} {...props} />;
}
