import { prisma } from "../db";
import { backfillSharedCruiseRoutes } from "../services/sharing/backfillCruiseRoutes";
import logger from "../utils/logger";

/**
 * One-off after the release that made hand-drawn cruise lines a shared fact (2026-11-24): the
 * groups shared before get the lines without re-sharing. Dry run by default; only `--apply`
 * writes. Run on the RC server's copy of production first; apply on production on the owner's word.
 */
async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const result = await backfillSharedCruiseRoutes({ apply });
  logger.info({ operation: "sharing_backfill_cruise_routes", apply, ...result });
  process.stdout.write(`${apply ? "APPLIED" : "DRY RUN"} ${JSON.stringify(result)}\n`);
}

main()
  .catch((err: unknown) => {
    logger.error({ operation: "sharing_backfill_cruise_routes_failed", err });
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
