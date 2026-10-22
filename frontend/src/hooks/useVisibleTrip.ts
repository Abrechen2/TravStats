import { useMemo } from "react";
import type { Trip } from "../types";
import { useEnabledDomains } from "./useEnabledDomains";
import { useDomainVisible } from "./useDomainVisible";

/** Filter every trip surface through the same domain gates. */
export function useVisibleTrip(trip: Trip | null) {
  // Domain-gating: a disabled domain's segments are stripped from the trip copy
  // every tab reads; a banner below the tab bar says they are hidden, not lost.
  const { isEnabled } = useEnabledDomains();
  const cruiseEnabled = isEnabled("cruise");
  const lodgingEnabled = isEnabled("lodging");
  // Rail asks the domain alone; rental, bus and ferry the beta switch AND the domain.
  const railVisible = useDomainVisible("rail");
  const rentalVisible = useDomainVisible("rental");
  const busVisible = useDomainVisible("bus");
  const ferryVisible = useDomainVisible("ferry");
  const displayTrip = useMemo<Trip | null>(() => {
    const allShown =
      cruiseEnabled && lodgingEnabled && railVisible && rentalVisible && busVisible && ferryVisible;
    if (trip === null || allShown) return trip;
    return {
      ...trip,
      cruises: cruiseEnabled ? trip.cruises : [],
      lodgingStays: lodgingEnabled ? trip.lodgingStays : [],
      railJourneys: railVisible ? trip.railJourneys : [],
      rentalBookings: rentalVisible ? trip.rentalBookings : [],
      busJourneys: busVisible ? trip.busJourneys : [],
      ferryJourneys: ferryVisible ? trip.ferryJourneys : [],
      _count: trip._count
        ? {
            ...trip._count,
            ...(cruiseEnabled ? {} : { cruises: 0 }),
            ...(lodgingEnabled ? {} : { lodgingStays: 0 }),
          }
        : trip._count,
    };
  }, [trip, cruiseEnabled, lodgingEnabled, railVisible, rentalVisible, busVisible, ferryVisible]);
  const hiddenCruiseCount = cruiseEnabled
    ? 0
    : (trip?._count?.cruises ?? trip?.cruises?.length ?? 0);
  const hiddenLodgingCount = lodgingEnabled
    ? 0
    : (trip?._count?.lodgingStays ?? trip?.lodgingStays?.length ?? 0);
  return { displayTrip, hiddenCruiseCount, hiddenLodgingCount };
}
