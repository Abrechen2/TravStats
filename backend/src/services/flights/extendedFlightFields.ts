/**
 * The AeroDataBox extended fields, in one place for both write paths.
 *
 * These seven have had columns and a Zod entry since v1.5 and were mapped
 * nowhere: a POST carrying them answered 201 and stored nulls, so an importer
 * lost the data while being told it had succeeded (audit finding AUD-020). They
 * live here rather than inline because `routes/flights.ts` is over the 800-line
 * limit and frozen at its size — and because two write paths that must agree
 * are exactly what a shared module is for.
 */

/** The subset of the parsed flight payload this module reads. */
export interface ExtendedFlightInput {
  runwayDepartureTime?: Date | null;
  runwayArrivalTime?: Date | null;
  isCargo?: boolean | null;
  aerodataboxLastUpdatedUtc?: Date | null;
  aerodataboxQualityTags?: string[];
  baggageBelt?: string | null;
  checkInDesk?: string | null;
}

/** What the fields contribute to a `flight.create`. */
export function extendedFlightCreateFields(data: ExtendedFlightInput) {
  return {
    runwayDepartureTime: data.runwayDepartureTime,
    runwayArrivalTime: data.runwayArrivalTime,
    isCargo: data.isCargo,
    aerodataboxLastUpdatedUtc: data.aerodataboxLastUpdatedUtc,
    aerodataboxQualityTags: data.aerodataboxQualityTags ?? [],
    baggageBelt: data.baggageBelt,
    checkInDesk: data.checkInDesk,
  };
}

/**
 * Copy whatever the caller actually sent into an update payload.
 *
 * `undefined` means "not mentioned" and must not overwrite a stored value;
 * `null` means "clear it" and must. That is why this is a series of presence
 * checks rather than a spread.
 */
export function applyExtendedFlightFields(
  data: ExtendedFlightInput,
  updateData: ExtendedFlightInput,
): void {
  if (data.runwayDepartureTime !== undefined) updateData.runwayDepartureTime = data.runwayDepartureTime;
  if (data.runwayArrivalTime !== undefined) updateData.runwayArrivalTime = data.runwayArrivalTime;
  if (data.isCargo !== undefined) updateData.isCargo = data.isCargo;
  if (data.aerodataboxLastUpdatedUtc !== undefined)
    updateData.aerodataboxLastUpdatedUtc = data.aerodataboxLastUpdatedUtc;
  if (data.aerodataboxQualityTags !== undefined)
    updateData.aerodataboxQualityTags = data.aerodataboxQualityTags;
  if (data.baggageBelt !== undefined) updateData.baggageBelt = data.baggageBelt;
  if (data.checkInDesk !== undefined) updateData.checkInDesk = data.checkInDesk;
}

/**
 * The delay is a difference between two times, so it changes when EITHER moves.
 *
 * It used to be recomputed only when a new ACTUAL departure arrived, which left
 * a corrected schedule contradicting its own delay: a flight planned for 10:00
 * that left at 10:15 kept its 15 minutes after the plan was corrected to 10:10,
 * where the truth is 5 (audit finding AUD-021). Every consumer of the stored
 * value then reads a number the same row disproves.
 *
 * `null` when either side is unknown — not 0. A missing time is not punctuality.
 */
export function delayMinutesBetween(
  scheduledDeparture: Date | null,
  actualDeparture: Date | null,
): number | null {
  if (!scheduledDeparture || !actualDeparture) return null;
  return Math.round((actualDeparture.getTime() - scheduledDeparture.getTime()) / 60000);
}

/**
 * Write the actual departure and the delay it implies.
 *
 * Kept together because they are one decision: the delay is derived from the
 * scheduled time and the actual one, so it has to be rewritten when either is
 * touched — and `routes/flights.ts` is frozen at its size, so the branch lives
 * here rather than there.
 */
export function applyDepartureTimesAndDelay(
  sent: { actualDepartureSent: boolean; scheduledSent: boolean },
  times: {
    incomingActualDep: Date | null;
    incomingScheduledDep: Date | null;
    existing: { departureTime: Date | null; actualDeparture: Date | null };
  },
  updateData: { actualDeparture?: Date | null; delayMinutes?: number | null },
): void {
  if (sent.actualDepartureSent) {
    updateData.actualDeparture = times.incomingActualDep;
  }
  if (!sent.actualDepartureSent && !sent.scheduledSent) return;

  const actual = sent.actualDepartureSent ? times.incomingActualDep : times.existing.actualDeparture;
  const scheduled = times.incomingScheduledDep ?? times.existing.departureTime;
  updateData.delayMinutes = delayMinutesBetween(scheduled, actual);
}
