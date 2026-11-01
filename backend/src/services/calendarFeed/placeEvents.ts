import { prisma } from "../../db";
import { classifyVisit } from "../../shared/placeCounting";
import { now } from "../../shared/time/clock";
import { visitTime } from "../places/timesDto";
import { boundsOfInstants } from "./eventBounds";
import { FEED_ROW_LIMIT, feedEvent, iconOf, joined, present, type FeedContext } from "./feedEvent";
import type { IcsEvent } from "./ics";

/**
 * Planned place visits in the calendar feed (forgejo#405).
 *
 * The feed's old reason for leaving places out — "a visit is a record of
 * having been somewhere, nothing in it is scheduled" — is contradicted by the
 * domain's own counting rule: a visit dated in the FUTURE is a plan
 * (`placeCounting.classifyVisit` → `planned`) that the trip page already
 * shows. Those, and only those, are drawn: a visit that has happened is
 * history, not an appointment, and an undated or month-vague one has no day a
 * calendar could put it on (`boundsOfInstants` abstains).
 *
 * A visit known to the minute at a known zone goes out as that instant, one
 * known to the day as an all-day event on the place's calendar day.
 */
export async function placeVisitEvents(ctx: FeedContext): Promise<IcsEvent[]> {
  const at = now();
  const rows = await prisma.placeVisit.findMany({
    where: {
      userId: ctx.userId,
      // Coarse filter; `classifyVisit` below is the rule. The margin lets a
      // legacy fake-UTC `visitedAt` (hours off) reach it.
      OR: [
        { visitedAtUtc: { gt: at } },
        { visitedAtUtc: null, visitedAt: { gt: new Date(at.getTime() - 2 * 86_400_000) } },
      ],
    },
    orderBy: [{ visitedAtUtc: "asc" }, { visitedAt: "asc" }, { id: "asc" }],
    take: FEED_ROW_LIMIT,
    select: {
      id: true,
      visitedAt: true,
      visitedAtUtc: true,
      visitedZone: true,
      visitedPrecision: true,
      updatedAt: true,
      place: { select: { id: true, name: true, city: true, country: true } },
      trip: { select: { name: true } },
    },
  });
  return rows
    .filter((v) => classifyVisit(v, at) === "planned")
    .map((v) =>
      feedEvent(
        {
          uid: `place-visit-${v.id}`,
          summary: joined(" ", iconOf("poi"), v.place.name),
          bounds: boundsOfInstants(visitTime(v), null),
          location: joined(", ", v.place.name, v.place.city, v.place.country) || null,
          details: [v.trip ? `🧳 ${v.trip.name}` : null],
          path: `/places/${v.place.id}`,
          updatedAt: v.updatedAt,
        },
        ctx
      )
    )
    .filter(present);
}
