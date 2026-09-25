/**
 * `npm run seed:roadtrip-demo -- <username>` — the roadtrip and tour demo
 * (`seedDemo/seedRoadtrips.ts`) into one existing account. Re-runnable: it
 * removes its own "Demo:" rows first. Never point it at an account whose
 * owner did not ask for demo data.
 */
import { prisma } from "./db";
import { seedRoadtripDemo } from "./seedDemo/seedRoadtrips";

async function main(): Promise<void> {
  const username = process.argv[2];
  if (!username) throw new Error("usage: seedRoadtripDemoCli <username>");
  const user = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (!user) throw new Error(`no user named ${username}`);
  const made = await seedRoadtripDemo(user.id);
  process.stdout.write(`seeded roadtrip demo for ${username}: ${JSON.stringify(made)}\n`);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
