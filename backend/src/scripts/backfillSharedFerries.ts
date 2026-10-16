import { prisma } from "../db";
import { backfillSharedFerries } from "../services/sharing/backfillFerries";
import logger from "../utils/logger";

/**
 * Rollout of the sharing rework (spec 2026-10-16, §10, step 3). Dry run by
 * default; only `--apply` writes. Run on the RC server's copy of production
 * first; apply on production only on the owner's word.
 */
async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const result = await backfillSharedFerries({ apply });
  logger.info({ operation: "sharing_backfill_ferries", apply, ...result });
  process.stdout.write(`${apply ? "APPLIED" : "DRY RUN"} ${JSON.stringify(result)}\n`);
}

main()
  .catch((err: unknown) => {
    logger.error({ operation: "sharing_backfill_ferries_failed", err });
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
