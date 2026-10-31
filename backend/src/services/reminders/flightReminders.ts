import { prisma } from "../../db";
import { sendFlightReminder } from "../emailService";
import { getCachedAirport } from "../airportCache";
import { normalizeFlightTimeUtc, type FlightTimeSemantics } from "../../utils/timezone";
import { flightTimes } from "../flights/timesDto";
import { resolveFlightDuration } from "../../shared/flightDuration";
import logger from "../../utils/logger";
import { reminderMessage } from "../notifications/messages";
import { sendDueReminder } from "./dispatch";
import { isDue, MAX_LATENESS_MS } from "./due";
import { activeLeadHours, leadsFor, REMINDER_USER_SELECT } from "./prefs";

/**
 * The flight half of the departure-reminder scheduler (moved out of
 * `reminderScheduler.ts` 2026-09-27 so cruise/rail/lodging can each own their
 * file under the 800-line ratchet). The window-matching logic below is
 * UNCHANGED from the original — only the display data gathered for a flight
 * that IS due changed (times DTO + duration for the redesigned email).
 */

// DB pre-filter is widened by this much beyond the precise reminder window
// to catch LEGACY_FAKE_UTC rows whose stored value can be off by up to ~14h
// from the real UTC instant (extreme airport offsets like Pacific). 16 hours
// covers everything globally with a comfortable margin.
const PRE_FILTER_PADDING_MS = 16 * 60 * 60 * 1000;

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

export async function checkFlightReminders(now: Date): Promise<void> {
  for (const hoursAhead of await activeLeadHours()) {
    const target = now.getTime() + hoursAhead * 60 * 60 * 1000;
    // Pre-filter is wider so we can catch LEGACY rows whose stored timestamp
    // is offset from real UTC by the airport's tz; we then re-check the
    // normalized UTC with `isDue` below (due at or after `departure - lead`,
    // at most an hour late).
    const preFilterStart = new Date(target - PRE_FILTER_PADDING_MS - MAX_LATENESS_MS);
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
          seatClass: true,
          terminal: true,
          gate: true,
          bookingReference: true,
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
          onlineCheckInOpensAt: true,
          onlineCheckInZone: true,
          userId: true,
          user: REMINDER_USER_SELECT,
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
      const { user } = flight;
      if (!leadsFor(user, "flight").includes(hoursAhead)) continue;
      if (!flight.departureTime) continue;

      // Normalise the stored departure to a real UTC instant before comparing
      // against the reminder window. Pure-UTC rows are returned as-is;
      // LEGACY rows are re-interpreted via the airport's tz.
      const semantics = flight.depTimeSemantics as FlightTimeSemantics;
      const windowDepTz =
        semantics === "UTC" ? null : await resolveTz(flight.depIata, flight.depIcao);
      const realDeparture = normalizeFlightTimeUtc(flight.departureTime, semantics, windowDepTz);
      if (!realDeparture || !isDue(realDeparture, hoursAhead, now)) continue;

      const departureTime = flight.departureTime;
      await sendDueReminder({
        user,
        domain: "flight",
        entryId: flight.id,
        tripId: flight.tripId,
        hours: hoursAhead,
        anchorAt: realDeparture,
        anchorKey: departureTime.toISOString(),
        now,
        render: (locale) => reminderMessage({ ...flight, departureTime }, hoursAhead, locale),
        sendMail: async () => {
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
              seatClass: flight.seatClass,
              terminal: flight.terminal,
              gate: flight.gate,
              bookingReference: flight.bookingReference,
              depName: flight.depName,
              depIata: flight.depIata,
              arrName: flight.arrName,
              arrIata: flight.arrIata,
              departure: times.departure,
              arrival: times.arrival,
              durationMinutes: duration?.minutes ?? null,
            },
            {
              notificationEmail: user.notificationEmail as string,
              settingsData: user.settings?.data ?? null,
            },
            hoursAhead
          );
        },
      });
    }
  }
}
