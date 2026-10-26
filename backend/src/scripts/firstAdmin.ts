import type { Db } from "../db";
import { initialLocationProvider } from "../services/locationProvider/initialProvider";

/**
 * The admin `createAdmin.ts` makes on an empty instance — created like every
 * other account (TravTrack plan T8): in one transaction with its initial
 * location provider, so it starts on TravTrack where TravTrack is on.
 */
export async function createFirstAdmin(
  db: Db,
  input: { username: string; passwordHash: string }
): Promise<{ id: string; username: string }> {
  return db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { username: input.username, passwordHash: input.passwordHash, isAdmin: true },
      select: { id: true, username: true },
    });
    await initialLocationProvider(tx, user.id);
    return user;
  });
}
