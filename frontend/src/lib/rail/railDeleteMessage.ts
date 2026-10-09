import { survivorsNote, withDocumentNote } from "../deleteConfirm";
import type { RailJourney } from "../../types/rail";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * What the delete question for one train ride says (forgejo#250) — on the list
 * AND on the detail page, from one function so the two cannot drift.
 *
 * What goes: the ride itself, named by its route, and the originals filed
 * with it (`Document` cascades from `RailJourney`). What stays: the trip it
 * is filed under and the other trains of its booking — a booking's legs are
 * bound by `bookingId`, which is `SetNull`, so deleting one train never takes
 * its connection with it, and the question says so.
 *
 * `otherLegs` is the number of the booking's OTHER legs where the caller knows
 * it (the detail page reads the booking), `null` where it does not (a list
 * row) — then a booked ride says "other journeys of the same booking" in
 * general terms rather than guessing a number.
 */
export function railDeleteMessage(
  t: Translate,
  journey: Pick<RailJourney, "depStationName" | "arrStationName" | "bookingId"> & {
    trip?: { name: string } | null;
  },
  facts: { documentCount: number | null; otherLegs: number | null }
): string {
  const base = t("rail:deleteConfirmNamed", {
    route: `${journey.depStationName} → ${journey.arrStationName}`,
  });
  const withDocuments = withDocumentNote(base, t, facts.documentCount);
  const legs =
    facts.otherLegs !== null
      ? facts.otherLegs > 0
        ? [t("rail:deleteSurvivors.otherLegs", { count: facts.otherLegs })]
        : []
      : journey.bookingId !== null
        ? [t("rail:deleteSurvivors.bookingLegs")]
        : [];
  const survivors = survivorsNote(t, [
    ...(journey.trip ? [t("rail:deleteSurvivors.trip", { name: journey.trip.name })] : []),
    ...legs,
  ]);
  return survivors === null ? withDocuments : `${withDocuments}\n${survivors}`;
}
