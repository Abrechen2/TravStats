import { prisma } from "../../db";
import type { Prisma } from "../../prisma";
import { sendBusReminder } from "../emailService";
import type { BusReminderData } from "../email/ferryBusReminderContent";
import { railTimes } from "../rail/timesDto";
import { REMINDER_USER_SELECT, dueWhere, runSingleRideReminders } from "./singleRideReminders";

/**
 * The bus half of the departure-reminder scheduler: rail's windows and
 * switches, one mail per coach ride. A ride stores real UTC instants and each
 * terminal's zone, read through rail's `railTimes` (as `withBusTimes` does),
 * so the mail shows both ends on their terminal's own clock.
 */

const sentReminders = new Set<string>();

const RIDE_SELECT = {
  id: true,
  tripId: true,
  operator: true,
  lineName: true,
  fareClass: true,
  seat: true,
  bookingReference: true,
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

type RideRow = Prisma.BusJourneyGetPayload<{ select: typeof RIDE_SELECT }>;

function toReminderRide(row: RideRow): BusReminderData {
  const { departure, arrival } = railTimes(row);
  return {
    id: row.id,
    tripId: row.tripId,
    operator: row.operator,
    lineName: row.lineName,
    fareClass: row.fareClass,
    seat: row.seat,
    bookingReference: row.bookingReference,
    depStationName: row.depStationName,
    arrStationName: row.arrStationName,
    // The window query only reads rows with a departure, so it is never null.
    departure: departure!,
    arrival,
  };
}

export async function checkBusReminders(now: Date): Promise<void> {
  await runSingleRideReminders(
    {
      domain: "bus",
      sent: sentReminders,
      due: (start, end) =>
        prisma.busJourney.findMany({ where: dueWhere(start, end), select: RIDE_SELECT }),
      send: (row, user, hoursAhead) => sendBusReminder(toReminderRide(row), user, hoursAhead),
    },
    now
  );
}
