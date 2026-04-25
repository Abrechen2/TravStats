/**
 * Re-evaluate every user against the current achievement seed list.
 *
 * Run this once after a deploy that changes achievement definitions
 * (new achievements, balance changes, fixes to checker logic). The
 * regular `checkAndUpdateAchievements` only fires on flight/cruise
 * mutations — without this script, users whose data already qualifies
 * for newly-added or fixed achievements would have to add a fresh
 * record before they unlock.
 *
 * Idempotent: existing unlocks are skipped (the checker has an
 * `alreadyUnlocked` short-circuit). Safe to run multiple times.
 *
 * Usage:
 *   cd backend
 *   DATABASE_URL=... npx tsx scripts/recheckAllAchievements.ts
 *
 * For prod (Underworld) just run it inside the running container:
 *   docker exec -it TravStats node dist/scripts/recheckAllAchievements.js
 */

import { PrismaClient } from "@prisma/client";
import { checkAndUpdateAchievements } from "../src/utils/achievements";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, username: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Re-checking achievements for ${users.length} active user(s)...`);

  let totalNewUnlocks = 0;
  let usersWithUnlocks = 0;

  for (const user of users) {
    try {
      const newlyUnlocked = await checkAndUpdateAchievements(user.id);
      if (newlyUnlocked.length > 0) {
        usersWithUnlocks += 1;
        totalNewUnlocks += newlyUnlocked.length;
        const names = newlyUnlocked
          .map((ua) => ua.achievement?.name ?? ua.achievementId)
          .join(", ");
        console.log(
          `  ${user.username.padEnd(24)} +${newlyUnlocked.length}: ${names}`,
        );
      } else {
        console.log(`  ${user.username.padEnd(24)} (no new unlocks)`);
      }
    } catch (err) {
      console.error(`  ${user.username}: FAILED — ${(err as Error).message}`);
    }
  }

  console.log("");
  console.log(
    `Done. ${totalNewUnlocks} new unlock(s) across ${usersWithUnlocks} user(s).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
