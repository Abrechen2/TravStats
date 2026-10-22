import { trainName, type BareTrainName } from "../../lib/rail/trainName";
import type { RailJourney } from "../../types/rail";

/** "ICE 578 · DB Fernverkehr" — whatever of the three is known, nothing invented. */
export function trainLabel(
  journey: Pick<RailJourney, "trainCategory" | "trainNumber" | "operator">,
  bare: BareTrainName
): string {
  const train = trainName(journey.trainCategory, journey.trainNumber, bare);
  return [train, journey.operator].filter(Boolean).join(" · ");
}
