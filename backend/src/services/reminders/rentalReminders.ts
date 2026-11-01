import { prisma } from "../../db";
import type { Prisma } from "../../prisma";
import { sendRentalReminder } from "../emailService";
import { entryReminderMessage } from "../notifications/messages";
import { serializeTime, TIME_PRECISIONS, type TimePrecision } from "../../shared/time/wire";
import { REMINDER_USER_SELECT } from "./prefs";
import { runAnchorReminders, type Anchor } from "./anchorReminders";

/**
 * Rental reminders (forgejo#405): one before the pick-up and one before the
 * return, each `lead` hours ahead like every other area. Both anchors are the
 * booking's real instants on their station's clock; a hand-over logged to the
 * day only (precision `day`/`unknown`) has no clock, so "in 2 hours" would be
 * a time nobody printed and that anchor abstains. A cancelled or finished
 * rental (status other than `scheduled`) is not announced.
 */

const RENTAL_SELECT = {
  id: true,
  tripId: true,
  provider: true,
  confirmationNumber: true,
  vehicleClass: true,
  vehicleExample: true,
  licensePlate: true,
  pickupStationName: true,
  pickupAddress: true,
  returnStationName: true,
  returnAddress: true,
  pickupTime: true,
  returnTime: true,
  pickupPrecision: true,
  returnPrecision: true,
  pickupTimezone: true,
  returnTimezone: true,
  user: REMINDER_USER_SELECT,
} as const;

type RentalRow = Prisma.RentalBookingGetPayload<{ select: typeof RENTAL_SELECT }>;

const precisionOf = (value: string): TimePrecision =>
  (TIME_PRECISIONS as readonly string[]).includes(value) ? (value as TimePrecision) : "minute";

export function rentalAnchors(row: RentalRow): Anchor[] {
  const anchors: Anchor[] = [];
  if (row.pickupPrecision === "minute") {
    anchors.push({ part: "pickup", at: row.pickupTime, key: row.pickupTime.toISOString() });
  }
  if (row.returnPrecision === "minute") {
    anchors.push({ part: "return", at: row.returnTime, key: row.returnTime.toISOString() });
  }
  return anchors;
}

export async function checkRentalReminders(now: Date): Promise<void> {
  await runAnchorReminders(
    {
      domain: "rental",
      due: (start, end) =>
        prisma.rentalBooking.findMany({
          where: {
            status: "scheduled",
            OR: [
              { pickupTime: { gte: start, lte: end }, pickupPrecision: "minute" },
              { returnTime: { gte: start, lte: end }, returnPrecision: "minute" },
            ],
          },
          select: RENTAL_SELECT,
        }),
      anchorsOf: rentalAnchors,
      tripId: (row) => row.tripId,
      ids: (row) => ({ rentalId: row.id }),
      render: (row, anchor, hoursAhead, locale) =>
        entryReminderMessage(
          anchor.part === "return" ? "rentalReturn" : "rental",
          {
            label: anchor.part === "return" ? row.returnStationName : row.pickupStationName,
            detail: row.provider,
            at: anchor.at,
            zone: anchor.part === "return" ? row.returnTimezone : row.pickupTimezone,
          },
          hoursAhead,
          locale
        ),
      send: (row, anchor, user, hoursAhead) => {
        return sendRentalReminder(
          {
            id: row.id,
            tripId: row.tripId,
            part: anchor.part === "return" ? "return" : "pickup",
            provider: row.provider,
            confirmationNumber: row.confirmationNumber,
            vehicleClass: row.vehicleClass,
            vehicleExample: row.vehicleExample,
            licensePlate: row.licensePlate,
            pickupStationName: row.pickupStationName,
            pickupAddress: row.pickupAddress,
            returnStationName: row.returnStationName,
            returnAddress: row.returnAddress,
            pickup: serializeTime(
              row.pickupTime,
              row.pickupTimezone,
              precisionOf(row.pickupPrecision)
            ),
            return: serializeTime(
              row.returnTime,
              row.returnTimezone,
              precisionOf(row.returnPrecision)
            ),
          },
          user,
          hoursAhead
        );
      },
    },
    now
  );
}
