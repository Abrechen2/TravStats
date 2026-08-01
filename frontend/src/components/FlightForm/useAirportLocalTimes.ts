import { useEffect, useState } from "react";
import { airportsApi } from "../../lib/api/airports";

interface UseAirportLocalTimesArgs {
  isOpen: boolean;
  depCode: string | null;
  arrCode: string | null;
  /** The zone to report before hydration (and to keep reporting if
   *  hydration never completes) — callers pass their own browser-local
   *  fallback here, computed however they see fit (e.g. Intl). */
  browserTimezone: string;
}

interface UseAirportLocalTimesResult {
  depTimezone: string;
  arrTimezone: string;
  /** True only once BOTH airports resolved a timezone. A half-resolved
   *  pair is never reported as hydrated — see the "half-resolved" test —
   *  because a value that mixes a browser-local wall clock on one side
   *  with an airport-local one on the other is exactly the drift this
   *  hook exists to prevent. */
  hydrated: boolean;
}

/**
 * Resolves the IANA timezones for a departure/arrival airport pair,
 * reporting `hydrated` only once both resolved. Re-resolves whenever
 * `isOpen`, `depCode`, or `arrCode` changes, so callers whose airport
 * codes are editable stay in sync automatically.
 *
 * Until the FIRST hydration completes (or if it never does — an airport
 * miss, a network error), both zones report `browserTimezone`. Once
 * hydrated, a re-resolution (triggered by a code change) never un-hydrates
 * mid-flight: the last known-good pair is held until the new lookup either
 * completes (the new pair replaces it) or definitively fails (only then
 * does it fall back to `browserTimezone`). Never un-hydrating during the
 * resolve window matters because a consumer may submit using whatever this
 * hook currently reports at any instant — a synchronous reset to
 * `browserTimezone` while the on-screen value was still airport-local
 * would pair a stale wall clock with the wrong zone basis.
 */
export function useAirportLocalTimes({
  isOpen,
  depCode,
  arrCode,
  browserTimezone,
}: UseAirportLocalTimesArgs): UseAirportLocalTimesResult {
  const [depTimezone, setDepTimezone] = useState(browserTimezone);
  const [arrTimezone, setArrTimezone] = useState(browserTimezone);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    void (async () => {
      const [depAirport, arrAirport] = await Promise.all([
        depCode ? airportsApi.getByCode(depCode).catch(() => null) : Promise.resolve(null),
        arrCode ? airportsApi.getByCode(arrCode).catch(() => null) : Promise.resolve(null),
      ]);
      // Guards against a stale response from an earlier, superseded lookup
      // landing after a newer one: React runs this effect's cleanup (which
      // flips `cancelled`) before starting the next effect instance, so an
      // in-flight promise from a prior depCode/arrCode/isOpen combination
      // can never apply its result once a newer resolution has started.
      if (cancelled) return;

      const dTz = depAirport?.timezone ?? null;
      const aTz = arrAirport?.timezone ?? null;
      if (dTz && aTz) {
        // Both resolved — apply the new pair.
        setDepTimezone(dTz);
        setArrTimezone(aTz);
        setHydrated(true);
      } else {
        // Definitive failure: this lookup will not produce a usable pair.
        // Only now fall back to the browser zone — never synchronously at
        // the top of the effect, which would un-hydrate an already-good
        // pair for the entire resolve window even when the new lookup is
        // about to succeed.
        setDepTimezone(browserTimezone);
        setArrTimezone(browserTimezone);
        setHydrated(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, depCode, arrCode, browserTimezone]);

  return { depTimezone, arrTimezone, hydrated };
}
