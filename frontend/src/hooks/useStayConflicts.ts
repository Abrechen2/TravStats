import { useCallback, useRef, useState } from "react";

import { listStayPage } from "../lib/api/lodging";
import { findStayConflicts, type StayConflict } from "../lib/lodgingConflicts";
import { exactDays, type StaySpan } from "../shared/lodgingOverlap";
import { logger } from "../lib/logger";

/** What the lookup found for one set of dates; `conflicts: null` = the lookup failed. */
interface ConflictVerdict {
  key: string;
  conflicts: StayConflict[] | null;
}

/** The notice to show, or null. */
export interface StayConflictNotice {
  conflicts: readonly StayConflict[];
  /** The lookup itself failed: nothing is known, and the notice says so. */
  unchecked: boolean;
}

/**
 * The overlap notice behind saving a stay (forgejo#229, forgejo#227).
 *
 * `check` runs when the user presses Save with dates the lookup has not seen:
 * it asks the server which stays touch those days (a coarse superset) and
 * applies the exact rule (`shared/lodgingOverlap.ts`) to them. The result is
 * `"clear"` - go on and save - or `"ask"` - the notice is up and nothing was
 * sent. It never blocks: `acknowledge` ("Absichtlich so") makes the same dates
 * `"clear"` from then on, and the owner's legitimate parallel rooms are always
 * one click away.
 *
 * Everything is keyed by `dateKey`, a string that changes with the dates: edit
 * a date and the notice disappears and the next Save looks again, with no
 * effect for every setter to remember.
 *
 * A lookup that FAILS is not a clear. Saying nothing would let "could not
 * check" pass for "no overlap" (a provider failure turned into silent
 * success); the notice says it, offers a retry, and still lets the user save.
 */
export function useStayConflicts({
  lodgingId,
  stayId,
  dateKey,
}: {
  lodgingId: string;
  stayId: string | null;
  dateKey: string;
}): {
  notice: StayConflictNotice | null;
  checking: boolean;
  check: (span: StaySpan) => Promise<"clear" | "ask">;
  acknowledge: () => void;
} {
  const [verdict, setVerdict] = useState<ConflictVerdict | null>(null);
  const [acknowledgedKey, setAcknowledgedKey] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  // A ref as well: "Absichtlich so" acknowledges and saves in one handler, and
  // the save must see the acknowledgement before React has re-rendered.
  const acknowledged = useRef<string | null>(null);
  const pending = useRef<Promise<"clear" | "ask"> | null>(null);

  const check = useCallback(
    async (span: StaySpan): Promise<"clear" | "ask"> => {
      if (acknowledged.current === dateKey) return "clear";
      const days = exactDays(span);
      // Cancelled, undated or month/year: it names no days, so it can collide with nothing.
      if (days === null) return "clear";
      if (verdict?.key === dateKey && verdict.conflicts !== null) {
        return verdict.conflicts.length > 0 ? "ask" : "clear";
      }
      // Two presses of Save in one breath share one lookup: the second must
      // wait for the first's answer, not start another.
      if (pending.current !== null) return pending.current;
      const lookup = (async (): Promise<"clear" | "ask"> => {
        setChecking(true);
        try {
          const page = await listStayPage({ from: days.from, to: days.to, limit: 100 });
          const conflicts = findStayConflicts(span, page.rows, { stayId, lodgingId });
          setVerdict({ key: dateKey, conflicts });
          return conflicts.length > 0 ? "ask" : "clear";
        } catch (err: unknown) {
          logger.error("useStayConflicts: could not look up overlapping stays", err);
          setVerdict({ key: dateKey, conflicts: null });
          return "ask";
        } finally {
          pending.current = null;
          setChecking(false);
        }
      })();
      pending.current = lookup;
      return lookup;
    },
    [dateKey, lodgingId, stayId, verdict]
  );

  const acknowledge = useCallback((): void => {
    acknowledged.current = dateKey;
    setAcknowledgedKey(dateKey);
  }, [dateKey]);

  const shown =
    verdict !== null && verdict.key === dateKey && acknowledgedKey !== dateKey ? verdict : null;
  const notice: StayConflictNotice | null =
    shown === null || (shown.conflicts !== null && shown.conflicts.length === 0)
      ? null
      : { conflicts: shown.conflicts ?? [], unchecked: shown.conflicts === null };

  return { notice, checking, check, acknowledge };
}
