import type { RailJourney } from "../../types/rail";

/** "ICE 578 · DB Fernverkehr" — whatever of the three is known, nothing invented. */
export function trainLabel(
  journey: Pick<RailJourney, "trainCategory" | "trainNumber" | "operator">
): string {
  const train = [journey.trainCategory, journey.trainNumber].filter(Boolean).join(" ");
  return [train, journey.operator].filter(Boolean).join(" · ");
}
