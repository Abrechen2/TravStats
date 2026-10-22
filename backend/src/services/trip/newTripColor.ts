import { prisma, type DbTransaction } from "../../db";
import { TRIP_COLORS } from "../../schemas/trip";

type Db = Pick<DbTransaction, "trip" | "userSettings">;

/**
 * The colour a new trip gets when nothing names one — the one rule every
 * create path asks (forgejo#321, "Reisefarbe für neue Reisen").
 *
 * The account's chosen palette colour when it has one. Otherwise the rotation
 * every path used before the setting existed: the palette entry after the
 * account's trip count, `offset` further on for the n-th trip of a batch
 * created in one go, so a detection run that makes three trips does not paint
 * them all alike.
 *
 * A colour the caller was given explicitly never comes here: an explicit
 * choice always wins over a preference.
 */
export async function newTripColor(userId: string, offset = 0, db: Db = prisma): Promise<string> {
  return (await tripColorSequence(userId, db))(offset);
}

/**
 * The same rule for a batch: two reads up front, then the n-th trip's colour
 * without another query — a detection run can create fifty trips inside one
 * transaction, and fifty extra round trips there are what times it out.
 */
export async function tripColorSequence(
  userId: string,
  db: Db = prisma
): Promise<(offset: number) => string> {
  const chosen = await chosenTripColor(userId, db);
  if (chosen !== null) return () => chosen;
  const count = await db.trip.count({ where: { userId } });
  return (offset) => TRIP_COLORS[(count + offset) % TRIP_COLORS.length];
}

/**
 * The account's chosen colour, or null when it has none (or one the palette
 * no longer holds).
 */
export async function chosenTripColor(userId: string, db: Db = prisma): Promise<string | null> {
  const row = await db.userSettings.findUnique({
    where: { userId },
    select: { tripDefaultColor: true },
  });
  const chosen = row?.tripDefaultColor ?? null;
  return chosen !== null && (TRIP_COLORS as readonly string[]).includes(chosen) ? chosen : null;
}
