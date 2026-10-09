import logger from "./logger";

/**
 * The one failure rule of the badge check (forgejo#256–#265, unified at the
 * integration of the three statistics branches).
 *
 * A badge check reads many sources — the flight and cruise insight rows, the
 * lodging, place, roadtrip and tour insights, rentals, bus rides, the
 * cross-domain trips. When one of them throws, the badges it feeds answer
 * `SKIP`: the planner leaves their stored rows exactly as they are — neither
 * revoked by a progress of 0 nor written — and checks every other badge as
 * usual. A failed read is not a fallen measure, and one bad row in a rarely
 * used domain must not stop every badge update for the user.
 */
export const SKIP = "skip" as const;

/** A badge's answer from its own module: its progress, or `SKIP` for this run. */
export type BadgeVerdict = { isUnlocked: boolean; progress: number } | typeof SKIP;

/**
 * Runs one source of the badge check; a throw is logged and the source comes
 * back `null`, which its module turns into `SKIP` for every rule it owns.
 */
export async function settleBadgeSource<T>(
  userId: string,
  source: string,
  work: () => Promise<T>
): Promise<T | null> {
  try {
    return await work();
  } catch (error) {
    logger.error({
      operation: "badge_source_failed",
      message: "A badge source failed during the check; its badges keep their stored rows",
      context: { userId, source },
      error: {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return null;
  }
}
