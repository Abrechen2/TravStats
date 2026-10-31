import { prisma } from "../../db";
import { profileZoneFromSettings } from "../../shared/time/profileZone";
import { REMINDER_USER_SELECT, wantsApp, wantsMail, type ReminderDomain } from "./prefs";

/**
 * The check right before a send. The query that found a reminder is seconds to
 * minutes old; in between the entry may have been deleted, cancelled or moved,
 * and the user may have switched the domain or the channel off. Anything that
 * no longer holds drops the reminder.
 *
 * `anchorKey` is the entry's time as the finder read it ({@link keyOf}); an
 * entry whose key changed since is NOT sent from the stale read — the next run
 * sees the new time.
 */
export const isoOf = (d: Date | null | undefined): string => (d ? d.toISOString() : "");

async function currentKey(
  domain: ReminderDomain,
  entryId: string,
  userId: string,
  accountZone: string
) {
  switch (domain) {
    case "flight": {
      const row = await prisma.flight.findFirst({
        where: { id: entryId, userId, status: "scheduled" },
        select: { departureTime: true },
      });
      return row ? isoOf(row.departureTime) : null;
    }
    case "cruise": {
      const stop = await prisma.cruiseStop.findFirst({
        where: { dayNumber: 1, cruise: { id: entryId, userId, status: "scheduled" } },
        select: { departureUtc: true },
      });
      return stop ? isoOf(stop.departureUtc) : null;
    }
    case "rail": {
      const row = await prisma.railJourney.findFirst({
        where: { id: entryId, userId, status: "scheduled" },
        select: { departureTime: true },
      });
      return row ? isoOf(row.departureTime) : null;
    }
    case "bus": {
      const row = await prisma.busJourney.findFirst({
        where: { id: entryId, userId, status: "scheduled" },
        select: { departureTime: true },
      });
      return row ? isoOf(row.departureTime) : null;
    }
    case "ferry": {
      const row = await prisma.ferryJourney.findFirst({
        where: { id: entryId, userId, status: "scheduled" },
        select: { departureTime: true },
      });
      return row ? isoOf(row.departureTime) : null;
    }
    case "lodging": {
      const row = await prisma.lodgingStay.findFirst({
        where: { id: entryId, userId, status: "scheduled" },
        select: {
          checkIn: true,
          checkInDate: true,
          checkInAt: true,
          stayZone: true,
          datePrecision: true,
        },
      });
      return row ? lodgingKey(row, accountZone) : null;
    }
  }
}

/** Everything the lodging anchor is computed from, so a change to any of it re-keys the stay. */
export const lodgingKey = (
  s: {
    checkIn: Date | null;
    checkInDate: Date | null;
    checkInAt: Date | null;
    stayZone: string | null;
    datePrecision: string;
  },
  accountZone: string
): string =>
  [
    isoOf(s.checkIn),
    isoOf(s.checkInDate),
    isoOf(s.checkInAt),
    s.stayZone ?? `account:${accountZone}`,
    s.datePrecision,
  ].join("|");

export type Channel = "mail" | "app";

export async function stillEligible(args: {
  userId: string;
  domain: ReminderDomain;
  entryId: string;
  hours: number;
  channel: Channel;
  anchorKey: string;
}): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { isActive: true, ...REMINDER_USER_SELECT.select },
  });
  if (!user || !user.isActive) return false;
  const wanted =
    args.channel === "mail"
      ? wantsMail(user, args.domain, args.hours)
      : wantsApp(user, args.domain, args.hours);
  if (!wanted) return false;
  return (
    (await currentKey(
      args.domain,
      args.entryId,
      args.userId,
      profileZoneFromSettings(user.settings?.data).zone
    )) === args.anchorKey
  );
}
