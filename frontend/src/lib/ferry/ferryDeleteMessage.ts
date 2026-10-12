import { survivorsNote, withDocumentNote } from "../deleteConfirm";
import type { FerryJourney } from "../../types/ferry";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Shared confirmation text for the crossing list and detail page. */
export function ferryDeleteMessage(
  t: Translate,
  ride: Pick<FerryJourney, "depStationName" | "arrStationName" | "companions" | "trip">,
  documentCount: number | null
): string {
  const base = t("ferry:deleteConfirm", {
    route: `${ride.depStationName} → ${ride.arrStationName}`,
  });
  const withDocuments = withDocumentNote(base, t, documentCount);
  const survivors = survivorsNote(t, [
    ...(ride.trip ? [t("ferry:deleteSurvivors.trip", { name: ride.trip.name })] : []),
    ...(ride.companions.length > 0
      ? [t("ferry:deleteSurvivors.companions", { count: ride.companions.length })]
      : []),
  ]);
  return survivors === null ? withDocuments : `${withDocuments}\n${survivors}`;
}
