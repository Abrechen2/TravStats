import { apiErrorMachineCode } from "../../lib/apiError";
import type { TourStop } from "../../types/tour";

/**
 * Whether a tour's points are its own to edit here (acceptance D5,
 * 2026-09-26). A standalone tour's always are. A day tour that JOINED a trip
 * keeps its own, trip-less points — the trip page must edit those with the
 * point editor, not the assigner, which only knows the trip's timeline stops.
 * An empty section on a trip is waiting for the trip's stops, not a tour of
 * its own.
 */
export function editsOwnPoints(onTrip: boolean, stops: readonly TourStop[]): boolean {
  if (!onTrip) return true;
  return stops.length > 0 && stops.every((s) => (s.tripId ?? null) === null);
}

/**
 * The German/English copy for a refused point save, keyed by what the server
 * said — never its English sentence (the 409 used to arrive as "This tour
 * belongs to a trip …" plus a stack, and the page showed nothing).
 */
export function tourPointsSaveErrorKey(err: unknown): string {
  if (apiErrorMachineCode(err) === "TOUR_POINTS_FROM_TRIP") {
    return "trips:tours.points.saveErrorFromTrip";
  }
  const status = (err as { response?: { status?: number } } | undefined)?.response?.status;
  if (status === undefined) return "trips:tours.points.saveErrorOffline";
  if (status === 400) return "trips:tours.points.saveErrorInvalid";
  if (status === 404) return "trips:tours.points.saveErrorGone";
  return "trips:tours.points.saveError";
}
