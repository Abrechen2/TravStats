import { prisma } from "../../db";
import { cruiseTimes } from "../cruise/timesDto";
import { stayTimes } from "../lodging/timesDto";
import { tripTimes } from "../trips/timesDto";
import { boundsOfDaySpan, boundsOfInstants, boundsOfNights } from "./eventBounds";
import {
  FEED_ROW_LIMIT,
  feedEvent,
  iconOf,
  joined,
  present,
  queryCutoff,
  type FeedContext,
} from "./feedEvent";
import type { IcsEvent } from "./ics";

/**
 * Cruises, stays and trips in the calendar feed (forgejo#310) — the entries
 * that span days. Each reads its `times` through the domain's own builder.
 */

const TRIP_ICON = "🧳";

export async function cruiseEvents(ctx: FeedContext): Promise<IcsEvent[]> {
  const from = queryCutoff(ctx);
  const rows = await prisma.cruise.findMany({
    where: {
      userId: ctx.userId,
      status: { not: "cancelled" },
      // Every day column, so a row the time-model backfill has not reached is found too.
      OR: [
        { endDay: { gte: from } },
        { endDate: { gte: from } },
        { startDay: { gte: from } },
        { startDate: { gte: from } },
      ],
    },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
    take: FEED_ROW_LIMIT,
    select: {
      id: true,
      startDate: true,
      endDate: true,
      startDay: true,
      endDay: true,
      startZone: true,
      endZone: true,
      cruiseLine: true,
      shipNameOverride: true,
      routeName: true,
      updatedAt: true,
      ship: { select: { name: true } },
      departurePort: { select: { name: true } },
      trip: { select: { name: true } },
    },
  });
  return rows
    .map((c) => {
      const times = cruiseTimes(c);
      const ship = c.ship?.name ?? c.shipNameOverride ?? c.cruiseLine;
      return feedEvent(
        {
          uid: `cruise-${c.id}`,
          summary: joined(" ", iconOf("cruise"), joined(" · ", ship, c.routeName) || "—"),
          bounds: boundsOfDaySpan(times.start, times.end),
          location: c.departurePort?.name ?? null,
          details: [c.cruiseLine, c.trip ? `${TRIP_ICON} ${c.trip.name}` : null],
          path: `/cruises/${c.id}`,
          updatedAt: c.updatedAt,
        },
        ctx
      );
    })
    .filter(present);
}

export async function stayEvents(ctx: FeedContext): Promise<IcsEvent[]> {
  const from = queryCutoff(ctx);
  const rows = await prisma.lodgingStay.findMany({
    where: {
      userId: ctx.userId,
      status: { not: "cancelled" },
      OR: [
        { checkOutDate: { gte: from } },
        { checkOut: { gte: from } },
        { checkInDate: { gte: from } },
        { checkIn: { gte: from } },
      ],
    },
    orderBy: [{ checkIn: "asc" }, { id: "asc" }],
    take: FEED_ROW_LIMIT,
    select: {
      id: true,
      checkIn: true,
      checkOut: true,
      checkInDate: true,
      checkOutDate: true,
      checkInAt: true,
      checkOutAt: true,
      stayZone: true,
      datePrecision: true,
      freeCancellationUntil: true,
      freeCancellationOn: true,
      freeCancellationZone: true,
      paymentDueOn: true,
      updatedAt: true,
      lodging: { select: { id: true, name: true, address: true, city: true, country: true } },
      trip: { select: { name: true } },
    },
  });
  return rows
    .map((s) => {
      const times = stayTimes(s);
      // Both hours known: the stay is the time between them. Otherwise its
      // nights, by day — a check-in time alone does not say when it ends.
      const bounds =
        times.checkInAt && times.checkOutAt
          ? boundsOfInstants(times.checkInAt, times.checkOutAt)
          : boundsOfNights(times.checkIn, times.checkOut);
      return feedEvent(
        {
          uid: `stay-${s.id}`,
          summary: joined(" ", iconOf("lodging"), s.lodging.name),
          bounds,
          location: joined(", ", s.lodging.address, s.lodging.city, s.lodging.country) || null,
          details: [s.trip ? `${TRIP_ICON} ${s.trip.name}` : null],
          // A stay has no page of its own; its lodging's page lists it.
          path: `/lodging/${s.lodging.id}`,
          updatedAt: s.updatedAt,
        },
        ctx
      );
    })
    .filter(present);
}

/** Trips are the frame around the domains, not one of them: always in the feed, like `/upcoming`. */
export async function tripEvents(ctx: FeedContext): Promise<IcsEvent[]> {
  const from = queryCutoff(ctx);
  const rows = await prisma.trip.findMany({
    where: {
      userId: ctx.userId,
      status: { not: "cancelled" },
      // Every day column, so a row the time-model backfill has not reached is found too.
      OR: [
        { endDay: { gte: from } },
        { endDate: { gte: from } },
        { startDay: { gte: from } },
        { startDate: { gte: from } },
      ],
    },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
    take: FEED_ROW_LIMIT,
    select: {
      id: true,
      name: true,
      destinationLabel: true,
      startDate: true,
      endDate: true,
      startDay: true,
      endDay: true,
      startZone: true,
      endZone: true,
      updatedAt: true,
    },
  });
  return rows
    .map((t) => {
      const times = tripTimes(t);
      return feedEvent(
        {
          uid: `trip-${t.id}`,
          summary: joined(" ", TRIP_ICON, t.name),
          bounds: boundsOfDaySpan(times.start, times.end),
          location: t.destinationLabel,
          path: `/trips/${t.id}`,
          updatedAt: t.updatedAt,
        },
        ctx
      );
    })
    .filter(present);
}
