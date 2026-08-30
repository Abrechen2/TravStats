/**
 * Place Address Backfill Scheduler
 *
 * The owner's rule is that a place ALWAYS ends up with an address, not only a
 * place created from now on. Both creation paths fill their own row
 * (`routes/places.ts` on save, `routes/placeLists/curated.ts` on tick), but
 * that leaves every place recorded before those paths existed — and on a real
 * instance that is all of them, because the catalogue never carried an address
 * to begin with.
 *
 * So the gap is closed from behind, without asking anyone to press anything:
 * once shortly after boot, then daily. Both runs are the same bounded,
 * throttled pass, and a row that already has its address costs no request.
 *
 * Why not on demand, when a list or a detail page is opened: the geocoder is
 * limited to one request per second, so a user opening a list of 54 places
 * would either wait or watch fields appear one by one for a minute. A sweep
 * that has already run is invisible, which is the point.
 */

import cron from "node-cron";
import logger from "../utils/logger";
import { prisma } from "../db";
import { completeMissingPlaceAddresses } from "../services/places/addressBackfill";

/** 03:20 UTC — after the airline-logo sweep at 03:00, so the two do not
 *  contend for the same outbound budget. */
const CRON_EXPRESSION = "20 3 * * *";

/**
 * Delay before the boot run. Long enough that it cannot compete with startup
 * (migrations, seeds, the first requests), short enough that someone who just
 * upgraded sees addresses appear within the same session.
 */
const BOOT_DELAY_MS = 2 * 60 * 1000;

let schedulerTask: cron.ScheduledTask | null = null;
let bootTimer: NodeJS.Timeout | null = null;

/**
 * One pass over every user that owns at least one incomplete place.
 *
 * Users are handled one after another on purpose: the geocoder queue is
 * process-wide and sequential, so running them concurrently would build a
 * longer queue rather than finish sooner, and it would let one user with a
 * large catalogue subscription monopolise it.
 */
export async function runPlaceAddressBackfill(): Promise<{ users: number; filled: number }> {
  const groups = await prisma.place.groupBy({
    by: ["userId"],
    where: { OR: [{ address: null }, { city: null }, { country: null }] },
  });

  let filled = 0;
  for (const group of groups) {
    const result = await completeMissingPlaceAddresses(group.userId);
    filled += result.filled;
  }

  if (groups.length > 0) {
    logger.info(
      { operation: "place_address_backfill_sweep", users: groups.length, filled },
      "Place address backfill sweep finished",
    );
  }
  return { users: groups.length, filled };
}

export function startPlaceAddressBackfillScheduler(): void {
  if (schedulerTask) return;

  bootTimer = setTimeout(() => {
    void runPlaceAddressBackfill().catch((error) => {
      logger.warn(
        { operation: "place_address_backfill_boot_error", error },
        "Boot place address backfill failed",
      );
    });
  }, BOOT_DELAY_MS);
  // Never hold the process open for this — a shutdown during the delay should
  // just drop the run; the daily one will pick it up.
  bootTimer.unref?.();

  schedulerTask = cron.schedule(CRON_EXPRESSION, async () => {
    try {
      await runPlaceAddressBackfill();
    } catch (error) {
      logger.warn(
        { operation: "place_address_backfill_error", error },
        "Daily place address backfill failed",
      );
    }
  });

  logger.info(
    { operation: "place_address_backfill_scheduler_started", cron: CRON_EXPRESSION },
    "place address backfill scheduler started",
  );
}

export function stopPlaceAddressBackfillScheduler(): void {
  if (bootTimer) clearTimeout(bootTimer);
  bootTimer = null;
  schedulerTask?.stop();
  schedulerTask = null;
}
