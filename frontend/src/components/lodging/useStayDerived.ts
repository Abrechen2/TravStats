import { useRatingCategories } from "../../hooks/useRatingCategories";
import { ratingFields } from "./ratingFields";
import { deriveStayOverallRating } from "../../shared/ratingDerivation";
import { derivePricePerNight } from "../../lib/lodgingFormat";
import { deriveLodgingStatus } from "../../shared/statusDerivation";
import { deriveStayMembership } from "../../shared/membershipDerivation";
import { parseDecimalInput } from "../../lib/decimalInput";
import type { LodgingMembership, LodgingStay, StayStatus } from "../../types/lodging";

interface Args {
  datePrecision: "DAY" | "MONTH" | "YEAR" | "NONE" | string;
  checkIn: string;
  checkOut: string;
  isCancelled: boolean;
  nightsText: string;
  totalPrice: string;
  manualFxRate: string;
  ratings: Record<string, number>;
  stay: LodgingStay | null | undefined;
  membershipId: string;
  membershipOptOut: boolean;
  lodgingId: string;
  lodgingChainId: number | null;
  memberships: LodgingMembership[];
}

/** What the editor shows and sends that is DERIVED from the typed values, never stored in state. */
export function useStayDerived({
  datePrecision,
  checkIn,
  checkOut,
  isCancelled,
  nightsText,
  totalPrice,
  manualFxRate,
  ratings,
  stay,
  membershipId,
  membershipOptOut,
  lodgingId,
  lodgingChainId,
  memberships,
}: Args) {
  // What the backend will store for these dates. Shown next to the cancelled
  // checkbox so the derived state is visible rather than a surprise after save.
  // With no dates the deriver has nothing to work from and returns `current`.
  // "completed" is the right default there: an undated stay is one being
  // recorded after the fact.
  const derivedStatus = deriveLodgingStatus({
    checkIn: datePrecision === "NONE" || !checkIn ? null : new Date(checkIn),
    checkOut: datePrecision !== "DAY" || !checkOut ? null : new Date(checkOut),
    current: datePrecision === "NONE" ? "completed" : "scheduled",
  }) as StayStatus;
  // The single value the save path sends - no second source to drift from.
  const effectiveStatus: StayStatus = isCancelled ? "cancelled" : derivedStatus;

  // Either notation: `parseFloat` read "1.500,00" as 1.5 and "39,90" as 39.
  const parsedTotalPrice = parseDecimalInput(totalPrice);
  const parsedManualFxRate =
    manualFxRate.trim() && Number.isFinite(Number.parseFloat(manualFxRate))
      ? Number.parseFloat(manualFxRate)
      : null;
  // The SAME function the server runs on save (shared/ratingDerivation.ts), so
  // the readout cannot promise a number the backend then stores differently.
  // `current` carries an overall the stay already has with no components behind
  // it - an import, or a row from before the components existed. Without it,
  // merely opening such a stay and saving would wipe the user's own score.
  // It sees every value the stay HAS - never the set of switched-on
  // categories - so switching one off cannot move an old stay's overall.
  const derivedRatingOverall = deriveStayOverallRating({
    ratings,
    current: stay?.ratingOverall ?? null,
  });
  const { view: ratingView, labelOf: ratingLabelOf } = useRatingCategories();
  const { active: activeRatingFields, retired: retiredRatingFields } = ratingFields(
    ratingView,
    ratings,
    ratingLabelOf
  );
  const derivedPricePerNight = derivePricePerNight(
    Number.isFinite(parsedTotalPrice) ? parsedTotalPrice : null,
    checkIn,
    checkOut
  );

  // The SAME function the server resolves with (shared/membershipDerivation.ts).
  // `membershipId` is an OVERRIDE, never the answer - a card attached to the
  // hotel's chain covers this stay without the user restating it here.
  const resolvedMembership = deriveStayMembership({
    overrideId: membershipId || null,
    optOut: membershipOptOut,
    lodgingId,
    lodgingChainId: lodgingChainId ?? null,
    memberships: memberships.map((m) => ({
      id: m.id,
      createdAt: m.createdAt,
      chainIds: m.chainIds,
      lodgingIds: m.lodgingIds,
    })),
  });
  const resolvedMembershipName =
    memberships.find((m) => m.id === resolvedMembership.membershipId)?.programName ?? null;

  const parsedNights =
    nightsText.trim() && Number.isFinite(Number.parseInt(nightsText, 10))
      ? Math.max(0, Number.parseInt(nightsText, 10))
      : null;

  return {
    derivedStatus,
    effectiveStatus,
    parsedTotalPrice,
    parsedManualFxRate,
    derivedRatingOverall,
    activeRatingFields,
    retiredRatingFields,
    derivedPricePerNight,
    resolvedMembership,
    resolvedMembershipName,
    parsedNights,
  };
}
