import { useEffect, useState } from "react";
import { airportsApi } from "../../lib/api/airports";

export interface AirportLocalTimes {
  /** IANA zone the departure time field is rendered against. */
  depTimezone: string;
  /** IANA zone the arrival time field is rendered against. */
  arrTimezone: string;
  /**
   * True once BOTH airports resolved to a real zone. While false the caller
   * must keep treating its time fields as browser-local — that is what makes a
   * no-op edit round-trip losslessly instead of drifting.
   */
  hydrated: boolean;
}

interface UseAirportLocalTimesArgs {
  isOpen: boolean;
  depCode: string | null;
  arrCode: string | null;
  browserTimezone: string;
}

/**
 * Resolve the departure/arrival airports' IANA timezones so a form can render
 * its time fields airport-local and pair them with the matching basis on
 * submit.
 *
 * The invariant: both zones move together or neither does. A half-resolved
 * pair would render one field airport-local and the other browser-local, and
 * submit would then pair each value with the wrong zone — a silent shift of a
 * stored UTC instant, invisible in any timezone where the two happen to agree.
 *
 * Re-resolves whenever a code changes, which is what lets the airports be
 * edited at all.
 */
export function useAirportLocalTimes({
  isOpen,
  depCode,
  arrCode,
  browserTimezone,
}: UseAirportLocalTimesArgs): AirportLocalTimes {
  const [zones, setZones] = useState<AirportLocalTimes>({
    depTimezone: browserTimezone,
    arrTimezone: browserTimezone,
    hydrated: false,
  });

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    // A code change invalidates the previous pair: fall back to the browser
    // zone and report unhydrated until both sides have resolved again.
    const unhydrated: AirportLocalTimes = {
      depTimezone: browserTimezone,
      arrTimezone: browserTimezone,
      hydrated: false,
    };
    setZones((prev) =>
      prev.hydrated ||
      prev.depTimezone !== browserTimezone ||
      prev.arrTimezone !== browserTimezone
        ? unhydrated
        : prev
    );

    void (async () => {
      // A missing airport is not an error here — the caller simply stays on
      // the browser zone, so failures resolve to null rather than throwing.
      const [depAirport, arrAirport] = await Promise.all([
        depCode ? airportsApi.getByCode(depCode).catch(() => null) : Promise.resolve(null),
        arrCode ? airportsApi.getByCode(arrCode).catch(() => null) : Promise.resolve(null),
      ]);
      if (cancelled) return;

      const depZone = depAirport?.timezone;
      const arrZone = arrAirport?.timezone;
      if (!depZone || !arrZone) return; // stays unhydrated — both or neither

      setZones({ depTimezone: depZone, arrTimezone: arrZone, hydrated: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, depCode, arrCode, browserTimezone]);

  return zones;
}
