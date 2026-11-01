import { prisma } from "../../db";
import type { Prisma } from "../../prisma";
import { sendPlaceVisitReminder } from "../emailService";
import { entryReminderMessage } from "../notifications/messages";
import { serializeTime } from "../../shared/time/wire";
import { REMINDER_USER_SELECT } from "./prefs";
import { runAnchorReminders, type Anchor } from "./anchorReminders";

/**
 * Place-visit reminders (forgejo#405): a visit planned for a time in the
 * future, announced `lead` hours ahead. Only a visit with a CLOCK is
 * announced: `visitedAtUtc` set and precision `minute`. A visit known to the
 * day, or one with only the legacy mixed `visitedAt` column (web wall clock
 * stored as UTC), has no honest instant, so it abstains. The area is the
 * places domain (`poi`) and follows its switch like every other.
 */

const VISIT_SELECT = {
  id: true,
  tripId: true,
  notes: true,
  visitedAtUtc: true,
  visitedZone: true,
  visitedPrecision: true,
  place: { select: { id: true, name: true, address: true, city: true, country: true } },
  user: REMINDER_USER_SELECT,
} as const;

type VisitRow = Prisma.PlaceVisitGetPayload<{ select: typeof VISIT_SELECT }>;

export function visitAnchor(row: {
  visitedAtUtc: Date | null;
  visitedPrecision: string | null;
}): Anchor | null {
  if (!row.visitedAtUtc || row.visitedPrecision !== "minute") return null;
  return {
    at: row.visitedAtUtc,
    key: `${row.visitedAtUtc.toISOString()}|${row.visitedPrecision}`,
  };
}

export async function checkPlaceVisitReminders(now: Date): Promise<void> {
  await runAnchorReminders<VisitRow>(
    {
      domain: "poi",
      due: (start, end) =>
        prisma.placeVisit.findMany({
          where: { visitedAtUtc: { gte: start, lte: end }, visitedPrecision: "minute" },
          select: VISIT_SELECT,
        }),
      anchorsOf: (row) => {
        const anchor = visitAnchor(row);
        return anchor ? [anchor] : [];
      },
      tripId: (row) => row.tripId,
      ids: (row) => ({ placeId: row.place.id, visitId: row.id }),
      render: (row, anchor, hoursAhead, locale) =>
        entryReminderMessage(
          "poi",
          {
            label: row.place.name,
            detail: [row.place.address, row.place.city].filter(Boolean).join(", ") || null,
            at: anchor.at,
            zone: row.visitedZone,
          },
          hoursAhead,
          locale
        ),
      send: (row, anchor, user, hoursAhead) =>
        sendPlaceVisitReminder(
          {
            id: row.id,
            tripId: row.tripId,
            placeId: row.place.id,
            placeName: row.place.name,
            address: row.place.address,
            city: row.place.city,
            country: row.place.country,
            notes: row.notes,
            visitAt: serializeTime(anchor.at, row.visitedZone, "minute"),
          },
          user,
          hoursAhead
        ),
    },
    now
  );
}
