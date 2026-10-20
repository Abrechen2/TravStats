import { prisma } from "../../db";
import { fromDbDate } from "../../shared/time/localDate";
import { serializeDay } from "../../shared/time/wire";
import { STATIONS_ONLY } from "../roadtrip/roadtripSummary";
import { stationTimes } from "../roadtrip/timesDto";
import { boundsOfDaySpan } from "./eventBounds";
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
 * Roadtrips and day tours in the calendar feed (forgejo#310). Both sit behind
 * the roadtrip domain — tours share its switch and its beta key, as in the UI.
 *
 * A roadtrip is drawn as its STATIONS, one all-day event each over the days of
 * its nights: that is where the traveller is on a given day, which is the
 * question a calendar answers. A route correction (`viaPoint`) is a bend in the
 * line, not a place, and stays out.
 */

const TOUR_ICON = "🧭";

export async function roadtripStationEvents(ctx: FeedContext): Promise<IcsEvent[]> {
  const from = queryCutoff(ctx);
  const rows = await prisma.tripStop.findMany({
    where: {
      ...STATIONS_ONLY,
      route: { userId: ctx.userId, kind: "roadtrip" },
      OR: [
        { endUtc: { gte: from } },
        { endDate: { gte: from } },
        { startUtc: { gte: from } },
        { startDate: { gte: from } },
      ],
    },
    orderBy: [{ startUtc: "asc" }, { startDate: "asc" }, { id: "asc" }],
    take: FEED_ROW_LIMIT,
    select: {
      id: true,
      title: true,
      startDate: true,
      endDate: true,
      startUtc: true,
      endUtc: true,
      stopZone: true,
      updatedAt: true,
      route: { select: { id: true, name: true } },
      lodgingStay: { select: { lodging: { select: { name: true } } } },
    },
  });
  return rows
    .map((s) => {
      const route = s.route;
      if (!route) return null; // the `where` above only matches stops on a route
      const times = stationTimes(s);
      return feedEvent(
        {
          uid: `roadtrip-station-${s.id}`,
          summary: joined(" ", iconOf("roadtrip"), joined(" · ", route.name, s.title)),
          bounds: boundsOfDaySpan(times.start, times.end),
          location: s.title,
          details: [s.lodgingStay ? `${iconOf("lodging")} ${s.lodgingStay.lodging.name}` : null],
          path: `/roadtrips/${route.id}`,
          updatedAt: s.updatedAt,
        },
        ctx
      );
    })
    .filter(present);
}

/**
 * A day tour on its day. Its start minute is local to a place a tour may not
 * have yet, so no instant can be made of it here — the day is what is known.
 */
export async function tourEvents(ctx: FeedContext): Promise<IcsEvent[]> {
  const rows = await prisma.tripRoute.findMany({
    where: { userId: ctx.userId, kind: "tour", tourDate: { gte: queryCutoff(ctx) } },
    orderBy: [{ tourDate: "asc" }, { id: "asc" }],
    take: FEED_ROW_LIMIT,
    select: {
      id: true,
      name: true,
      tourDate: true,
      updatedAt: true,
      trip: { select: { name: true } },
    },
  });
  return rows
    .map((t) => {
      const day = t.tourDate ? serializeDay(fromDbDate(t.tourDate), null) : null;
      return feedEvent(
        {
          uid: `tour-${t.id}`,
          summary: joined(" ", TOUR_ICON, t.name),
          bounds: boundsOfDaySpan(day, day),
          details: [t.trip ? `🧳 ${t.trip.name}` : null],
          path: `/tours/${t.id}`,
          updatedAt: t.updatedAt,
        },
        ctx
      );
    })
    .filter(present);
}
