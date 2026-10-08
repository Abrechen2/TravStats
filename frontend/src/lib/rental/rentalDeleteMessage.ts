import { survivorsNote, withDocumentNote } from "../deleteConfirm";
import type { RentalBooking } from "../../types/rental";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * What the delete question for one rental says (forgejo#250) — on the list
 * AND on the detail page, from one function so the two cannot drift.
 *
 * What goes: the rental, named by provider and stations, and the documents
 * filed with it (`Document.rentalBookingId` cascades). What stays: the trip
 * and the roadtrip it is linked to — both relations are `SetNull`, so neither
 * is touched — and the companions, who are people, not part of the rental.
 */
export function rentalDeleteMessage(
  t: Translate,
  rental: Pick<
    RentalBooking,
    "provider" | "pickupStationName" | "returnStationName" | "oneWay" | "companions"
  > & {
    trip?: { name: string } | null;
    route?: { name: string | null } | null;
  },
  documentCount: number | null
): string {
  const where = rental.oneWay
    ? `${rental.pickupStationName} → ${rental.returnStationName}`
    : rental.pickupStationName;
  const base = t("rental:deleteConfirmNamed", { provider: rental.provider, where });
  const withDocuments = withDocumentNote(base, t, documentCount);
  const survivors = survivorsNote(t, [
    ...(rental.trip ? [t("rental:deleteSurvivors.trip", { name: rental.trip.name })] : []),
    ...(rental.route
      ? [
          t("rental:deleteSurvivors.roadtrip", {
            name: rental.route.name ?? t("rental:detail.roadtripUnnamed"),
          }),
        ]
      : []),
    ...(rental.companions.length > 0
      ? [t("rental:deleteSurvivors.companions", { count: rental.companions.length })]
      : []),
  ]);
  return survivors === null ? withDocuments : `${withDocuments}\n${survivors}`;
}
