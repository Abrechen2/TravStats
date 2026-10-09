import { survivorsNote, withDocumentNote } from "../deleteConfirm";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface FlightDeleteFacts {
  /** "LH2462 MUC → CPH" — the flight as the row or the page names it. */
  name: string;
  /** Null when the flight belongs to no trip; "" when it does but its name is not at hand. */
  tripName: string | null;
  /**
   * The booking the flight is linked to, or null. `otherFlights` counts the
   * booking's other flights where the page knows it (the detail page reads
   * the booking); null where it does not (a list row).
   */
  booking: { pnr: string | null; otherFlights: number | null } | null;
}

/**
 * What a flight's delete confirmation says (forgejo#250), ONE home for the
 * list and the detail page: what goes (the flight, and its documents, counted
 * — they cascade with it), and what stays, by name (its trip, its booking and
 * the booking's other flights). It used to say "a trip stays" whether or not
 * the flight had one, and nothing about documents on the list.
 */
export function flightDeleteMessage(
  t: Translate,
  facts: FlightDeleteFacts,
  documentCount: number | null
): string {
  const stays: string[] = [];
  if (facts.tripName !== null) {
    stays.push(
      facts.tripName
        ? t("flights:deleteSurvivors.trip", { name: facts.tripName })
        : t("flights:deleteSurvivors.tripUnnamed")
    );
  }
  if (facts.booking) {
    const pnr = facts.booking.pnr ?? "";
    const others = facts.booking.otherFlights;
    stays.push(
      others === null
        ? t("flights:deleteSurvivors.bookingMaybe", { pnr })
        : others > 0
          ? t("flights:deleteSurvivors.bookingWithFlights", { pnr, count: others })
          : t("flights:deleteSurvivors.booking", { pnr })
    );
  }
  const base = withDocumentNote(
    t("flights:table.deleteConfirm.message", { name: facts.name }),
    t,
    documentCount
  );
  const survivors = survivorsNote(t, stays);
  return survivors ? `${base}\n${survivors}` : base;
}
