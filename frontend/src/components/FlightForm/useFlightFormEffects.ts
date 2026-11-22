import { useEffect, type MutableRefObject } from "react";
import { useSettingsStore } from "../../store/settingsStore";
import { todayIn } from "../../shared/time";
import { todayZoneNow } from "../../hooks/useTodayZone";
import { estimateFlightTimes } from "../../lib/timeEstimation";
import { shiftWallClock } from "../../lib/wallClockMath";
import type { FlightInput } from "../../types";
import type { FlightFormState } from "./useFlightFormState";

export interface FlightFormRefs {
  /** A notice the next step transition must keep (an airport the lookup could not resolve). */
  stepNoticeRef: MutableRefObject<string | null>;
  /** Whether the arrival was set by hand or by a picked lookup hit. */
  arrivalDateSetRef: MutableRefObject<boolean>;
  /** Accumulates confirmed flight inputs during multi-flight email import. */
  confirmedFlightsRef: MutableRefObject<FlightInput[]>;
}

/** Suggests an arrival from the estimated flight duration, once both airports and a departure are in. */
function useArrivalEstimate(
  s: FlightFormState,
  arrivalDateSetRef: FlightFormRefs["arrivalDateSetRef"]
) {
  const {
    departureDate,
    departureTime,
    departure,
    arrival,
    flightNumber,
    setArrivalDate,
    setArrivalTime,
    setTimeEstimationWarning,
  } = s;
  // Auto-suggest arrival time based on estimated flight duration
  useEffect(() => {
    if (departureDate && departureTime && departure && arrival && !arrivalDateSetRef.current) {
      try {
        // `estimateFlightTimes` takes a BOARDING time because it grew out of
        // the boarding-pass path. Here there is no boarding time — the user
        // typed a departure time — so one is synthesised by subtracting the
        // same 30 minutes the estimator will add back. The round trip cancels
        // out, which is why the resulting estimate is correct.
        //
        // This is an internal adaptation and must NOT leak into the copy: the
        // UI used to explain the result as "based on boarding time" and
        // "Departure = Boarding + 30min", telling the user their times came
        // from an input they never gave and sending them looking for a field
        // that does not exist on this form (#235).
        // Wall-clock arithmetic, not the browser's clock (lib/wallClockMath.ts).
        const boardingTime =
          shiftWallClock(departureDate, departureTime, -30)?.time ?? departureTime;

        const estimation = estimateFlightTimes(
          boardingTime,
          departureDate,
          flightNumber || undefined,
          departure.iata || "",
          arrival.iata || "",
          departure.lat,
          departure.lon,
          arrival.lat,
          arrival.lon
        );

        setArrivalDate(departureDate);
        setArrivalTime(estimation.arrivalTime);
        arrivalDateSetRef.current = true;
        setTimeEstimationWarning({
          show: true,
          source: estimation.source,
          confidence: estimation.confidence,
          sampleCount: estimation.sampleCount,
        });
      } catch {
        // Two hours on the ticket's clock — the old code took the UTC date
        // and the browser's time, a different day east of UTC.
        const arr = shiftWallClock(departureDate, departureTime, 120);
        setArrivalDate(arr?.date ?? departureDate);
        setArrivalTime(arr?.time ?? departureTime);
        arrivalDateSetRef.current = true;
        setTimeEstimationWarning({ show: true, source: "heuristic", confidence: "low" });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the setters and the ref are stable; only the inputs re-run the estimate
  }, [departureDate, departureTime, departure, arrival, flightNumber]);
}

/** The create form's effects: settings defaults, derived status, notice handling and the arrival estimate. */
export function useFlightFormEffects(
  s: FlightFormState,
  refs: FlightFormRefs,
  /** A day the form opens on instead of today (the gap calendar's "Eintrag anlegen"). */
  initialDate?: string
): void {
  const baseCurrency = useSettingsStore((st) => st.baseCurrency);
  const defaults = useSettingsStore((st) => st.defaults);
  const { stepNoticeRef, arrivalDateSetRef, confirmedFlightsRef } = refs;
  const {
    status,
    departureDate,
    step,
    parsedFlights,
    setSearchDate,
    setDepartureDate,
    setArrivalDate,
    setCurrency,
    setCategory,
    setSeatClass,
    setAirline,
    setStatus,
    setError,
  } = s;

  // Initialize defaults from settings
  useEffect(() => {
    // Today in the profile zone (Q1) — neither UTC nor the browser's.
    const today = initialDate ?? todayIn(todayZoneNow());
    setSearchDate(today);
    setDepartureDate(today);
    setArrivalDate(today);

    // The one currency the app has (see UnitsSection). Was
    // `units.currency`, which governed flights alone.
    if (baseCurrency) setCurrency(baseCurrency);
    if (defaults?.flightCategory) setCategory(defaults.flightCategory);
    if (defaults?.seatClass) setSeatClass(defaults.seatClass);
    // Settings > Defaults > favourite airline (forgejo#389). This hook is the CREATE form only
    // (editing uses editFormModel, which never reads defaults); a typed or
    // loaded airline wins.
    if (defaults?.favoriteAirline) setAirline((prev) => prev || defaults.favoriteAirline);
  }, [baseCurrency, defaults]); // eslint-disable-line react-hooks/exhaustive-deps -- setters are stable

  // Auto-set status based on date (skip when historical is active)
  useEffect(() => {
    if (status === "historical") return;
    // Both `YYYY-MM-DD`: before today in the profile zone (Q1) is flown.
    if (departureDate) setStatus(departureDate < todayIn(todayZoneNow()) ? "flown" : "scheduled");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- status is read, not watched: only a date change re-derives it
  }, [departureDate]);

  // Clear error when step changes — unless the transition itself carries a
  // notice (an airport the lookup could not resolve), which must survive it.
  useEffect(() => {
    setError(stepNoticeRef.current ?? "");
    stepNoticeRef.current = null;
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps -- the setter and the ref are stable

  // Reset accumulated flights whenever a new email import session begins
  useEffect(() => {
    confirmedFlightsRef.current = [];
  }, [parsedFlights]); // eslint-disable-line react-hooks/exhaustive-deps -- the ref is stable

  useArrivalEstimate(s, arrivalDateSetRef);
}
