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
 * them, `countPortCalls`), the originals filed with it — `Document` cascades
 * from `Cruise` — and its GPS recordings and the routes redrawn on the map. What stays: the trip it is filed under (`tripId` is
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
  // Recordings and redrawn routes cascade too (review I1). Named whether or
  // not the tracks beta is switched on — the data goes either way. A missing
  // count says nothing rather than "0".
  const counts = cruise._count;
  const also = [
    ...(counts && counts.tracks > 0
      ? [t("cruise:deleteParts.tracks", { count: counts.tracks })]
      : []),
    ...(counts && counts.legRoutes > 0
      ? [t("cruise:deleteParts.legRoutes", { count: counts.legRoutes })]
      : []),
  ];
  const withAlso =
    also.length === 0
      ? withDocuments
      : `${withDocuments}\n${t("cruise:deleteParts.alsoGoes", {
          list: also.join(t("cruise:deleteParts.and")),
        })}`;
  const survivors = survivorsNote(
    t,
    cruise.trip
      ? [t("cruise:deleteSurvivors.trip", { name: cruise.trip.name })]
      : cruise.tripId
        ? [t("cruise:deleteSurvivors.tripUnnamed")]
        : []
  );
  return survivors === null ? withAlso : `${withAlso}\n${survivors}`;
}
