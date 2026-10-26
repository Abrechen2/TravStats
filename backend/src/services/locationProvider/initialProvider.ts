import type { Prisma } from "../../prisma";
import type { DbTransaction } from "../../db";
import { appVersion } from "../../utils/version";
import { travTrackInstanceOn } from "../travtrack/availability";
import type { LocationProviderKind } from "./kinds";

/**
 * The location provider a NEW account starts with (TravTrack plan T8, spec
 * rule 4: "Default: TravTrack + Companion for new users — only where TravTrack
 * is unlocked; existing users are never switched").
 *
 * Called by every account-creation path inside its transaction —
 * registration (`routes/auth.ts`), the first admin (`routes/setup.ts`), an
 * administrator creating an account (`routes/admin/users.ts`), the
 * `createAdmin` script (`scripts/firstAdmin.ts`) and the dev seed's demo login
 * (`seedLoginUser.ts`, flagged `isDemo`, so it stays `none`) — and by
 * nothing else: an existing account is never moved, and switching TravTrack
 * on later changes nobody. The demo seeds do not call it, and a demo account
 * passed in anyway stays on `none`.
 *
 * With TravTrack on, the settings row gets `locationProvider: "travtrack"`,
 * `rev 0`. Created with the release stamp every new account carries
 * (`whatsNewStamp.ts`), so whichever of the two runs first, neither loses the
 * other. With TravTrack off nothing is written: no row reads as `none`.
 */
export async function initialLocationProvider(
  tx: DbTransaction,
  userId: string
): Promise<LocationProviderKind> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { isDemo: true } });
  if (!user || user.isDemo || !(await travTrackInstanceOn())) return "none";
  await tx.userSettings.upsert({
    where: { userId },
    create: {
      userId,
      data: { whatsNewSeenVersion: appVersion } as unknown as Prisma.InputJsonValue,
      locationProvider: "travtrack",
      locationProviderRev: 0,
    },
    update: { locationProvider: "travtrack", locationProviderRev: 0 },
  });
  return "travtrack";
}
