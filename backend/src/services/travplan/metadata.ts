import type { PlanTransaction } from "./execution";
import type { PlanState } from "./types";
const date = (day: string | null) => (day ? new Date(day + "T00:00:00Z") : null);
/** Feed upcoming-trip views without asserting that any travel has happened. */
export async function mirrorEmptyTrip(tx: PlanTransaction, tripId: string, state: PlanState) {
  const trip = await tx.trip.findUnique({
    where: { id: tripId },
    select: {
      _count: {
        select: {
          flights: true,
          lodgingStays: true,
          railJourneys: true,
          busJourneys: true,
          ferryJourneys: true,
          cruises: true,
          rentalBookings: true,
          journalEntries: true,
          placeVisits: true,
          stops: true,
        },
      },
    },
  });
  if (!trip || Object.values(trip._count).some((n) => n > 0)) return;
  await tx.trip.update({
    where: { id: tripId },
    data: {
      startDate: date(state.startDay),
      endDate: date(state.endDay),
      startDay: date(state.startDay),
      endDay: date(state.endDay),
      startZone: state.timezone,
      endZone: state.timezone,
      destinationLabel: state.destination || null,
    },
  });
}
