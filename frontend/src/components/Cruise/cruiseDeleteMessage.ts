import { countedDeleteMessage, survivorsNote, withDocumentNote } from "../../lib/deleteConfirm";
import type { Cruise } from "../../types";
import { countPortCalls } from "./cruisePorts";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Ship name, falling back to the free-text override the parser may set. */
export function cruiseDisplayName(cruise: Cruise, t: Translate): string {
  return cruise.ship?.name ?? cruise.shipNameOverride ?? t("cruise:list.unnamedShip");
}

/**
 * What the delete question for one cruise says (forgejo#250) — on the list AND
 * on the detail page, from one function so the two cannot drift (they did:
 * the list never mentioned the documents that go with a cruise).
 *
 * What goes: the cruise with its port calls (counted the way the row counts
 * them, `countPortCalls`) and the originals filed with it — `Document`
 * cascades from `Cruise`. What stays: the trip it is filed under (`tripId` is
 * `SetNull`), NAMED rather than "zugehörige Reisen", so the reader knows which.
 * `documentCount` is null while it is still being asked; the note then waits.
 */
export function cruiseDeleteMessage(
  t: Translate,
  cruise: Cruise,
  documentCount: number | null
): string {
  const base = countedDeleteMessage(
    t,
    {
      counted: "cruise:detail.deleteConfirmMessage",
      empty: "cruise:detail.deleteConfirmMessageNoStops",
    },
    cruiseDisplayName(cruise, t),
    countPortCalls(cruise)
  );
  const withDocuments = withDocumentNote(base, t, documentCount);
  const survivors = survivorsNote(
    t,
    cruise.trip
      ? [t("cruise:deleteSurvivors.trip", { name: cruise.trip.name })]
      : cruise.tripId
        ? [t("cruise:deleteSurvivors.tripUnnamed")]
        : []
  );
  return survivors === null ? withDocuments : `${withDocuments}\n${survivors}`;
}
