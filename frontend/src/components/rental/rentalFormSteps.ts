import type { RentalBooking } from "../../types/rental";
import type { RentalDraftErrors, RentalFormField } from "./rentalFormModel";

/**
 * The rental form as three short steps over ONE draft (forgejo#236): what was
 * booked, what happened at the counter, what happened at the return. A step
 * is only a view of the draft — switching never resets a field — and every
 * field the form ever had lives on exactly one of them.
 */
export type RentalFormStep = "booking" | "pickup" | "return";

export const RENTAL_FORM_STEPS: readonly RentalFormStep[] = ["booking", "pickup", "return"];

/** Where each field the form can complain about lives, in reading order. */
export const FIELD_STEP: Readonly<Record<RentalFormField, RentalFormStep>> = {
  provider: "booking",
  pickupStation: "booking",
  returnStation: "booking",
  pickupLocal: "booking",
  returnLocal: "booking",
  acrissCode: "booking",
  price: "booking",
  actualPickupLocal: "pickup",
  odometerOutKm: "pickup",
  odometerInKm: "return",
  actualReturnLocal: "return",
  finalAmount: "return",
  distanceKm: "return",
};

/** The DOM id of a field's control; stations name their search box. */
export function rentalFieldId(field: RentalFormField): string {
  if (field === "pickupStation") return "rental-pickup-search";
  if (field === "returnStation") return "rental-return-search";
  return `rental-${field}`;
}

/** How many of `errors` sit on each step — what the step tabs count. */
export function errorsPerStep(errors: RentalDraftErrors): Record<RentalFormStep, number> {
  const counts: Record<RentalFormStep, number> = { booking: 0, pickup: 0, return: 0 };
  for (const field of Object.keys(errors) as RentalFormField[]) counts[FIELD_STEP[field]] += 1;
  return counts;
}

/** The first step (in step order) holding one of `fields`, or null. */
export function firstStepWith(fields: readonly RentalFormField[]): RentalFormStep | null {
  return RENTAL_FORM_STEPS.find((step) => fields.some((f) => FIELD_STEP[f] === step)) ?? null;
}

/**
 * The step an opened form starts on. A new rental starts at the booking; a
 * rental whose pickup time has come opens at the return — the step a person
 * opens it for after the drive (odometer, return time, invoice).
 */
export function openingStep(rental: RentalBooking | null): RentalFormStep {
  if (!rental) return "booking";
  return rental.status === "in_progress" || rental.status === "completed" ? "return" : "booking";
}
