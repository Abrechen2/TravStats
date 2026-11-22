import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { gapDatesFromParams, type GapDates } from "../lib/gapCalendar";

/**
 * The gap calendar's "Eintrag anlegen" arrives as `?addFrom=&addTo=`. This
 * reads it once, strips it from the URL (a reload must not reopen the form),
 * and hands the page a request: `{ dates }` — null when the first day was not a
 * real day, in which case the form still opens, on its own defaults — or
 * nothing when the page was not asked at all. `done` clears the request.
 */
export function useGapPrefill(): { request: { dates: GapDates | null } | null; done: () => void } {
  const [params, setParams] = useSearchParams();
  const [request, setRequest] = useState<{ dates: GapDates | null } | null>(null);

  useEffect(() => {
    const from = params.get("addFrom");
    if (from === null) return;
    setRequest({ dates: gapDatesFromParams(from, params.get("addTo")) });
    const next = new URLSearchParams(params);
    next.delete("addFrom");
    next.delete("addTo");
    setParams(next, { replace: true });
  }, [params, setParams]);

  const done = useCallback(() => setRequest(null), []);
  return { request, done };
}
