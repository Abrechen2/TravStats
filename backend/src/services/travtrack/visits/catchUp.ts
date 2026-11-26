/**
 * The plugins' catch-up as the visit projection runs it (`enrich.ts`, `catchUpPlugins`): with
 * the day loop, and on its own when no day is owed — it used to run only behind an owed day,
 * so a quiet account never asked about a stop again once its day had been acknowledged.
 */
import { prisma } from "../../../db";
import logger from "../../../utils/logger";
import { profileZoneOf } from "../../../shared/time/profileZone";
import { historyGeneration } from "../../locationEvidence/generation";
import type { AskDeps } from "../../plugins/ask";
import { catchUpPlugins, type EnrichContext } from "./enrich";
import { writeEvidence } from "./stopFindings";

/** Writes a caught-up answer under the publish rules; false when the finding moved on. */
export const catchUpWriter =
  (userId: string) =>
  async (id: string, evidence: Record<string, unknown>): Promise<boolean> => {
    const generation = await historyGeneration(prisma, userId);
    return (await writeEvidence({ userId }, generation, id, evidence)) === "created";
  };

/** The catch-up alone, for a run with no day owed. False when it failed (logged). */
export async function catchUpOnly(
  userId: string,
  result: EnrichContext["result"],
  now: Date,
  pluginDeps: AskDeps | undefined
): Promise<boolean> {
  if ((await prisma.suggestionPlugin.count({ where: { userId, enabled: true } })) === 0)
    return true;
  try {
    await catchUpPlugins(
      {
        userId,
        profileZone: (await profileZoneOf(userId)).zone,
        calendar: null,
        plugins: true,
        pluginDeps,
        result,
      },
      catchUpWriter(userId),
      now
    );
    return true;
  } catch (error) {
    logger.warn({
      operation: "travtrack.visits.catchUpFailed",
      userId,
      error: (error as Error).message,
    });
    return false;
  }
}
