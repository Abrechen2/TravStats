import { prisma } from "../../db";
import type { UpcomingEntry } from "../../routes/upcoming";
import { CLOCKLESS_PRECISIONS, endHasClock, rideEndsAt } from "../../shared/railClock";
import { withBusTimes } from "./timesDto";

/** Upcoming timed departures, or open tickets through their terminal's day. */
export async function nextBus(userId: string): Promise<UpcomingEntry | null> {
  const now = new Date();
  let cursor: string | undefined;
  // Page candidates so expired day-only tickets cannot hide a later departure.
  for (;;) {
    const rides = await prisma.busJourney.findMany({
      where: {
        userId,
        status: { not: "cancelled" },
        OR: [
          { departureTime: { gte: now } },
          {
            depPrecision: { in: [...CLOCKLESS_PRECISIONS] },
            departureTime: { gte: new Date(now.getTime() - 38 * 3_600_000) },
          },
        ],
      },
      orderBy: [{ departureTime: "asc" }, { id: "asc" }],
      take: 50,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        operator: true,
        lineName: true,
        depStationName: true,
        arrStationName: true,
        departureTime: true,
        arrivalTime: true,
        actualDepartureTime: true,
        actualArrivalTime: true,
        depTimezone: true,
        arrTimezone: true,
        depPrecision: true,
        arrPrecision: true,
        tripId: true,
        trip: { select: { name: true } },
      },
    });
    const ride = rides.find((r) =>
      endHasClock(r.depPrecision)
        ? r.departureTime >= now
        : rideEndsAt({ ...r, arrivalTime: null, arrTimezone: null, arrPrecision: null }) > now
    );
    if (ride)
      return {
        domain: "bus",
        id: ride.id,
        detailId: ride.id,
        startsAt: ride.departureTime.toISOString(),
        startsAtPrecision: endHasClock(ride.depPrecision) ? "minute" : "day",
        times: withBusTimes(ride).times,
        tripId: ride.tripId,
        tripName: ride.trip?.name ?? null,
        primary: [ride.operator, ride.depStationName].filter(Boolean).join(" · "),
        secondary: [ride.lineName, ride.arrStationName].filter(Boolean).join(" · "),
      };
    if (rides.length < 50) return null;
    cursor = rides[rides.length - 1].id;
  }
}
