import { useCallback, useEffect, useState } from "react";
import { flightBookingApi } from "../../lib/api/flightBooking";
import { logger } from "../../lib/logger";
import type { FlightBookingAnswer } from "../../types/flightBooking";

export type FlightBookingState =
  /** The flight is linked to no booking — nothing was asked. */
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "loaded"; answer: FlightBookingAnswer };

/**
 * The flight's booking and its segments, read once per flight (and again on
 * `retry` or when `version` moves — after an edit on this page). A failure is
 * a state of its own, so the page can say so instead of drawing a booking
 * with one segment.
 */
export function useFlightBooking(
  flightId: string | null,
  bookingId: string | null | undefined,
  version = 0
): {
  state: FlightBookingState;
  retry: () => void;
  /** Put a fresh answer in place — what a split or its removal returned. */
  replace: (answer: FlightBookingAnswer) => void;
} {
  const [state, setState] = useState<FlightBookingState>({ kind: "none" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!flightId || !bookingId) {
      setState({ kind: "none" });
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    flightBookingApi
      .get(flightId)
      .then((answer) => {
        if (!cancelled) setState({ kind: "loaded", answer });
      })
      .catch((err: unknown) => {
        logger.warn({ err }, "useFlightBooking: booking could not be read");
        if (!cancelled) setState({ kind: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [flightId, bookingId, version, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const replace = useCallback(
    (answer: FlightBookingAnswer) => setState({ kind: "loaded", answer }),
    []
  );
  return { state, retry, replace };
}
