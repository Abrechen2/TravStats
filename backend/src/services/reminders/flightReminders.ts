import { prisma } from "../../db";
import { sendFlightReminder } from "../emailService";
import { getCachedAirport } from "../airportCache";
import { normalizeFlightTimeUtc, type FlightTimeSemantics } from "../../utils/timezone";
import { flightTimes } from "../flights/timesDto";
import { resolveFlightDuration } from "../../shared/flightDuration";
import logger from "../../utils/logger";
import { notifyReminder } from "../notifications/dispatcher";

/**
 * The flight half of the departure-reminder scheduler (moved out of
 * `reminderScheduler.ts` 2026-09-27 so cruise/rail/lodging can each own their
 * file under the 800-line ratchet). The window-matching logic below is
 * UNCHANGED from the original — only the display data gathered for a flight
 * that IS due changed (times DTO + duration for the redesigned email).
 */

// Track sent reminders to avoid duplicates within the same process lifetime.
const sentReminders = new Set<string>();

// DB pre-filter is widened by this much beyond the precise reminder window
// to catch LEGACY_FAKE_UTC rows whose stored value can be off by up to ~14h
// from the real UTC instant (extreme airport offsets like Pacific). 16 hours
// covers everything globally with a comfortable margin.
const PRE_FILTER_PADDING_MS = 16 * 60 * 60 * 1000;

const REMINDER_WINDOWS = [
  { hoursAhead: 24, key: "24h" },
  { hoursAhead: 2, key: "2h" },
] as const;

async function resolveTz(iata: string | null, icao: string | null): Promise<string | null> {
  for (const code of [iata, icao]) {
    if (!code) continue;
    try {
      const airport = await getCachedAirport(code);
      if (airport?.timezone) return airport.timezone;
    } catch {
      // ignore lookup error, try next code
    }
  }
  return null;
}

/** The stored zone if the flight carries one, else a best-effort catalogue lookup. */
async function catalogueZone(
  stored: string | null,
  iata: string | null,
  icao: string | null
): Promise<string | null> {
  return stored ?? resolveTz(iata, icao);
}

/**
 * Push the reminder to the user's paired phone(s). Fire-and-forget: the e-mail
 * path and the cron must never wait for the relay or fail because of it. The
 * dispatcher applies the phone's own reminder switch and dedupes per flight
 * and window, so calling it on every run inside the window is safe.
 */
function announceReminder(
  userId: string,
  flight: Parameters<typeof notifyReminder>[1],
  key: "24h" | "2h"
): void {
  const log = (error: unknown) =>
    logger.warn(
      {
        operation: "flight_reminder_push_failed",
        flightId: flight.id,
        key,
        error: error instanceof Error ? error.message : String(error),
      },
      "Push for a departure reminder failed"
    );
  try {
    notifyReminder(userId, flight, key).catch(log);
  } catch (error) {
    log(error);
  }
}

export async function checkFlightReminders(now: Date): Promise<void> {
  for (const { hoursAhead, key } of REMINDER_WINDOWS) {
    const target = now.getTime() + hoursAhead * 60 * 60 * 1000;
    const preciseStart = target - 15 * 60 * 1000;
    const preciseEnd = target + 15 * 60 * 1000;
    // Pre-filter is wider so we can catch LEGACY rows whose stored timestamp
    // is offset from real UTC by the airport's tz; we then re-check the
    // normalized UTC against preciseStart/End below.
    const preFilterStart = new Date(target - PRE_FILTER_PADDING_MS);
    const preFilterEnd = new Date(target + PRE_FILTER_PADDING_MS);

    let flights;
    try {
      flights = await prisma.flight.findMany({
        where: {
          status: "scheduled",
          departureTime: { gte: preFilterStart, lte: preFilterEnd },
        },
        select: {
          id: true,
          tripId: true,
          flightNumber: true,
          airline: true,
          aircraft: true,
          seatNumber: true,
          depName: true,
          depIata: true,
          depIcao: true,
          depLat: true,
          depLon: true,
          depTimezone: true,
          depTimeSemantics: true,
          depPrecision: true,
          arrName: true,
          arrIata: true,
          arrIcao: true,
          arrLat: true,
          arrLon: true,
          arrTimezone: true,
          arrTimeSemantics: true,
          arrPrecision: true,
          departureTime: true,
          arrivalTime: true,
          durationMinutes: true,
          actualDeparture: true,
          actualArrival: true,
          runwayDepartureTime: true,
          runwayArrivalTime: true,
          userId: true,
          user: {
            select: {
              notificationEmail: true,
              notifyBefore24h: true,
              notifyBefore2h: true,
              settings: { select: { data: true } },
            },
          },
        },
      });
    } catch (error) {
      logger.error({
        operation: "reminder_scheduler_query_failed",
        domain: "flight",
        hoursAhead,
        error: { message: error instanceof Error ? error.message : "Unknown error" },
      });
      continue;
    }

    for (const flight of flights) {
      const reminderKey = `flight:${flight.id}-${key}`;

      const { user } = flight;
      const shouldEmail =
        !sentReminders.has(reminderKey) &&
        user.notificationEmail !== null &&
        ((key === "24h" && user.notifyBefore24h) || (key === "2h" && user.notifyBefore2h));

      // Normalise the stored departure to a real UTC instant before comparing
      // against the precise reminder window. Pure-UTC rows are returned as-is;
      // LEGACY rows are re-interpreted via the airport's tz.
      const semantics = flight.depTimeSemantics as FlightTimeSemantics;
      const windowDepTz =
        semantics === "UTC" ? null : await resolveTz(flight.depIata, flight.depIcao);
      const realDeparture = normalizeFlightTimeUtc(flight.departureTime, semantics, windowDepTz);
      if (!realDeparture) continue;

      const realMs = realDeparture.getTime();
      if (realMs < preciseStart || realMs > preciseEnd) continue;

      // The phone has its own reminder switch (checked by the dispatcher), so
      // the push does not depend on the e-mail address or the e-mail switches.
      // (A null departure never reaches here: normalising it above returned null.)
      if (flight.departureTime) {
        announceReminder(flight.userId, { ...flight, departureTime: flight.departureTime }, key);
      }

      if (!shouldEmail) continue;

      try {
        const depTz = await catalogueZone(flight.depTimezone, flight.depIata, flight.depIcao);
        const arrTz = await catalogueZone(flight.arrTimezone, flight.arrIata, flight.arrIcao);
        const times = flightTimes(flight, { dep: depTz, arr: arrTz });
        const duration = resolveFlightDuration({
          measuredMinutes: flight.durationMinutes,
          depLat: flight.depLat,
          depLon: flight.depLon,
          arrLat: flight.arrLat,
          arrLon: flight.arrLon,
        });

        await sendFlightReminder(
          {
            id: flight.id,
            tripId: flight.tripId,
            flightNumber: flight.flightNumber,
            airline: flight.airline,
            aircraft: flight.aircraft,
            seatNumber: flight.seatNumber,
            depName: flight.depName,
            depIata: flight.depIata,
            arrName: flight.arrName,
            arrIata: flight.arrIata,
            departure: times.departure,
            arrival: times.arrival,
            durationMinutes: duration?.minutes ?? null,
          },
          { notificationEmail: user.notificationEmail, settingsData: user.settings?.data ?? null },
          hoursAhead
        );
        sentReminders.add(reminderKey);
      } catch (error) {
        logger.error({
          operation: "reminder_scheduler_send_failed",
          domain: "flight",
          flightId: flight.id,
          hoursAhead,
          error: { message: error instanceof Error ? error.message : "Unknown error" },
        });
        // Do not add to sentReminders — allow retry on next run
      }
    }
  }
}
