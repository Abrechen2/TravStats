import { prisma } from "../../db";
import type { Prisma } from "../../prisma";
import { sendRoadtripStationReminder } from "../emailService";
import { entryReminderMessage } from "../notifications/messages";
import { daysBetween } from "../../shared/time/localDate";
import { localDay } from "../../shared/time/instant";
import { serializeDay } from "../../shared/time/wire";
import { anchorFromLocal } from "./due";
import { REMINDER_USER_SELECT } from "./prefs";
import { runAnchorReminders, type Anchor } from "./anchorReminders";

/**
 * Roadtrip station reminders (forgejo#405): "your next stop is X", `lead`
 * hours before the arrival.
 *
 * A station stores the DAY it is reached, not a clock (ADR 0002: precision
 * `day`, the instant its day begins at the station). The honest anchor for a
 * day is a morning default in the STATION's zone, the same device lodging uses
 * for a check-in day without a time: {@link STATION_ARRIVAL_TIME}. A station
 * without a zone has no calendar day to read, so it abstains. A pass-through
 * is announced like a night; a route correction ("via point") is not a stop
 * and never is.
 */
export const STATION_ARRIVAL_TIME = "09:00";

const DAY_MS = 24 * 3_600_000;

const STATION_SELECT = {
  id: true,
  title: true,
  startUtc: true,
  endUtc: true,
  stopZone: true,
  tripId: true,
  route: { select: { id: true, name: true, tripId: true, user: REMINDER_USER_SELECT } },
  lodgingStay: { select: { lodging: { select: { name: true } } } },
} as const;

type StationRow = Prisma.TripStopGetPayload<{ select: typeof STATION_SELECT }>;
type Route = NonNullable<StationRow["route"]>;
type Row = Omit<StationRow, "route"> & { route: Route; user: Route["user"] };

export function stationAnchor(row: {
  startUtc: Date | null;
  stopZone: string | null;
}): Anchor | null {
  if (!row.startUtc || !row.stopZone) return null;
  const day = localDay(row.startUtc, row.stopZone);
  return {
    at: anchorFromLocal(day, STATION_ARRIVAL_TIME, row.stopZone),
    key: `${row.startUtc.toISOString()}|${row.stopZone}`,
  };
}

export async function checkRoadtripReminders(now: Date): Promise<void> {
  await runAnchorReminders<Row>(
    {
      domain: "roadtrip",
      due: async (start, end) => {
        // The day's start precedes the 09:00 anchor by at most a day plus the
        // zone's offset; the exact test is `isDue` on the computed anchor.
        const rows = await prisma.tripStop.findMany({
          where: {
            viaPoint: false,
            stopZone: { not: null },
            startUtc: {
              gte: new Date(start.getTime() - 2 * DAY_MS),
              lte: new Date(end.getTime() + DAY_MS),
            },
            route: { kind: "roadtrip" },
          },
          select: STATION_SELECT,
        });
        return rows.flatMap((row) =>
          row.route ? [{ ...row, route: row.route, user: row.route.user }] : []
        );
      },
      anchorsOf: (row) => {
        const anchor = stationAnchor(row);
        return anchor ? [anchor] : [];
      },
      tripId: (row) => row.route.tripId ?? row.tripId,
      ids: (row) => ({ stationId: row.id, roadtripId: row.route.id }),
      render: (row, anchor, hoursAhead, locale) =>
        entryReminderMessage(
          "roadtrip",
          // The day only: the message carries no clock for a station.
          { label: row.title, detail: row.route.name, at: null, zone: row.stopZone },
          hoursAhead,
          locale
        ),
      send: (row, anchor, user, hoursAhead) => {
        const zone = row.stopZone as string;
        const arrival = row.startUtc ? localDay(row.startUtc, zone) : null;
        const departure = row.endUtc ? localDay(row.endUtc, zone) : null;
        const nights = arrival && departure ? daysBetween(arrival, departure) : null;
        return sendRoadtripStationReminder(
          {
            id: row.id,
            tripId: row.route.tripId ?? row.tripId,
            roadtripId: row.route.id,
            roadtripName: row.route.name,
            stationName: row.title,
            stayName: row.lodgingStay?.lodging.name ?? null,
            arrivalDay: arrival ? serializeDay(arrival, zone) : null,
            nights: nights !== null && nights > 0 ? nights : null,
          },
          user,
          hoursAhead
        );
      },
    },
    now
  );
}
