import { prisma } from "../../db";
import { sendCruiseReminder } from "../emailService";
import { zoneOf } from "../../shared/time/zoneOf";
import { serializeTime, type TimePrecision } from "../../shared/time/wire";
import logger from "../../utils/logger";
import { cruiseTimes } from "../cruise/timesDto";
import { reminderDomainEnabled } from "./domainEnabled";

/**
 * The cruise half of the departure-reminder scheduler. Same 24h/2h-before
 * semantics as flights (`flightReminders.ts`), anchored on the embarkation
 * stop's real UTC instant.
 *
 * A cruise's own `startDate`/`startZone` are DAY precision only (ADR 0002)
 * — no hour survives on the cruise row itself. The hour lives on the
 * embarkation port call, `CruiseStop` with `dayNumber: 1`, in `departureUtc`
 * once that call has one (a parser reading, or a manual edit that gave the
 * stop a time). A cruise whose day-1 stop carries no `departureUtc` gets NO
 * hour-precision reminder — this is an honest abstention (no assumed
 * boarding time), not a bug; see the redesign report.
 *
 * `departureUtc` is already a real UTC instant (no LEGACY_FAKE_UTC class for
 * cruises), so — unlike flights — no re-normalisation step is needed before
 * the precise window compare.
 */

const sentReminders = new Set<string>();

const REMINDER_WINDOWS = [
  { hoursAhead: 24, key: "24h" },
  { hoursAhead: 2, key: "2h" },
] as const;

const isPrecision = (value: string | null): value is TimePrecision =>
  value !== null && ["minute", "day", "month", "year", "unknown"].includes(value);

export async function checkCruiseReminders(now: Date): Promise<void> {
  for (const { hoursAhead, key } of REMINDER_WINDOWS) {
    const target = now.getTime() + hoursAhead * 60 * 60 * 1000;
    const preciseStart = new Date(target - 15 * 60 * 1000);
    const preciseEnd = new Date(target + 15 * 60 * 1000);

    let stops;
    try {
      stops = await prisma.cruiseStop.findMany({
        where: {
          dayNumber: 1,
          departureUtc: { gte: preciseStart, lte: preciseEnd },
          cruise: { status: "scheduled" },
        },
        select: {
          id: true,
          departureUtc: true,
          stopZone: true,
          timePrecision: true,
          port: {
            select: { name: true, city: true, country: true, timezone: true, lat: true, lon: true },
          },
          cruise: {
            select: {
              id: true,
              tripId: true,
              cruiseLine: true,
              shipNameOverride: true,
              cabinType: true,
              cabinNumber: true,
              deck: true,
              routeName: true,
              bookingReference: true,
              startDate: true,
              endDate: true,
              startDay: true,
              endDay: true,
              startZone: true,
              endZone: true,
              ship: { select: { name: true } },
              user: {
                select: {
                  notificationEmail: true,
                  notifyBefore24h: true,
                  notifyBefore2h: true,
                  settings: { select: { data: true, enabledDomains: true } },
                },
              },
            },
          },
        },
      });
    } catch (error) {
      logger.error({
        operation: "reminder_scheduler_query_failed",
        domain: "cruise",
        hoursAhead,
        error: { message: error instanceof Error ? error.message : "Unknown error" },
      });
      continue;
    }

    for (const stop of stops) {
      if (!stop.departureUtc) continue; // narrows for TS; the where clause already guarantees this
      const reminderKey = `cruise:${stop.cruise.id}-${key}`;
      if (sentReminders.has(reminderKey)) continue;

      const { user } = stop.cruise;
      const shouldSend =
        user.notificationEmail !== null &&
        reminderDomainEnabled(user.settings, "cruise") &&
        ((key === "24h" && user.notifyBefore24h) || (key === "2h" && user.notifyBefore2h));
      if (!shouldSend) continue;

      try {
        const zone =
          stop.stopZone ??
          (stop.port
            ? zoneOf({ catalogueZone: stop.port.timezone, lat: stop.port.lat, lon: stop.port.lon })
            : null);
        const precision: TimePrecision = isPrecision(stop.timePrecision)
          ? stop.timePrecision
          : "minute";
        const departure = serializeTime(stop.departureUtc, zone, precision);

        await sendCruiseReminder(
          {
            id: stop.cruise.id,
            tripId: stop.cruise.tripId,
            shipName: stop.cruise.ship?.name ?? stop.cruise.shipNameOverride,
            cruiseLine: stop.cruise.cruiseLine,
            portName: stop.port?.name ?? null,
            portCity: stop.port?.city ?? null,
            portCountry: stop.port?.country ?? null,
            cabinType: stop.cruise.cabinType,
            cabinNumber: stop.cruise.cabinNumber,
            deck: stop.cruise.deck,
            routeName: stop.cruise.routeName,
            bookingReference: stop.cruise.bookingReference,
            departure,
            endDay: cruiseTimes(stop.cruise).end,
          },
          { notificationEmail: user.notificationEmail, settingsData: user.settings?.data ?? null },
          hoursAhead
        );
        sentReminders.add(reminderKey);
      } catch (error) {
        logger.error({
          operation: "reminder_scheduler_send_failed",
          domain: "cruise",
          cruiseId: stop.cruise.id,
          hoursAhead,
          error: { message: error instanceof Error ? error.message : "Unknown error" },
        });
      }
    }
  }
}
