import { flightsApi } from "../../lib/api/flights";
import { useToastStore } from "../../store/toastStore";
import { reportBatchOutcome } from "./flightReviewBatch";
import { isAlreadyImported, type FlightSubmitOptions } from "./flightFormModel";
import type { Flight, FlightInput, UserAchievement } from "../../types";
import type { FlightFormRefs } from "./useFlightFormEffects";
import type { FlightFormState } from "./useFlightFormState";
import type { useTranslation } from "../../hooks/useTranslation";
import { reportPageError } from "../../store/pageErrorStore";

type T = ReturnType<typeof useTranslation>["t"];

interface Args {
  s: FlightFormState;
  refs: FlightFormRefs;
  t: T;
  onSubmit: (flight: FlightInput, opts?: FlightSubmitOptions) => Promise<Flight | void>;
  onCancel: () => void;
  onBatchComplete?: (newAchievements?: UserAchievement[]) => void;
}

/** Closes the review: forgets the parsed flights and the import batch. */
function finishReview(s: FlightFormState): void {
  s.setShowFlightReview(false);
  s.setParsedFlights([]);
  s.setCurrentFlightIndex(0);
  s.setImportBatchId(null);
}

/** Confirming one flight of a mail: a batch on the last of several, one `onSubmit` for a single flight. */
export function useFlightReviewConfirm({ s, refs, t, onSubmit, onCancel, onBatchComplete }: Args) {
  const { confirmedFlightsRef } = refs;

  /** The last flight of a multi-flight mail: send the whole batch. */
  const sendBatch = async (): Promise<void> => {
    s.setLoading(true);
    s.setError("");
    try {
      const submittedCount = confirmedFlightsRef.current.length;
      const batchResult = await flightsApi.createBatch(
        confirmedFlightsRef.current,
        s.importBatchId
      );

      reportBatchOutcome(batchResult, submittedCount, t);

      confirmedFlightsRef.current = [];
      finishReview(s);
      onBatchComplete?.(batchResult.newAchievements);
      onCancel();
    } catch (err: unknown) {
      const errorObj = err as { response?: { data?: { error?: string }; status?: number } };
      const msg = errorObj.response?.data?.error ?? t("errors:saveFailed");
      // Show as toast since the form may already be closing
      reportPageError(msg);
      s.setError(msg);
    } finally {
      s.setLoading(false);
    }
  };

  /** A single flight uses the existing onSubmit callback. */
  const submitSingle = async (
    enrichedFlight: FlightInput,
    hasMoreFlights: boolean,
    nextIndex: number
  ): Promise<void> => {
    // A repeat of the same confirmation is counted, not treated as a failed
    // save: the user did nothing wrong, and "saving failed" would send them
    // looking for a problem that isn't there.
    try {
      await onSubmit(enrichedFlight, { hasMoreFlights });
    } catch (err: unknown) {
      if (!isAlreadyImported(err)) throw err;
      useToastStore.getState().addToast("info", t("flights:form.alreadyImported"));
    }

    if (hasMoreFlights) {
      s.setCurrentFlightIndex(nextIndex);
    } else {
      finishReview(s);
      onCancel();
    }
  };

  const handleFlightReviewConfirm = async (flightData: FlightInput) => {
    const sourceFlight = s.parsedFlights[s.currentFlightIndex];
    s.setBaggageAllowance(sourceFlight?.baggageAllowance);
    s.setFrequentFlyerNumber(sourceFlight?.frequentFlyerNumber);
    s.setBookingClassLetter(sourceFlight?.bookingClassLetter);
    s.setBoardingGroup(sourceFlight?.boardingGroup ?? "");
    s.setCoPassengers(sourceFlight?.coPassengers ?? []);

    const enrichedFlight: FlightInput = {
      ...flightData,
      importBatchId: s.importBatchId,
      baggageAllowance: sourceFlight?.baggageAllowance,
      frequentFlyerNumber: sourceFlight?.frequentFlyerNumber,
      bookingClassLetter: sourceFlight?.bookingClassLetter,
      coPassengers: sourceFlight?.coPassengers,
      // Propagate PNR from parsed email so backend can group flights into Trip+Booking
      bookingReference:
        sourceFlight?.bookingReference ?? sourceFlight?.pnr ?? flightData.bookingReference,
    };

    const nextIndex = s.currentFlightIndex + 1;
    const hasMoreFlights = nextIndex < s.parsedFlights.length;
    const isMultiFlight = s.parsedFlights.length > 1;

    if (!isMultiFlight) {
      await submitSingle(enrichedFlight, hasMoreFlights, nextIndex);
      return;
    }
    // Accumulate and send as batch on last flight
    confirmedFlightsRef.current = [...confirmedFlightsRef.current, enrichedFlight];
    if (hasMoreFlights) {
      // Advance to next flight without calling API yet
      s.setCurrentFlightIndex(nextIndex);
    } else {
      await sendBatch();
    }
  };

  return { handleFlightReviewConfirm };
}
