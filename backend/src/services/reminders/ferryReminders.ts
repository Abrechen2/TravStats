import { prisma } from "../../db";
import type { Prisma } from "../../prisma";
import { sendFerryReminder } from "../emailService";
import type { FerryReminderData } from "../email/ferryBusReminderContent";
import { railTimes } from "../rail/timesDto";
import { REMINDER_USER_SELECT, dueWhere, runSingleRideReminders } from "./singleRideReminders";

/**
 * The ferry half of the departure-reminder scheduler (dennis/TravStats
 * forgejo#293): rail's windows and switches, one mail per crossing. A
 * crossing stores real UTC instants and each port's zone, read through rail's
 * `railTimes`, so the mail shows both ends on their port's own clock.
 */

const sentReminders = new Set<string>();

const CROSSING_SELECT = {
  id: true,
  tripId: true,
  operator: true,
  vesselName: true,
  fareClass: true,
  cabinType: true,
  seat: true,
  vehicleType: true,
  vehicleRegistration: true,
  bookingReference: true,
  ticketReference: true,
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
  user: REMINDER_USER_SELECT,
} as const;

type CrossingRow = Prisma.FerryJourneyGetPayload<{ select: typeof CROSSING_SELECT }>;

function toReminderCrossing(row: CrossingRow): FerryReminderData {
  const { departure, arrival } = railTimes(row);
  return {
    id: row.id,
    tripId: row.tripId,
    operator: row.operator,
    vesselName: row.vesselName,
    fareClass: row.fareClass,
    cabinType: row.cabinType,
    seat: row.seat,
    vehicleType: row.vehicleType,
    vehicleRegistration: row.vehicleRegistration,
    bookingReference: row.bookingReference,
    ticketReference: row.ticketReference,
    depStationName: row.depStationName,
    arrStationName: row.arrStationName,
    // The window query only reads rows with a departure, so it is never null.
    departure: departure!,
    arrival,
  };
}

export async function checkFerryReminders(now: Date): Promise<void> {
  await runSingleRideReminders(
    {
      domain: "ferry",
      sent: sentReminders,
      due: (start, end) =>
        prisma.ferryJourney.findMany({ where: dueWhere(start, end), select: CROSSING_SELECT }),
      send: (row, user, hoursAhead) => sendFerryReminder(toReminderCrossing(row), user, hoursAhead),
    },
    now
  );
}
