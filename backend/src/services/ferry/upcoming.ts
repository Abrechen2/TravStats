import { prisma } from "../../db";
import type { UpcomingEntry } from "../../routes/upcoming";
import { CLOCKLESS_PRECISIONS, endHasClock, rideEndsAt } from "../../shared/railClock";
import { railTimes } from "../rail/timesDto";

/** Candidates read per page; departed day-only crossings are filtered after the read. */
const PAGE = 50;
/** The widest a date-only crossing's day can reach behind "now" (UTC-12 to UTC+14). */
const DAY_WINDOW_MS = 38 * 3_600_000;

/**
 * The next ferry crossing — the bus and rail rule, unchanged: a timed crossing
 * from now on, a date-only one until its day is over at the port. /upcoming
 * named every transport but this one, so a booked crossing never showed as
 * the next thing although the dashboard could already draw and link it.
 */
export async function nextFerry(userId: string): Promise<UpcomingEntry | null> {
  const now = new Date();
  let cursor: string | undefined;
  for (;;) {
    const rides = await prisma.ferryJourney.findMany({
      where: {
        userId,
        status: { not: "cancelled" },
        OR: [
          { departureTime: { gte: now } },
          {
            depPrecision: { in: [...CLOCKLESS_PRECISIONS] },
            departureTime: { gte: new Date(now.getTime() - DAY_WINDOW_MS) },
          },
        ],
      },
      orderBy: [{ departureTime: "asc" }, { id: "asc" }],
      take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        operator: true,
        vesselName: true,
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
    if (ride) {
      return {
        domain: "ferry",
        id: ride.id,
        detailId: ride.id,
        startsAt: ride.departureTime.toISOString(),
        startsAtPrecision: endHasClock(ride.depPrecision) ? "minute" : "day",
        times: railTimes(ride),
        tripId: ride.tripId,
        tripName: ride.trip?.name ?? null,
        primary: `${ride.depStationName} → ${ride.arrStationName}`,
        secondary: [ride.operator, ride.vesselName].filter(Boolean).join(" · ") || null,
      };
    }
    if (rides.length < PAGE) return null;
    cursor = rides[rides.length - 1].id;
  }
}
