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
 * Until hydration completes (or if it never does — an airport miss, a
 * network error), both zones report `browserTimezone` unchanged.
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
    setHydrated(false);
    setDepTimezone(browserTimezone);
    setArrTimezone(browserTimezone);

    void (async () => {
      const [depAirport, arrAirport] = await Promise.all([
        depCode ? airportsApi.getByCode(depCode).catch(() => null) : Promise.resolve(null),
        arrCode ? airportsApi.getByCode(arrCode).catch(() => null) : Promise.resolve(null),
      ]);
      if (cancelled) return;

      const dTz = depAirport?.timezone ?? null;
      const aTz = arrAirport?.timezone ?? null;
      // Only apply the pair — and only report hydrated — when BOTH
      // resolved. A lone resolved zone stays discarded so depTimezone /
      // arrTimezone never disagree on which basis (browser vs. airport)
      // they're expressed in.
      if (dTz && aTz) {
        setDepTimezone(dTz);
        setArrTimezone(aTz);
        setHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, depCode, arrCode, browserTimezone]);

  return { depTimezone, arrTimezone, hydrated };
}
