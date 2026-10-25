import type { Db } from "./db";
import { initialLocationProvider } from "./services/locationProvider/initialProvider";

/**
 * The login `seed.ts` writes (`demo` / `demo123`): the built-in demo account,
 * so it is flagged `isDemo` as the demo seeders flag theirs (see
 * `scripts/backfillDemoFlag.ts`). A new one goes through
 * `initialLocationProvider` like every account (TravTrack plan T8), which
 * keeps a demo account on `none`; an existing one is left as it is.
 */
export async function seedLoginUser(
  db: Db,
  input: { username: string; passwordHash: string }
): Promise<{ id: string; username: string; isDemo: boolean }> {
  return db.$transaction(async (tx) => {
    const select = { id: true, username: true, isDemo: true } as const;
    const existing = await tx.user.findUnique({ where: { username: input.username }, select });
    if (existing) return existing;
    const user = await tx.user.create({
      data: { username: input.username, passwordHash: input.passwordHash, isDemo: true },
      select,
    });
    await initialLocationProvider(tx, user.id);
    return user;
  });
}
