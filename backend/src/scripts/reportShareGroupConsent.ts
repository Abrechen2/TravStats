import { prisma } from "../db";
import { unconsentedPairs } from "../services/sharing/backfillFerries";
import logger from "../utils/logger";

/**
 * Read-only: share groups whose members include a pair with no accepted
 * consent (spec 2026-10-16, §10, step 2). Prints usernames only — no emails,
 * no names.
 */
async function main(): Promise<void> {
  const report = await unconsentedPairs();
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(report.flatMap((r) => r.pairs.flat()))] } },
    select: { id: true, username: true },
  });
  const name = new Map(users.map((u) => [u.id, u.username]));
  for (const entry of report) {
    const pairs = entry.pairs.map(([a, b]) => `${name.get(a)} <-> ${name.get(b)}`).join(", ");
    process.stdout.write(`group ${entry.groupId}: ${pairs}\n`);
  }
  process.stdout.write(`${report.length} group(s) with unconsented pairs\n`);
}

main()
  .catch((err: unknown) => {
    logger.error({ operation: "sharing_report_consent_failed", err });
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
