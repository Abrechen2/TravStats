import { useCallback, useEffect, useRef } from "react";

import { dayOf, type DatedTrip } from "../lib/tripForDate";

interface StayDatesFromTripOptions {
  /** A NEW stay at DAY precision; an existing stay's dates are recorded facts. */
  enabled: boolean;
  trips: readonly DatedTrip[];
  tripId: string;
  checkIn: string;
  checkOut: string;
  onCheckInChange: (day: string) => void;
  onCheckOutChange: (day: string) => void;
}

export interface StayDatesOffer {
  checkIn: string | null;
  checkOut: string | null;
}

export interface StayDatesFromTrip {
  /** The trip's days for whichever of the two fields is still empty; null when there is nothing to offer. */
  offer: StayDatesOffer | null;
  accept: () => void;
}

/**
 * The selected trip's first and last day, as the dates of a new stay.
 *
 * With both dates empty, picking a trip writes them — the one case where
 * nothing the user typed can be in the way, and the trip is the only date
 * the form knows. A trip changed while the fields still hold what this hook
 * wrote moves them along. With one date typed, the other is only OFFERED: a
 * stay that starts mid-trip rarely ends on the trip's last day by accident,
 * and the user decides.
 *
 * A trip without a start date gives nothing; a check-out the trip would put
 * before the typed check-in is not offered.
 */
export function useStayDatesFromTrip({
  enabled,
  trips,
  tripId,
  checkIn,
  checkOut,
  onCheckInChange,
  onCheckOutChange,
}: StayDatesFromTripOptions): StayDatesFromTrip {
  const trip = tripId ? trips.find((candidate) => candidate.id === tripId) : undefined;
  const start = enabled ? dayOf(trip?.startDate) : null;
  const end = start ? dayOf(trip?.endDate) : null;

  const written = useRef<{ checkIn: string; checkOut: string } | null>(null);
  const callbacks = useRef({ onCheckInChange, onCheckOutChange });
  callbacks.current = { onCheckInChange, onCheckOutChange };

  useEffect(() => {
    const ours =
      written.current !== null &&
      checkIn === written.current.checkIn &&
      checkOut === written.current.checkOut;
    if (!ours && (checkIn !== "" || checkOut !== "")) {
      written.current = null;
      return;
    }
    const next = { checkIn: start ?? "", checkOut: end ?? "" };
    if (!ours && next.checkIn === "") return;
    written.current = next.checkIn === "" ? null : next;
    if (next.checkIn !== checkIn) callbacks.current.onCheckInChange(next.checkIn);
    if (next.checkOut !== checkOut) callbacks.current.onCheckOutChange(next.checkOut);
    // The dates are read, not watched: a keystroke must not re-run the fill.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end]);

  const offerCheckIn = start !== null && checkIn === "" ? start : null;
  const offerCheckOut =
    end !== null && checkOut === "" && (checkIn === "" || end > checkIn) ? end : null;
  const offer =
    offerCheckIn !== null || offerCheckOut !== null
      ? { checkIn: offerCheckIn, checkOut: offerCheckOut }
      : null;

  const accept = useCallback((): void => {
    if (offer?.checkIn) callbacks.current.onCheckInChange(offer.checkIn);
    if (offer?.checkOut) callbacks.current.onCheckOutChange(offer.checkOut);
  }, [offer?.checkIn, offer?.checkOut]);

  return { offer, accept };
}
