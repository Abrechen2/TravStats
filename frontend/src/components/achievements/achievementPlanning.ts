/**
 * Which achievement rules count PLANNED travel rather than travel that
 * happened (forgejo#265: "Vorhandene Planungsbadges ausdrücklich als Planung
 * kennzeichnen"). These four rules read scheduled flights — booked, not yet
 * flown — so a card and its dialog say "Planung" outright, and nobody reads
 * "Wanderlust" as a count of trips already made.
 *
 * Keyed on the RULE (`requirementType`), like `achievementEvidenceKey.ts`: the
 * rule decides what is counted, not the badge's code or its category — the
 * "planner" category also holds the notetaker and the documented trip, which
 * count things that happened.
 */
export const PLANNING_RULES: ReadonlySet<string> = new Set([
  "scheduled_count",
  "scheduled_continents",
  "scheduled_advance_days",
  "scheduled_30d",
]);

export function isPlanningRule(requirementType: string): boolean {
  return PLANNING_RULES.has(requirementType);
}
