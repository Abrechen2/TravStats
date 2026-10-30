/**
 * "Is this actual record done?" for the TravPlan link-to-actual flow, one home.
 *
 * The server (`services/travplan/linkActual.ts`, `existing.ts`) and the picker
 * (`pages/TravPlan/ActualRecordPicker.tsx`) each hand-copied a status list, and
 * the copy carried `"returned"`, a status no domain stores. Done is whatever
 * the domain's own counting rule says happened, so this delegates: flights
 * `flown`/`historical`, cruises `completed`/`historical`/`flown`, rail, bus,
 * ferry and rental `completed`.
 *
 * Status-level on purpose: the picker reads rows off one trip payload and
 * knows the kind only through the collection they came from.
 *
 * MIRRORED in `backend/src/shared/actualRecordDone.ts`. Change both together.
 */
import { isCountableFlightStatus } from "./flightCounting";
import { isCountableCruiseStatus } from "./cruiseCounting";
import { COUNTABLE_RAIL_STATUSES } from "./railCounting";
import { COUNTABLE_BUS_STATUSES } from "./busCounting";
import { COUNTABLE_FERRY_STATUSES } from "./ferryCounting";
import { COUNTABLE_RENTAL_STATUSES } from "./rentalCounting";

const GROUND_AND_RENTAL_DONE: readonly string[] = [
  ...COUNTABLE_RAIL_STATUSES,
  ...COUNTABLE_BUS_STATUSES,
  ...COUNTABLE_FERRY_STATUSES,
  ...COUNTABLE_RENTAL_STATUSES,
];

export function isActualRecordDone(status: string): boolean {
  return (
    isCountableFlightStatus(status) ||
    isCountableCruiseStatus(status) ||
    GROUND_AND_RENTAL_DONE.includes(status)
  );
}
