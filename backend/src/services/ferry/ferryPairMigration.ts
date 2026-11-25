import { prisma } from "../../db";
import logger from "../../utils/logger";
import { readSeaGeometry } from "./ferryGeometry";
import { crossingEnds, crossingsOnPair, findPairRoute } from "./ferryPairRoute";
import { storePairLine } from "./ferryManualRoute";
import { SHARE_TX_TIMEOUT_MS } from "../sharing/propagate";

/**
 * Sort the hand-drawn lines that predate the pair line (GitHub #406). A manual
 * line with no `manualScope` is read as that crossing's own; this gives each one
 * its owner:
 * - the only manual line on its pair of ports becomes the pair line, and the
 *   pair's other crossings are redrawn with it;
 * - several manual lines on one pair (or a pair line already stored) are a
 *   conflict: each keeps its own line (`journey`), nothing is merged or lost.
 * Idempotent: a crossing with a scope is not looked at again.
 */
export async function adoptLegacyManualLines(): Promise<{ adopted: number; kept: number }> {
  const legacy = await prisma.ferryJourney.findMany({
    where: { geometrySource: "manual", manualScope: null },
    orderBy: { createdAt: "asc" },
  });
  const seen = new Set<string>();
  const report = { adopted: 0, kept: 0 };
  for (const crossing of legacy) {
    if (seen.has(crossing.id)) continue;
    const members = await crossingsOnPair(prisma, crossing.userId, crossingEnds(crossing));
    const manual = members.filter((m) => m.ride.geometrySource === "manual");
    const mine = manual.filter((m) => m.ride.manualScope === null).map((m) => m.ride.id);
    mine.forEach((id) => seen.add(id));
    seen.add(crossing.id);
    const line = readSeaGeometry(crossing.geometry);
    const alone =
      manual.length <= 1 &&
      line !== null &&
      (await findPairRoute(prisma, crossing.userId, crossing)) === null;
    await prisma.$transaction(
      async (tx) => {
        if (alone && line) {
          // share-exempt: a boot-time sort of legacy lines, run per account over its own rows.
          const claimed = await tx.ferryJourney.updateMany({
            where: {
              id: crossing.id,
              manualScope: null,
              geometrySource: "manual",
              updatedAt: crossing.updatedAt,
            },
            data: { manualScope: "pair" },
          });
          // Edited since it was read: leave it for the next boot instead of sharing a stale line.
          if (claimed.count !== 1) return;
          await storePairLine(tx, crossing.userId, { ...crossing, manualScope: "pair" }, line);
        } else {
          // share-exempt: a boot-time sort of legacy lines, run per account over its own rows.
          await tx.ferryJourney.updateMany({
            where: { id: { in: [...mine, crossing.id] }, manualScope: null },
            data: { manualScope: "journey" },
          });
        }
      },
      { timeout: SHARE_TX_TIMEOUT_MS }
    );
    if (alone) report.adopted += 1;
    else report.kept += mine.length || 1;
  }
  if (legacy.length > 0)
    logger.info({ operation: "ferry_pair_line_migration", ...report }, "Manual ferry lines sorted");
  return report;
}
