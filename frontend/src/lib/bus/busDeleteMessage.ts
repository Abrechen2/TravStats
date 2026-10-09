import { survivorsNote, withDocumentNote } from "../deleteConfirm";
import type { BusJourney } from "../../types/bus";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * What the delete question for one bus ride says (forgejo#250) — on the list
 * AND on the detail page, from one function so the two cannot drift. Before,
 * both said "Diese Busfahrt löschen?" without naming which ride, and nothing
 * about what survives.
 *
 * What goes: the ride, named by its route, and the originals filed with it
 * (`Document` cascades from `BusJourney`, `withDocumentNote`). What stays: the
 * trip it is filed under (`tripId` is `SetNull`) and its travel companions —
 * only the ride's links to them cascade (`BusJourneyCompanion`), the people
 * themselves are the user's and appear on other entries. Both rows the list
 * and the detail page hold carry the trip and the companions, so the two
 * dialogs say exactly the same thing.
 */
export function busDeleteMessage(
  t: Translate,
  ride: Pick<BusJourney, "depStationName" | "arrStationName" | "companions" | "trip">,
  documentCount: number | null
): string {
  const base = t("bus:deleteConfirm", {
    route: `${ride.depStationName} → ${ride.arrStationName}`,
  });
  const withDocuments = withDocumentNote(base, t, documentCount);
  const survivors = survivorsNote(t, [
    ...(ride.trip ? [t("bus:deleteSurvivors.trip", { name: ride.trip.name })] : []),
    ...(ride.companions.length > 0
      ? [t("bus:deleteSurvivors.companions", { count: ride.companions.length })]
      : []),
  ]);
  return survivors === null ? withDocuments : `${withDocuments}\n${survivors}`;
}
