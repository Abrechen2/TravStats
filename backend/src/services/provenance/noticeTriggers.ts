import { addWriteObserver, prisma, type WriteEvent } from "../../db";
import logger from "../../utils/logger";
import { syncProvenanceNotices } from "./notices";

/**
 * Keeps the stored contradiction notices current WITHOUT the inbox badge's poll doing the work.
 *
 * Every write to one of the nine provenance models marks its account dirty; a few seconds later
 * (one pass per account however many writes there were, and after any enclosing transaction has
 * committed) `syncProvenanceNotices` brings the stored rows in line. `/provenance/notices/count`
 * then reads those rows — one indexed count. A write that does not name its account
 * (`updateMany` by something else) is caught by the boot sweep and by opening the inbox.
 */
const MODELS = new Set([
  "Trip",
  "Flight",
  "LodgingStay",
  "RailJourney",
  "BusJourney",
  "FerryJourney",
  "RentalBooking",
  "Cruise",
  "PlaceVisit",
]);
const WRITES = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
]);
let debounceMs = 5_000;
/** Test seam: how long a burst of writes waits before its pass. */
export function setNoticeDebounceMs(ms: number): void {
  debounceMs = ms;
}
const BOOT_SWEEP_MS = 60_000;

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** The account a write belongs to, when the event names it; null otherwise. */
export function writerOf(event: WriteEvent): string | null {
  const result = event.result as { userId?: unknown } | null;
  if (result && typeof result.userId === "string") return result.userId;
  const args = event.args as { where?: { userId?: unknown }; data?: { userId?: unknown } } | null;
  if (typeof args?.where?.userId === "string") return args.where.userId;
  if (typeof args?.data?.userId === "string") return args.data.userId;
  return null;
}

function schedule(userId: string): void {
  if (timers.has(userId)) return;
  const timer = setTimeout(() => {
    timers.delete(userId);
    syncProvenanceNotices(userId).catch((error) =>
      logger.warn({ message: "provenance_notice_sync_failed", error })
    );
  }, debounceMs);
  timer.unref();
  timers.set(userId, timer);
}

/** Exported for the test that drives it without waiting on the timer. */
export function onProvenanceWrite(event: WriteEvent): void {
  if (!event.model || !MODELS.has(event.model) || !WRITES.has(event.operation)) return;
  const userId = writerOf(event);
  if (userId) schedule(userId);
}

/** Boot-time: every write feeds the notices. Not installed under test unless a test asks. */
export function installProvenanceNoticeTriggers(): () => void {
  const remove = addWriteObserver(onProvenanceWrite);
  // Writes that could not name their account, and anything done while the server was down.
  const boot = setTimeout(() => {
    void sweepAllAccounts().catch((error) =>
      logger.warn({ message: "provenance_notice_boot_sweep_failed", error })
    );
  }, BOOT_SWEEP_MS);
  boot.unref();
  return () => {
    remove();
    clearTimeout(boot);
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  };
}

/** Accounts that hold anything remembered are the only ones a contradiction can involve. */
export async function sweepAllAccounts(): Promise<number> {
  const rows = await prisma.$queryRaw<{ user_id: string }[]>`
    SELECT DISTINCT user_id FROM (
      SELECT user_id FROM trips WHERE provenance = 'remembered'
      UNION ALL SELECT user_id FROM flights WHERE provenance = 'remembered'
      UNION ALL SELECT user_id FROM lodging_stays WHERE provenance = 'remembered'
      UNION ALL SELECT user_id FROM rail_journeys WHERE provenance = 'remembered'
      UNION ALL SELECT user_id FROM bus_journeys WHERE provenance = 'remembered'
      UNION ALL SELECT user_id FROM ferry_journeys WHERE provenance = 'remembered'
      UNION ALL SELECT user_id FROM rental_bookings WHERE provenance = 'remembered'
      UNION ALL SELECT user_id FROM cruises WHERE provenance = 'remembered'
      UNION ALL SELECT user_id FROM place_visits WHERE provenance = 'remembered'
      UNION ALL SELECT user_id FROM provenance_notices WHERE status = 'pending'
    ) t`;
  for (const { user_id } of rows) await syncProvenanceNotices(user_id);
  return rows.length;
}
